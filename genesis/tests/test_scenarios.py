"""Required scenarios A-H (section 16 of the specification)."""
import threading
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from genesis import audit
from genesis.distribution import next_distribution_time, run_distribution
from genesis.errors import Conflict, InsufficientFunds, LedgerError, PolicyViolation
from genesis.ledger import A, INTERNAL_TRANSFER, Ledger, Line
from genesis.models import Agent, AgentEvent, Approval, AuditLog, Distribution, JournalEntry, ReproductionEvent
from genesis.money import usd
from genesis.policy import get_policy, get_state
from genesis.simworld import EvidenceSigner
from genesis.strategies import REGISTRY, register
from genesis.strategies.base import Param, Strategy, StrategySpec
from genesis.treasury import SimulatedChain, reconcile

from .conftest import WALLET


# ---------------------------------------------------------------- Test A: birth
def test_a_agent_birth(core, h):
    aid = h.genesis()
    assert aid == "AGT-0001"
    a = h.agent(aid)
    assert a.parent_id is None and a.generation == 1 and a.status == "active"
    assert a.starting_capital == usd(50)
    assert a.next_reproduction_threshold == usd(500)
    assert a.created_at == core.now()
    assert a.strategy_key == "research_reports" and a.strategy_profile["params"]
    assert a.permissions == {"spend": True, "trade": True, "sell": True, "reproduce": True}
    f = h.fin(aid)
    assert f["cash"] == f["available"] == usd(50)
    assert f["revenue"] == f["expenses"] == f["net_profit"] == 0
    # the allocation is internal: treasury -> agent; no income recognised
    assert h.ledger(lambda l, s: l.balance(A.TREASURY)) == 0
    assert h.ledger(lambda l, s: l.income()) == 0
    # operating limits come from policy
    with core.tx() as s:
        pol = get_policy(s)
        assert core.remaining_budget(s, core.get_agent(s, aid), "claude_api") == usd(pol["agent_daily_budgets_usd"]["claude_api"])
    # only one genesis agent may ever be created directly
    with pytest.raises(Conflict):
        h.genesis()


# ---------------------------------------------------------------- Test B: growth
def test_b_financial_growth(core, h):
    aid = h.genesis()
    h.revenue(aid, 100)
    h.expense(aid, 2, "business")
    h.expense(aid, 0.25, "claude_api")
    f = h.fin(aid)
    assert f["revenue"] == usd(100)
    assert f["expenses"] == usd(2.25)
    assert f["net_profit"] == usd(97.75)
    assert f["cash"] == usd(147.75)
    with core.tx() as s:
        tb = Ledger(s).trial_balance()
        assert tb[A.OPERATOR_PAYABLE] == -usd(2.25)  # operator-paid costs are a liability
        assert Ledger(s).is_balanced()
        assert reconcile(s, core.signer(s), core.treasury_address(s))["ok"]


# ---------------------------------------------------------------- Test C: first reproduction
def test_c_first_reproduction(core, h):
    aid = h.genesis()
    h.revenue(aid, 449)
    assert core.run(lambda s: core.try_reproduce(s, aid)) is None  # $499 < $500
    h.revenue(aid, 1)
    child = core.run(lambda s: core.try_reproduce(s, aid))
    assert child is not None and child.id == "AGT-0002"
    parent = h.agent(aid)
    assert h.fin(child.id)["cash"] == usd(50)
    assert h.fin(aid)["cash"] == usd(450)
    assert parent.reproduction_count == 1
    assert parent.capital_after_last_reproduction == usd(450)
    assert parent.next_reproduction_threshold == usd(900)
    c = h.agent(child.id)
    assert c.parent_id == aid and c.generation == 2 and c.starting_capital == usd(50)
    assert c.next_reproduction_threshold == usd(500)
    # funding the child is not revenue or profit
    assert h.ledger(lambda l, s: l.revenue()) == usd(450)
    assert h.ledger(lambda l, s: l.realized_profit()) == usd(450)


