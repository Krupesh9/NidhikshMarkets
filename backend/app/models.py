from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, Float, Boolean, ForeignKey, UniqueConstraint, Index, JSON, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(16), default='viewer')
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(default=now)

class LoginSession(Base):
    __tablename__ = 'sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    csrf: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[str] = mapped_column(index=True)

class LoginAttempt(Base):
    __tablename__ = 'login_attempts'
    key: Mapped[str] = mapped_column(primary_key=True)
    attempts: Mapped[int] = mapped_column(default=0)
    reset_at: Mapped[str]

class AuditEvent(Base):
    __tablename__ = 'audit_events'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'))
    action: Mapped[str]
    at: Mapped[str] = mapped_column(default=now, index=True)
    detail: Mapped[str] = mapped_column(default='')

class Exchange(Base):
    __tablename__ = 'exchanges'
    code: Mapped[str] = mapped_column(primary_key=True)
    timezone: Mapped[str]
    calendar: Mapped[str]

class Instrument(Base):
    __tablename__ = 'instruments'
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(unique=True, index=True)
    name: Mapped[str]
    asset_type: Mapped[str]
    exchange: Mapped[str] = mapped_column(ForeignKey('exchanges.code'), default='XNYS')
    currency: Mapped[str] = mapped_column(default='USD')
    timezone: Mapped[str] = mapped_column(default='America/New_York')
    region: Mapped[str] = mapped_column(default='US')
    cik: Mapped[str | None]
    note: Mapped[str] = mapped_column(default='')
    active: Mapped[bool] = mapped_column(default=True)
    symbol_history: Mapped[list] = mapped_column(JSON, default=list)

class PriceBar(Base):
    __tablename__ = 'price_bars'
    __table_args__ = (UniqueConstraint('instrument_id','timeframe','timestamp','provider','feed','adjustment'), Index('ix_bars_lookup','instrument_id','timeframe','provider','adjustment','timestamp'))
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey('instruments.id'))
    timeframe: Mapped[str] = mapped_column(default='1d')
    timestamp: Mapped[str]
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float)
    provider: Mapped[str]
    feed: Mapped[str]
    adjustment: Mapped[str]
    event_time: Mapped[str]
    available_at: Mapped[str]
    observed_at: Mapped[str]
    fetched_at: Mapped[str]
    source_last_updated: Mapped[str | None]
    provenance: Mapped[dict] = mapped_column(JSON)

class CorporateAction(Base):
    __tablename__ = 'corporate_actions'
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey('instruments.id'))
    event_time: Mapped[str]
    available_at: Mapped[str]
    kind: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)
    provider: Mapped[str]

class Fundamental(Base):
    __tablename__ = 'fundamentals'
    __table_args__ = (UniqueConstraint('instrument_id','available_at','provider'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey('instruments.id'), index=True)
    available_at: Mapped[str]
    fetched_at: Mapped[str]
    provider: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)

