"""Weekly profit distribution (Rule 5).

distributable = max(0, cumulative realized profit - high-water mark)
owner share   = floor(distributable * owner_profit_share_bps / 10_000)

* Realized profit comes only from income/expense accounts, so capital
  contributions, allocations, offspring funding, agent-to-agent transfers and
  unrealized gains can never be distributed.
* The high-water mark (HWM) only advances by the profit actually distributed
  against, so prior losses must be recovered first and no profit is ever
  paid twice.
* Operator-paid costs (liabilities) are reimbursed before profit is paid,
  and no agent is drawn below its reserve to fund a payout.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .errors import Conflict, NotFound
from .ledger import DISTRIBUTION, REIMBURSEMENT, A, Ledger, Line
from .models import Agent, AgentStatus, Approval, Distribution, Transfer
from .money import bps, fmt, usd
from .policy import get_policy, get_state, set_state
from .wallets import validate_address

UTC = ZoneInfo("UTC")


def next_distribution_time(policy: dict, after: datetime) -> datetime:
    """Next scheduled run strictly after `after` (naive UTC in, naive UTC out)."""
    tz = ZoneInfo(policy["distribution_timezone"])
    local = after.replace(tzinfo=UTC).astimezone(tz)
    days_ahead = (policy["distribution_weekday"] - local.weekday()) % 7
    candidate = (local + timedelta(days=days_ahead)).replace(
        hour=policy["distribution_hour"], minute=policy["distribution_minute"], second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=7)
    return candidate.astimezone(UTC).replace(tzinfo=None)


def _period_start(s: Session) -> datetime:
    last = get_state(s, "last_distribution_period_end")
    if last:
        return datetime.fromisoformat(last)
    genesis = get_state(s, "genesis_at")
    # inclusive of activity at the genesis instant
    return datetime.fromisoformat(genesis) - timedelta(microseconds=1) if genesis else datetime(1970, 1, 1)


def _funding_plan(core, s: Session, amount: int, period_start: datetime, period_end: datetime) -> tuple[list[dict], int]:
    """Who funds the payout: free treasury first, then agents pro rata to their
    positive realized profit this period, never below their reserve."""
    pol = get_policy(s)
    reserve = usd(pol["min_agent_reserve_usd"])
    ledger = Ledger(s)
    plan: list[dict] = []
    remaining = amount
    free = max(0, ledger.balance(A.TREASURY))
    if free and remaining:
        take = min(free, remaining)
        plan.append({"source": "treasury", "amount": take})
        remaining -= take
    capacity: dict[str, int] = {}
    weights: dict[str, int] = {}
    for agent in s.scalars(select(Agent).where(Agent.status != AgentStatus.DECEASED).order_by(Agent.seq)):
        fin = core.financials(s, agent)
        capacity[agent.id] = max(0, fin["available"] - reserve)
        weights[agent.id] = max(0, ledger.realized_profit(agent_id=agent.id, start=period_start, end=period_end))
    taken: dict[str, int] = {k: 0 for k in capacity}
    total_w = sum(weights.values())
    if remaining and total_w:
        for aid, w in weights.items():
            share = min(capacity[aid], remaining * w // total_w)
            taken[aid] += share
        remaining -= sum(taken.values())
    # Second pass: rounding residue / capped agents -> anyone with spare capacity.
    for aid in sorted(capacity, key=lambda a: capacity[a] - taken[a], reverse=True):
        if remaining <= 0:
            break
        extra = min(capacity[aid] - taken[aid], remaining)
        if extra > 0:
            taken[aid] += extra
            remaining -= extra
    plan += [{"source": aid, "amount": amt} for aid, amt in taken.items() if amt > 0]
    return plan, amount - remaining


def reimburse_operator(core, s: Session, *, actor: str) -> int:
    owed = -Ledger(s).balance(A.OPERATOR_PAYABLE)
    wallet = get_state(s, "admin_wallet")
    if owed <= 0 or not wallet:
        return 0
    signer = core.signer(s)
    t = Transfer(kind="reimbursement", network=wallet["network"], from_address=core.treasury_address(s),
                 to_address=wallet["address"], amount=owed, status="created", simulated=not signer.live,
                 created_at=core.now(), meta={"reason": "operator-paid operating costs"})
    s.add(t)
    s.flush()
    t.tx_hash = signer.submit(t)
    t.status = "confirmed" if not signer.live else "submitted"
    t.confirmed_at = core.now() if not signer.live else None
    core.post(s, kind=REIMBURSEMENT, description="reimburse administrator for operating costs", created_by=actor,
              idempotency_key=f"reimb:{t.id}", meta={"chain_handled": True, "transfer_id": t.id},
              lines=[Line(A.OPERATOR_PAYABLE, owed), Line(A.REIMB_RESERVE, -owed)])
    audit.record(s, ts=core.now(), actor=actor, action="operator_reimbursement", details={"amount": owed, "transfer": t.id})
    return owed


def run_distribution(core, s: Session, period_end: datetime, *, actor: str = "scheduler") -> Distribution:
    existing = s.scalar(select(Distribution).where(Distribution.period_end == period_end))
    if existing is not None:
        return existing  # idempotent per period
    pol = get_policy(s)
    ledger = Ledger(s)
    start = _period_start(s)
    now = core.now()
    period_profit = ledger.realized_profit(start=start, end=period_end)
    cumulative = ledger.realized_profit(end=period_end)
    hwm = int(get_state(s, "distribution_hwm") or 0)
    distributable = max(0, cumulative - hwm)
    share = pol["owner_profit_share_bps"]
    owner = bps(distributable, share)
    details = {
        "revenue": ledger.revenue(start=start, end=period_end),
        "trading_income": ledger.income(start=start, end=period_end) - ledger.revenue(start=start, end=period_end),
        "expenses_by_category": ledger.expenses_by_category(start=start, end=period_end),
        "per_agent_profit": {a.id: ledger.realized_profit(agent_id=a.id, start=start, end=period_end)
                             for a in s.scalars(select(Agent).order_by(Agent.seq))},
        "owner_share_bps": share,
    }
    d = Distribution(period_start=start, period_end=period_end, computed_at=now, period_profit=period_profit,
                     cumulative_profit=cumulative, hwm_before=hwm, hwm_after=hwm, distributable=distributable,
                     owner_amount=0, retained_amount=distributable, status="computed", details=details)
    s.add(d)
    s.flush()
    set_state(s, "last_distribution_period_end", period_end.isoformat(), now)

    # Operator-paid costs are a liability, repaid every period regardless of profit or pending payouts.
    d.reimbursement_amount = reimburse_operator(core, s, actor=actor)
    if s.scalar(select(Distribution.id).where(Distribution.status == "pending_approval", Distribution.id != d.id)):
        d.status = "deferred_pending_approval"
        details["note"] = "an earlier payout awaits approval; this period's profit carries forward"
        d.details = details
        return d
    if owner <= 0:
        d.status = "no_profit" if distributable == 0 else "no_owner_share"
        details["note"] = ("no distributable profit (period loss or prior losses not yet recovered)"
                           if distributable == 0 else "owner share is 0%")
        d.details = details
        audit.record(s, ts=now, actor=actor, action="distribution_computed", target=str(d.id),
                     details={"status": d.status, "cumulative": cumulative, "hwm": hwm})
        return d

    plan, fundable = _funding_plan(core, s, owner, start, period_end)
    d.owner_amount = fundable
    consumed = distributable if fundable == owner else (fundable * 10_000 + share - 1) // share
    d.retained_amount = consumed - fundable
    d.hwm_after = hwm + consumed
    details["funding_plan"] = plan
    if fundable < owner:
        details["shortfall"] = owner - fundable
        details["note"] = "liquidity above reserves was insufficient; the remainder carries forward"
    d.details = details
    if fundable == 0:
        d.status = "insufficient_liquidity"
        d.hwm_after = hwm
        return d

    wallet = get_state(s, "admin_wallet")
    if not wallet:
        d.status = "awaiting_wallet"
        d.hwm_after = hwm
        details["note"] = "administrator wallet not configured; profit carries forward"
        d.details = details
        return d
    needs_approval = fundable > usd(pol["auto_payout_limit_usd"]) or core.is_live(s)
    if needs_approval:
        d.status = "pending_approval"
        s.add(Approval(kind="distribution_payout", title=f"Weekly payout {fmt(fundable)} to {wallet['address'][:10]}…",
                       payload={"distribution_id": d.id, "amount": fundable}, status="pending", created_at=now))
        audit.record(s, ts=now, actor=actor, action="distribution_pending_approval", target=str(d.id), details={"amount": fundable})
        return d
    execute_distribution(core, s, d.id, actor=actor)
    return d


def execute_distribution(core, s: Session, distribution_id: int, *, actor: str) -> Distribution:
    d = s.get(Distribution, distribution_id)
    if d is None:
        raise NotFound("distribution not found")
    if d.status not in ("computed", "pending_approval"):
        raise Conflict(f"distribution is {d.status}")
    wallet = get_state(s, "admin_wallet")
    if not wallet:
        raise Conflict("administrator wallet not configured")
    validate_address(wallet["address"], wallet["network"])
    # Re-plan at execution time: balances may have moved since approval was requested.
    plan, fundable = _funding_plan(core, s, d.owner_amount, d.period_start, d.period_end)
    if fundable < d.owner_amount:
        raise Conflict("insufficient liquidity at execution time; re-run next period")
    signer = core.signer(s)
    t = Transfer(kind="payout", network=wallet["network"], from_address=core.treasury_address(s),
                 to_address=wallet["address"], amount=d.owner_amount, status="created", simulated=not signer.live,
                 created_at=core.now(), meta={"distribution_id": d.id})
    s.add(t)
    s.flush()
    signer.simulate(t)
    for item in plan:
        src = item["source"]
        if src == "treasury":
            lines = [Line(A.DISTRIBUTIONS, item["amount"]), Line(A.TREASURY, -item["amount"])]
        else:
            lines = [Line(A.DISTRIBUTIONS, item["amount"], src), Line(A.cash(src), -item["amount"], src)]
        core.post(s, kind=DISTRIBUTION, agent_id=None if src == "treasury" else src, lines=lines, created_by=actor,
                  description=f"weekly profit distribution #{d.id}", idempotency_key=f"dist:{d.id}:{src}",
                  meta={"chain_handled": True, "transfer_id": t.id})
    t.tx_hash = signer.submit(t)
    t.status = "submitted" if signer.live else "confirmed"
    t.confirmed_at = None if signer.live else core.now()
    d.transfer_id = t.id
    d.status = "executed"
    d.details = {**d.details, "funding_plan": plan}
    set_state(s, "distribution_hwm", d.hwm_after, core.now())
    audit.record(s, ts=core.now(), actor=actor, action="distribution_executed", target=str(d.id),
                 details={"amount": d.owner_amount, "transfer": t.id, "tx_hash": t.tx_hash, "hwm_after": d.hwm_after})
    return d


def run_due_distributions(core, s: Session, *, actor: str = "scheduler") -> list[Distribution]:
    pol = get_policy(s)
    out = []
    start = _period_start(s)
    now = core.now()
    nxt = next_distribution_time(pol, start)
    while nxt <= now:
        out.append(run_distribution(core, s, nxt, actor=actor))
        nxt = next_distribution_time(pol, nxt)
    return out
