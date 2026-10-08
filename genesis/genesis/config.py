"""Process-level configuration from environment variables.

Runtime economic policy (limits, thresholds, payout share) lives in the
database (see policy.py) so the administrator can change it without a
redeploy, and so every change is audit-logged.
"""
import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str
    admin_token: str | None
    viewer_token: str | None
    master_key: str | None
    anthropic_api_key_present: bool
    use_claude_in_simulation: bool
    autostart_orchestrator: bool
    tick_seconds: float
    sim_seed: int
    sim_clock: bool
    cors_origins: tuple[str, ...]


def load_settings(**overrides) -> Settings:
    values = dict(
        database_url=os.getenv("DATABASE_URL", "sqlite:///./genesis.db"),
        admin_token=os.getenv("GENESIS_ADMIN_TOKEN"),
        viewer_token=os.getenv("GENESIS_VIEWER_TOKEN"),
        master_key=os.getenv("GENESIS_MASTER_KEY"),
        anthropic_api_key_present=bool(os.getenv("ANTHROPIC_API_KEY")),
        use_claude_in_simulation=_bool("GENESIS_SIM_USE_CLAUDE", False),
        autostart_orchestrator=_bool("GENESIS_AUTOSTART", False),
        tick_seconds=float(os.getenv("GENESIS_TICK_SECONDS", "3600")),
        sim_seed=int(os.getenv("GENESIS_SIM_SEED", "42")),
        sim_clock=_bool("GENESIS_SIM_CLOCK", True),
        cors_origins=tuple(o for o in os.getenv("GENESIS_CORS_ORIGINS", "").split(",") if o),
    )
    values.update(overrides)
    return Settings(**values)
