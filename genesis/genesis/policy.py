"""Ecosystem policy (administrator-controlled) and ecosystem state.

Policy values are only writable through `update_policy`, which is reachable
solely from authenticated administrator API routes. No agent code path holds
a reference to it: agents receive a read-only snapshot.
"""
import copy
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import PolicyViolation
from .ledger import EXPENSE_CATEGORIES
from .models import StateKV

# Conservative initial deployment defaults. Money values are USD.
DEFAULT_POLICY: dict = {
    # Rule 1 / 3 / 4 — economic constants
    "initial_agent_capital_usd": 50,
    "offspring_capital_usd": 50,
    "first_reproduction_multiple": 10,  # $500 for a $50 agent
    "subsequent_reproduction_multiple": 2,  # capital doubling
    # Rule 5 — distribution
    "owner_profit_share_bps": 5000,  # 50%
    "distribution_weekday": 6,  # Sunday (Mon=0)
    "distribution_hour": 23,
    "distribution_minute": 59,
    "distribution_timezone": "Africa/Johannesburg",
    "auto_payout_limit_usd": 100,  # larger payouts need explicit approval
    "min_agent_reserve_usd": 5,  # an agent never funds a payout below this
    # Rule 9 — proliferation and spend safeguards
    "max_active_agents": 10,
    "max_births_per_day": 2,
    "max_aggregate_capital_usd": 5000,
    "max_daily_expenditure_usd": 10,
    "max_weekly_expenditure_usd": 50,
    "max_transaction_usd": 100,
    "min_parent_reserve_after_reproduction_usd": 50,
    # Survival
    "insolvency_floor_usd": 0.05,
    # Per-agent daily budgets by category
    "agent_daily_budgets_usd": {
        "claude_api": 0.50,
        "external_api": 0.25,
        "compute": 0.25,
        "hosting": 0.50,
        "trading_fees": 1.00,
        "blockchain_fees": 0.25,
        "payment_fees": 2.00,
        "software": 0.50,
        "marketing": 2.00,
        "business": 2.00,
        "other": 0.25,
    },
    # Risk
    "max_violations_per_day_before_suspend": 5,
    "losing_days_warning": 7,
    "max_risk_tolerance": 0.5,
    "max_position_fraction": 0.5,  # of available capital, spot only
    # AI cost control
    "claude_routine_model": "claude-haiku-5-5",
    "claude_reasoning_model": "claude-opus-5-5",
    "claude_max_calls_per_agent_per_day": 4,
    "claude_max_output_tokens": 1500,
    "planning_interval_hours": 24,
    # Strategies the administrator has enabled
    "enabled_strategies": ["research_reports", "micro_saas", "spot_momentum", "conservation"],
}

# Bounds for numeric policy keys: (min, max)
_BOUNDS = {
    "initial_agent_capital_usd": (1, 1_000_000),
    "offspring_capital_usd": (1, 1_000_000),
    "first_reproduction_multiple": (2, 1000),
    "subsequent_reproduction_multiple": (1.1, 100),
    "owner_profit_share_bps": (0, 10_000),
    "distribution_weekday": (0, 6),
    "distribution_hour": (0, 23),
    "distribution_minute": (0, 59),
    "auto_payout_limit_usd": (0, 10_000_000),
    "min_agent_reserve_usd": (0, 1_000_000),
    "max_active_agents": (1, 10_000),
    "max_births_per_day": (0, 1000),
    "max_aggregate_capital_usd": (1, 1e12),
    "max_daily_expenditure_usd": (0, 1e9),
    "max_weekly_expenditure_usd": (0, 1e10),
    "max_transaction_usd": (0, 1e9),
    "min_parent_reserve_after_reproduction_usd": (0, 1e9),
    "insolvency_floor_usd": (0, 1000),
    "max_violations_per_day_before_suspend": (1, 1000),
    "losing_days_warning": (1, 365),
    "max_risk_tolerance": (0, 1),
    "max_position_fraction": (0, 1),
    "claude_max_calls_per_agent_per_day": (0, 1000),
    "claude_max_output_tokens": (64, 64000),
    "planning_interval_hours": (1, 24 * 30),
}

