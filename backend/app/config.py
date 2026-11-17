from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / '.env', extra='ignore')
    database_url: str = f'sqlite:///{ROOT / "runtime/market.sqlite"}'
    app_origin: str = 'http://localhost:3000'
    cookie_secure: bool = False
    demo_enabled: bool = True
    partner_data_display_approved: bool = False
    alpaca_api_key: str = ''
    alpaca_secret_key: str = ''
    alpaca_feed: Literal['sip', 'iex'] = 'sip'
    fred_api_key: str = ''
    sec_user_agent: str = ''
    intraday_enabled: bool = False
    intraday_refresh_seconds: int = Field(default=60,ge=60,le=900)
    collectors_enabled: bool = False
    refresh_interval_seconds: int = 1800
    news_retention_days: int = 90
    session_hours: int = 12
    history_years: int = 5
    alpha_vantage_api_key: str = ''
    # OVERVIEW is premium-only; enable only for an entitled subscription.
    alpha_vantage_overview_enabled: bool = False
    # Enable only after written permission covering local FRED storage is obtained.
    fred_storage_permission_confirmed: bool = False

@lru_cache
def settings() -> Settings:
    return Settings()
