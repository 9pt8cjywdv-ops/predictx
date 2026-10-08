"""Controlled live deployment gate (Phase 7).

Live transactions stay disabled until every check passes AND the
administrator explicitly authorizes activation with a confirmation phrase.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from . import audit
from .errors import PolicyViolation
from .policy import get_state, set_state
from .treasury import ExternalSignerAdapter
from .wallets import validate_address

CONFIRMATION_PHRASE = "I AUTHORIZE LIVE TRANSACTIONS"


def readiness(s: Session, *, auth, vault) -> dict:
    checks = []

    def add(key, ok, detail):
        checks.append({"key": key, "ok": bool(ok), "detail": detail})

    ver = get_state(s, "last_simulation_verification")
    add("simulations_passed", ver and ver.get("all_passed"),
        f"last verification {ver['ts']}: {ver['passed']}/{ver['total']} scenarios" if ver else "run `python -m genesis.simulate --verify`")
    add("financial_identity", audit_ok := audit.verify(s)["ok"], "audit chain intact" if audit_ok else "audit chain broken")
    add("admin_credentials", not auth.admin_is_default, "GENESIS_ADMIN_TOKEN set" if not auth.admin_is_default else "admin token is auto-generated")
    add("secrets_encryption", not vault.ephemeral, "GENESIS_MASTER_KEY set" if not vault.ephemeral else "GENESIS_MASTER_KEY missing")
    wallet = get_state(s, "admin_wallet")
    wallet_ok = False
    if wallet:
        try:
            validate_address(wallet["address"], wallet["network"])
            wallet_ok = True
        except PolicyViolation:
            pass
    add("admin_wallet", wallet_ok, f"{wallet['network']}:{wallet['address']}" if wallet else "not configured")
    tre = get_state(s, "treasury_address")
    add("treasury_wallet", bool(tre), tre or "treasury (signing service) address not configured")
    add("signing_service", ExternalSignerAdapter().configured, "GENESIS_SIGNER_URL configured" if ExternalSignerAdapter().configured else "awaiting signing-service integration")
    add("limits_confirmed", get_state(s, "limits_confirmed_by_admin"), "administrator confirmed spending limits")
    rec = get_state(s, "last_reconciliation")
    add("reconciliation", rec and rec.get("ok"), "last reconciliation clean" if rec and rec.get("ok") else "run reconciliation")
    return {"ready": all(c["ok"] for c in checks), "checks": checks, "live_mode": get_state(s, "live_mode")}


def activate(s: Session, *, auth, vault, actor: str, phrase: str, ts: datetime) -> dict:
    r = readiness(s, auth=auth, vault=vault)
    if phrase != CONFIRMATION_PHRASE:
        raise PolicyViolation(f"type the exact confirmation phrase: {CONFIRMATION_PHRASE}")
    if not r["ready"]:
        failing = [c["key"] for c in r["checks"] if not c["ok"]]
        raise PolicyViolation("live mode blocked; failing checks: " + ", ".join(failing), code="not_ready")
    set_state(s, "live_mode", True, ts)
    set_state(s, "live_authorization", {"by": actor, "ts": ts.isoformat()}, ts)
    audit.record(s, ts=ts, actor=actor, action="live_mode_activated", details={"checks": r["checks"]})
    return readiness(s, auth=auth, vault=vault)


def deactivate(s: Session, *, actor: str, ts: datetime) -> None:
    set_state(s, "live_mode", False, ts)
    audit.record(s, ts=ts, actor=actor, action="live_mode_deactivated")
