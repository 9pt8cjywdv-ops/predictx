"""Wires the components together for the API server, CLI and tests."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .brain import ClaudeBrain, HeuristicBrain
from .clock import SimClock, SystemClock
from .config import Settings, load_settings
from .core import GenesisCore
from .db import init_schema, make_engine, make_session_factory
from .orchestrator import Orchestrator
from .policy import get_policy, get_state
from .security import RateLimiter, TokenAuth, Vault

log = logging.getLogger("genesis")


@dataclass
class Runtime:
    settings: Settings
    core: GenesisCore
    orchestrator: Orchestrator
    auth: TokenAuth
    vault: Vault
    limiter: RateLimiter
    engine: object


def build_runtime(settings: Settings | None = None, *, create_schema: bool = True, brain=None) -> Runtime:
    settings = settings or load_settings()
    engine = make_engine(settings.database_url)
    if create_schema:
        init_schema(engine)
    factory = make_session_factory(engine)
    clock = SimClock() if settings.sim_clock else SystemClock()
    if brain is None:
        with factory() as s:
            pol = get_policy(s)
            live = bool(get_state(s, "live_mode"))
        use_claude = settings.anthropic_api_key_present and (live or settings.use_claude_in_simulation)
        if use_claude:
            brain = ClaudeBrain(settings.sim_seed, pol["claude_routine_model"], pol["claude_reasoning_model"],
                                pol["claude_max_output_tokens"])
            log.info("agent reasoning: Claude (%s)", pol["claude_routine_model"])
        else:
            brain = HeuristicBrain(settings.sim_seed, pol["claude_routine_model"])
            log.info("agent reasoning: deterministic heuristic brain (costs metered at %s rates)", pol["claude_routine_model"])
    core = GenesisCore(factory, clock=clock, brain=brain, seed=settings.sim_seed)
    if clock.simulated:
        with factory() as s:
            prices = get_state(s, "sim_prices")
        if prices and core.world is not None:
            core.world.prices.update(prices)
    auth = TokenAuth(settings.admin_token, settings.viewer_token)
    if auth.generated_admin_token:
        log.warning("GENESIS_ADMIN_TOKEN not set; generated one-time admin token: %s", auth.generated_admin_token)
    return Runtime(settings=settings, core=core, orchestrator=Orchestrator(core), auth=auth,
                   vault=Vault(settings.master_key), limiter=RateLimiter(240, 60), engine=engine)
