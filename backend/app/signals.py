"""Descriptive bar-close episodes only. No orders, fills, or performance claims."""
import hashlib
import json
import math
import pandas as pd
from .indicators import sma,rsi,bollinger,relative_volume
from .schemas import StrategyConfig

VERSION='1.1.0'
DISCLAIMER='Research candidate — not a guaranteed trade. Unvalidated; retrospective annotation.'

def parameter_hash(config: StrategyConfig) -> str:
    return hashlib.sha256(json.dumps(config.model_dump(),sort_keys=True).encode()).hexdigest()[:16]

def evaluate(bars: list[dict], config: StrategyConfig | None=None) -> list[dict]:
    p=config or StrategyConfig()
    if len(bars)<2:
        return []
    f=pd.DataFrame(bars)
    if not f.timestamp.is_monotonic_increasing or f.timestamp.duplicated().any():
        raise ValueError('Bars must have strictly increasing timestamps')
    close=f.close.astype(float)
    fast,mid,slow=[sma(close,n) for n in [p.trend_fast,p.trend_mid,p.trend_slow]]
    strength=rsi(close)
    lower,center,upper=bollinger(close,p.mean_period,p.mean_std)
    high=f.high.rolling(p.breakout_high,min_periods=p.breakout_high).max().shift(1)
    low=f.low.rolling(p.breakout_low,min_periods=p.breakout_low).min().shift(1)
    rvol=relative_volume(f.volume,20)
    active={'trend':False,'mean_reversion':False,'breakout':False}
    armed=False
    armed_at=None
    events=[]
    def finite(*xs):
        return all(math.isfinite(float(x)) for x in xs)
    for i in range(1,len(f)):
        b=bars[i]
        def emit(strategy,side,evidence):
            events.append({'strategy':strategy,'version':VERSION,'algorithm_version':VERSION,
                'kind':side,'time':b['timestamp'],'source_bar':{k:b[k] for k in ['timestamp','open','high','low','close','volume']},
                'price':float(close.iloc[i]),'timeframe':'1d','parameters':p.model_dump(),
                'parameter_hash':parameter_hash(p),'evidence':evidence,'label':DISCLAIMER,
                'classification':'observed_historical','provenance':b.get('provenance',{})})
        c=float(close.iloc[i]); r=float(strength.iloc[i]); prev_r=float(strength.iloc[i-1])
        if finite(fast.iloc[i],mid.iloc[i],slow.iloc[i],r,prev_r):
            if not active['trend'] and c>slow.iloc[i] and fast.iloc[i]>mid.iloc[i] and prev_r<=p.trend_rsi_entry<r:
                emit('trend','entry',{'close':c,'sma_slow':float(slow.iloc[i]),'sma_fast':float(fast.iloc[i]),'sma_mid':float(mid.iloc[i]),'rsi_prior':prev_r,'rsi':r,'conditions':['close > slow SMA','fast SMA > mid SMA','RSI crossed above entry threshold']})
                active['trend']=True
            elif active['trend'] and (c<fast.iloc[i] or prev_r>=p.trend_rsi_exit>r):
                emit('trend','exit',{'close':c,'sma_fast':float(fast.iloc[i]),'rsi_prior':prev_r,'rsi':r,'conditions':['close < fast SMA' if c<fast.iloc[i] else 'RSI crossed below exit threshold']})
                active['trend']=False
        if finite(lower.iloc[i],center.iloc[i],upper.iloc[i],r):
            if armed_at is not None and i-armed_at['index']>p.mean_max_wait:
                armed=False;armed_at=None
            if active['mean_reversion'] and (c>=center.iloc[i] or r>p.mean_rsi_exit):
                emit('mean_reversion','exit',{'close':c,'bb_mid':float(center.iloc[i]),'rsi':r,'conditions':['close reached mid-band' if c>=center.iloc[i] else 'RSI above exit threshold']})
                active['mean_reversion']=False
            elif armed and not active['mean_reversion'] and lower.iloc[i]<=c<center.iloc[i] and r<=p.mean_rsi_exit:
                emit('mean_reversion','entry',{'close':c,'bb_lower':float(lower.iloc[i]),'bb_mid':float(center.iloc[i]),'bb_upper':float(upper.iloc[i]),'rsi':r,'prior_setup':{k:v for k,v in armed_at.items() if k!='index'},'sessions_since_setup':i-armed_at['index'],'conditions':['earlier completed close below lower band with RSI below threshold','subsequent close returned inside bands within configured maximum wait','close remains below mid-band target; RSI has not passed exit threshold']})
                active['mean_reversion']=True
                armed=False
                armed_at=None
            if not active['mean_reversion'] and c<lower.iloc[i] and r<p.mean_rsi_entry:
                armed=True
                armed_at={'index':i,'time':b['timestamp'],'close':c,'bb_lower':float(lower.iloc[i]),'rsi':r}
        if finite(high.iloc[i],low.iloc[i],rvol.iloc[i]):
            if not active['breakout'] and c>high.iloc[i] and rvol.iloc[i]>p.breakout_rvol:
                emit('breakout','entry',{'close':c,'prior_high':float(high.iloc[i]),'relative_volume':float(rvol.iloc[i]),'conditions':['close > prior-session window high (current bar excluded)','volume / prior 20-session average > configured threshold']})
                active['breakout']=True
            elif active['breakout'] and c<low.iloc[i]:
                emit('breakout','exit',{'close':c,'prior_low':float(low.iloc[i]),'conditions':['close < trailing prior-session low (current bar excluded)']})
                active['breakout']=False
    return events
