import asyncio
import hashlib
import json
import sqlite3
import subprocess
import sys
import os
from pathlib import Path
from datetime import datetime,timedelta,timezone
import httpx
import pytest
from sqlalchemy import select,func
from app.config import Settings
from app.providers import HTTP,Alpaca,SEC,FRED,GDELT,ProviderError,session_status
from app.budgets import reserve,usage,cooldown,BudgetExceeded,POLICY
from app.models import ProviderRequest,ProviderCooldown,PriceBar,Instrument,ProviderStatus,now
from app.db import transaction
from app.schemas import BarDTO,Provenance
from app.ingestion import refresh,upsert
from app.cli import backup,restore_test,import_legacy

@pytest.fixture
def cfg():return Settings(alpaca_api_key='fake',alpaca_secret_key='fake',fred_api_key='fake',sec_user_agent='Nidhiksh tests@example.org')

async def test_alpaca_pagination_batch_and_provenance(respx_mock,cfg,monkeypatch):
    # Mock clock-independent old completed session, never any real provider requests.
    route=respx_mock.get('https://data.alpaca.markets/v2/stocks/bars').mock(side_effect=[
        httpx.Response(200,json={'bars':{'NVDA':[{'t':'2025-01-06T05:00:00Z','o':10,'h':12,'l':9,'c':11,'v':100}]},'next_page_token':'page2'}),
        httpx.Response(200,json={'bars':{'AAPL':[{'t':'2025-01-06T05:00:00Z','o':20,'h':22,'l':19,'c':21,'v':200}]},'next_page_token':None})])
    monkeypatch.setattr('app.providers.next_delay',lambda code:0)
    rows=await Alpaca(cfg).bars(['NVDA','AAPL'])
    assert len(rows['NVDA'])==len(rows['AAPL'])==1
    assert route.call_count==2
    assert route.calls[0].request.url.params['symbols']=='NVDA,AAPL'
    assert route.calls[0].request.url.params['adjustment']=='split'
    assert route.calls[1].request.url.params['page_token']=='page2'
    p=rows['NVDA'][0].provenance
    assert p.source=='alpaca' and p.feed=='sip' and p.delay_seconds==900
    assert datetime.fromisoformat(rows['NVDA'][0].available_at)>datetime.fromisoformat(rows['NVDA'][0].event_time)
    assert len(list_rows(ProviderRequest))==2

async def test_429_stops_calls_persists_cooldown_and_no_secret_leak(respx_mock,monkeypatch):
    monkeypatch.setattr('app.providers.next_delay',lambda code:0)
    route=respx_mock.get('https://api.stlouisfed.org/fred/series/observations').mock(return_value=httpx.Response(429,headers={'Retry-After':'120'}))
    for _ in range(2):
        with pytest.raises(ProviderError) as error:
            await HTTP().get('https://api.stlouisfed.org/fred/series/observations',params={'api_key':'NEVER-ECHO-ME'})
        assert 'NEVER-ECHO-ME' not in str(error.value)
    assert route.call_count==1
    assert usage()['fred']['paused'] is True

def list_rows(model):
    with transaction() as db:return list(db.scalars(select(model)))

def test_internal_minute_and_daily_caps_survive_new_sessions():
    at=datetime(2026,11,17,12,tzinfo=timezone.utc)
    for _ in range(POLICY['alpaca']['minute']):reserve('alpaca',at)
    with pytest.raises(BudgetExceeded):reserve('alpaca',at)
    with transaction() as db:
        assert db.get(ProviderCooldown,'alpaca').until
        assert db.scalar(select(func.count()).select_from(ProviderRequest))==60
    # Midnight reset applies to daily budget; reservation history persists.
    assert reserve('alpaca',at+timedelta(days=1))

def test_daily_cap_independent_from_minute_limit():
    at=datetime(2026,11,17,12,tzinfo=timezone.utc)
    with transaction() as db:
        for i in range(POLICY['fred']['day']):
            db.add(ProviderRequest(provider='fred',at=(at-timedelta(minutes=10+i)).isoformat().replace('+00:00','Z')))
    with pytest.raises(BudgetExceeded,match='budget'):reserve('fred',at)
    with transaction() as db:assert db.get(ProviderCooldown,'fred').until.startswith('2026-11-18')

async def test_sec_acceptance_and_original_filing_link(respx_mock,cfg,monkeypatch):
    monkeypatch.setattr('app.providers.next_delay',lambda code:0)
    respx_mock.get('https://data.sec.gov/submissions/CIK0001045810.json').mock(return_value=httpx.Response(200,json={'filings':{'recent':{'form':['4'],'accessionNumber':['0001045810-25-000001'],'primaryDocument':['form4.xml'],'filingDate':['2025-01-06'],'acceptanceDateTime':['2025-01-06T21:05:00Z'],'reportDate':['2025-01-03']}}}))
    row=(await SEC(cfg).filings('1045810'))[0]
    assert row['event_time']=='2025-01-06'
    assert row['available_at']=='2025-01-06T21:05:00Z'
    assert '/1045810/000104581025000001/form4.xml' in row['url']
    assert row['payload']['report_date']=='2025-01-03'

