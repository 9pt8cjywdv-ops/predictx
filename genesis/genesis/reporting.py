"""Read models for the dashboard. All figures come from the ledger."""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from .core import agent_financials
from .distribution import next_distribution_time
from .ledger import CONTRIBUTION, A, Ledger
from .models import (
    Agent, AgentEvent, AgentMemory, AgentStatus, Approval, DailySnapshot, Distribution, JournalEntry, JournalLine,
    Opportunity, Position, ReproductionEvent, Transfer, UsageRecord,
)
from .money import to_usd
from .policy import get_policy, get_state


def _iso(dt):
    return dt.isoformat() if dt else None


def _positions_by_agent(s):
    out: dict[str, list] = {}
    for p in s.scalars(select(Position).where(Position.quantity > 0)):
        out.setdefault(p.agent_id, []).append(p)
    return out


def leaderboard(core, s) -> list[dict]:
    balances = Ledger(s).all_agent_balances()
    positions = _positions_by_agent(s)
    now = core.now()
    rows = []
    for a in s.scalars(select(Agent).order_by(Agent.seq)):
        fin = agent_financials(a, balances.get(a.id, {}), positions.get(a.id, []))
        if a.status == AgentStatus.DECEASED and a.final_performance:
            fin = {**fin, **{k: a.final_performance.get(k, fin.get(k)) for k in ("net_capital", "available", "cash")}}
        end = a.deceased_at or now
        rows.append({
            "id": a.id, "name": a.name, "generation": a.generation, "parent_id": a.parent_id,
            "age_days": round((end - a.created_at).total_seconds() / 86400, 1),
            "strategy": a.strategy_key, "market": (a.strategy_profile or {}).get("market"),
            "starting_capital": to_usd(a.starting_capital), "net_capital": to_usd(fin["net_capital"]),
            "available": to_usd(fin["available"]), "revenue": to_usd(fin["revenue"]),
            "trading_pnl": to_usd(fin["trading_pnl"]), "expenses": to_usd(fin["expenses"]),
            "net_profit": to_usd(fin["net_profit"]), "unrealized": to_usd(fin["unrealized"]),
            "roc": round(fin["roc"], 4), "reproduction_count": a.reproduction_count,
            "next_threshold": to_usd(a.next_reproduction_threshold), "status": a.status,
            "status_reason": a.status_reason, "created_at": _iso(a.created_at), "deceased_at": _iso(a.deceased_at),
        })
    rows.sort(key=lambda r: (r["status"] == "deceased", -r["net_profit"]))
    return rows


