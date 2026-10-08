"""GENESIS CORE — the deterministic supervisor.

Every rule that protects money is enforced here, in plain code. AI output is
treated as a proposal that this module validates; it is never trusted to
enforce limits itself.
"""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.orm.exc import StaleDataError

from . import audit
from .brain import HeuristicBrain, PlanContext
from .clock import SimClock, SystemClock
from .errors import Conflict, GenesisError, InsufficientFunds, LedgerError, NotFound, PolicyViolation
from .ledger import (
    ACCRUAL, ALLOCATION, COLLECTION, CONTRIBUTION, ESTATE_SWEEP, EXPENSE, EXPENSE_CATEGORIES, INTERNAL_TRANSFER,
    REPRODUCTION, REVENUE, SETTLEMENT, TRADE_BUY, TRADE_SELL, A, Ledger, Line, is_wallet_held,
)
from .models import (
    Agent, AgentEvent, AgentMemory, AgentStatus, Approval, Opportunity, Position, ReproductionEvent, UsageRecord,
)
from .money import fmt, to_usd, usd
from .policy import get_policy, get_state, set_state
from .simworld import RevenueEvidence, SimWorld
from .strategies import REGISTRY
from .treasury import SIM_TREASURY_ADDRESS, ExternalSignerAdapter, SimulatedChain, SimulatedSigner

log = logging.getLogger("genesis.core")

# Costs paid off-chain by the administrator (card/bank) accrue to
# operator_payable and are reimbursed from the treasury; on-chain costs are
# paid straight from the wallet.
WALLET_PAID_CATEGORIES = {"blockchain_fees", "trading_fees"}
TRADING_FEE_RATE = 0.001  # 0.10% taker fee (simulated venue)
BASE_INFRA_PER_AGENT_DAY_USD = 0.02  # share of a small VPS + database
TEST_PHASE_DAYS = 14


def agent_financials(agent: Agent, bal: dict[str, int], positions: list[Position] | None = None) -> dict:
    aid = agent.id
    cash = bal.get(A.cash(aid), 0)
    receivable = bal.get(A.receivable(aid), 0)
    pos_cost = bal.get(A.positions(aid), 0)
    payable = -bal.get(A.payable(aid), 0)
    revenue = -bal.get(A.REVENUE, 0)
    trading_gain = -bal.get(A.TRADING_GAIN, 0)
    expenses = sum(v for k, v in bal.items() if k.startswith("expense:"))
    trading_loss = bal.get("expense:trading_loss", 0)
    distributed = bal.get(A.DISTRIBUTIONS, 0)
    unrealized = 0
    pos_value = 0
    for p in positions or []:
        value = int(p.quantity * p.mark_price * 1_000_000)
        pos_value += value
        unrealized += value - p.cost_basis
    net_profit = revenue + trading_gain - expenses
    available = cash - payable
    return {
        "cash": cash,
        "receivable": receivable,
        "positions_cost": pos_cost,
        "positions_value": pos_value,
        "payable": payable,
        "available": available,
        "net_capital": cash + receivable + pos_cost - payable,
        "revenue": revenue,
        "trading_pnl": trading_gain - trading_loss,
        "expenses": expenses - trading_loss,
        "net_profit": net_profit,
        "unrealized": unrealized,
        "distributed": distributed,
        "roc": (net_profit / agent.starting_capital) if agent.starting_capital else 0.0,
    }