async def test_gdelt_batches_metadata_and_does_not_invent_publication(respx_mock,monkeypatch):
    monkeypatch.setattr('app.providers.next_delay',lambda code:0)
    route=respx_mock.get('https://api.gdeltproject.org/api/v2/doc/doc').mock(return_value=httpx.Response(200,json={'articles':[{'title':'NVIDIA company announcement','url':'https://example.org/announcement','domain':'example.org','seendate':'20250106T210000Z'},{'title':'Bad URL','url':'javascript:alert(1)'}]}))
    rows=await GDELT().news_batch(['NVIDIA','Microsoft'])
    assert len(rows)==1 and route.call_count==1
    assert ' OR ' in route.calls[0].request.url.params['query']
    assert rows[0]['published_at'] is None
    assert rows[0]['payload']['seen_at']=='2025-01-06T21:00:00+00:00'
    assert 'body' not in rows[0]

async def test_no_fred_storage_without_written_permission(respx_mock):
    result=await refresh(['fred'])
    assert result['fred']['status']=='unavailable'
    assert 'terms' in result['fred']['message']
    assert len(respx_mock.calls)==0

def test_holiday_early_close_and_regular_session_calendar():
    assert session_status(datetime(2025,7,4,16,tzinfo=timezone.utc))['status']=='closed'
    assert session_status(datetime(2025,7,3,18,tzinfo=timezone.utc))['status']=='closed'
    assert session_status(datetime(2025,7,7,16,tzinfo=timezone.utc))['status']=='open'

def test_bar_contract_rejects_invalid_ohlc(cfg):
    p=Provenance(source='test',feed='test',observed_at=now(),fetched_at=now())
    with pytest.raises(ValueError):BarDTO(timestamp=now(),open=10,high=9,low=8,close=10,volume=100,event_time=now(),available_at=now(),provenance=p)

def test_idempotent_upsert_and_outage_stale_cache(admin_client):
    with transaction() as db:
        i=db.scalar(select(Instrument).where(Instrument.symbol=='NVDA'))
        row=dict(instrument_id=i.id,timeframe='1d',timestamp='2025-01-06T05:00:00Z',open=10,high=12,low=9,close=11,volume=100,provider='alpaca',feed='sip',adjustment='split',event_time='2025-01-06T21:00:00Z',available_at='2025-01-06T21:15:00Z',observed_at=now(),fetched_at=now(),source_last_updated=None,provenance={'source':'alpaca','feed':'sip','fetched_at':now(),'adjustment':'split'})
        for _ in range(2):upsert(db,PriceBar,row,['instrument_id','timeframe','timestamp','provider','feed','adjustment'])
        db.add(ProviderStatus(code='alpaca',status='error',message='outage'))
    result=admin_client.get('/instruments/NVDA/quote').json()
    assert result['price']==11 and result['freshness']['stale'] is True
    assert len(list_rows(PriceBar))==1

def test_online_backup_restore_and_legacy_source_preserved(tmp_path):
    source=tmp_path/'legacy.sqlite'
    schema=Path('..' if not Path('starter_database').exists() else '.').resolve()/'starter_database/schema.sql'
    with sqlite3.connect(source) as db:
        db.executescript(schema.read_text())
        db.execute("insert into instruments(id,symbol,name,asset_type) values(1,'NVDA','NVIDIA','stock')")
        db.execute("insert into price_bars values(1,'1d','2025-01-06T05:00:00Z',10,12,9,11,100,NULL,'legacy','2025-01-07T00:00:00Z')")
    original=hashlib.sha256(source.read_bytes()).hexdigest()
    import_legacy(source)
    assert hashlib.sha256(source.read_bytes()).hexdigest()==original
    row=list_rows(PriceBar)[0]
    assert row.provider=='legacy_unverified' and row.adjustment=='unknown'
    from app.db import engine
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE IF NOT EXISTS alembic_version (version_num TEXT PRIMARY KEY)')
    destination=tmp_path/'backup.sqlite'
    backup(destination);restore_test(destination)
    assert destination.stat().st_mode&0o777==0o600

def test_fresh_migrations_subprocess(tmp_path):
    env=dict(os.environ,DATABASE_URL='sqlite:///'+str(tmp_path/'fresh.sqlite'))
    script="from alembic import command;from alembic.config import Config;command.upgrade(Config('backend/alembic.ini'),'head')"
    result=subprocess.run([sys.executable,'-c',script],env=env,capture_output=True,text=True,cwd=Path(__file__).resolve().parents[2])
    assert result.returncode==0,result.stderr
    with sqlite3.connect(tmp_path/'fresh.sqlite') as db:
        assert db.execute('select version_num from alembic_version').fetchone()[0]
        names={r[0] for r in db.execute("select name from sqlite_master where type='table'")}
        assert {'price_bars','users','provider_requests','economic_series','signal_events'}<=names
