from datetime import datetime,timezone,timedelta
import asyncio
import pytest
from sqlalchemy import select,func
from app.config import settings
from app.db import transaction
from app.models import PriceBar,Instrument,IntradayCache
from app.providers import HTTP,ProviderError
from app.intraday import refresh_if_due,get_cache,normalize

AT=datetime(2026,11,17,16,0,tzinfo=timezone.utc)

def payload(feed):
    if feed=='delayed_sip':return {'bars':{'NVDA':[{'t':'2026-11-17T15:43:00Z','c':102}]},'next_page_token':None}
    return {'NVDA':{'latestTrade':{'t':'2026-11-17T15:59:50Z','p':103}}}

async def test_two_batches_shared_across_clients_and_closed_market_makes_no_calls(monkeypatch):
    monkeypatch.setattr(settings(),'intraday_enabled',True);calls=[]
    async def mock(self,url,**kwargs):calls.append(kwargs['params']);await asyncio.sleep(.01);return payload('iex' if 'snapshots' in url else 'delayed_sip')
    monkeypatch.setattr(HTTP,'get',mock)
    a,b=await asyncio.gather(refresh_if_due(active_admin=True,at=AT),refresh_if_due(active_admin=True,at=AT))
    assert len(calls)==2 and len(calls[0]['symbols'].split(','))==25
    assert a['feeds']['iex']['items']['NVDA']['price']==103
    assert b['feeds']['delayed_sip']['items']['NVDA']['price']==102
    await refresh_if_due(active_admin=True,at=AT+timedelta(seconds=59));assert len(calls)==2
    await refresh_if_due(active_admin=True,at=AT.replace(hour=23));assert len(calls)==2

async def test_disabled_or_inactive_admin_never_fetches(monkeypatch):
    async def forbidden(*args,**kwargs):raise AssertionError('No outbound calls expected')
    monkeypatch.setattr(HTTP,'get',forbidden)
    monkeypatch.setattr(settings(),'intraday_enabled',False)
    assert not (await refresh_if_due(active_admin=True,at=AT))['configured']
    monkeypatch.setattr(settings(),'intraday_enabled',True)
    assert (await refresh_if_due(active_admin=False,at=AT))['feeds']['iex']['status']=='not_fetched'

async def test_delayed_feed_waits_for_first_eligible_session_price(monkeypatch):
    monkeypatch.setattr(settings(),'intraday_enabled',True);calls=[]
    async def mock(self,url,**kwargs):calls.append(url);return {}
    monkeypatch.setattr(HTTP,'get',mock)
    result=await refresh_if_due(active_admin=True,at=AT.replace(hour=14,minute=35))
    assert len(calls)==1 and 'snapshots' in calls[0]
    assert result['feeds']['delayed_sip']['status']=='waiting_for_delayed_session'

def test_normalization_rejects_future_prices_and_missing_baselines():
    rows=normalize(payload('delayed_sip'),'delayed_sip',['NVDA'],AT,{})
    assert rows['NVDA']['as_of']=='2026-11-17T15:44:00Z'
    assert rows['NVDA']['change_percent'] is None
    assert normalize({'NVDA':{'latestTrade':{'t':'2026-11-17T17:00:00Z','p':200}}},'iex',['NVDA'],AT,{})=={}
    with pytest.raises(ProviderError):normalize({'bars':{},'next_page_token':'more'},'delayed_sip',['NVDA'],AT,{})

async def test_outage_retains_cache_and_does_not_modify_daily_bars(monkeypatch):
    monkeypatch.setattr(settings(),'intraday_enabled',True)
    with transaction() as db:db.add(IntradayCache(feed='iex',last_attempt='2026-11-17T15:00:00Z',fetched_at='2026-11-17T15:00:00Z',status='cached',message='',items={'NVDA':{'price':100,'as_of':'2026-11-17T15:00:00Z','status':'cached'}}))
    async def fail(*args,**kwargs):raise ProviderError('Network unavailable; cached prices retained')
    monkeypatch.setattr(HTTP,'get',fail)
    result=await refresh_if_due(active_admin=True,at=AT)
    assert result['feeds']['iex']['items']['NVDA']['price']==100
    assert result['feeds']['iex']['items']['NVDA']['status']=='stale'
    assert result['feeds']['iex']['status']=='error'
    with transaction() as db:assert db.scalar(select(func.count()).select_from(PriceBar))==0

def test_routes_auth_and_viewer_access(client):
    assert client.get('/quotes/intraday').status_code==401
    assert client.post('/admin/quotes/intraday/refresh',json={}).status_code==401
    r=client.post('/auth/login',json={'username':'viewer','password':'test-viewer-password'},headers={'Origin':'http://localhost:3000'})
    client.headers.update({'Origin':'http://localhost:3000','X-CSRF-Token':r.json()['csrf']})
    assert client.get('/quotes/intraday').status_code==403
    assert client.get('/quotes/intraday?mode=demo').status_code==200
    assert client.post('/admin/quotes/intraday/refresh',json={}).status_code==403


def test_change_uses_explicit_consolidated_baseline():
    row=normalize(payload('iex'),'iex',['NVDA'],AT,{'NVDA':(100,'2026-11-16T21:00:00Z')})['NVDA']
    assert row['change_percent']==pytest.approx(3)
    assert row['previous_close_as_of']=='2026-11-16T21:00:00Z'
    assert row['change_basis']=='previous completed consolidated session close'

async def test_exhausted_budget_blocks_both_price_feeds(monkeypatch):
    from app.models import ProviderRequest,now
    from app.budgets import POLICY
    monkeypatch.setattr(settings(),'intraday_enabled',True)
    with transaction() as db:
        for _ in range(POLICY['alpaca']['day']):db.add(ProviderRequest(provider='alpaca',at=now()))
    async def forbidden(*args,**kwargs):raise AssertionError('Budget must block both feeds')
    monkeypatch.setattr(HTTP,'get',forbidden)
    result=await refresh_if_due(active_admin=True,at=AT)
    assert result['budget']['paused']
    assert all(feed['status']=='budget_paused' for feed in result['feeds'].values())


def test_invalid_snapshot_entry_is_not_a_price():
    assert normalize({'NVDA':[]},'iex',['NVDA'],AT,{})=={}