def overview(core, s, light: bool = False) -> dict:
    ledger = Ledger(s)
    pol = get_policy(s)
    tb = ledger.trial_balance()
    counts = dict(s.execute(select(Agent.status, func.count(Agent.id)).group_by(Agent.status)).all())
    contributions = [-ln for (ln,) in s.execute(
        select(JournalLine.amount).join(JournalEntry).where(JournalEntry.kind == CONTRIBUTION,
                                                            JournalLine.account == A.CONTRIBUTED).order_by(JournalEntry.id))]
    positions = list(s.scalars(select(Position).where(Position.quantity > 0)))
    unrealized = sum(int(p.quantity * p.mark_price * 1_000_000) - p.cost_basis for p in positions)
    assets = sum(v for k, v in tb.items() if k.startswith("asset:"))
    liabilities = -sum(v for k, v in tb.items() if k.startswith("liability:"))
    agent_cash = sum(v for k, v in tb.items() if k.startswith("asset:agent:") and k.endswith(":cash"))
    revenue = -tb.get(A.REVENUE, 0)
    trading = -tb.get(A.TRADING_GAIN, 0) - tb.get("expense:trading_loss", 0)
    expenses = sum(v for k, v in tb.items() if k.startswith("expense:") and k != "expense:trading_loss")
    realized = ledger.realized_profit()
    hwm = int(get_state(s, "distribution_hwm") or 0)
    out = {
        "ts": _iso(core.now()),
        "total_agents": sum(counts.values()),
        "active_agents": counts.get(AgentStatus.ACTIVE, 0),
        "suspended_agents": counts.get(AgentStatus.SUSPENDED, 0),
        "terminated_agents": counts.get(AgentStatus.DECEASED, 0),
        "max_generation": s.scalar(select(func.coalesce(func.max(Agent.generation), 0))),
        "initial_investment": to_usd(contributions[0]) if contributions else 0.0,
        "additional_contributions": to_usd(sum(contributions[1:])),
        "total_revenue": to_usd(revenue),
        "trading_pnl_realized": to_usd(trading),
        "total_expenses": to_usd(expenses),
        "realized_net_profit": to_usd(realized),
        "unrealized_pnl": to_usd(unrealized),
        "treasury_balance": to_usd(tb.get(A.TREASURY, 0)),
        "agent_capital": to_usd(agent_cash),
        "operator_payable": to_usd(-tb.get(A.OPERATOR_PAYABLE, 0)),
        "net_assets": to_usd(assets - liabilities),
        "net_assets_incl_unrealized": to_usd(assets - liabilities + unrealized),
        "total_distributions": to_usd(tb.get(A.DISTRIBUTIONS, 0)),
        "distribution_hwm": to_usd(hwm),
        "distributable_now": to_usd(max(0, realized - hwm)),
        "births": s.scalar(select(func.count(ReproductionEvent.id))),
    }
    if light:
        return out
    genesis = get_state(s, "genesis_at")
    last = get_state(s, "last_distribution_period_end")
    nxt = None
    if genesis:
        nxt = next_distribution_time(pol, datetime.fromisoformat(last or genesis))
    tz = ZoneInfo(pol["distribution_timezone"])
    out.update({
        "mode": "live" if get_state(s, "live_mode") else "simulation",
        "paused": get_state(s, "paused"),
        "emergency_stop": get_state(s, "emergency_stop"),
        "next_distribution_utc": _iso(nxt),
        "next_distribution_local": nxt.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz).strftime("%a %d %b %Y %H:%M %Z") if nxt else None,
        "pending_approvals": s.scalar(select(func.count(Approval.id)).where(Approval.status == "pending")),
        "admin_wallet": get_state(s, "admin_wallet"),
        "network": get_state(s, "network"),
        "accounting_identity_ok": ledger.is_balanced(),
        "clock_simulated": core.clock.simulated,
    })
    return out


def agent_detail(core, s, agent_id: str) -> dict:
    a = core.get_agent(s, agent_id)
    fin = core.financials(s, a)
    events = s.scalars(select(AgentEvent).where(AgentEvent.agent_id == a.id).order_by(AgentEvent.id.desc()).limit(80))
    mem = s.scalars(select(AgentMemory).where(AgentMemory.agent_id == a.id).order_by(AgentMemory.id.desc()).limit(20))
    opps = s.scalars(select(Opportunity).where(Opportunity.agent_id == a.id).order_by(Opportunity.id.desc()).limit(20))
    usage = s.execute(select(func.count(UsageRecord.id), func.coalesce(func.sum(UsageRecord.cost), 0))
                      .where(UsageRecord.agent_id == a.id)).one()
    children = [c for (c,) in s.execute(select(Agent.id).where(Agent.parent_id == a.id).order_by(Agent.seq))]
    prof = a.strategy_profile or {}
    return {
        "id": a.id, "name": a.name, "status": a.status, "status_reason": a.status_reason,
        "generation": a.generation, "parent_id": a.parent_id, "children": children,
        "created_at": _iso(a.created_at), "deceased_at": _iso(a.deceased_at),
        "objective": a.objective, "strategy": a.strategy_key, "market": prof.get("market"),
        "params": prof.get("params"), "risk_tolerance": prof.get("risk_tolerance"),
        "strategy_state": prof.get("state"), "experiments": prof.get("experiments", []),
        "decision_config": prof.get("decision_config"), "lineage_change": prof.get("lineage_change"),
        "permissions": a.permissions, "reproduction_count": a.reproduction_count,
        "next_threshold": to_usd(a.next_reproduction_threshold),
        "financials": {k: (to_usd(v) if isinstance(v, int) else v) for k, v in fin.items()},
        "final_performance": a.final_performance,
        "model_calls": usage[0], "model_cost": to_usd(int(usage[1])),
        "events": [{"ts": _iso(e.ts), "type": e.type, "severity": e.severity, "summary": e.summary} for e in events],
        "memory": [{"ts": _iso(m.ts), "kind": m.kind, "content": m.content} for m in mem],
        "opportunities": [{"id": o.id, "title": o.title, "status": o.status, "assessment": o.assessment,
                           "results": o.results, "created_at": _iso(o.created_at)} for o in opps],
        "reproduction_blockers": core.reproduction_blockers(s, a) if a.status == AgentStatus.ACTIVE else [],
    }


