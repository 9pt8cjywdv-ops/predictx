"""Runtime settings, read from environment variables (or a .env file).

Secrets (API keys, admin token, database password) are only ever read from the
environment. They are never written to the database, logged, or returned by the API.
"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://predictx:predictx@localhost:5432/predictx",
        description="SQLAlchemy URL. PostgreSQL in production; sqlite works for local tests.",
    )

    # The Odds API (https://the-odds-api.com). Optional: without it the engine runs
    # on its statistical models only and the confidence score reflects that.
    odds_api_key: str | None = None
    odds_api_regions: str = "uk,eu"

    # Protects POST /api/admin/* endpoints. Leave unset to disable those endpoints.
    admin_token: str | None = None

    # How far back to backfill results the first time a league is seen. Ratings are
    # built by replaying these results, so more history means better ratings.
    history_days: int = 540
    # Window of upcoming fixtures to predict.
    lookahead_days: int = 7

    # Scheduler intervals (minutes).
    fixtures_interval_min: int = 30
    results_interval_min: int = 15
    odds_interval_min: int = 120
    injuries_interval_min: int = 120

    # A prediction is "stale" (not shown as current) if its inputs have not been
    # refreshed within this many hours.
    stale_after_hours: float = 6.0

    http_timeout_s: float = 20.0
    enabled_leagues: str | None = Field(
        default=None, description="Comma separated league keys; default = all in leagues.py"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
