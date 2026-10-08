"""Event loop: advances time, runs each agent's strategy through a validated
Toolbox, triggers planning, survival/reproduction checks and the weekly
distribution scheduler."""
from __future__ import annotations

import copy
import logging
import threading
import time
from datetime import datetime, timedelta

from sqlalchemy import select

from . import audit
from .core import BASE_INFRA_PER_AGENT_DAY_USD, GenesisCore
from .distribution import next_distribution_time, run_due_distributions
from .errors import GenesisError, PolicyViolation
from .ledger import Ledger
from .models import Agent, AgentStatus, DailySnapshot, Opportunity, Position
from .money import fmt, usd
from .policy import get_policy, get_state, set_state
from .strategies import REGISTRY
from .strategies.base import Strategy

log = logging.getLogger("genesis.orchestrator")


class Toolbox:
    """The only interface strategies have to the outside world. Every call is
    bound to one agent (an agent cannot name another agent's funds) and
    validated by GENESIS CORE."""

    def __init__(self, core: GenesisCore, s, agent: Agent):
        self.core, self.s, self.agent = core, s, agent
        self.agent_id = agent.id
        self.market = agent.strategy_profile.get("market")
        self.now = core.now()
        self.summary = {"spent": 0, "revenue": 0, "sales": 0, "blocked": 0, "trades": 0}

    def _guard(self, fn, *args, **kw):
        try:
            with self.s.begin_nested():
                return fn(*args, **kw)
        except PolicyViolation as exc:
            self.summary["blocked"] += 1
            self.core.event(self.s, self.agent_id, "blocked", str(exc), "warning", code=exc.code)
            return None
        except GenesisError as exc:
            self.core.event(self.s, self.agent_id, "error", str(exc), "warning", code=exc.code)
            return None

    # ------------------------------------------------------------ money
    def available(self) -> int:
        return self.core.financials(self.s, self.agent)["available"]

    def spend(self, category: str, amount: int, memo: str) -> bool:
        if amount <= 0:
            return True
        ok = self._guard(self.core.charge_expense, self.s, self.agent, category, amount, memo) is not None
        if ok:
            self.summary["spent"] += amount
        return ok

    def spend_up_to(self, category: str, amount: int, memo: str) -> int:
        cap = min(amount, self.core.remaining_budget(self.s, self.agent, category), max(0, self.available()))
        if cap <= 0:
            return 0
        return cap if self.spend(category, cap, memo) else 0

    def record_sale(self, amount: int, product: str) -> bool:
        if self.core.world is None:
            return False  # live revenue arrives only through verified integration webhooks
        evidence = self.core.world.issue_sale(self.agent_id, amount, product)
        ok = self._guard(self.core.record_revenue, self.s, self.agent, evidence, description=f"sale: {product}") is not None
        if ok:
            self.summary["revenue"] += amount
            self.summary["sales"] += 1
        return ok

    # ------------------------------------------------------------ markets
    def price(self, symbol: str) -> float:
        return self.core._market_price(symbol)

    def position_qty(self, symbol: str) -> float:
        pos = self.s.scalar(select(Position).where(Position.agent_id == self.agent_id, Position.symbol == symbol))
        return pos.quantity if pos else 0.0

    def buy(self, symbol: str, notional: int):
        r = self._guard(self.core.buy, self.s, self.agent, symbol, notional)
        if r is not None:
            self.summary["trades"] += 1
            self.core.event(self.s, self.agent_id, "tool", f"spot buy {symbol} {fmt(notional)}", tool="buy")
        return r

    def sell(self, symbol: str, qty: float):
        r = self._guard(self.core.sell, self.s, self.agent, symbol, qty)
        if r is not None:
            self.summary["trades"] += 1
            self.core.event(self.s, self.agent_id, "tool", f"spot sell {symbol}: realized {fmt(r)}", tool="sell")
        return r

    # ------------------------------------------------------------ simulated world
    def world_demand(self, fn: str, **kw) -> int:
        if self.core.world is None:
            return 0
        return getattr(self.core.world, fn)(self.market, **kw)

    def world_churned(self) -> bool:
        return self.core.world.churned() if self.core.world else False

    def world_momentum(self, symbol: str, lookback: int) -> float:
        return self.core.world.momentum(symbol, lookback) if self.core.world else 0.0

    def log(self, type_: str, summary: str, **data):
        self.core.event(self.s, self.agent_id, type_, summary, **data)