class GenesisCore:
    def __init__(self, session_factory: sessionmaker, *, clock=None, world: SimWorld | None = None,
                 brain=None, seed: int = 42):
        self.factory = session_factory
        self.clock = clock or SimClock()
        self.world = world if world is not None else (SimWorld(seed) if self.clock.simulated else None)
        self.brain = brain or HeuristicBrain(seed)
        self.lock = threading.RLock()
        self.verifiers = {}
        if self.world is not None:
            self.verifiers["simulation"] = self.world.evidence

    # ================================================================ infra
    def now(self) -> datetime:
        return self.clock.now()

    @contextmanager
    def tx(self):
        s: Session = self.factory()
        try:
            yield s
            s.commit()
        except BaseException:
            s.rollback()
            raise
        finally:
            s.close()

    def run(self, fn, *, actor: str = "core", agent_id: str | None = None):
        """Run fn(session) atomically. Policy violations roll back all writes,
        are recorded in the activity feed + audit log, then re-raised."""
        with self.lock, self.tx() as s:
            try:
                return fn(s)
            except PolicyViolation as exc:
                s.rollback()
                s.info.pop("genesis_kv", None)
                self._record_violation(s, agent_id, exc, actor)
                s.commit()
                raise

    def is_live(self, s: Session) -> bool:
        return bool(get_state(s, "live_mode"))

    def signer(self, s: Session):
        return ExternalSignerAdapter() if self.is_live(s) else SimulatedSigner(s)

    def treasury_address(self, s: Session) -> str:
        if self.is_live(s):
            addr = get_state(s, "treasury_address")
            if not addr:
                raise GenesisError("treasury address not configured", code="not_configured")
            return addr
        return SIM_TREASURY_ADDRESS

    def event(self, s: Session, agent_id: str | None, type_: str, summary: str, severity: str = "info", **data):
        s.add(AgentEvent(agent_id=agent_id, ts=self.now(), type=type_, severity=severity, summary=summary, data=data))

    def _record_violation(self, s: Session, agent_id: str | None, exc: PolicyViolation, actor: str):
        self.event(s, agent_id, "violation", str(exc), "warning", code=exc.code, actor=actor)
        audit.record(s, ts=self.now(), actor=actor, action="policy_violation_blocked", target=agent_id,
                     details={"code": exc.code, "message": str(exc)})
        if agent_id:
            agent = s.get(Agent, agent_id)
            if agent and agent.status == AgentStatus.ACTIVE:
                pol = get_policy(s)
                since = self.now() - timedelta(days=1)
                n = s.scalar(select(func.count(AgentEvent.id)).where(
                    AgentEvent.agent_id == agent_id, AgentEvent.type == "violation", AgentEvent.ts > since))
                if (n or 0) + 1 >= pol["max_violations_per_day_before_suspend"]:
                    agent.status = AgentStatus.SUSPENDED
                    agent.status_reason = "auto-suspended: repeated policy violations"
                    self.event(s, agent_id, "suspended", agent.status_reason, "critical")
                    audit.record(s, ts=self.now(), actor="risk_monitor", action="agent_auto_suspended",
                                 target=agent_id, details={"violations_24h": (n or 0) + 1})

    def post(self, s: Session, **kw):
        """Post a journal entry and, in simulation, mirror its net wallet effect
        on the simulated chain so reconciliation is meaningful."""
        kw.setdefault("ts", self.now())
        kw.setdefault("simulated", not self.is_live(s))
        entry = Ledger(s).post(**kw)
        if not self.is_live(s) and not (kw.get("meta") or {}).get("chain_handled"):
            delta = sum(ln.amount for ln in kw["lines"] if is_wallet_held(ln.account))
            chain = SimulatedChain(s)
            if delta > 0:
                chain.mint(SIM_TREASURY_ADDRESS, delta)
            elif delta < 0:
                chain.transfer(SIM_TREASURY_ADDRESS, "SIM-EXTERNAL", -delta)
        return entry

    # ================================================================ lookups
    def get_agent(self, s: Session, agent_id: str, *, lock: bool = False) -> Agent:
        q = select(Agent).where(Agent.id == agent_id)
        if lock:
            q = q.with_for_update()
        agent = s.scalar(q)
        if agent is None:
            raise NotFound(f"agent {agent_id} not found")
        return agent

    def financials(self, s: Session, agent: Agent) -> dict:
        positions = list(s.scalars(select(Position).where(Position.agent_id == agent.id, Position.quantity > 0)))
        return agent_financials(agent, Ledger(s).agent_balances(agent.id), positions)

    # ================================================================ capital
    def contribute_capital(self, s: Session, amount: int, *, actor: str, reference: str | None = None) -> None:
        if amount <= 0:
            raise PolicyViolation("contribution must be positive")
        if self.is_live(s) and not reference:
            raise PolicyViolation("live contributions require the on-chain deposit transaction hash")
        self.post(s, kind=CONTRIBUTION, lines=[Line(A.TREASURY, amount), Line(A.CONTRIBUTED, -amount)],
                  description="administrator capital contribution", external_ref=reference, created_by=actor,
                  idempotency_key=f"contrib:{reference}" if reference else None)
        audit.record(s, ts=self.now(), actor=actor, action="capital_contribution", details={"amount": amount, "ref": reference})

    def treasury_free(self, s: Session) -> int:
        return Ledger(s).balance(A.TREASURY)

    def aggregate_agent_capital(self, s: Session) -> int:
        """Net capital held by all agents (assets at cost minus their payables)."""
        tb = Ledger(s).trial_balance()
        # liability balances are negative (credits), so a plain sum nets them off
        return sum(v for k, v in tb.items() if k.startswith(("asset:agent:", "liability:agent:")))

    # ================================================================ agents
    def _next_seq(self, s: Session) -> int:
        return int(s.scalar(select(func.coalesce(func.max(Agent.seq), 0)))) + 1

    def _new_agent(self, s: Session, *, parent: Agent | None, capital: int, profile: dict, actor: str) -> Agent:
        pol = get_policy(s)
        seq = self._next_seq(s)
        agent_id = f"AGT-{seq:04d}"
        key = profile["strategy_key"]
        strat = REGISTRY[key]
        now = self.now()
        agent = Agent(
            id=agent_id, seq=seq, name=f"Genesis-{seq:03d}", parent_id=parent.id if parent else None,
            generation=(parent.generation + 1) if parent else 1, created_at=now, status=AgentStatus.ACTIVE,
            starting_capital=capital, reproduction_count=0,
            next_reproduction_threshold=capital * pol["first_reproduction_multiple"],
            strategy_key=key,
            strategy_profile={
                "market": profile["market"],
                "params": strat.clamp_params(profile.get("params")),
                "risk_tolerance": min(pol["max_risk_tolerance"], profile.get("risk_tolerance", 0.3)),
                "started_at": now.isoformat(),
                "baseline": {"revenue": 0, "costs": 0},
                "state": {},
                "experiments": [],
                "lineage_change": profile.get("change"),
                "decision_config": {"brain": getattr(self.brain, "name", "heuristic"),
                                    "routine_model": pol["claude_routine_model"],
                                    "reasoning_model": pol["claude_reasoning_model"]},
            },
            objective=f"Establish a first verified revenue stream with {strat.spec.name}.",
            permissions={"spend": True, "trade": True, "sell": True, "reproduce": True},
            budget_overrides={},
        )
        s.add(agent)
        s.flush()
        self._open_opportunity(s, agent, key, profile["market"])
        self.event(s, agent_id, "birth", f"{agent_id} born with {fmt(capital)}"
                   + (f" (offspring of {parent.id})" if parent else " (genesis agent)"),
                   parent=parent.id if parent else None, strategy=key, market=profile["market"])
        audit.record(s, ts=now, actor=actor, action="agent_created", target=agent_id,
                     details={"parent": parent.id if parent else None, "capital": capital, "strategy": key})
        return agent

    def create_genesis_agent(self, s: Session, *, actor: str, strategy_key: str = "research_reports",
                             market: str | None = None) -> Agent:
        pol = get_policy(s)
        if s.scalar(select(func.count(Agent.id))):
            raise Conflict("genesis agent already exists; further agents are born through reproduction")
        if strategy_key not in REGISTRY or strategy_key not in pol["enabled_strategies"]:
            raise PolicyViolation(f"strategy {strategy_key!r} is not enabled")
        capital = usd(pol["initial_agent_capital_usd"])
        if self.treasury_free(s) < capital:
            raise InsufficientFunds(f"treasury needs {fmt(capital)} to fund the genesis agent")
        if self.aggregate_agent_capital(s) + capital > usd(pol["max_aggregate_capital_usd"]):
            raise PolicyViolation("allocation would exceed max aggregate operating capital")
        strat = REGISTRY[strategy_key]
        agent = self._new_agent(s, parent=None, capital=capital, actor=actor, profile={
            "strategy_key": strategy_key, "risk_tolerance": 0.3,
            # Unbiased default: the market is drawn from the seeded RNG unless the administrator picks one.
            "market": market if market in strat.spec.markets else self.brain.rng.choice(strat.spec.markets)})
        self.post(s, kind=ALLOCATION, agent_id=agent.id, created_by=actor,
                  lines=[Line(A.cash(agent.id), capital, agent.id), Line(A.TREASURY, -capital)],
                  description=f"initial allocation to {agent.id}", idempotency_key=f"alloc:genesis:{agent.id}",
                  meta={"chain_handled": True})
        if get_state(s, "genesis_at") is None:
            set_state(s, "genesis_at", self.now().isoformat(), self.now())
        return agent

    def set_agent_status(self, s: Session, agent_id: str, status: str, *, actor: str, reason: str) -> Agent:
        agent = self.get_agent(s, agent_id, lock=True)
        if agent.status == AgentStatus.DECEASED:
            raise Conflict("agent is deceased")
        if status == AgentStatus.DECEASED:
            self.terminate(s, agent, reason=reason, actor=actor)
            return agent
        agent.status = status
        agent.status_reason = reason
        self.event(s, agent.id, status, f"{agent.id} {status}: {reason}", "warning" if status != "active" else "info")
        audit.record(s, ts=self.now(), actor=actor, action=f"agent_{status}", target=agent.id, details={"reason": reason})
        return agent

    # ================================================================ spending
    def _day_start(self) -> datetime:
        n = self.now()
        return n.replace(hour=0, minute=0, second=0, microsecond=0)

    def check_spend(self, s: Session, agent: Agent, category: str, amount: int, *, mandatory: bool = False) -> None:
        pol = get_policy(s)
        if category not in EXPENSE_CATEGORIES or category == "trading_loss":
            raise PolicyViolation(f"unknown spending category {category!r}")
        if amount <= 0:
            raise PolicyViolation("spend amount must be positive")
        if agent.status == AgentStatus.DECEASED:
            raise PolicyViolation(f"{agent.id} is deceased; spending permissions revoked", code="unauthorized")
        if not mandatory:
            if agent.status != AgentStatus.ACTIVE or not agent.permissions.get("spend"):
                raise PolicyViolation(f"{agent.id} is not authorised to spend", code="unauthorized")
            if get_state(s, "paused") or get_state(s, "emergency_stop"):
                raise PolicyViolation("ecosystem is paused", code="paused")
            if amount > usd(pol["max_transaction_usd"]):
                raise PolicyViolation(f"{fmt(amount)} exceeds max transaction value", code="tx_limit")
            ledger = Ledger(s)
            budgets = {**pol["agent_daily_budgets_usd"], **agent.budget_overrides}
            cap = usd(budgets.get(category, 0))
            spent = ledger.operating_spend(agent_id=agent.id, category=category, start=self._day_start() - timedelta(microseconds=1))
            if spent + amount > cap:
                raise PolicyViolation(f"{category} daily budget exceeded ({fmt(spent + amount)} > {fmt(cap)})", code="budget")
            now = self.now()
            day = ledger.operating_spend(start=now - timedelta(days=1))
            if day + amount > usd(pol["max_daily_expenditure_usd"]):
                raise PolicyViolation("ecosystem daily expenditure cap reached", code="eco_daily_cap")
            week = ledger.operating_spend(start=now - timedelta(days=7))
            if week + amount > usd(pol["max_weekly_expenditure_usd"]):
                raise PolicyViolation("ecosystem weekly expenditure cap reached", code="eco_weekly_cap")
        fin = self.financials(s, agent)
        if fin["available"] < amount:
            raise InsufficientFunds(f"{agent.id} has {fmt(fin['available'])} available; cannot pay {fmt(amount)} (no borrowing)")

    def remaining_budget(self, s: Session, agent: Agent, category: str) -> int:
        pol = get_policy(s)
        budgets = {**pol["agent_daily_budgets_usd"], **agent.budget_overrides}
        spent = Ledger(s).operating_spend(agent_id=agent.id, category=category, start=self._day_start() - timedelta(microseconds=1))
        return max(0, usd(budgets.get(category, 0)) - spent)

    def charge_expense(self, s: Session, agent: Agent, category: str, amount: int, memo: str, *,
                       mandatory: bool = False, paid_via: str | None = None, created_by: str | None = None,
                       idempotency_key: str | None = None):
        self.check_spend(s, agent, category, amount, mandatory=mandatory)
        paid_via = paid_via or ("wallet" if category in WALLET_PAID_CATEGORIES else "operator")
        lines = [Line(A.expense(category), amount, agent.id, category), Line(A.cash(agent.id), -amount, agent.id)]
        if paid_via == "operator":
            lines += [Line(A.REIMB_RESERVE, amount), Line(A.OPERATOR_PAYABLE, -amount)]
        return self.post(s, kind=EXPENSE, agent_id=agent.id, lines=lines, description=memo,
                         created_by=created_by or agent.id, idempotency_key=idempotency_key,
                         meta={"paid_via": paid_via, "mandatory": mandatory})

    def accrue_expense(self, s: Session, agent: Agent, category: str, amount: int, memo: str):
        """Record an obligation incurred but not yet paid (reduces available capital)."""
        self.check_spend(s, agent, category, amount)
        return self.post(s, kind=ACCRUAL, agent_id=agent.id, description=memo, created_by=agent.id, lines=[
            Line(A.expense(category), amount, agent.id, category), Line(A.payable(agent.id), -amount, agent.id)])

    def settle_payables(self, s: Session, agent: Agent) -> int:
        bal = Ledger(s).agent_balances(agent.id)
        owed = -bal.get(A.payable(agent.id), 0)
        cash = bal.get(A.cash(agent.id), 0)
        pay = min(owed, cash)
        if pay > 0:
            self.post(s, kind=SETTLEMENT, agent_id=agent.id, description="settle accrued obligations", lines=[
                Line(A.payable(agent.id), pay, agent.id), Line(A.cash(agent.id), -pay, agent.id),
                Line(A.REIMB_RESERVE, pay), Line(A.OPERATOR_PAYABLE, -pay)])
        return pay

    # ================================================================ revenue
    def record_revenue(self, s: Session, agent: Agent, evidence: RevenueEvidence, *, description: str = "",
                       collected: bool = True):
        if agent.status != AgentStatus.ACTIVE or not agent.permissions.get("sell"):
            raise PolicyViolation(f"{agent.id} may not record revenue", code="unauthorized")
        if not isinstance(evidence, RevenueEvidence):
            raise PolicyViolation("revenue requires verifiable evidence", code="unverified_revenue")
        if self.is_live(s) and evidence.source == "simulation":
            raise PolicyViolation("simulated revenue cannot be recorded in live mode", code="unverified_revenue")
        verifier = self.verifiers.get(evidence.source)
        if verifier is None or not verifier.verify(evidence):
            raise PolicyViolation("revenue evidence failed verification", code="unverified_revenue")
        payer = (evidence.payer or "").lower()
        internal_ids = {a.lower() for a in s.scalars(select(Agent.id))}
        if payer.startswith("agent:") or payer in internal_ids or "treasury" in payer or payer.startswith("agt-"):
            raise PolicyViolation("circular revenue: payer is inside the ecosystem", code="circular_revenue")
        if evidence.amount <= 0:
            raise PolicyViolation("revenue must be positive")
        debit = A.cash(agent.id) if collected else A.receivable(agent.id)
        try:
            with s.begin_nested():
                entry = self.post(s, kind=REVENUE, agent_id=agent.id, description=description or "verified sale",
                                  lines=[Line(debit, evidence.amount, agent.id), Line(A.REVENUE, -evidence.amount, agent.id)],
                                  external_ref=evidence.reference, evidence_source=evidence.source,
                                  idempotency_key=f"rev:{evidence.source}:{evidence.reference}",
                                  meta={"payer": evidence.payer, "collected": collected})
        except LedgerError as exc:
            if exc.code == "duplicate":
                raise PolicyViolation("revenue already recorded for this payment reference", code="duplicate_revenue") from exc
            raise
        return entry

    def collect_receivable(self, s: Session, agent: Agent, amount: int, reference: str):
        bal = Ledger(s).agent_balances(agent.id).get(A.receivable(agent.id), 0)
        if amount <= 0 or amount > bal:
            raise PolicyViolation("collection exceeds receivable")
        return self.post(s, kind=COLLECTION, agent_id=agent.id, description="receivable collected",
                         lines=[Line(A.cash(agent.id), amount, agent.id), Line(A.receivable(agent.id), -amount, agent.id)],
                         idempotency_key=f"collect:{reference}")

    # ================================================================ trading
    def _position(self, s: Session, agent_id: str, symbol: str) -> Position:
        pos = s.scalar(select(Position).where(Position.agent_id == agent_id, Position.symbol == symbol))
        if pos is None:
            pos = Position(agent_id=agent_id, symbol=symbol, quantity=0.0, cost_basis=0, mark_price=0.0, updated_at=self.now())
            s.add(pos)
            s.flush()
        return pos

    def _market_price(self, symbol: str) -> float:
        if self.world is None:
            raise GenesisError("live exchange adapter not configured", code="not_configured")
        return self.world.price(symbol)

    def buy(self, s: Session, agent: Agent, symbol: str, notional: int):
        pol = get_policy(s)
        if not agent.permissions.get("trade"):
            raise PolicyViolation("trading not permitted", code="unauthorized")
        fee = max(1, int(notional * TRADING_FEE_RATE))
        fin = self.financials(s, agent)
        if notional + fee > fin["available"]:
            raise InsufficientFunds("order exceeds available cash (no leverage or margin)")
        if notional > int(fin["available"] * pol["max_position_fraction"]) + 1:
            raise PolicyViolation("order exceeds max position fraction", code="risk_limit")
        self.check_spend(s, agent, "trading_fees", fee)
        if notional > usd(pol["max_transaction_usd"]):
            raise PolicyViolation("order exceeds max transaction value", code="tx_limit")
        price = self._market_price(symbol)
        qty = notional / 1_000_000 / price
        pos = self._position(s, agent.id, symbol)
        pos.quantity += qty
        pos.cost_basis += notional
        pos.mark_price = price
        pos.updated_at = self.now()
        self.post(s, kind=TRADE_BUY, agent_id=agent.id, description=f"buy {qty:.6f} {symbol} @ {price:,.2f}",
                  meta={"symbol": symbol, "qty": qty, "price": price}, lines=[
                      Line(A.positions(agent.id), notional, agent.id),
                      Line(A.expense("trading_fees"), fee, agent.id, "trading_fees"),
                      Line(A.cash(agent.id), -(notional + fee), agent.id)])
        return qty

    def sell(self, s: Session, agent: Agent, symbol: str, qty: float, *, forced: bool = False):
        pos = self._position(s, agent.id, symbol)
        if qty <= 0 or qty > pos.quantity + 1e-12:
            raise PolicyViolation("cannot sell more than held (no shorting)", code="risk_limit")
        if not forced and not agent.permissions.get("trade"):
            raise PolicyViolation("trading not permitted", code="unauthorized")
        price = self._market_price(symbol)
        frac = min(1.0, qty / pos.quantity)
        cost = pos.cost_basis if frac >= 1.0 else int(pos.cost_basis * frac)
        gross = int(qty * price * 1_000_000)
        fee = max(1, int(gross * TRADING_FEE_RATE))
        pnl = gross - cost
        lines = [Line(A.cash(agent.id), gross - fee, agent.id), Line(A.expense("trading_fees"), fee, agent.id, "trading_fees"),
                 Line(A.positions(agent.id), -cost, agent.id)]
        if pnl > 0:
            lines.append(Line(A.TRADING_GAIN, -pnl, agent.id))
        elif pnl < 0:
            lines.append(Line(A.expense("trading_loss"), -pnl, agent.id, "trading_loss"))
        pos.quantity = 0.0 if frac >= 1.0 else pos.quantity - qty
        pos.cost_basis -= cost
        pos.mark_price = price
        pos.updated_at = self.now()
        self.post(s, kind=TRADE_SELL, agent_id=agent.id, lines=lines, description=f"sell {qty:.6f} {symbol} @ {price:,.2f}",
                  meta={"symbol": symbol, "qty": qty, "price": price, "realized_pnl": pnl})
        return pnl

    def mark_positions(self, s: Session) -> None:
        if self.world is None:
            return
        for pos in s.scalars(select(Position).where(Position.quantity > 0)):
            pos.mark_price = self.world.price(pos.symbol)
            pos.updated_at = self.now()

    # ================================================================ internal transfers
    def request_internal_transfer(self, s: Session, src: Agent, dst_id: str, amount: int, reason: str) -> Approval:
        dst = self.get_agent(s, dst_id)
        if dst.status != AgentStatus.ACTIVE or src.status != AgentStatus.ACTIVE:
            raise PolicyViolation("both agents must be active")
        if src.id == dst.id or amount <= 0:
            raise PolicyViolation("invalid transfer")
        if self.financials(s, src)["available"] < amount:
            raise InsufficientFunds("insufficient available capital")
        ap = Approval(kind="internal_transfer", agent_id=src.id, title=f"{src.id} → {dst.id}: {fmt(amount)}",
                      payload={"src": src.id, "dst": dst.id, "amount": amount, "reason": reason[:500]},
                      status="pending", created_at=self.now())
        s.add(ap)
        s.flush()
        self.event(s, src.id, "approval_requested", f"internal transfer to {dst.id} awaiting supervisor approval")
        return ap

    def _execute_internal_transfer(self, s: Session, ap: Approval, actor: str):
        p = ap.payload
        src = self.get_agent(s, p["src"], lock=True)
        if self.financials(s, src)["available"] < p["amount"]:
            raise InsufficientFunds("insufficient available capital at execution time")
        self.post(s, kind=INTERNAL_TRANSFER, agent_id=src.id, counterparty_agent_id=p["dst"], created_by=actor,
                  description=f"approved internal transfer to {p['dst']} (not revenue)",
                  idempotency_key=f"itx:{ap.id}", lines=[
                      Line(A.cash(p["dst"]), p["amount"], p["dst"]), Line(A.cash(src.id), -p["amount"], src.id)])

    # ================================================================ approvals
    def decide_approval(self, s: Session, approval_id: int, approve: bool, *, actor: str, note: str = "") -> Approval:
        ap = s.get(Approval, approval_id)
        if ap is None:
            raise NotFound("approval not found")
        if ap.status != "pending":
            raise Conflict(f"approval already {ap.status}")
        ap.status = "approved" if approve else "rejected"
        ap.decided_at = self.now()
        ap.decided_by = actor
        ap.decision_note = note
        if approve:
            if ap.kind == "internal_transfer":
                self._execute_internal_transfer(s, ap, actor)
            elif ap.kind == "distribution_payout":
                from .distribution import execute_distribution

                execute_distribution(self, s, ap.payload["distribution_id"], actor=actor)
            elif ap.kind == "strategy_authorization":
                opp = s.get(Opportunity, ap.payload["opportunity_id"])
                if opp:
                    opp.status = "testing"
                    opp.updated_at = self.now()
                    agent = s.get(Agent, ap.agent_id)
                    if agent and agent.status == AgentStatus.ACTIVE:
                        self._switch_strategy(s, agent, opp.strategy_key, opp.assessment.get("market"), None,
                                              reason="administrator authorised strategy")
        else:
            if ap.kind == "distribution_payout":
                from .models import Distribution

                d = s.get(Distribution, ap.payload["distribution_id"])
                if d:
                    d.status = "rejected"
        audit.record(s, ts=self.now(), actor=actor, action=f"approval_{ap.status}", target=str(ap.id),
                     details={"kind": ap.kind, "note": note})
        return ap

    # ================================================================ opportunities
    def ecosystem_strategy_stats(self, s: Session) -> dict:
        """Measured per-strategy performance, built from experiment histories."""
        agg: dict[str, dict] = {}
        balances = Ledger(s).all_agent_balances()
        for agent in s.scalars(select(Agent)):
            prof = agent.strategy_profile or {}
            exps = list(prof.get("experiments", []))
            bal = balances.get(agent.id, {})
            rev = -bal.get(A.REVENUE, 0) - bal.get(A.TRADING_GAIN, 0)
            costs = sum(v for k, v in bal.items() if k.startswith("expense:"))
            start = datetime.fromisoformat(prof.get("started_at", agent.created_at.isoformat()))
            end = agent.deceased_at or self.now()
            base = prof.get("baseline", {"revenue": 0, "costs": 0})
            exps.append({"strategy": agent.strategy_key, "days": max(0.0, (end - start).total_seconds() / 86400),
                         "revenue": rev - base["revenue"], "costs": costs - base["costs"]})
            for e in exps:
                d = agg.setdefault(e["strategy"], {"agent_days": 0.0, "revenue": 0, "costs": 0, "experiments": 0})
                d["agent_days"] += e["days"]
                d["revenue"] += e["revenue"]
                d["costs"] += e["costs"]
                d["experiments"] += 1
        out = {}
        for k, d in agg.items():
            days = max(d["agent_days"], 1e-9)
            out[k] = {
                "agent_days": round(d["agent_days"], 1),
                "experiments": d["experiments"],
                "revenue_per_agent_day": round(to_usd(d["revenue"]) / days, 4),
                "cost_per_agent_day": round(to_usd(d["costs"]) / days, 4),
                "roi_per_day": round((to_usd(d["revenue"] - d["costs"]) / days) / 50.0, 6),
            }
        return out

    def _open_opportunity(self, s: Session, agent: Agent, key: str, market: str) -> Opportunity:
        strat = REGISTRY[key]
        mode = "live" if self.is_live(s) else "simulation"
        assessment = strat.assess(mode=mode, ecosystem_stats=self.ecosystem_strategy_stats(s),
                                  risk_tolerance=(agent.strategy_profile or {}).get("risk_tolerance", 0.3)).to_dict()
        assessment["market"] = market
        needs_auth = assessment["compliance"]["requires_authorization"]
        status = "awaiting_authorization" if needs_auth else "testing"
        opp = Opportunity(agent_id=agent.id, strategy_key=key, title=f"{strat.spec.name} — {market}",
                          category=strat.spec.category, status=status, assessment=assessment,
                          results={"test_days": TEST_PHASE_DAYS}, created_at=self.now(), updated_at=self.now())
        s.add(opp)
        s.flush()
        if needs_auth:
            s.add(Approval(kind="strategy_authorization", agent_id=agent.id, created_at=self.now(),
                           title=f"Authorise {strat.spec.name} for {agent.id}",
                           payload={"opportunity_id": opp.id, "strategy": key, "assessment": assessment}))
        return opp

    def _switch_strategy(self, s: Session, agent: Agent, key: str, market: str | None, params: dict | None, *, reason: str):
        # Close out positions first so their realised P&L belongs to the old experiment.
        for pos in list(s.scalars(select(Position).where(Position.agent_id == agent.id, Position.quantity > 0))):
            self.sell(s, agent, pos.symbol, pos.quantity, forced=True)
        prof = dict(agent.strategy_profile)
        bal = Ledger(s).agent_balances(agent.id)
        rev = -bal.get(A.REVENUE, 0) - bal.get(A.TRADING_GAIN, 0)
        costs = sum(v for k, v in bal.items() if k.startswith("expense:"))
        start = datetime.fromisoformat(prof["started_at"])
        base = prof.get("baseline", {"revenue": 0, "costs": 0})
        exps = list(prof.get("experiments", []))
        exps.append({"strategy": agent.strategy_key, "market": prof.get("market"), "params": prof.get("params"),
                     "start": prof["started_at"], "end": self.now().isoformat(),
                     "days": round((self.now() - start).total_seconds() / 86400, 2),
                     "revenue": rev - base["revenue"], "costs": costs - base["costs"],
                     "profit": (rev - base["revenue"]) - (costs - base["costs"])})
        strat = REGISTRY[key]
        old = agent.strategy_key
        prof.update({"experiments": exps[-30:], "started_at": self.now().isoformat(),
                     "baseline": {"revenue": rev, "costs": costs}, "state": {},
                     "market": market if market in strat.spec.markets else strat.spec.markets[0],
                     "params": strat.clamp_params(params)})
        agent.strategy_key = key
        agent.strategy_profile = prof
        for opp in s.scalars(select(Opportunity).where(Opportunity.agent_id == agent.id,
                                                        Opportunity.status.in_(["testing", "active"]))):
            opp.status = "retired"
            opp.results = {**opp.results, "final": exps[-1]}
            opp.updated_at = self.now()
        self._open_opportunity(s, agent, key, prof["market"])
        self.event(s, agent.id, "strategy_change", f"{old} → {key} ({prof['market']}): {reason}",
                   old=old, new=key, market=prof["market"], params=prof["params"])

    # ================================================================ survival
    def is_insolvent(self, s: Session, agent: Agent) -> bool:
        pol = get_policy(s)
        fin = self.financials(s, agent)
        floor = usd(pol["insolvency_floor_usd"])
        liquid = fin["available"] + fin["receivable"] + fin["positions_value"]
        return liquid < floor or (fin["available"] < floor and fin["positions_value"] == 0 and fin["receivable"] == 0)

    def terminate(self, s: Session, agent: Agent, *, reason: str, actor: str) -> dict:
        if agent.status == AgentStatus.DECEASED:
            raise Conflict("agent already deceased")
        # 1-3. stop execution, revoke permissions, cancel outstanding activity
        agent.permissions = {}
        for pos in list(s.scalars(select(Position).where(Position.agent_id == agent.id, Position.quantity > 0))):
            if self.world is not None:
                self.sell(s, agent, pos.symbol, pos.quantity, forced=True)
            else:
                s.add(Approval(kind="manual_liquidation", agent_id=agent.id, created_at=self.now(),
                               title=f"Liquidate {pos.symbol} held by deceased {agent.id}", payload={"symbol": pos.symbol}))
        self.settle_payables(s, agent)
        for ap in s.scalars(select(Approval).where(Approval.agent_id == agent.id, Approval.status == "pending",
                                                   Approval.kind != "manual_liquidation")):
            ap.status = "cancelled"
            ap.decided_at = self.now()
            ap.decided_by = "core"
        for opp in s.scalars(select(Opportunity).where(Opportunity.agent_id == agent.id,
                                                        Opportunity.status.notin_(["rejected", "retired"]))):
            opp.status = "retired"
            opp.updated_at = self.now()
        # 4-5. preserve records and final performance
        fin = self.financials(s, agent)
        final = {k: v for k, v in fin.items()}
        final.update({"age_days": round((self.now() - agent.created_at).total_seconds() / 86400, 2),
                      "reproduction_count": agent.reproduction_count, "reason": reason})
        # Residual dust returns to the treasury (internal; never revenue).
        residual = Ledger(s).agent_balances(agent.id).get(A.cash(agent.id), 0)
        if residual > 0:
            self.post(s, kind=ESTATE_SWEEP, agent_id=agent.id, description=f"estate of {agent.id} returned to treasury",
                      lines=[Line(A.TREASURY, residual), Line(A.cash(agent.id), -residual, agent.id)])
        final["residual_returned"] = residual
        # 6. mark deceased
        agent.status = AgentStatus.DECEASED
        agent.status_reason = reason
        agent.deceased_at = self.now()
        agent.final_performance = final
        self.event(s, agent.id, "death", f"{agent.id} terminated: {reason}", "critical", final=final)
        audit.record(s, ts=self.now(), actor=actor, action="agent_terminated", target=agent.id, details=final)
        return final

    # ================================================================ reproduction
    def reproduction_blockers(self, s: Session, agent: Agent, fin: dict | None = None) -> list[str]:
        pol = get_policy(s)
        fin = fin or self.financials(s, agent)
        out = []
        offspring = usd(pol["offspring_capital_usd"])
        if agent.status != AgentStatus.ACTIVE or not agent.permissions.get("reproduce"):
            out.append("agent not active")
        if get_state(s, "paused") or get_state(s, "emergency_stop"):
            out.append("ecosystem paused")
        if fin["available"] < agent.next_reproduction_threshold:
            out.append(f"threshold not reached ({fmt(fin['available'])} < {fmt(agent.next_reproduction_threshold)})")
            return out
        if fin["available"] - offspring < usd(pol["min_parent_reserve_after_reproduction_usd"]):
            out.append("parent reserve would be violated")
        active = s.scalar(select(func.count(Agent.id)).where(Agent.status != AgentStatus.DECEASED))
        if active >= pol["max_active_agents"]:
            out.append("ecosystem at max active agents")
        births = s.scalar(select(func.count(ReproductionEvent.id)).where(ReproductionEvent.ts > self.now() - timedelta(days=1)))
        if births >= pol["max_births_per_day"]:
            out.append("daily birth limit reached")
        if self.aggregate_agent_capital(s) > usd(pol["max_aggregate_capital_usd"]):
            out.append("ecosystem above max aggregate operating capital")
        # Records reconciled: position sub-ledger matches, no negative balances, no pending transfers.
        pos_sum = s.scalar(select(func.coalesce(func.sum(Position.cost_basis), 0)).where(Position.agent_id == agent.id))
        if int(pos_sum) != fin["positions_cost"] or fin["cash"] < 0:
            out.append("agent records not reconciled")
        pending = s.scalar(select(func.count(Approval.id)).where(Approval.agent_id == agent.id, Approval.status == "pending",
                                                                  Approval.kind == "internal_transfer"))
        if pending:
            out.append("pending internal transfers")
        return out

    def try_reproduce(self, s: Session, agent_id: str, *, actor: str = "core") -> Agent | None:
        """Atomic, idempotent reproduction. Safe under concurrent calls: the agent
        row is locked (PostgreSQL) / write-locked (SQLite), the version column
        guards against lost updates, and (parent_id, seq) is unique in the DB."""
        agent = self.get_agent(s, agent_id, lock=True)
        fin = self.financials(s, agent)
        blockers = self.reproduction_blockers(s, agent, fin)
        if blockers:
            return None
        pol = get_policy(s)
        offspring_capital = usd(pol["offspring_capital_usd"])
        seq = agent.reproduction_count + 1
        before = fin["available"]
        retained = before - offspring_capital
        next_threshold = int(retained * pol["subsequent_reproduction_multiple"])
        prof = agent.strategy_profile
        mutation = self.brain.mutate_offspring(agent.strategy_key, prof.get("params", {}), prof.get("market"),
                                               pol["enabled_strategies"], pol["max_risk_tolerance"],
                                               prof.get("risk_tolerance", 0.3))
        try:
            with s.begin_nested():
                child = self._new_agent(s, parent=agent, capital=offspring_capital, profile=mutation, actor=actor)
                s.add(ReproductionEvent(parent_id=agent.id, seq=seq, child_id=child.id, ts=self.now(),
                                        parent_capital_before=before, offspring_capital=offspring_capital,
                                        parent_capital_after=retained, threshold_used=agent.next_reproduction_threshold,
                                        next_threshold=next_threshold, mutation=mutation))
                self.post(s, kind=REPRODUCTION, agent_id=agent.id, counterparty_agent_id=child.id, created_by=actor,
                          description=f"{agent.id} funds offspring {child.id} (internal transfer, not revenue)",
                          idempotency_key=f"repro:{agent.id}:{seq}", meta={"chain_handled": True},
                          lines=[Line(A.cash(child.id), offspring_capital, child.id),
                                 Line(A.cash(agent.id), -offspring_capital, agent.id)])
                agent.reproduction_count = seq
                agent.capital_after_last_reproduction = retained
                threshold_used = agent.next_reproduction_threshold
                agent.next_reproduction_threshold = next_threshold
                s.flush()
        except (IntegrityError, StaleDataError, LedgerError) as exc:
            raise Conflict(f"duplicate reproduction prevented for {agent.id}: {type(exc).__name__}") from exc
        # Offspring inherit the parent's most recent lessons (learning across generations).
        for mem in s.scalars(select(AgentMemory).where(AgentMemory.agent_id == agent.id, AgentMemory.kind == "lesson")
                             .order_by(AgentMemory.id.desc()).limit(5)):
            s.add(AgentMemory(agent_id=child.id, ts=self.now(), kind="lesson", content=f"[from {agent.id}] {mem.content}"))
        self.event(s, agent.id, "reproduction",
                   f"{agent.id} reproduced → {child.id}: {fmt(before)} → retains {fmt(retained)}; next threshold {fmt(next_threshold)}",
                   child=child.id, threshold_used=threshold_used, next_threshold=next_threshold, mutation=mutation)
        audit.record(s, ts=self.now(), actor=actor, action="reproduction", target=agent.id,
                     details={"child": child.id, "seq": seq, "before": before, "retained": retained, "next_threshold": next_threshold})
        return child

    # ================================================================ planning
    def plan_agent(self, s: Session, agent: Agent) -> None:
        pol = get_policy(s)
        model = pol["claude_routine_model"]
        calls_today = s.scalar(select(func.count(UsageRecord.id)).where(
            UsageRecord.agent_id == agent.id, UsageRecord.ts > self.now() - timedelta(days=1)))
        if calls_today >= pol["claude_max_calls_per_agent_per_day"]:
            self.event(s, agent.id, "warning", "planning skipped: model call rate limit reached", "warning")
            return
        est = self.brain.estimate_cost(model)
        try:
            self.check_spend(s, agent, "claude_api", est)
        except PolicyViolation as exc:
            self.event(s, agent.id, "warning", f"planning skipped: {exc}", "warning")
            agent.last_planned_at = self.now()
            return
        prof = agent.strategy_profile
        ledger = Ledger(s)
        week_ago = self.now() - timedelta(days=7)
        fin = self.financials(s, agent)
        lessons = [m.content for m in s.scalars(select(AgentMemory).where(
            AgentMemory.agent_id == agent.id, AgentMemory.kind == "lesson").order_by(AgentMemory.id.desc()).limit(8))]
        ctx = PlanContext(
            agent_id=agent.id, generation=agent.generation, strategy_key=agent.strategy_key,
            params=prof.get("params", {}), market=prof.get("market"), risk_tolerance=prof.get("risk_tolerance", 0.3),
            available_usd=to_usd(fin["available"]), starting_usd=to_usd(agent.starting_capital),
            days_on_strategy=int((self.now() - datetime.fromisoformat(prof["started_at"])).total_seconds() // 86400),
            trailing_7d_profit_usd=to_usd(ledger.realized_profit(agent_id=agent.id, start=week_ago)),
            trailing_7d_revenue_usd=to_usd(ledger.income(agent_id=agent.id, start=week_ago)),
            lessons=lessons, enabled_strategies=[k for k in pol["enabled_strategies"] if k in REGISTRY],
            ecosystem_stats=self.ecosystem_strategy_stats(s),
        )
        bal = ledger.agent_balances(agent.id)
        base = prof.get("baseline", {"revenue": 0, "costs": 0})
        strat_rev = -bal.get(A.REVENUE, 0) - bal.get(A.TRADING_GAIN, 0) - base["revenue"]
        strat_cost = sum(v for k, v in bal.items() if k.startswith("expense:")) - base["costs"]
        ctx.strategy_revenue_usd = to_usd(strat_rev)
        ctx.strategy_profit_usd = to_usd(strat_rev - strat_cost)
        last_tuned = prof.get("last_tuned_at")
        ctx.days_since_tuning = int((self.now() - datetime.fromisoformat(last_tuned)).total_seconds() // 86400) if last_tuned else 999
        try:
            decision = self.brain.plan(ctx)
        except Exception as exc:  # noqa: BLE001 - any model/network failure degrades to heuristic
            log.warning("brain failure for %s: %s", agent.id, exc)
            self.event(s, agent.id, "error", f"reasoning call failed ({type(exc).__name__}); heuristic fallback", "warning")
            decision = HeuristicBrain.plan(self.brain, ctx)
        cost = min(decision.cost, est) if decision.simulated_cost else decision.cost
        if cost > 0:
            self.charge_expense(s, agent, "claude_api", cost, f"planning call ({decision.model})", mandatory=True)
        s.add(UsageRecord(agent_id=agent.id, ts=self.now(), provider="anthropic", model=decision.model or model,
                          purpose="planning", input_tokens=decision.input_tokens, output_tokens=decision.output_tokens,
                          cost=cost, simulated=decision.simulated_cost))
        agent.last_planned_at = self.now()
        agent.objective = decision.objective
        if decision.strategy_key not in pol["enabled_strategies"]:
            decision.strategy_key = agent.strategy_key
        if decision.strategy_key != agent.strategy_key or decision.market != prof.get("market"):
            self._switch_strategy(s, agent, decision.strategy_key, decision.market, decision.params, reason=decision.rationale)
        else:
            prof = dict(agent.strategy_profile)
            if prof.get("params") != decision.params:
                prof["last_tuned_at"] = self.now().isoformat()
                self.event(s, agent.id, "strategy_tuning", f"parameters adjusted: {decision.rationale}",
                           old=prof.get("params"), new=decision.params)
            prof["params"] = decision.params
            agent.strategy_profile = prof
        if decision.lesson:
            s.add(AgentMemory(agent_id=agent.id, ts=self.now(), kind="lesson", content=decision.lesson))
        self.event(s, agent.id, "decision", decision.rationale or "plan confirmed", source=decision.source,
                   model=decision.model, cost=cost, strategy=decision.strategy_key, params=decision.params)

    def evaluate_opportunities(self, s: Session, agent: Agent) -> None:
        """Step 8 of the pipeline: after the small-scale test, keep or reject."""
        for opp in s.scalars(select(Opportunity).where(Opportunity.agent_id == agent.id, Opportunity.status == "testing")):
            if (self.now() - opp.created_at) < timedelta(days=TEST_PHASE_DAYS):
                continue
            ledger = Ledger(s)
            rev = ledger.income(agent_id=agent.id, start=opp.created_at)
            cost = ledger.expenses(agent_id=agent.id, start=opp.created_at)
            verdict = "active" if rev > cost else ("testing" if rev > 0 else "rejected")
            opp.results = {**opp.results, "test_revenue": rev, "test_costs": cost, "evaluated_at": self.now().isoformat()}
            if verdict != "testing":
                opp.status = verdict
            opp.updated_at = self.now()
            self.event(s, agent.id, "evaluation", f"opportunity '{opp.title}' evaluated: {verdict} "
                       f"(revenue {fmt(rev)}, costs {fmt(cost)})", verdict=verdict)
