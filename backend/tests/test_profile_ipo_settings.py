import asyncio
from datetime import date
import pytest
from sqlalchemy import select,func
from app.config import settings
from app.db import transaction
from app.models import ProviderRequest,IPOCalendarCache,now
from app.providers import ProviderError,HTTP
from app.profiles import fetch_profile
from app.ipos import parse_calendar,items
from app.schemas import IndicatorConfig


def test_premium_profile_is_blocked_without_an_outbound_request(admin_client,monkeypatch):
    monkeypatch.setattr(settings(),'alpha_vantage_overview_enabled',False)
    async def forbidden(*args,**kwargs):raise AssertionError('Free account must not request premium data')
    monkeypatch.setattr(HTTP,'get',forbidden)
    before=admin_client.get('/instruments/NVDA/fundamentals').json()
    assert before['profile_access']['status']=='premium_required'
    assert not before['profile_access']['can_refresh']
    response=admin_client.post('/admin/instruments/NVDA/profile',json={})
    assert response.status_code==403 and 'premium' in response.json()['detail'].lower()
    with pytest.raises(ProviderError,match='premium'):asyncio.run(fetch_profile('NVDA'))
    with transaction() as db:assert db.scalar(select(func.count()).select_from(ProviderRequest))==0


def test_profile_errors_are_safe_and_distinguish_premium_from_missing_data(monkeypatch):
    monkeypatch.setattr(settings(),'alpha_vantage_overview_enabled',True)
    monkeypatch.setattr(settings(),'alpha_vantage_api_key','test-only')
    async def premium(*args,**kwargs):return {'Information':'This is a premium endpoint. Sensitive key test-only'}
    monkeypatch.setattr(HTTP,'get',premium)
    with pytest.raises(ProviderError,match='premium access') as error:asyncio.run(fetch_profile('NVDA'))
    assert 'test-only' not in str(error.value)


def test_bollinger_settings_persist_and_preview_matches_saved_chart(admin_client):
    cfg=IndicatorConfig(bb=True,bb_period=25,bb_std=2.5).model_dump()
    preview=admin_client.post('/instruments/NVDA/indicators/preview',json={'mode':'demo','config':cfg})
    assert preview.status_code==200 and preview.json()['values']['bb_upper']>preview.json()['values']['bb_lower']
    assert admin_client.put('/settings/indicators',json=cfg).status_code==200
    assert admin_client.get('/settings').json()['indicators']==cfg
    saved=admin_client.get('/instruments/NVDA/bars?mode=demo').json()['indicators']
    assert saved['bb_upper'][-1]==preview.json()['values']['bb_upper']


def test_ipo_csv_and_verified_announcements_preserve_estimates():
    rows=parse_calendar(b'symbol,name,ipoDate,priceRangeLow,priceRangeHigh,currency,exchange\nAAA,Example,2026-11-23,10,12,USD,NASDAQ\nBBB,Another,2026-11-24,,,USD,NYSE\n')
    assert rows[0]['price_low']==10 and rows[1]['price_low'] is None
    assert rows[0]['status']=='provider_scheduled'
    verified=next(r for r in items(rows,at=date(2026,11,16)) if r['symbol']=='ANT')
    assert verified['expected_date']=='2026-11-19' and verified['price_low']==70
    assert verified['provider']=='issuer_announcement'
    assert not items([],at=date(2027,1,1))
    with pytest.raises(ProviderError):parse_calendar(b'{"Information":"No calendar"}')


def test_ipo_schedule_is_authenticated_and_reuses_fresh_cache(admin_client):
    with transaction() as db:db.add(IPOCalendarCache(provider='alpha_vantage',fetched_at=now(),source_url='https://www.alphavantage.co/documentation/#ipo-calendar',items=[]))
    assert admin_client.get('/ipos').status_code==200
    assert admin_client.post('/admin/ipos/refresh',json={}).json()['status']=='cached'
    admin_client.post('/auth/logout',json={})
    assert admin_client.get('/ipos').status_code==401
    assert admin_client.get('/markets/session').status_code==401


def test_auto_theme_and_dismissed_updates_are_account_settings(admin_client):
    body={'theme':'auto','dismissed_news':['NVDA:123']}
    assert admin_client.put('/settings/workspace',json=body).status_code==200
    saved=admin_client.get('/settings').json()['workspace']
    assert saved['theme']=='auto' and saved['dismissed_news']==['NVDA:123']
    assert admin_client.get('/markets/session').json()['status'] in ['open','closed','pre-market']


def test_calendar_budget_disables_refresh_before_any_extra_attempt(admin_client):
    from app.budgets import POLICY,usage
    with transaction() as db:
        for _ in range(POLICY['alpha_vantage']['day']):db.add(ProviderRequest(provider='alpha_vantage',at=now(),status_code=200))
    calendar=admin_client.get('/earnings?start=2026-11-01&end=2026-12-01').json()
    assert calendar['budget']['paused'] and not calendar['can_refresh']
    assert admin_client.post('/admin/earnings/refresh',json={}).status_code==429
    assert admin_client.post('/admin/ipos/refresh',json={}).status_code==429
    assert usage()['alpha_vantage']['day_used']==POLICY['alpha_vantage']['day']


def test_corporate_action_route_respects_modes_and_auth(admin_client):
    result=admin_client.get('/instruments/NVDA/corporate-actions?mode=demo')
    assert result.status_code==200 and result.json()['items']==[] and result.json()['symbol_history']==[]
    admin_client.post('/auth/logout',json={})
    assert admin_client.get('/instruments/NVDA/corporate-actions').status_code==401


def test_outbound_spacing_respects_the_minute_budget():
    from app.budgets import reserve,next_delay
    reserve('logos')
    assert next_delay('logos')>=3.5
