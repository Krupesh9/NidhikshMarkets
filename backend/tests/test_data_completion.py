import asyncio
from datetime import datetime,timezone
import httpx
import pytest
from sqlalchemy import select,func
from app.config import Settings
from app.db import transaction
from app.models import Instrument,InstrumentDirectory,ProviderStatus,CorporateAction,now
from app.heatmap import parse_invesco_holdings
from app.sec_mapping import parse_ticker_directory,map_missing_ciks
from app.corporate_actions import normalize_actions,persist_actions
from app.providers import Alpaca,HTTP,ProviderError


def qqq_payload():
    equities=[{'ticker':f'AAA{i}','issuerName':f'Company {i}','securityTypeCode':'COM','percentageOfTotalNetAssets':.5} for i in range(98)]
    return {'effectiveBusinessDate':'2026-11-13','holdings':equities+[{'ticker':'ASML','issuerName':'ASML','securityTypeCode':'DRNY','percentageOfTotalNetAssets':1.2},{'ticker':'ARM','issuerName':'ARM','securityTypeCode':'ADR','percentageOfTotalNetAssets':.3},{'ticker':'PDD','issuerName':'PDD','securityTypeCode':'ADR','percentageOfTotalNetAssets':.2},{'ticker':'USD','securityTypeCode':'CASH','percentageOfTotalNetAssets':3}]}

def test_qqq_keeps_receipts_and_rejects_corrupt_weights():
    stamp,rows=parse_invesco_holdings(qqq_payload())
    assert stamp=='2026-11-13' and len(rows)==101
    assert {'ASML','ARM','PDD'}<={r['symbol'] for r in rows}
    assert not any(r['symbol']=='USD' for r in rows)
    payload=qqq_payload();payload['holdings'][0]['percentageOfTotalNetAssets']='oops'
    with pytest.raises(ProviderError):parse_invesco_holdings(payload)
    payload=qqq_payload();payload['holdings'].append(payload['holdings'][0])
    with pytest.raises(ProviderError,match='duplicate'):parse_invesco_holdings(payload)

def test_sec_bulk_mapping_handles_share_class_punctuation_and_ambiguity():
    result=parse_ticker_directory({'fields':['cik','name','ticker','exchange'],'data':[[123,'Example','BRK-B','NYSE'],[456,'Ambiguous 1','DUP','NYSE'],[789,'Ambiguous 2','DUP','Nasdaq']]})
    assert result['BRK-B']['cik']=='123' and 'DUP' not in result
    with pytest.raises(ProviderError):parse_ticker_directory({'data':[]})

async def test_new_company_sec_mapping_is_cached_and_idempotent(monkeypatch):
    with transaction() as db:
        item=db.scalar(select(Instrument).where(Instrument.symbol=='NVDA'));item.cik=None
        db.add(InstrumentDirectory(symbol='NVDA',name='NVIDIA',exchange='NASDAQ',provider_id='asset-1',fetched_at=now(),payload={}))
    calls=[]
    async def fake(self):
        calls.append(True);return {'NVDA':{'cik':'1045810','name':'NVIDIA','exchange':'Nasdaq'}}
    monkeypatch.setattr('app.providers.SEC.ticker_directory',fake)
    cfg=Settings(sec_user_agent='Test tests@example.org')
    with transaction() as db:items=list(db.scalars(select(Instrument).where(Instrument.symbol=='NVDA')))
    assert await map_missing_ciks(items,cfg)==1 and items[0].cik=='1045810'
    with transaction() as db:
        row=db.scalar(select(Instrument).where(Instrument.symbol=='NVDA'))
        assert row.cik=='1045810' and row.symbol_history[-1]['source'].endswith('company_tickers_exchange.json')
        row.cik=None
    with transaction() as db:items=list(db.scalars(select(Instrument).where(Instrument.symbol=='NVDA')))
    assert await map_missing_ciks(items,cfg)==1
    assert len(calls)==1

async def test_corporate_action_batch_pagination_uses_market_data_api(respx_mock,monkeypatch):
    monkeypatch.setattr('app.providers.next_delay',lambda code:0)
    action={'id':'split-1','symbol':'NVDA','new_rate':10,'old_rate':1,'process_date':'2024-06-10','ex_date':'2024-06-10'}
    route=respx_mock.get('https://data.alpaca.markets/v1/corporate-actions').mock(side_effect=[httpx.Response(200,json={'corporate_actions':{'forward_splits':[action]},'next_page_token':'next'}),httpx.Response(200,json={'corporate_actions':{'cash_dividends':[]},'next_page_token':None})])
    cfg=Settings(alpaca_api_key='test-only',alpaca_secret_key='test-only')
    rows=await Alpaca(cfg).corporate_actions(['NVDA','AAPL'],start='2024-01-01',end='2024-12-31')
    assert len(rows)==1 and route.call_count==2
    assert route.calls[0].request.url.params['symbols']=='NVDA,AAPL'
    assert route.calls[1].request.url.params['page_token']=='next'
    assert rows[0]['event_time']=='2024-06-10'

