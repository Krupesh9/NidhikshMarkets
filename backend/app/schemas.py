from typing import Literal
from pydantic import BaseModel, Field, model_validator

class Provenance(BaseModel):
    source: str
    feed: str
    observed_at: str
    fetched_at: str
    exchange_timezone: str = 'America/New_York'
    delay_seconds: int | None = None
    license_category: str = 'personal-research; display rights unverified'
    adjustment: str = 'split'
    status: str = 'cached'
    currency: str = 'USD'
    quality_flags: list[str] = Field(default_factory=list)

class BarDTO(BaseModel):
    model_config = {'allow_inf_nan': False}
    timestamp: str
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(ge=0)
    event_time: str
    available_at: str
    source_last_updated: str | None = None
    provenance: Provenance
    @model_validator(mode='after')
    def valid_ohlc(self):
        if self.high < max(self.open,self.close,self.low) or self.low > min(self.open,self.close,self.high):
            raise ValueError('Invalid OHLC ordering')
        return self

class IndicatorConfig(BaseModel):
    sma: list[int] = Field(default_factory=lambda:[20,50,200], max_length=6)
    ema: list[int] = Field(default_factory=list, max_length=4)
    rsi: bool = True
    rsi_period: int = Field(default=14,ge=2,le=100)
    rsi_lower: float = Field(default=30,ge=0,le=100)
    rsi_upper: float = Field(default=70,ge=0,le=100)
    bb: bool = False
    bb_period: int = Field(default=20,ge=2,le=200)
    bb_std: float = Field(default=2,gt=0,le=5)
    macd: bool = False
    macd_fast: int = Field(default=12,ge=2,le=100)
    macd_slow: int = Field(default=26,ge=3,le=200)
    macd_signal: int = Field(default=9,ge=2,le=100)
    atr: bool = False
    atr_period: int = Field(default=14,ge=2,le=100)
    rvol: bool = False
    rvol_period: int = Field(default=20,ge=2,le=200)
    @model_validator(mode='after')
    def valid(self):
        if any(n not in [20,30,50,90,100,200] for n in self.sma):
            raise ValueError('Unsupported SMA period')
        if any(n<2 or n>200 for n in self.ema):
            raise ValueError('EMA period must be 2–200')
        if self.rsi_lower >= self.rsi_upper or self.macd_fast >= self.macd_slow:
            raise ValueError('Invalid threshold ordering')
        return self

class StrategyConfig(BaseModel):
    trend_fast: int = Field(default=20,ge=2,le=100)
    trend_mid: int = Field(default=50,ge=3,le=150)
    trend_slow: int = Field(default=200,ge=4,le=250)
    trend_rsi_entry: float = Field(default=50,ge=0,le=100)
    trend_rsi_exit: float = Field(default=45,ge=0,le=100)
    mean_period: int = Field(default=20,ge=2,le=100)
    mean_std: float = Field(default=2,gt=0,le=5)
    mean_rsi_entry: float = Field(default=30,ge=0,le=100)
    mean_rsi_exit: float = Field(default=55,ge=0,le=100)
    mean_max_wait: int = Field(default=3,ge=1,le=20)
    breakout_high: int = Field(default=20,ge=2,le=100)
    breakout_low: int = Field(default=10,ge=2,le=100)
    breakout_rvol: float = Field(default=1.5,gt=0,le=20)
    @model_validator(mode='after')
    def ordered(self):
        if not self.trend_fast < self.trend_mid < self.trend_slow:
            raise ValueError('Trend periods must increase')
        if self.mean_rsi_entry >= self.mean_rsi_exit:
            raise ValueError('Mean reversion RSI entry must be below exit')
        return self
