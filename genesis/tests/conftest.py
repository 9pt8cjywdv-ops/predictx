import os

import pytest

from genesis.brain import HeuristicBrain
from genesis.config import load_settings
from genesis.ledger import Ledger
from genesis.money import usd
from genesis.runtime import build_runtime

ADMIN = "test-admin-token"
VIEWER = "test-viewer-token"
WALLET = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"


# Set GENESIS_TEST_DATABASE_URL=postgresql+psycopg://... to run the suite against PostgreSQL.
PG_URL = os.getenv("GENESIS_TEST_DATABASE_URL")


@pytest.fixture
def rt(tmp_path):
    url = PG_URL or f"sqlite:///{tmp_path / 'genesis.db'}"
    if PG_URL:
        from genesis.db import make_engine
        from genesis.models import Base
        eng = make_engine(PG_URL)
        Base.metadata.drop_all(eng)
        eng.dispose()
    settings = load_settings(database_url=url, admin_token=ADMIN,
                             viewer_token=VIEWER, sim_seed=7, master_key="unit-test-master-key")
    runtime = build_runtime(settings, brain=HeuristicBrain(7))
    yield runtime
    runtime.orchestrator.stop()
    runtime.engine.dispose()


@pytest.fixture
def core(rt):
    return rt.core


class Helpers:
    def __init__(self, core):
        self.core = core

    def genesis(self, fund=50, strategy="research_reports", market="law-firms"):
        c = self.core
        c.run(lambda s: c.contribute_capital(s, usd(fund), actor="admin"))
        return c.run(lambda s: c.create_genesis_agent(s, actor="admin", strategy_key=strategy, market=market)).id

    def revenue(self, agent_id, amount_usd, payer="sim-customer:test"):
        c = self.core
        ev = c.world.evidence.issue(f"test-{agent_id}-{c.world.rng.getrandbits(64):x}", usd(amount_usd), payer)
        return c.run(lambda s: c.record_revenue(s, c.get_agent(s, agent_id), ev), agent_id=agent_id)

    def expense(self, agent_id, amount_usd, category="business", **kw):
        c = self.core
        return c.run(lambda s: c.charge_expense(s, c.get_agent(s, agent_id), category, usd(amount_usd), "test", **kw),
                     agent_id=agent_id)

    def fin(self, agent_id):
        c = self.core
        with c.tx() as s:
            return c.financials(s, c.get_agent(s, agent_id))

    def agent(self, agent_id):
        c = self.core
        with c.tx() as s:
            return c.get_agent(s, agent_id)

    def ledger(self, fn):
        with self.core.tx() as s:
            return fn(Ledger(s), s)

    def policy(self, **changes):
        from genesis.policy import update_policy
        c = self.core
        c.run(lambda s: update_policy(s, changes, c.now()))

    def state(self, key, value):
        from genesis.policy import set_state
        c = self.core
        c.run(lambda s: set_state(s, key, value, c.now()))

    def generous_limits(self):
        self.policy(max_daily_expenditure_usd=10_000, max_weekly_expenditure_usd=100_000, max_transaction_usd=10_000,
                    agent_daily_budgets_usd={"business": 10_000, "claude_api": 10_000, "marketing": 10_000})


@pytest.fixture
def h(core):
    return Helpers(core)
