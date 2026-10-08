"""Authentication (RBAC), secrets vault and rate limiting."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import NotConfigured, PolicyViolation
from .models import Secret

ROLES = ("admin", "viewer")


class TokenAuth:
    """Bearer-token RBAC. Tokens are compared in constant time via their hashes."""

    def __init__(self, admin_token: str | None, viewer_token: str | None):
        self.generated_admin_token = None
        if not admin_token:
            admin_token = secrets.token_urlsafe(32)
            self.generated_admin_token = admin_token
        self._hashes = {"admin": hashlib.sha256(admin_token.encode()).digest()}
        if viewer_token:
            self._hashes["viewer"] = hashlib.sha256(viewer_token.encode()).digest()
        self.admin_is_default = self.generated_admin_token is not None

    def role_for(self, token: str | None) -> str | None:
        if not token:
            return None
        h = hashlib.sha256(token.encode()).digest()
        for role in ROLES:
            expected = self._hashes.get(role)
            if expected and hmac.compare_digest(h, expected):
                return role
        return None


class Vault:
    """Encrypted integration credentials (Fernet / AES-128-CBC + HMAC).

    Credentials are scoped: `get(name, scope)` only returns plaintext to an
    allowed scope (e.g. "integration:stripe"). Agents and prompts never receive
    plaintext; integrations receive a handle and resolve it here.
    """

    def __init__(self, master_key: str | None):
        from cryptography.fernet import Fernet

        self.ephemeral = master_key is None
        if master_key is None:
            master_key = Fernet.generate_key().decode()
        key = master_key.encode()
        try:
            self._f = Fernet(key)
        except ValueError:
            # Accept any passphrase by deriving a Fernet key from it.
            self._f = Fernet(base64.urlsafe_b64encode(hashlib.sha256(key).digest()))

    def put(self, s: Session, name: str, value: str, scopes: list[str], description: str, ts: datetime) -> None:
        if not name.replace("_", "").replace("-", "").isalnum() or len(name) > 64:
            raise PolicyViolation("invalid secret name")
        row = s.get(Secret, name)
        ct = self._f.encrypt(value.encode()).decode()
        if row is None:
            s.add(Secret(name=name, ciphertext=ct, scopes=scopes, description=description, updated_at=ts))
        else:
            row.ciphertext, row.scopes, row.description, row.updated_at = ct, scopes, description, ts

    def get(self, s: Session, name: str, scope: str) -> str:
        row = s.get(Secret, name)
        if row is None:
            raise NotConfigured(f"credential {name!r} not configured")
        if scope not in row.scopes:
            raise PolicyViolation(f"scope {scope!r} may not read credential {name!r}", code="unauthorized")
        return self._f.decrypt(row.ciphertext.encode()).decode()

    def delete(self, s: Session, name: str) -> None:
        row = s.get(Secret, name)
        if row is not None:
            s.delete(row)

    @staticmethod
    def list(s: Session) -> list[dict]:
        return [{"name": r.name, "scopes": r.scopes, "description": r.description, "updated_at": r.updated_at.isoformat()}
                for r in s.scalars(select(Secret).order_by(Secret.name))]


class RateLimiter:
    """Token bucket per key."""

    def __init__(self, rate_per_minute: float, burst: int):
        self.rate = rate_per_minute / 60.0
        self.burst = burst
        self._b: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            tokens, last = self._b.get(key, (float(self.burst), now))
            tokens = min(self.burst, tokens + (now - last) * self.rate)
            if tokens < 1:
                self._b[key] = (tokens, now)
                return False
            self._b[key] = (tokens - 1, now)
            return True
