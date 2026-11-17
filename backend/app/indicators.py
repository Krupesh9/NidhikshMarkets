"""Causal close-based indicators. NaN warmups are exposed as JSON nulls."""
import numpy as np
import pandas as pd
from .schemas import IndicatorConfig

def sma(s: pd.Series, period: int) -> pd.Series:
    return s.rolling(period, min_periods=period).mean()

def ema(s: pd.Series, period: int) -> pd.Series:
    # SMA seed, then alpha=2/(n+1). Preserve unavailable prefix.
    result = pd.Series(np.nan,index=s.index,dtype=float)
    first = s.first_valid_index()
    if first is None:
        return result
    start = s.index.get_loc(first)
    seed = start+period-1
    if seed>=len(s):
        return result
    result.iloc[seed] = s.iloc[start:seed+1].mean()
    alpha = 2/(period+1)
    for i in range(seed+1,len(s)):
        result.iloc[i] = alpha*s.iloc[i] + (1-alpha)*result.iloc[i-1]
    return result

def wilder(s: pd.Series, period: int) -> pd.Series:
    result = pd.Series(np.nan,index=s.index,dtype=float)
    valid = np.flatnonzero(s.notna().to_numpy())
    if len(valid)<period:
        return result
    i = int(valid[period-1])
    result.iloc[i] = s.iloc[valid[:period]].mean()
    for j in range(i+1,len(s)):
        result.iloc[j] = (result.iloc[j-1]*(period-1)+s.iloc[j])/period
    return result

def rsi(close: pd.Series, period=14) -> pd.Series:
    d=close.diff()
    gain=wilder(d.clip(lower=0),period)
    loss=wilder(-d.clip(upper=0),period)
    result=100-100/(1+gain/loss.replace(0,np.nan))
    result[(loss==0)&(gain>0)] = 100
    result[(loss==0)&(gain==0)] = 50
    return result

def bollinger(close: pd.Series, period=20, std=2):
    mid=sma(close,period)
    dev=close.rolling(period,min_periods=period).std(ddof=0)*std
    return mid-dev,mid,mid+dev

def atr(frame: pd.DataFrame, period=14):
    prev=frame.close.shift(1)
    tr=pd.concat([frame.high-frame.low,(frame.high-prev).abs(),(frame.low-prev).abs()],axis=1).max(axis=1)
    return wilder(tr,period)

def relative_volume(volume: pd.Series, period=20):
    # Prior sessions only, excluding the evaluated session's volume.
    return volume / sma(volume,period).shift(1).replace(0,np.nan)

def calculate(bars: list[dict], config: IndicatorConfig) -> dict:
    if not bars:
        return {}
    f=pd.DataFrame(bars)
    c=f.close.astype(float)
    out={f'sma{n}':sma(c,n) for n in config.sma}
    out.update({f'ema{n}':ema(c,n) for n in config.ema})
    if config.rsi:
        out['rsi']=rsi(c,config.rsi_period)
    if config.bb:
        out['bb_lower'],out['bb_mid'],out['bb_upper']=bollinger(c,config.bb_period,config.bb_std)
    if config.macd:
        m=ema(c,config.macd_fast)-ema(c,config.macd_slow)
        out['macd']=m
        out['macd_signal']=ema(m,config.macd_signal)
        out['macd_histogram']=m-out['macd_signal']
    if config.atr:
        out['atr']=atr(f,config.atr_period)
    if config.rvol:
        out['rvol']=relative_volume(f.volume,config.rvol_period)
    return {k:[None if not np.isfinite(v) else round(float(v),8) for v in a] for k,a in out.items()}