def family_tree(s) -> dict:
    nodes = [{"id": a.id, "parent": a.parent_id, "generation": a.generation, "status": a.status,
              "strategy": a.strategy_key, "seq": a.seq}
             for a in s.scalars(select(Agent).order_by(Agent.seq))]
    return {"nodes": nodes}


def transactions(s, limit: int = 100, agent_id: str | None = None, kind: str | None = None) -> list[dict]:
    q = select(JournalEntry).order_by(JournalEntry.id.desc()).limit(min(limit, 500))
    if agent_id:
        q = q.where((JournalEntry.agent_id == agent_id) | (JournalEntry.counterparty_agent_id == agent_id))
    if kind:
        q = q.where(JournalEntry.kind == kind)
    out = []
    for e in s.scalars(q):
        out.append({
            "id": e.id, "ts": _iso(e.ts), "kind": e.kind, "agent_id": e.agent_id,
            "counterparty": e.counterparty_agent_id, "description": e.description,
            "amount": to_usd(max((abs(ln.amount) for ln in e.lines), default=0)),
            "simulated": e.simulated, "evidence": e.evidence_source, "ref": e.external_ref,
            "lines": [{"account": ln.account, "amount": to_usd(ln.amount)} for ln in e.lines],
        })
    return out


def timeseries(s, days: int = 90) -> list[dict]:
    # One extra (older) snapshot so the first returned day has a proper daily delta.
    rows = list(s.scalars(select(DailySnapshot).order_by(DailySnapshot.day.desc()).limit(days + 1)))
    rows.reverse()
    has_base = len(rows) > days
    out = []
    prev = None
    for r in rows:
        m = dict(r.metrics)
        m["day"] = r.day
        if prev:
            m["day_revenue"] = round(m["total_revenue"] - prev["total_revenue"], 6)
            m["day_expenses"] = round(m["total_expenses"] - prev["total_expenses"], 6)
            m["day_profit"] = round(m["realized_net_profit"] - prev["realized_net_profit"], 6)
        else:
            m["day_revenue"], m["day_expenses"], m["day_profit"] = m["total_revenue"], m["total_expenses"], m["realized_net_profit"]
        out.append(m)
        prev = r.metrics
    return out[1:] if has_base else out


def cost_report(core, s, days: int = 1) -> dict:
    ledger = Ledger(s)
    start = core.now() - timedelta(days=days)
    return {
        "window_days": days,
        "by_category": {k: to_usd(v) for k, v in ledger.expenses_by_category(start=start).items()},
        "operating_spend": to_usd(ledger.operating_spend(start=start)),
        "revenue": to_usd(ledger.revenue(start=start)),
        "model_calls": s.scalar(select(func.count(UsageRecord.id)).where(UsageRecord.ts > start)),
    }


def distributions(s) -> list[dict]:
    out = []
    for d in s.scalars(select(Distribution).order_by(Distribution.id.desc()).limit(104)):
        t = s.get(Transfer, d.transfer_id) if d.transfer_id else None
        out.append({
            "id": d.id, "period_start": _iso(d.period_start), "period_end": _iso(d.period_end),
            "status": d.status, "period_profit": to_usd(d.period_profit), "cumulative_profit": to_usd(d.cumulative_profit),
            "hwm_before": to_usd(d.hwm_before), "hwm_after": to_usd(d.hwm_after),
            "distributable": to_usd(d.distributable), "owner_amount": to_usd(d.owner_amount),
            "retained_amount": to_usd(d.retained_amount), "reimbursement": to_usd(d.reimbursement_amount),
            "tx_hash": t.tx_hash if t else None, "transfer_status": t.status if t else None,
            "simulated": t.simulated if t else None, "details": d.details,
        })
    return out
