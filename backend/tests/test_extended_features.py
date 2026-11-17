import pytest
from app.earnings import parse_calendar
from app.financials import trailing_eps
from app.heatmap import parse_holdings
from app.providers import ProviderError
from app.signals import evaluate
from app.demo import demo_bars

def test_calendar_preserves_scheduled_date_and_missing_estimate():
    result=parse_calendar(b'symbol,name,reportDate,fiscalDateEnding,estimate,currency\nAAA,Example,2026-11-18,2026-09-30,,USD\n')
    assert result[0]['report_date']=='2026-11-18'
    assert result[0]['eps_estimate'] is None
    assert result[0]['provenance']['release_time'] is None
    assert result[0]['status']=='provider_scheduled'
    with pytest.raises(ProviderError):parse_calendar(b'{"Information":"Rate limit reached"}')

def test_ttm_uses_four_nonoverlapping_quarters_and_latest_revision():
    records=[{'start':'2025-01-01','end':'2025-03-31','val':1,'filed':'2025-04-20'}, {'start':'2025-04-01','end':'2025-06-30','val':2,'filed':'2025-07-20'}, {'start':'2025-07-01','end':'2025-09-30','val':3,'filed':'2025-10-20'}, {'start':'2025-10-01','end':'2025-12-31','val':4,'filed':'2026-01-20'}]
    assert trailing_eps(records)['value']==10
    assert trailing_eps(records[:3]) is None
    revised=[*records,dict(records[-1],val=5,filed='2026-02-20')]
    assert trailing_eps(revised)['value']==11
    assert trailing_eps([records[0],records[0],records[0],records[0]]) is None

def test_holdings_reject_incomplete_response_and_exclude_non_equities():
    with pytest.raises(ProviderError):parse_holdings(b'Invalid file')
    lines=['Fund Holdings as of,"Nov 13, 2026"','Ticker,Name,Sector,Asset Class,Weight (%)']
    lines += [f'AAA{i},Company {i},Technology,Equity,1.0' for i in range(60)]
    lines += ['USD,Cash,Cash,Cash,10.0']
    stamp,rows=parse_holdings('\n'.join(lines).encode())
    assert stamp=='Nov 13, 2026' and len(rows)==60
    assert not any(r['symbol']=='USD' for r in rows)

def test_each_strategy_exits_only_after_its_own_entry_and_markers_match_bar():
    events=evaluate(demo_bars('NVDA'))
    active={}
    for event in events:
        strategy=event['strategy']
        if event['kind']=='entry':
            assert strategy not in active
            active[strategy]=event
        else:
            assert strategy in active
            assert active[strategy]['time']<event['time']
            del active[strategy]
        assert event['price']==event['source_bar']['close']
        assert event['time']==event['source_bar']['timestamp']


def test_heatmap_watchlist_and_calendar_routes_are_auth_protected(client):
    assert client.get('/heatmap').status_code==401
    assert client.get('/earnings?start=2026-11-01&end=2026-12-01').status_code==401
    assert client.post('/admin/heatmap/refresh',json={}).status_code==401
    assert client.post('/admin/earnings/refresh',json={}).status_code==401