def test_corporate_actions_are_idempotent_and_preserve_revision_availability():
    action={'id':'name-1','old_symbol':'OLD','new_symbol':'NVDA','process_date':'2024-01-01'}
    rows=normalize_actions({'name_changes':[action]},['NVDA'])
    with transaction() as db:
        assert persist_actions(db,rows,observed_at='2026-01-01T01:00:00Z')==1
        db.flush()
        assert persist_actions(db,rows,observed_at='2026-01-02T01:00:00Z')==0
        action2=dict(action,process_date='2024-01-02')
        assert persist_actions(db,normalize_actions({'name_changes':[action2]},['NVDA']),observed_at='2026-01-03T01:00:00Z')==1
    with transaction() as db:
        assert db.scalar(select(func.count()).select_from(CorporateAction))==1
        row=db.scalar(select(CorporateAction));assert row.available_at=='2026-01-01T01:00:00Z'
        assert row.event_time=='2024-01-02' and len(row.payload['revisions'])==1
        instrument=db.scalar(select(Instrument).where(Instrument.symbol=='NVDA'))
        assert instrument.symbol=='NVDA' and len(instrument.symbol_history)==1
    with pytest.raises(ProviderError):normalize_actions({'forward_splits':[{'id':'bad','symbol':'NVDA','ex_date':'invalid'}]},['NVDA'])


async def test_failed_sec_mapping_is_not_retried_for_every_new_symbol(monkeypatch):
    with transaction() as db:
        row=db.scalar(select(Instrument).where(Instrument.symbol=='NVDA'));row.cik=None
    calls=[]
    async def unavailable(self):
        calls.append(True);raise ProviderError('Provider HTTP 403; mapping unavailable')
    monkeypatch.setattr('app.providers.SEC.ticker_directory',unavailable)
    cfg=Settings(sec_user_agent='Test tests@example.org')
    for _ in range(2):
        with transaction() as db:items=list(db.scalars(select(Instrument).where(Instrument.symbol=='NVDA')))
        assert await map_missing_ciks(items,cfg)==0
    assert len(calls)==1

async def test_sec_missing_companyfacts_does_not_abort_other_issuers_or_drop_filings(monkeypatch):
    from app.ingestion import refresh
    from app.models import Fundamental,Filing
    from app.providers import ProviderNotFound
    with transaction() as db:
        spy=db.scalar(select(Instrument).where(Instrument.symbol=='SPY'));spy.cik='884394'
        db.add(Fundamental(instrument_id=spy.id,provider='sec',available_at=now(),fetched_at=now(),payload={'facts':{'Assets':{'val':123}},'note':'Previously cached source facts'}))
    completed=[]
    async def filings(self,cik):
        return [{'accession':f'{cik}-filing','form':'8-K','url':f'https://www.sec.gov/Archives/{cik}/filing.htm','event_time':'2026-01-01','available_at':now(),'fetched_at':now(),'payload':{'source':'SEC EDGAR'}}]
    async def facts(self,cik):
        if cik=='884394':raise ProviderNotFound('Provider HTTP 404; requested source record unavailable')
        completed.append(cik)
        return {'facts':{'Assets':{'val':42}},'fetched_at':now(),'source':'SEC companyfacts'}
    monkeypatch.setattr('app.providers.SEC.filings',filings)
    monkeypatch.setattr('app.providers.SEC.fundamentals',facts)
    result=await refresh(['sec'],symbols=['NVDA','SPY','O'])
    assert result['sec']['status']=='ready'
    assert result['sec']['missing_components']==['SPY:fundamentals']
    assert completed==['1045810','726728']
    with transaction() as db:
        spy=db.scalar(select(Instrument).where(Instrument.symbol=='SPY'))
        assert len(list(db.scalars(select(Filing).where(Filing.instrument_id==spy.id))))==1
        facts=list(db.scalars(select(Fundamental).where(Fundamental.instrument_id==spy.id)))
        assert len(facts)==1 and facts[0].payload['facts']['Assets']['val']==123
        missing=db.get(ProviderStatus,'sec:SPY:fundamentals')
        assert missing.status=='missing' and 'Previous cached facts retained' in missing.message
        assert 'CIK0000884394.json' in missing.message
        assert db.get(ProviderStatus,'sec:O:fundamentals').status=='ready'

@pytest.mark.parametrize('failure',['Provider HTTP 401; credentials invalid','Provider HTTP 403; not entitled','Provider rate limit reached; outbound refresh paused','sec refresh paused until tomorrow: app request budget reached'])
async def test_sec_global_failures_still_stop_the_batch(monkeypatch,failure):
    from app.ingestion import refresh
    called=[]
    async def filings(self,cik):return []
    async def facts(self,cik):
        called.append(cik)
        raise ProviderError(failure)
    monkeypatch.setattr('app.providers.SEC.filings',filings)
    monkeypatch.setattr('app.providers.SEC.fundamentals',facts)
    result=await refresh(['sec'],symbols=['NVDA','O'])
    assert result['sec']['status']=='unavailable' and result['sec']['message']==failure
    assert called==['1045810']

async def test_http_missing_record_has_typed_error_without_exposing_request(respx_mock,monkeypatch):
    from app.providers import ProviderNotFound
    monkeypatch.setattr('app.providers.next_delay',lambda code:0)
    respx_mock.get('https://data.sec.gov/api/xbrl/companyfacts/CIK0000884394.json').mock(return_value=httpx.Response(404))
    with pytest.raises(ProviderNotFound) as error:await HTTP().get('https://data.sec.gov/api/xbrl/companyfacts/CIK0000884394.json',headers={'User-Agent':'Private contact never-print@example.org'})
    assert error.value.status_code==404 and 'never-print' not in str(error.value)