# ---------------------------------------------------------------- Test D: subsequent reproduction
def test_d_subsequent_reproduction(core, h):
    aid = h.genesis()
    h.revenue(aid, 450)
    core.run(lambda s: core.try_reproduce(s, aid))
    h.revenue(aid, 449)  # 899
    assert core.run(lambda s: core.try_reproduce(s, aid)) is None
    h.revenue(aid, 1)  # 900
    child = core.run(lambda s: core.try_reproduce(s, aid))
    assert child is not None and child.id == "AGT-0003"
    parent = h.agent(aid)
    assert h.fin(aid)["cash"] == usd(850)
    assert parent.next_reproduction_threshold == usd(1700)
    assert parent.reproduction_count == 2
    with core.tx() as s:
        evs = list(s.scalars(select(ReproductionEvent).order_by(ReproductionEvent.seq)))
        assert [(e.seq, e.parent_capital_before, e.parent_capital_after, e.next_threshold) for e in evs] == [
            (1, usd(500), usd(450), usd(900)), (2, usd(900), usd(850), usd(1700))]


# ---------------------------------------------------------------- Test E: weekly distribution
def test_e_weekly_distribution(core, h):
    aid = h.genesis()
    h.generous_limits()
    h.state("admin_wallet", {"address": WALLET, "network": "base"})
    h.revenue(aid, 100)
    h.expense(aid, 10, "business")
    end1 = core.now() + timedelta(seconds=1)
    d = core.run(lambda s: run_distribution(core, s, end1))
    assert d.status == "executed"
    assert d.period_profit == usd(90) and d.distributable == usd(90)
    assert d.owner_amount == usd(45) and d.retained_amount == usd(45)
    assert d.reimbursement_amount == usd(10)  # operator-paid costs repaid first
    with core.tx() as s:
        chain = SimulatedChain(s)
        assert chain.balance(WALLET) == usd(55)
        assert get_state(s, "distribution_hwm") == usd(90)
        assert Ledger(s).balance(A.DISTRIBUTIONS) == usd(45)
        assert reconcile(s, core.signer(s), core.treasury_address(s))["ok"]
    # retained half stays with the agent: 50 + 100 - 10 - 45
    assert h.fin(aid)["cash"] == usd(95)
    # idempotent for the same period
    assert core.run(lambda s: run_distribution(core, s, end1)).id == d.id
    # no new profit -> no payout; profit is never paid twice
    core.clock.advance(timedelta(days=7))
    d2 = core.run(lambda s: run_distribution(core, s, core.now()))
    assert d2.status == "no_profit" and d2.owner_amount == 0
    # a loss week must be recovered before anything is paid (high-water mark)
    core.clock.advance(timedelta(days=1))
    h.expense(aid, 20, "business")
    core.clock.advance(timedelta(days=6))
    d3 = core.run(lambda s: run_distribution(core, s, core.now()))
    assert d3.status == "no_profit" and d3.cumulative_profit == usd(70)
    core.clock.advance(timedelta(days=1))
    h.revenue(aid, 30)
    core.clock.advance(timedelta(days=6))
    d4 = core.run(lambda s: run_distribution(core, s, core.now()))
    assert d4.cumulative_profit == usd(100) and d4.distributable == usd(10) and d4.owner_amount == usd(5)


def test_e2_large_payout_requires_approval(core, h):
    aid = h.genesis()
    h.state("admin_wallet", {"address": WALLET, "network": "base"})
    h.revenue(aid, 400)
    d = core.run(lambda s: run_distribution(core, s, core.now()))
    assert d.status == "pending_approval" and d.owner_amount == usd(200)
    with core.tx() as s:
        assert SimulatedChain(s).balance(WALLET) == 0
        ap = s.scalar(select(Approval).where(Approval.kind == "distribution_payout"))
    # while the payout awaits approval, later periods defer profit but still repay operator costs
    h.expense(aid, 1, "business")
    core.clock.advance(timedelta(days=7))
    d_next = core.run(lambda s: run_distribution(core, s, core.now()))
    assert d_next.status == "deferred_pending_approval" and d_next.reimbursement_amount == usd(1)
    core.run(lambda s: core.decide_approval(s, ap.id, True, actor="admin"))
    with core.tx() as s:
        assert SimulatedChain(s).balance(WALLET) == usd(201)
        assert s.get(Distribution, d.id).status == "executed"