class EconomicSeries(Base):
    __tablename__ = 'economic_series'
    __table_args__ = (UniqueConstraint('series_id','event_time','revision'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[str] = mapped_column(index=True)
    event_time: Mapped[str]
    available_at: Mapped[str]
    fetched_at: Mapped[str]
    revision: Mapped[str]
    value: Mapped[float] = mapped_column(Float)
    payload: Mapped[dict] = mapped_column(JSON)

class NewsEvent(Base):
    __tablename__ = 'news_events'
    __table_args__ = (UniqueConstraint('instrument_id','url','provider'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey('instruments.id'), index=True)
    title: Mapped[str]
    url: Mapped[str]
    publisher: Mapped[str]
    published_at: Mapped[str | None]
    available_at: Mapped[str]
    fetched_at: Mapped[str]
    provider: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)

class Filing(Base):
    __tablename__ = 'filings'
    __table_args__ = (UniqueConstraint('instrument_id','accession'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey('instruments.id'), index=True)
    accession: Mapped[str]
    form: Mapped[str]
    url: Mapped[str]
    event_time: Mapped[str]
    available_at: Mapped[str]
    fetched_at: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)

class InsiderTransaction(Base):
    __tablename__ = 'insider_transactions'
    id: Mapped[int] = mapped_column(primary_key=True)
    filing_id: Mapped[int] = mapped_column(ForeignKey('filings.id'), unique=True)
    payload: Mapped[dict] = mapped_column(JSON)

class Watchlist(Base):
    __tablename__ = 'watchlists'
    __table_args__ = (UniqueConstraint('user_id','name'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    name: Mapped[str]
    symbols: Mapped[list] = mapped_column(JSON)

class IndicatorPreset(Base):
    __tablename__ = 'indicator_presets'
    __table_args__ = (UniqueConstraint('user_id','name'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    name: Mapped[str]
    config: Mapped[dict] = mapped_column(JSON)

class StrategyDefinition(Base):
    __tablename__ = 'strategy_definitions'
    id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str]
    parameters: Mapped[dict] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(default=True)

class SignalEvent(Base):
    __tablename__ = 'signal_events'
    __table_args__ = (UniqueConstraint('instrument_id','strategy_id','version','bar_time','provider','feed','adjustment','parameter_hash'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey('instruments.id'), index=True)
    strategy_id: Mapped[str] = mapped_column(ForeignKey('strategy_definitions.id'))
    version: Mapped[str]
    bar_time: Mapped[str]
    evaluated_at: Mapped[str]
    provider: Mapped[str]
    feed: Mapped[str]
    adjustment: Mapped[str]
    parameter_hash: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)

class ProviderStatus(Base):
    __tablename__ = 'provider_status'
    code: Mapped[str] = mapped_column(primary_key=True)
    status: Mapped[str]
    last_attempt: Mapped[str | None]
    last_success: Mapped[str | None]
    message: Mapped[str]
    retry_after: Mapped[str | None]

class IngestionRun(Base):
    __tablename__ = 'ingestion_runs'
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(index=True)
    started_at: Mapped[str]
    completed_at: Mapped[str | None]
    status: Mapped[str]
    records: Mapped[int] = mapped_column(default=0)
    message: Mapped[str] = mapped_column(default='')

class AppSetting(Base):
    __tablename__ = 'app_settings'
    __table_args__ = (UniqueConstraint('user_id','key'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    key: Mapped[str]
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[str] = mapped_column(default=now)

class ProviderRequest(Base):
    __tablename__ = 'provider_requests'
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(index=True)
    at: Mapped[str] = mapped_column(index=True)
    status_code: Mapped[int | None]

class ProviderCooldown(Base):
    __tablename__ = 'provider_cooldowns'
    code: Mapped[str] = mapped_column(primary_key=True)
    until: Mapped[str]
    reason: Mapped[str]

class InstrumentLogo(Base):
    __tablename__ = 'instrument_logos'
    symbol: Mapped[str] = mapped_column(primary_key=True)
    content: Mapped[bytes | None] = mapped_column(LargeBinary)
    content_type: Mapped[str]
    source: Mapped[str]
    fetched_at: Mapped[str]
    status: Mapped[str]

class HeatmapUniverse(Base):
    __tablename__ = 'heatmap_universes'
    code: Mapped[str] = mapped_column(primary_key=True)
    source_url: Mapped[str]
    as_of: Mapped[str]
    fetched_at: Mapped[str]
    members: Mapped[list] = mapped_column(JSON)
    note: Mapped[str]

class HeatmapQuote(Base):
    __tablename__ = 'heatmap_quotes'
    symbol: Mapped[str] = mapped_column(primary_key=True)
    price: Mapped[float | None] = mapped_column(Float)
    change_percent: Mapped[float | None] = mapped_column(Float)
    as_of: Mapped[str | None]
    fetched_at: Mapped[str]
    feed: Mapped[str]
    provenance: Mapped[dict] = mapped_column(JSON)

class InstrumentDirectory(Base):
    __tablename__ = 'instrument_directory'
    symbol: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(index=True)
    exchange: Mapped[str]
    provider_id: Mapped[str]
    fetched_at: Mapped[str]
    payload: Mapped[dict] = mapped_column(JSON)

class EarningsEvent(Base):
    __tablename__ = 'earnings_events'
    __table_args__=(UniqueConstraint('symbol','report_date','provider'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(index=True)
    name: Mapped[str]
    report_date: Mapped[str] = mapped_column(index=True)
    fiscal_end: Mapped[str | None]
    eps_estimate: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str]
    provider: Mapped[str]
    source_url: Mapped[str]
    fetched_at: Mapped[str]
    status: Mapped[str]
    provenance: Mapped[dict] = mapped_column(JSON)

class IPOCalendarCache(Base):
    __tablename__ = 'ipo_calendar_cache'
    provider: Mapped[str] = mapped_column(primary_key=True)
    fetched_at: Mapped[str]
    source_url: Mapped[str]
    items: Mapped[list] = mapped_column(JSON)

class IntradayCache(Base):
    __tablename__ = 'intraday_cache'
    feed: Mapped[str] = mapped_column(primary_key=True)
    last_attempt: Mapped[str | None]
    fetched_at: Mapped[str | None]
    status: Mapped[str] = mapped_column(default='not_fetched')
    message: Mapped[str] = mapped_column(default='')
    items: Mapped[dict] = mapped_column(JSON,default=dict)
