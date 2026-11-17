import math
from datetime import datetime,timedelta,timezone
import numpy as np
import pandas as pd
import pytest
from hypothesis import given,strategies as st,settings,HealthCheck
from app.indicators import sma,ema,rsi,bollinger,atr,relative_volume,calculate
from app.signals import evaluate
from app.schemas import IndicatorConfig,StrategyConfig
from app.demo import demo_bars

def make_bars(closes,highs=None,volumes=None):
    start=datetime(2025,1,1,tzinfo=timezone.utc)
    return [{'timestamp':(start+timedelta(days=i)).isoformat(),'open':float(c),'high':float(highs[i] if highs else c+1),'low':float(c-1),'close':float(c),'volume':float(volumes[i] if volumes else 100)} for i,c in enumerate(closes)]

def test_sma_ema_bollinger_independent_arithmetic():
    series=pd.Series([1.,2.,3.,4.,5.])
    assert sma(series,3).tolist()[2:]==[2,3,4]
    # SMA seed of 2, then alpha .5 => 3 then 4.
    assert ema(series,3).tolist()[2:]==[2,3,4]
    low,mid,high=bollinger(series,3,2)
    assert mid.iloc[-1]==4
    assert high.iloc[-1]==pytest.approx(4+2*math.sqrt(2/3))
    assert low.iloc[-1]==pytest.approx(4-2*math.sqrt(2/3))

def test_wilder_rsi_published_reference_series():
    # Wilder's commonly reproduced worksheet: seed gains .238571, losses .10.
    close=pd.Series([44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64,46.21])
    result=rsi(close,14)
    assert result.iloc[:14].isna().all()
    assert result.iloc[14]==pytest.approx(70.464135,abs=1e-5)
    assert result.iloc[15]==pytest.approx(66.249619,abs=1e-5)
    assert result.iloc[16]==pytest.approx(66.480942,abs=1e-5)
    assert rsi(pd.Series([1.]*30)).iloc[-1]==50
    assert rsi(pd.Series(range(30),dtype=float)).iloc[-1]==100

def test_atr_gaps_and_relative_volume_excludes_current():
    f=pd.DataFrame({'high':[10,12,17],'low':[8,9,15],'close':[9,11,16]})
    # TR=2,3,6. Initial ATR(3)=11/3.
    assert atr(f,3).iloc[-1]==pytest.approx(11/3)
    assert relative_volume(pd.Series([100.]*20+[200.]),20).iloc[-1]==2

def test_splits_use_consistent_ohlc_and_scale_invariance():
    bars=make_bars(list(range(100,350)))
    split=[dict(b,**{k:b[k]/4 for k in ['open','high','low','close']},volume=b['volume']*4) for b in bars]
    config=IndicatorConfig(bb=True,atr=True,rvol=True)
    a,b=calculate(bars,config),calculate(split,config)
    assert b['sma200'][-1]==pytest.approx(a['sma200'][-1]/4)
    assert b['rsi'][-1]==a['rsi'][-1]
    assert b['atr'][-1]==pytest.approx(a['atr'][-1]/4,abs=1e-7)

def test_breakout_golden_prior_window_and_next_exit():
    closes=[10.]*25+[12.,8.]
    bars=make_bars(closes,volumes=[100]*25+[200,100])
    events=[e for e in evaluate(bars) if e['strategy']=='breakout']
    assert [(e['kind'],e['time']) for e in events]==[('entry',bars[25]['timestamp']),('exit',bars[26]['timestamp'])]
    assert events[0]['evidence']['prior_high']==11
    assert events[0]['evidence']['relative_volume']==2
    assert events[0]['source_bar']['close']==12

def test_trend_golden_cross_then_close_below_fast():
    p=StrategyConfig(trend_fast=2,trend_mid=3,trend_slow=4,trend_rsi_entry=50)
    bars=make_bars([100-i for i in range(15)]+[90,96,103,111,120,90])
    events=[e for e in evaluate(bars,p) if e['strategy']=='trend']
    assert [e['kind'] for e in events]==['entry','exit']
    assert events[0]['time']==bars[17]['timestamp']
    assert events[0]['evidence']['rsi_prior']<=50<events[0]['evidence']['rsi']
    assert events[1]['time']==bars[20]['timestamp']

def test_mean_reversion_golden_requires_subsequent_reentry():
    bars=make_bars([100.]*22+[70.,90.,105.])
    events=[e for e in evaluate(bars) if e['strategy']=='mean_reversion']
    assert [e['kind'] for e in events]==['entry','exit']
    assert events[0]['time']==bars[23]['timestamp']
    assert events[1]['time']==bars[24]['timestamp']

def test_missing_history_no_candidates_and_json_nulls():
    bars=make_bars([10.]*10)
    assert evaluate(bars)==[]
    assert calculate(bars,IndicatorConfig())['sma200']==[None]*10
    assert evaluate([])==[]

def test_signal_prefix_invariance_future_perturbation_and_determinism():
    rows=demo_bars('NVDA')
    earlier=evaluate(rows[:240])
    changed=[dict(b) for b in rows]
    for b in changed[240:]:
        for key in ['open','high','low','close']:b[key]*=7
        b['volume']*=50
    assert [e for e in evaluate(changed) if e['time']<=rows[239]['timestamp']]==earlier
    assert evaluate(rows)==evaluate(rows)
    assert all(e['price']==e['source_bar']['close'] for e in evaluate(rows))

def test_rejects_duplicate_or_unsorted_bar_times():
    rows=make_bars([10,11,12])
    with pytest.raises(ValueError):evaluate([rows[1],rows[0]])
    with pytest.raises(ValueError):evaluate([rows[0],rows[0]])

@given(st.lists(st.floats(min_value=1,max_value=1000,allow_nan=False,allow_infinity=False),min_size=1,max_size=80))
@settings(max_examples=30,suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_property_warmup_and_sma_prefix(series):
    values=pd.Series(series)
    result=sma(values,20)
    assert result.iloc[:min(19,len(values))].isna().all()
    if len(values)>=20:assert result.iloc[-1]==pytest.approx(sum(series[-20:])/20)
    bars=make_bars(series)
    times=[b['timestamp'] for b in bars]
    assert times==sorted(set(times))