def test_e3_no_wallet_or_no_profit_means_no_payout(core, h):
    aid = h.genesis()
    h.revenue(aid, 20)
    d = core.run(lambda s: run_distribution(core, s, core.now()))
    assert d.status == "awaiting_wallet" and get_state_value(core, "distribution_hwm") == 0


def get_state_value(core, key):
    with core.tx() as s:
        return get_state(s, key)


def test_e4_schedule_is_sunday_2359_johannesburg(core):
    with core.tx() as s:
        pol = get_policy(s)
    # Monday 2026-01-05 00:00 UTC -> Sunday 2026-01-11 23:59 SAST == 21:59 UTC
    assert next_distribution_time(pol, datetime(2026, 1, 5)) == datetime(2026, 1, 11, 21, 59)
    assert next_distribution_time(pol, datetime(2026, 1, 11, 21, 59)) == datetime(2026, 1, 18, 21, 59)


# ---------------------------------------------------------------- Test F: death
class _Burn(Strategy):
    spec = StrategySpec(key="test_burn", name="Never profitable", category="test", description="spends, never earns",
                        params={"burn": Param(0, 5, 1.0)}, markets=("nowhere",), risk_level=0.1)

    def on_day(self, tb, params, state):
        tb.spend("business", int(params["burn"] * 1_000_000), "burn")


def test_f_agent_death(core, h, rt):
    register(_Burn())
    h.policy(enabled_strategies=["test_burn"], planning_interval_hours=24)
    aid = h.genesis(strategy="test_burn", market="nowhere")
    result = rt.orchestrator.advance(24 * 120)
    assert aid in result["deaths"]
    a = h.agent(aid)
    assert a.status == "deceased" and a.deceased_at is not None
    assert a.permissions == {}
    fp = a.final_performance
    assert fp["revenue"] == 0 and fp["net_profit"] < 0 and fp["age_days"] > 40
    with core.tx() as s:
        n_entries = s.scalar(select(func.count(JournalEntry.id)).where(JournalEntry.agent_id == aid))
        assert n_entries > 40  # records preserved
        assert Ledger(s).balance(A.cash(aid)) == 0
        assert reconcile(s, core.signer(s), core.treasury_address(s))["ok"]
    # a deceased agent cannot spend or earn
    with pytest.raises(PolicyViolation):
        h.expense(aid, 0.01)
    with pytest.raises(PolicyViolation):
        h.revenue(aid, 1)
    REGISTRY.pop("test_burn")


# ---------------------------------------------------------------- Test G: security
def test_g_unauthorized_and_limit_violations(core, h):
    aid = h.genesis()
    # over the per-category daily budget
    with pytest.raises(PolicyViolation, match="budget"):
        h.expense(aid, 0.51, "claude_api")
    # over the max transaction value
    h.revenue(aid, 500)
    h.policy(max_transaction_usd=1)
    with pytest.raises(PolicyViolation, match="max transaction"):
        h.expense(aid, 1.5, "business")
    h.policy(max_transaction_usd=100)
    # ecosystem daily cap
    h.policy(max_daily_expenditure_usd=1)
    with pytest.raises(PolicyViolation, match="ecosystem daily"):
        h.expense(aid, 1.5, "business")
    h.policy(max_daily_expenditure_usd=10)
    # no borrowing beyond available capital
    aid2 = core.run(lambda s: core.try_reproduce(s, aid)).id
    h.policy(agent_daily_budgets_usd={"business": 1000}, max_daily_expenditure_usd=1000, max_weekly_expenditure_usd=1000)
    with pytest.raises(InsufficientFunds):
        h.expense(aid2, 50.01, "business")
    # suspended agents cannot spend
    core.run(lambda s: core.set_agent_status(s, aid2, "suspended", actor="admin", reason="test"))
    with pytest.raises(PolicyViolation, match="not authorised"):
        h.expense(aid2, 1, "business")
    # paused ecosystem blocks discretionary spend
    h.state("paused", True)
    with pytest.raises(PolicyViolation, match="paused"):
        h.expense(aid, 1, "business")
    h.state("paused", False)
    # violations are recorded and audited
    with core.tx() as s:
        assert s.scalar(select(func.count(AgentEvent.id)).where(AgentEvent.type == "violation")) >= 5
        assert s.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "policy_violation_blocked")) >= 5


