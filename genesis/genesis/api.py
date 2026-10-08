"""HTTP API + dashboard host.

Roles: `admin` (all routes) and `viewer` (read-only). Agents have no API
credentials; they run in-process behind the Toolbox.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import audit, live, reporting
from .distribution import run_distribution
from .errors import Conflict, GenesisError, NotFound, PolicyViolation
from .models import AgentEvent, AgentStatus, Approval, AuditLog, Transfer
from .money import to_usd, usd
from .policy import all_state, get_policy, set_state, update_policy
from .runtime import Runtime, build_runtime
from .strategies import REGISTRY
from .treasury import reconcile
from .wallets import NETWORKS, validate_address

log = logging.getLogger("genesis.api")
STATIC = Path(__file__).parent / "static"

ERROR_STATUS = {NotFound: 404, Conflict: 409, PolicyViolation: 422}


# ------------------------------------------------------------------ schemas
class AmountIn(BaseModel):
    amount_usd: float = Field(gt=0, le=10_000_000)
    reference: str | None = Field(default=None, max_length=128)


class GenesisIn(BaseModel):
    strategy_key: str = "research_reports"
    market: str | None = None
    fund_usd: float | None = Field(default=None, gt=0, le=10_000_000)


class ReasonIn(BaseModel):
    reason: str = Field(default="administrator action", max_length=500)


class PolicyIn(BaseModel):
    changes: dict[str, Any]


class WalletIn(BaseModel):
    address: str = Field(max_length=128)
    network: str


class TreasuryIn(BaseModel):
    network: str | None = None
    treasury_address: str | None = Field(default=None, max_length=128)


class DecisionIn(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=500)


class AdvanceIn(BaseModel):
    hours: int = Field(ge=1, le=24 * 400)


class ActivateIn(BaseModel):
    phrase: str


class SecretIn(BaseModel):
    name: str = Field(max_length=64)
    value: str = Field(max_length=8192)
    scopes: list[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=300)


class BudgetIn(BaseModel):
    overrides: dict[str, float]


def create_app(runtime: Runtime | None = None) -> FastAPI:
    rt_holder: dict[str, Runtime] = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        rt = runtime or build_runtime()
        rt_holder["rt"] = rt
        app.state.rt = rt
        if rt.settings.autostart_orchestrator:
            interval = 1.0 if rt.core.clock.simulated else rt.settings.tick_seconds
            rt.orchestrator.start(interval)
        yield
        rt.orchestrator.stop()

    app = FastAPI(title="GENESIS AI", version="0.1.0", lifespan=lifespan)
    if runtime is not None:
        app.state.rt = runtime
    settings_origins = (runtime.settings.cors_origins if runtime else ())
    if settings_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings_origins), allow_methods=["*"], allow_headers=["*"])

    def rt_of(request: Request) -> Runtime:
        return request.app.state.rt

    @app.exception_handler(GenesisError)
    async def _genesis_error(_: Request, exc: GenesisError):
        status = next((code for cls, code in ERROR_STATUS.items() if isinstance(exc, cls)), 400)
        return JSONResponse(status_code=status, content={"error": exc.code, "detail": str(exc)})

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        rt: Runtime = request.app.state.rt
        if request.url.path.startswith("/api/"):
            key = request.headers.get("authorization", request.client.host if request.client else "anon")
            if not rt.limiter.allow(key[-24:]):
                return JSONResponse(status_code=429, content={"error": "rate_limited"})
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
        return resp

    def role(request: Request) -> str:
        rt = rt_of(request)
        header = request.headers.get("authorization", "")
        token = header[7:] if header.lower().startswith("bearer ") else None
        r = rt.auth.role_for(token)
        if r is None:
            raise HTTPException(status_code=401, detail="missing or invalid token")
        return r

    def admin(request: Request, r: str = Depends(role)) -> str:
        if r != "admin":
            raise HTTPException(status_code=403, detail="administrator role required")
        return "admin"

    def run(request: Request, fn, agent_id: str | None = None):
        rt = rt_of(request)
        return rt.core.run(fn, actor="admin", agent_id=agent_id)

    def read(request: Request, fn):
        rt = rt_of(request)
        with rt.core.tx() as s:
            return fn(s)

    # ------------------------------------------------------------------ public
    @app.get("/api/health")
    def health(request: Request):
        rt = rt_of(request)
        return {"ok": True, "orchestrator_running": rt.orchestrator.running,
                "mode": read(request, lambda s: "live" if all_state(s)["live_mode"] else "simulation")}

    @app.get("/api/whoami")
    def whoami(r: str = Depends(role)):
        return {"role": r}

    # ------------------------------------------------------------------ reads
    @app.get("/api/overview")
    def get_overview(request: Request, _: str = Depends(role)):
        rt = rt_of(request)
        data = read(request, lambda s: reporting.overview(rt.core, s))
        data["orchestrator_running"] = rt.orchestrator.running
        data["brain"] = getattr(rt.core.brain, "name", "heuristic")
        return data

    @app.get("/api/agents")
    def get_agents(request: Request, _: str = Depends(role)):
        return read(request, lambda s: reporting.leaderboard(rt_of(request).core, s))

    @app.get("/api/agents/{agent_id}")
    def get_agent(agent_id: str, request: Request, _: str = Depends(role)):
        return read(request, lambda s: reporting.agent_detail(rt_of(request).core, s, agent_id))

    @app.get("/api/tree")
    def get_tree(request: Request, _: str = Depends(role)):
        return read(request, reporting.family_tree)

    @app.get("/api/transactions")
    def get_transactions(request: Request, limit: int = 100, agent_id: str | None = None, kind: str | None = None,
                         _: str = Depends(role)):
        return read(request, lambda s: reporting.transactions(s, limit, agent_id, kind))

    @app.get("/api/timeseries")
    def get_timeseries(request: Request, days: int = 120, _: str = Depends(role)):
        return read(request, lambda s: reporting.timeseries(s, days))

    @app.get("/api/costs")
    def get_costs(request: Request, days: int = 1, _: str = Depends(role)):
        return read(request, lambda s: reporting.cost_report(rt_of(request).core, s, days))

    @app.get("/api/distributions")
    def get_distributions(request: Request, _: str = Depends(role)):
        return read(request, reporting.distributions)

    @app.get("/api/events")
    def get_events(request: Request, limit: int = 100, severity: str | None = None, _: str = Depends(role)):
        def q(s):
            stmt = select(AgentEvent).order_by(AgentEvent.id.desc()).limit(min(limit, 500))
            if severity:
                stmt = stmt.where(AgentEvent.severity == severity)
            return [{"ts": e.ts.isoformat(), "agent_id": e.agent_id, "type": e.type, "severity": e.severity,
                     "summary": e.summary} for e in s.scalars(stmt)]
        return read(request, q)

    @app.get("/api/approvals")
    def get_approvals(request: Request, status: str = "pending", _: str = Depends(role)):
        return read(request, lambda s: [
            {"id": a.id, "kind": a.kind, "agent_id": a.agent_id, "title": a.title, "payload": a.payload,
             "status": a.status, "created_at": a.created_at.isoformat(), "decided_by": a.decided_by}
            for a in s.scalars(select(Approval).where(Approval.status == status).order_by(Approval.id.desc()).limit(200))])

    @app.get("/api/transfers")
    def get_transfers(request: Request, _: str = Depends(role)):
        return read(request, lambda s: [
            {"id": t.id, "kind": t.kind, "network": t.network, "to": t.to_address, "amount": to_usd(t.amount),
             "status": t.status, "simulated": t.simulated, "tx_hash": t.tx_hash, "created_at": t.created_at.isoformat()}
            for t in s.scalars(select(Transfer).order_by(Transfer.id.desc()).limit(200))])

    @app.get("/api/audit")
    def get_audit(request: Request, limit: int = 100, _: str = Depends(role)):
        return read(request, lambda s: [
            {"id": a.id, "ts": a.ts.isoformat(), "actor": a.actor, "action": a.action, "target": a.target,
             "details": a.details, "hash": a.hash[:16]}
            for a in s.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 500)))])

    @app.get("/api/audit/verify")
    def verify_audit(request: Request, _: str = Depends(role)):
        return read(request, audit.verify)

    @app.get("/api/settings")
    def get_settings(request: Request, _: str = Depends(role)):
        def q(s):
            st = all_state(s)
            st.pop("sim_prices", None)
            return {"policy": get_policy(s), "state": st, "networks": list(NETWORKS),
                    "strategies": {k: {"name": v.spec.name, "category": v.spec.category, "description": v.spec.description,
                                       "live_requirements": list(v.spec.live_requirements), "risk_level": v.spec.risk_level,
                                       "markets": list(v.spec.markets)}
                                   for k, v in REGISTRY.items()}}
        return read(request, q)

    @app.get("/api/live/readiness")
    def live_readiness(request: Request, _: str = Depends(role)):
        rt = rt_of(request)
        return read(request, lambda s: live.readiness(s, auth=rt.auth, vault=rt.vault))

    @app.get("/api/integrations")
    def list_integrations(request: Request, _: str = Depends(admin)):
        from .security import Vault
        return read(request, Vault.list)

    # ------------------------------------------------------------------ admin: lifecycle
    @app.post("/api/treasury/contribute")
    def contribute(body: AmountIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core
        run(request, lambda s: core.contribute_capital(s, usd(body.amount_usd), actor="admin", reference=body.reference))
        return {"ok": True}

    @app.post("/api/genesis")
    def genesis(body: GenesisIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core

        def fn(s):
            if body.fund_usd:
                core.contribute_capital(s, usd(body.fund_usd), actor="admin")
            a = core.create_genesis_agent(s, actor="admin", strategy_key=body.strategy_key, market=body.market)
            return {"agent_id": a.id}
        return run(request, fn)

    @app.post("/api/agents/{agent_id}/{action}")
    def agent_action(agent_id: str, action: str, body: ReasonIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core
        mapping = {"suspend": AgentStatus.SUSPENDED, "resume": AgentStatus.ACTIVE, "terminate": AgentStatus.DECEASED}
        if action not in mapping:
            raise HTTPException(404, "unknown action")
        run(request, lambda s: core.set_agent_status(s, agent_id, mapping[action], actor="admin", reason=body.reason))
        return {"ok": True}

    @app.put("/api/agents/{agent_id}/budgets")
    def agent_budgets(agent_id: str, body: BudgetIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core

        def fn(s):
            from .ledger import EXPENSE_CATEGORIES
            a = core.get_agent(s, agent_id)
            for k, v in body.overrides.items():
                if k not in EXPENSE_CATEGORIES or v < 0:
                    raise PolicyViolation(f"invalid budget {k}")
            a.budget_overrides = {**a.budget_overrides, **body.overrides}
            audit.record(s, ts=core.now(), actor="admin", action="agent_budget_changed", target=agent_id, details=body.overrides)
        run(request, fn)
        return {"ok": True}

    @app.post("/api/control/{action}")
    def control(action: str, body: ReasonIn, request: Request, _: str = Depends(admin)):
        rt = rt_of(request)
        core = rt.core
        if action not in ("pause", "resume", "emergency-stop", "start-orchestrator", "stop-orchestrator"):
            raise HTTPException(404, "unknown control")

        def fn(s):
            if action == "pause":
                set_state(s, "paused", True, core.now())
            elif action == "resume":
                set_state(s, "paused", False, core.now())
                set_state(s, "emergency_stop", False, core.now())
            elif action == "emergency-stop":
                set_state(s, "emergency_stop", True, core.now())
                set_state(s, "paused", True, core.now())
                if all_state(s)["live_mode"]:
                    live.deactivate(s, actor="admin", ts=core.now())
            audit.record(s, ts=core.now(), actor="admin", action=f"control_{action}", details={"reason": body.reason})
        run(request, fn)
        if action == "emergency-stop" or action == "stop-orchestrator":
            rt.orchestrator.stop()
        elif action == "start-orchestrator":
            rt.orchestrator.start(1.0 if core.clock.simulated else rt.settings.tick_seconds)
        return {"ok": True, "orchestrator_running": rt.orchestrator.running}

    # ------------------------------------------------------------------ admin: policy & treasury
    @app.put("/api/settings/policy")
    def put_policy(body: PolicyIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core

        def fn(s):
            merged = update_policy(s, body.changes, core.now())
            audit.record(s, ts=core.now(), actor="admin", action="policy_changed", details=body.changes)
            return merged
        return run(request, fn)

    @app.post("/api/settings/confirm-limits")
    def confirm_limits(request: Request, _: str = Depends(admin)):
        core = rt_of(request).core

        def fn(s):
            set_state(s, "limits_confirmed_by_admin", True, core.now())
            audit.record(s, ts=core.now(), actor="admin", action="limits_confirmed", details=get_policy(s))
        run(request, fn)
        return {"ok": True}

    @app.put("/api/settings/admin-wallet")
    def put_wallet(body: WalletIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core

        def fn(s):
            addr = validate_address(body.address, body.network)
            old = all_state(s)["admin_wallet"]
            set_state(s, "admin_wallet", {"address": addr, "network": body.network}, core.now())
            audit.record(s, ts=core.now(), actor="admin", action="admin_wallet_changed", details={"old": old, "new": addr, "network": body.network})
            return {"address": addr, "network": body.network}
        return run(request, fn)

    @app.put("/api/settings/treasury")
    def put_treasury(body: TreasuryIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core

        def fn(s):
            st = all_state(s)
            if st["live_mode"]:
                raise PolicyViolation("deactivate live mode before changing treasury settings")
            net = body.network or st["network"]
            if net not in NETWORKS:
                raise PolicyViolation("unsupported network")
            set_state(s, "network", net, core.now())
            if body.treasury_address:
                set_state(s, "treasury_address", validate_address(body.treasury_address, net), core.now())
            audit.record(s, ts=core.now(), actor="admin", action="treasury_settings_changed", details=body.model_dump())
        run(request, fn)
        return {"ok": True}

    @app.post("/api/treasury/reconcile")
    def do_reconcile(request: Request, _: str = Depends(admin)):
        core = rt_of(request).core

        def fn(s):
            try:
                addr = core.treasury_address(s)
            except GenesisError:
                addr = ""
            r = reconcile(s, core.signer(s), addr)
            set_state(s, "last_reconciliation", {**r, "ts": core.now().isoformat()}, core.now())
            audit.record(s, ts=core.now(), actor="admin", action="reconciliation", details={"ok": r["ok"], "issues": r["issues"]})
            return r
        return run(request, fn)

    @app.post("/api/approvals/{approval_id}")
    def decide(approval_id: int, body: DecisionIn, request: Request, _: str = Depends(admin)):
        core = rt_of(request).core
        ap = run(request, lambda s: core.decide_approval(s, approval_id, body.approve, actor="admin", note=body.note))
        return {"id": ap.id, "status": ap.status}

    @app.post("/api/distributions/run")
    def run_dist(request: Request, _: str = Depends(admin)):
        """Run the distribution for the period ending now (manual, off-schedule)."""
        core = rt_of(request).core
        d = run(request, lambda s: run_distribution(core, s, core.now(), actor="admin"))
        return {"id": d.id, "status": d.status, "owner_amount": to_usd(d.owner_amount)}

    @app.post("/api/live/activate")
    def activate(body: ActivateIn, request: Request, _: str = Depends(admin)):
        rt = rt_of(request)
        return run(request, lambda s: live.activate(s, auth=rt.auth, vault=rt.vault, actor="admin", phrase=body.phrase, ts=rt.core.now()))

    @app.post("/api/live/deactivate")
    def deactivate(request: Request, _: str = Depends(admin)):
        rt = rt_of(request)
        run(request, lambda s: live.deactivate(s, actor="admin", ts=rt.core.now()))
        return {"ok": True}

    @app.put("/api/integrations")
    def put_integration(body: SecretIn, request: Request, _: str = Depends(admin)):
        rt = rt_of(request)

        def fn(s):
            rt.vault.put(s, body.name, body.value, body.scopes, body.description, rt.core.now())
            audit.record(s, ts=rt.core.now(), actor="admin", action="credential_stored", target=body.name, details={"scopes": body.scopes})
        run(request, fn)
        return {"ok": True}

    @app.delete("/api/integrations/{name}")
    def delete_integration(name: str, request: Request, _: str = Depends(admin)):
        rt = rt_of(request)

        def fn(s):
            rt.vault.delete(s, name)
            audit.record(s, ts=rt.core.now(), actor="admin", action="credential_deleted", target=name)
        run(request, fn)
        return {"ok": True}

    # ------------------------------------------------------------------ simulation
    @app.post("/api/sim/advance")
    def sim_advance(body: AdvanceIn, request: Request, _: str = Depends(admin)):
        rt = rt_of(request)
        if not rt.core.clock.simulated:
            raise HTTPException(409, "simulation clock not active")
        if rt.orchestrator.running:
            raise HTTPException(409, "stop the background orchestrator first")
        r = rt.orchestrator.advance(body.hours)
        return {"now": rt.core.now().isoformat(), **r}

    # ------------------------------------------------------------------ dashboard
    if STATIC.exists():
        app.mount("/static", StaticFiles(directory=STATIC), name="static")

        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(STATIC / "index.html")

    return app


def get_app() -> FastAPI:  # uvicorn --factory genesis.api:get_app
    return create_app()
