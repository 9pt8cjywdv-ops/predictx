"""Long-run invariants: whatever the agents do, the books must stay correct."""
import pytest
from sqlalchemy import select

from genesis.ledger import A, Ledger
from genesis.models import Agent, Distribution
from genesis.policy import set_state
from genesis.treasury import reconcile

from .conftest import WALLET


@pytest.mark.parametrize("strategy,market", [("research_reports", "dental-clinics"), ("spot_momentum", "SOL"),
                                             ("micro_saas", "tutors")])
def test_long_run_invariants(core, h, rt, strategy, market):
    h.genesis(strategy=strategy, market=market)
    h.state("admin_wallet", {"address": WALLET, "network": "base"})
    rt.orchestrator.advance(24 * 90)
    with core.tx() as s:
        l = Ledger(s)
        assert l.is_balanced()
        assert reconcile(s, core.signer(s), core.treasury_address(s))["ok"]
        tb = l.trial_balance()
        for acct, bal in tb.items():
            if acct.endswith(":cash") or acct == A.TREASURY:
                assert bal >= 0, acct
        assets = sum(v for k, v in tb.items() if k.startswith("asset:"))
        liabilities = -sum(v for k, v in tb.items() if k.startswith("liability:"))
        assert assets - liabilities == -tb[A.CONTRIBUTED] + l.realized_profit() - tb.get(A.DISTRIBUTIONS, 0)
        dists = list(s.scalars(select(Distribution)))
        assert len(dists) == 12  # Sundays in 90 days from Mon 2026-01-05
        paid = sum(d.owner_amount for d in dists if d.status == "executed")
        assert paid == tb.get(A.DISTRIBUTIONS, 0)
        # Payouts never exceed the owner share of the high-water mark, and the HWM never
        # exceeds the peak cumulative realized profit observed at a period close.
        hwm = max([d.hwm_after for d in dists] + [0])
        assert paid <= hwm // 2
        assert hwm <= max([d.cumulative_profit for d in dists] + [0])
        for d in dists:
            assert d.owner_amount <= d.distributable // 2 and d.distributable == max(0, d.cumulative_profit - d.hwm_before)
        agents = list(s.scalars(select(Agent)))
        for a in agents:
            if a.status == "deceased":
                assert a.final_performance and a.permissions == {}