def test_g_forged_replayed_and_circular_revenue(core, h):
    aid = h.genesis()
    forged = EvidenceSigner("simulation", b"attacker-key").issue("fake-1", usd(1000), "sim-customer:x")
    with pytest.raises(PolicyViolation, match="verification"):
        core.run(lambda s: core.record_revenue(s, core.get_agent(s, aid), forged), agent_id=aid)
    ev = core.world.evidence.issue("real-1", usd(10), "sim-customer:x")
    core.run(lambda s: core.record_revenue(s, core.get_agent(s, aid), ev), agent_id=aid)
    with pytest.raises(PolicyViolation, match="already recorded"):
        core.run(lambda s: core.record_revenue(s, core.get_agent(s, aid), ev), agent_id=aid)
    circular = core.world.evidence.issue("circ-1", usd(10), "AGT-0001")
    with pytest.raises(PolicyViolation, match="circular"):
        core.run(lambda s: core.record_revenue(s, core.get_agent(s, aid), circular), agent_id=aid)
    assert h.fin(aid)["revenue"] == usd(10)


def test_g_duplicate_reproduction_under_concurrency(core, h):
    aid = h.genesis()
    h.revenue(aid, 450)
    results, errors = [], []
    barrier = threading.Barrier(6)

    def worker():
        barrier.wait()
        try:
            with core.tx() as s:  # deliberately bypass core.lock to exercise DB-level guards
                results.append(core.try_reproduce(s, aid))
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    births = [r for r in results if r is not None]
    assert len(births) == 1, (results, errors)
    assert all(isinstance(e, (Conflict,)) or "locked" in str(e) for e in errors)
    with core.tx() as s:
        assert s.scalar(select(func.count(Agent.id))) == 2
        assert s.scalar(select(func.count(ReproductionEvent.id))) == 1
        assert Ledger(s).balance(A.cash(aid)) == usd(450)


def test_g_trading_cannot_use_leverage_or_short(core, h):
    aid = h.genesis()
    with pytest.raises(PolicyViolation):
        core.run(lambda s: core.buy(s, core.get_agent(s, aid), "BTC", usd(49.99)), agent_id=aid)  # > max position fraction
    with pytest.raises(PolicyViolation):
        core.run(lambda s: core.sell(s, core.get_agent(s, aid), "BTC", 0.1), agent_id=aid)


def test_g_internal_transfer_requires_approval(core, h):
    aid = h.genesis()
    h.revenue(aid, 450)
    child = core.run(lambda s: core.try_reproduce(s, aid)).id
    ap = core.run(lambda s: core.request_internal_transfer(s, core.get_agent(s, aid), child, usd(10), "help sibling"))
    assert h.fin(child)["cash"] == usd(50)  # nothing moves before approval
    core.run(lambda s: core.decide_approval(s, ap.id, True, actor="admin"))
    assert h.fin(child)["cash"] == usd(60)
    assert h.fin(child)["revenue"] == 0


def test_g_auto_suspend_after_repeated_violations(core, h):
    aid = h.genesis()
    h.policy(max_violations_per_day_before_suspend=3)
    for _ in range(3):
        with pytest.raises(PolicyViolation):
            h.expense(aid, 5, "claude_api")
    assert h.agent(aid).status == "suspended"


def test_g_audit_log_tamper_detection(core, h):
    h.genesis()
    with core.tx() as s:
        assert audit.verify(s)["ok"]
        row = s.scalar(select(AuditLog).order_by(AuditLog.id).limit(1))
        row.details = {"amount": 999999}
    with core.tx() as s:
        v = audit.verify(s)
        assert not v["ok"] and v["broken_at"] == row.id