DEFAULT_STATE: dict = {
    "paused": False,
    "emergency_stop": False,
    "live_mode": False,
    "live_authorization": None,
    "limits_confirmed_by_admin": False,
    "network": "base",
    "treasury_address": None,
    "admin_wallet": None,  # {"address":..., "network":...}
    "distribution_hwm": 0,  # micro-USDC, cumulative realized profit already distributed against
    "last_distribution_period_end": None,
    "genesis_at": None,
    "sim_prices": {},
    "last_reconciliation": None,
    "last_simulation_verification": None,
}


def _get(s: Session, key: str, default):
    # Per-session read cache: policy/state are read many times per transaction.
    cache = s.info.setdefault("genesis_kv", {})
    if key not in cache:
        row = s.get(StateKV, key)
        cache[key] = row.value if row is not None else default
    return copy.deepcopy(cache[key])


def _put(s: Session, key: str, value, ts: datetime) -> None:
    s.info.setdefault("genesis_kv", {})[key] = copy.deepcopy(value)
    row = s.get(StateKV, key)
    if row is None:
        s.add(StateKV(key=key, value=value, updated_at=ts))
    else:
        row.value = value
        row.updated_at = ts
    s.flush()


def get_policy(s: Session) -> dict:
    stored = _get(s, "policy", {})
    merged = copy.deepcopy(DEFAULT_POLICY)
    merged.update(stored)
    return merged


def validate_policy_changes(current: dict, changes: dict) -> dict:
    out = copy.deepcopy(current)
    for key, value in changes.items():
        if key not in DEFAULT_POLICY:
            raise PolicyViolation(f"unknown policy key {key!r}")
        if key in _BOUNDS:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise PolicyViolation(f"{key} must be numeric")
            lo, hi = _BOUNDS[key]
            if not lo <= value <= hi:
                raise PolicyViolation(f"{key} must be between {lo} and {hi}")
        elif key == "agent_daily_budgets_usd":
            if not isinstance(value, dict):
                raise PolicyViolation("agent_daily_budgets_usd must be an object")
            for cat, amt in value.items():
                if cat not in EXPENSE_CATEGORIES or isinstance(amt, bool) or not isinstance(amt, (int, float)) or amt < 0:
                    raise PolicyViolation(f"invalid budget entry {cat}={amt}")
            value = {**out["agent_daily_budgets_usd"], **value}
        elif key == "enabled_strategies":
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                raise PolicyViolation("enabled_strategies must be a list of strategy keys")
        elif key == "distribution_timezone":
            from zoneinfo import ZoneInfo

            try:
                ZoneInfo(value)
            except Exception as exc:  # noqa: BLE001
                raise PolicyViolation(f"unknown timezone {value!r}") from exc
        elif key in ("claude_routine_model", "claude_reasoning_model"):
            if not isinstance(value, str) or not value.startswith("claude-"):
                raise PolicyViolation(f"{key} must be a Claude model id")
        out[key] = value
    if out["max_weekly_expenditure_usd"] < out["max_daily_expenditure_usd"]:
        raise PolicyViolation("weekly expenditure cap must be >= daily cap")
    return out


def update_policy(s: Session, changes: dict, ts: datetime) -> dict:
    merged = validate_policy_changes(get_policy(s), changes)
    stored = _get(s, "policy", {})
    stored.update({k: merged[k] for k in changes})
    _put(s, "policy", stored, ts)
    return merged


def get_state(s: Session, key: str):
    if key not in DEFAULT_STATE:
        raise KeyError(key)
    return _get(s, f"state:{key}", DEFAULT_STATE[key])


def set_state(s: Session, key: str, value, ts: datetime) -> None:
    if key not in DEFAULT_STATE:
        raise KeyError(key)
    _put(s, f"state:{key}", value, ts)


def all_state(s: Session) -> dict:
    return {k: get_state(s, k) for k in DEFAULT_STATE}