class Orchestrator:
    def __init__(self, core: GenesisCore):
        self.core = core
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.last_tick_at: datetime | None = None
        self._next_due: datetime | None = None

    # ------------------------------------------------------------ one step
    def tick(self, hours: int = 1, snapshot: bool = True) -> dict:
        core = self.core
        with core.lock:
            with core.tx() as s:
                if get_state(s, "emergency_stop") or get_state(s, "paused"):
                    return {"skipped": "paused"}
                if core.world is not None:
                    core.world.step(hours)
                    if snapshot or core.now().hour == 0:
                        set_state(s, "sim_prices", core.world.prices, core.now())
                core.mark_positions(s)
                agent_ids = list(s.scalars(select(Agent.id).where(Agent.status == AgentStatus.ACTIVE).order_by(Agent.seq)))
            results = {"agents": len(agent_ids), "births": [], "deaths": []}
            for aid in agent_ids:
                try:
                    with core.tx() as s:
                        self._run_agent(s, aid, results)
                except Exception as exc:  # noqa: BLE001 - one agent's failure must not stop the ecosystem
                    log.exception("agent %s cycle failed", aid)
                    with core.tx() as s:
                        core.event(s, aid, "error", f"cycle failed: {type(exc).__name__}: {exc}", "critical")
            with core.tx() as s:
                # Cheap guard: only consult the scheduler when the cached due time has passed
                # (the cache is refreshed daily so policy changes take effect within a day).
                if self._next_due is None or core.now() >= self._next_due or core.now().hour == 0:
                    if get_state(s, "genesis_at"):
                        dists = run_due_distributions(core, s)
                        results["distributions"] = [(d.id, d.status, d.owner_amount) for d in dists]
                        self._next_due = next_distribution_time(get_policy(s), datetime.fromisoformat(
                            get_state(s, "last_distribution_period_end") or get_state(s, "genesis_at")))
                if snapshot or core.now().hour == 23 or not s.get(DailySnapshot, core.now().strftime("%Y-%m-%d")):
                    self._snapshot(s)
            self.last_tick_at = core.now()
            return results

    def advance(self, hours: int) -> dict:
        """Simulation only: move the simulated clock forward hour by hour."""
        if not self.core.clock.simulated:
            raise GenesisError("advance() is only available with the simulation clock")
        totals = {"births": [], "deaths": [], "distributions": []}
        for _ in range(int(hours)):
            self.core.clock.advance(timedelta(hours=1))
            r = self.tick(1, snapshot=False)
            for k in totals:
                totals[k] += r.get(k, [])
        with self.core.tx() as s:
            self._snapshot(s)
        return totals

    def _run_agent(self, s, agent_id: str, results: dict) -> None:
        core = self.core
        agent = core.get_agent(s, agent_id)
        if agent.status != AgentStatus.ACTIVE:
            return
        pol = get_policy(s)
        now = core.now()
        strat = REGISTRY.get(agent.strategy_key)
        hourly = strat is not None and type(strat).on_hour is not Strategy.on_hour
        daily_due = agent.last_daily_run_at is None or now - agent.last_daily_run_at >= timedelta(hours=24)
        plan_due = agent.last_planned_at is None or now - agent.last_planned_at >= timedelta(hours=pol["planning_interval_hours"])
        if not (hourly or daily_due or plan_due):
            return  # nothing can have changed this agent's finances this hour
        prof = copy.deepcopy(agent.strategy_profile)
        state = prof.get("state", {})
        authorized = not s.scalar(select(Opportunity.id).where(
            Opportunity.agent_id == agent.id, Opportunity.status == "awaiting_authorization",
            Opportunity.strategy_key == agent.strategy_key))
        tb = Toolbox(core, s, agent)
        if strat and authorized:
            strat.on_hour(tb, prof.get("params", {}), state)
        if daily_due:
            start_profit = Ledger(s).realized_profit(agent_id=agent.id)
            tb.spend("compute", usd(BASE_INFRA_PER_AGENT_DAY_USD), "base infrastructure share") or \
                self._mandatory(s, agent, "compute", usd(BASE_INFRA_PER_AGENT_DAY_USD))
            if strat and authorized:
                strat.on_day(tb, prof.get("params", {}), state)
            agent.last_daily_run_at = now
            day_profit = Ledger(s).realized_profit(agent_id=agent.id) - start_profit
            agent.consecutive_losing_days = agent.consecutive_losing_days + 1 if day_profit < 0 else 0
            if agent.consecutive_losing_days == pol["losing_days_warning"]:
                core.event(s, agent.id, "risk", f"{agent.consecutive_losing_days} consecutive losing days", "warning")
            if tb.summary["sales"] or tb.summary["spent"] or tb.summary["trades"]:
                core.event(s, agent.id, "daily", f"day: revenue {fmt(tb.summary['revenue'])} from {tb.summary['sales']} sales, "
                           f"spent {fmt(tb.summary['spent'])}, {tb.summary['trades']} trades", **tb.summary)
            core.evaluate_opportunities(s, agent)
        # persist strategy state (JSON column => assign a fresh object)
        prof = copy.deepcopy(agent.strategy_profile)
        prof["state"] = state
        agent.strategy_profile = prof
        if plan_due:
            core.plan_agent(s, agent)
        if core.is_insolvent(s, agent):
            core.terminate(s, agent, reason="insolvent: operating capital exhausted", actor="core")
            results["deaths"].append(agent.id)
            return
        child = core.try_reproduce(s, agent.id)
        if child is not None:
            results["births"].append(child.id)

    def _mandatory(self, s, agent, category, amount) -> bool:
        """Unavoidable costs (already consumed infrastructure). Paid if funds exist,
        otherwise the agent is insolvent and will be terminated this cycle."""
        payable = min(amount, max(0, self.core.financials(s, agent)["available"]))
        if payable <= 0:
            return False
        try:
            self.core.charge_expense(s, agent, category, payable, "base infrastructure share (mandatory)", mandatory=True)
            return True
        except PolicyViolation:
            return False

    def _snapshot(self, s) -> None:
        from .reporting import overview

        day = self.core.now().strftime("%Y-%m-%d")
        ov = overview(self.core, s, light=True)
        row = s.get(DailySnapshot, day)
        if row is None:
            s.add(DailySnapshot(day=day, ts=self.core.now(), metrics=ov))
        else:
            row.metrics = ov
            row.ts = self.core.now()

    # ------------------------------------------------------------ background loop
    def start(self, interval_seconds: float) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()

        def loop():
            while not self._stop.is_set():
                try:
                    if self.core.clock.simulated:
                        self.advance(1)
                    else:
                        self.tick(1)
                except Exception:  # noqa: BLE001
                    log.exception("tick failed")
                self._stop.wait(interval_seconds)

        self._thread = threading.Thread(target=loop, name="genesis-orchestrator", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())