def test_g_proliferation_limits(core, h):
    aid = h.genesis()
    h.revenue(aid, 2000)
    h.policy(max_births_per_day=1)
    assert core.run(lambda s: core.try_reproduce(s, aid)) is not None
    with core.tx() as s:
        a = core.get_agent(s, aid)
        a.next_reproduction_threshold = usd(100)  # force eligibility to probe the other limits
    assert core.run(lambda s: core.try_reproduce(s, aid)) is None  # birth limit
    with core.tx() as s:
        assert "daily birth limit reached" in core.reproduction_blockers(s, core.get_agent(s, aid))
    h.policy(max_births_per_day=10, max_aggregate_capital_usd=1000)
    with core.tx() as s:
        assert "ecosystem above max aggregate operating capital" in core.reproduction_blockers(s, core.get_agent(s, aid))
    h.policy(max_aggregate_capital_usd=5000, max_active_agents=2)
    with core.tx() as s:
        assert "ecosystem at max active agents" in core.reproduction_blockers(s, core.get_agent(s, aid))


def test_g_policy_validation(core, h):
    with pytest.raises(PolicyViolation):
        h.policy(owner_profit_share_bps=20_000)
    with pytest.raises(PolicyViolation):
        h.policy(not_a_key=1)
    with pytest.raises(PolicyViolation):
        h.policy(max_daily_expenditure_usd=100, max_weekly_expenditure_usd=50)


# ---------------------------------------------------------------- Test H: accounting integrity
def test_h_accounting_integrity(core, h, rt):
    aid = h.genesis(fund=80)  # $30 of the contribution stays in the treasury
    core.run(lambda s: core.contribute_capital(s, usd(25), actor="admin"))  # additional contribution
    h.revenue(aid, 450)
    child = core.run(lambda s: core.try_reproduce(s, aid)).id  # offspring funding
    ap = core.run(lambda s: core.request_internal_transfer(s, core.get_agent(s, aid), child, usd(5), "x"))
    core.run(lambda s: core.decide_approval(s, ap.id, True, actor="admin"))  # agent-to-agent transfer
    # unrealized gain: buy, then mark the price up without selling
    core.run(lambda s: core.buy(s, core.get_agent(s, aid), "ETH", usd(100)))
    core.world.prices["ETH"] *= 1.5
    with core.tx() as s:
        core.mark_positions(s)
    with core.tx() as s:
        fin = core.financials(s, core.get_agent(s, aid))
        assert fin["unrealized"] > usd(40)
        l = Ledger(s)
        fee = usd(0.1)
        assert l.revenue() == usd(450)
        assert l.realized_profit() == usd(450) - fee  # only external revenue minus the trading fee
        assert l.is_balanced()
    h.state("admin_wallet", {"address": WALLET, "network": "base"})
    h.policy(auto_payout_limit_usd=10_000)
    d = core.run(lambda s: run_distribution(core, s, core.now()))
    assert d.distributable == usd(450) - usd(0.1)
    assert d.owner_amount == (usd(450) - usd(0.1)) // 2
    # Ledger refuses to classify an internal transfer as income
    with core.tx() as s:
        with pytest.raises(LedgerError):
            Ledger(s).post(kind=INTERNAL_TRANSFER, ts=core.now(), lines=[
                Line(A.cash(aid), usd(1), aid), Line(A.REVENUE, -usd(1), aid)])
    # identity: net assets == contributions + realized profit - distributions
    with core.tx() as s:
        tb = Ledger(s).trial_balance()
        assets = sum(v for k, v in tb.items() if k.startswith("asset:"))
        liabilities = -sum(v for k, v in tb.items() if k.startswith("liability:"))
        contributed = -tb[A.CONTRIBUTED]
        assert contributed == usd(105)
        assert assets - liabilities == contributed + Ledger(s).realized_profit() - tb.get(A.DISTRIBUTIONS, 0)
        assert reconcile(s, core.signer(s), core.treasury_address(s))["ok"]
