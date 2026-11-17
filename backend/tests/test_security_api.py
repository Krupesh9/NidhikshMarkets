from sqlalchemy import select,delete
from app.db import transaction
from app.models import LoginSession,AppSetting,SignalEvent,PriceBar

ORIGIN={'Origin':'http://localhost:3000'}

def test_all_research_and_admin_routes_require_login(client):
    for path in ['/health','/providers/status','/instruments/search','/markets/overview','/watchlists','/presets','/settings','/scanner','/instruments/NVDA/bars','/instruments/NVDA/quote','/instruments/NVDA/fundamentals','/instruments/NVDA/news','/instruments/NVDA/filings','/instruments/NVDA/signals','/admin/users']:
        assert client.get(path).status_code==401,path
    assert client.post('/admin/refresh',json={}).status_code==401

def test_login_origin_csrf_and_session_revocation(client):
    assert client.post('/auth/login',json={'username':'admin','password':'test-admin-password'}).status_code==403
    response=client.post('/auth/login',json={'username':'admin','password':'test-admin-password'},headers=ORIGIN)
    assert response.status_code==200
    cookie=response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=strict' in cookie
    assert client.post('/watchlists',json={'name':'Test','symbols':['NVDA']},headers=ORIGIN).status_code==403
    headers={**ORIGIN,'X-CSRF-Token':response.json()['csrf']}
    assert client.post('/watchlists',json={'name':'Test','symbols':['NVDA']},headers=headers).status_code==200
    assert client.post('/watchlists',json={'name':'Test','symbols':[]},headers={**headers,'Origin':'https://evil.example'}).status_code==403
    with transaction() as db:db.execute(delete(LoginSession))
    assert client.get('/settings').status_code==401

def test_viewer_denied_admin_and_market_but_can_save_own_settings(client):
    r=client.post('/auth/login',json={'username':'viewer','password':'test-viewer-password'},headers=ORIGIN)
    headers={**ORIGIN,'X-CSRF-Token':r.json()['csrf']}
    assert client.post('/admin/refresh',json={},headers=headers).status_code==403
    assert client.get('/admin/users').status_code==403
    assert client.post('/instruments',json={'symbol':'GOOG'},headers=headers).status_code==403
    assert client.get('/instruments/NVDA/bars?mode=market').status_code==403
    assert client.get('/instruments/NVDA/bars?mode=demo').status_code==200
    assert client.put('/settings/workspace',json={'theme':'dark'},headers=headers).status_code==200

def test_login_throttles_eighth_failure(client):
    for _ in range(8):assert client.post('/auth/login',json={'username':'admin','password':'incorrect-password'},headers=ORIGIN).status_code==401
    assert client.post('/auth/login',json={'username':'admin','password':'test-admin-password'},headers=ORIGIN).status_code==429

def test_preferences_presets_watchlists_are_user_isolated(admin_client):
    c=admin_client
    assert c.post('/watchlists',json={'name':'Private','symbols':['NVDA','AAPL']}).status_code==200
    list_id=c.get('/watchlists').json()[0]['id']
    assert c.post('/presets',json={'name':'My setup','config':{'sma':[20]}}).status_code==200
    preset_id=c.get('/presets').json()[0]['id']
    assert c.put('/settings/workspace',json={'theme':'dark'}).status_code==200
    c.post('/auth/logout',json={})
    r=c.post('/auth/login',json={'username':'viewer','password':'test-viewer-password'},headers=ORIGIN)
    c.headers.update({'X-CSRF-Token':r.json()['csrf']})
    assert c.get('/watchlists').json()==[]
    assert c.get('/presets').json()==[]
    assert c.get('/settings').json()['workspace']['theme']=='auto'
    assert c.delete(f'/watchlists/{list_id}').status_code==404
    assert c.delete(f'/presets/{preset_id}').status_code==404

def test_missing_provider_not_fabricated_and_demo_not_persisted(admin_client):
    c=admin_client
    assert c.get('/instruments/NVDA/quote').json()['price'] is None
    assert c.get('/instruments/NVDA/bars').json()['bars']==[]
    assert c.get('/instruments/NVDA/signals').json()['status']=='no_candidate'
    result=c.get('/instruments/NVDA/bars?mode=demo').json()
    assert result['bars'] and result['freshness']['status']=='demo'
    assert result['bars'][0]['provenance']['source']=='synthetic_demo'
    with transaction() as db:
        assert not list(db.scalars(select(PriceBar)))
        assert not list(db.scalars(select(SignalEvent)))
    assert c.get('/instruments/NVDA/news?mode=demo').json()['items']==[]

def test_config_validation_and_preview_does_not_save(admin_client):
    c=admin_client
    assert c.put('/settings/indicators',json={'sma':[7]}).status_code==422
    assert c.put('/settings/indicators',json={'rsi_lower':80,'rsi_upper':30}).status_code==422
    assert c.put('/settings/strategies',json={'trend_fast':100,'trend_mid':50}).status_code==422
    original=c.get('/settings').json()['indicators']
    preview=c.post('/instruments/NVDA/indicators/preview',json={'mode':'demo','config':{'sma':[20],'bb':True}})
    assert preview.status_code==200 and preview.json()['values']['bb_upper']>0
    assert c.get('/settings').json()['indicators']==original
    assert c.get('/instruments/../../auth/login/bars').status_code in [401,404]
    assert c.get('/instruments/NVDA/bars?range=100y').status_code==422
    assert c.post('/watchlists',json={'name':'Bad','symbols':['INVALID']}).status_code==422

def test_scanner_is_local_and_sourced(admin_client):
    response=admin_client.get('/scanner?mode=demo&filter=above_sma200')
    assert response.status_code==200
    payload=response.json()
    assert payload['external_calls']==0
    assert all(item['close']>item['sma200'] for item in payload['items'])
