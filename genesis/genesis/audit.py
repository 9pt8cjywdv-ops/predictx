"""Hash-chained, append-only audit log.

Each record's hash covers its content plus the previous record's hash, so any
edit or deletion of a historical record is detectable by verify().
"""
import hashlib
import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditLog

GENESIS_HASH = "0" * 64


def _digest(prev_hash: str, ts: datetime, actor: str, action: str, target, details: dict) -> str:
    payload = json.dumps(
        {"p": prev_hash, "t": ts.isoformat(), "a": actor, "x": action, "g": target, "d": details},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def record(s: Session, *, ts: datetime, actor: str, action: str, target: str | None = None, details: dict | None = None) -> AuditLog:
    details = json.loads(json.dumps(details or {}, default=str))
    last = s.scalar(select(AuditLog).order_by(AuditLog.id.desc()).limit(1).with_for_update())
    prev = last.hash if last else GENESIS_HASH
    row = AuditLog(
        ts=ts, actor=actor, action=action, target=target, details=details, prev_hash=prev,
        hash=_digest(prev, ts, actor, action, target, details),
    )
    s.add(row)
    s.flush()
    return row


def verify(s: Session) -> dict:
    prev = GENESIS_HASH
    count = 0
    for row in s.scalars(select(AuditLog).order_by(AuditLog.id)):
        if row.prev_hash != prev or row.hash != _digest(prev, row.ts, row.actor, row.action, row.target, row.details):
            return {"ok": False, "broken_at": row.id, "checked": count}
        prev = row.hash
        count += 1
    return {"ok": True, "checked": count}
