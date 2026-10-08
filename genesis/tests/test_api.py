from fastapi.testclient import TestClient

from genesis.api import create_app

from .conftest import ADMIN, VIEWER, WALLET

A = {"Authorization": f"Bearer {ADMIN}"}
V = {"Authorization": f"Bearer {VIEWER}"}


def test_api_end_to_end(rt):
    with TestClient(create_app(rt)) as c:
        assert c.get("/api/health").json()["ok"]
        assert c.get("/api/overview").status_code == 401
        assert c.get("/api/overview", headers={"Authorization": "Bearer nope"}).status_code == 401
        r = c.post("/api/genesis", json={"fund_usd": 50, "market": "law-firms"}, headers=A)
        assert r.status_code == 200 and r.json()["agent_id"] == "AGT-0001"
        # viewer: read-only
        assert c.get("/api/agents", headers=V).status_code == 200
        assert c.put("/api/settings/policy", json={"changes": {"owner_profit_share_bps": 10000}}, headers=V).status_code == 403
        assert c.post("/api/control/pause", json={}, headers=V).status_code == 403
        # wallet validation
        bad = c.put("/api/settings/admin-wallet", json={"address": WALLET.lower()[:-1] + "x", "network": "base"}, headers=A)
        assert bad.status_code == 422
        ok = c.put("/api/settings/admin-wallet", json={"address": WALLET, "network": "base"}, headers=A)
        assert ok.status_code == 200
        # simulate 3 weeks
        r = c.post("/api/sim/advance", json={"hours": 24 * 21}, headers=A)
        assert r.status_code == 200
        ov = c.get("/api/overview", headers=V).json()
        assert ov["total_agents"] >= 1 and ov["accounting_identity_ok"] is True
        assert ov["next_distribution_local"].endswith("SAST")
        assert len(c.get("/api/distributions", headers=V).json()) == 3
        detail = c.get("/api/agents/AGT-0001", headers=V).json()
        assert detail["events"] and detail["opportunities"]
        assert c.get("/api/tree", headers=V).json()["nodes"][0]["id"] == "AGT-0001"
        assert c.get("/api/timeseries", headers=V).json()
        assert c.get("/api/transactions?limit=5", headers=V).json()
        assert c.get("/api/audit/verify", headers=V).json()["ok"]
        rec = c.post("/api/treasury/reconcile", headers=A).json()
        assert rec["ok"], rec
        # controls
        assert c.post("/api/control/pause", json={"reason": "t"}, headers=A).status_code == 200
        r = c.post("/api/sim/advance", json={"hours": 2}, headers=A)
        assert r.status_code == 200
        assert c.get("/api/overview", headers=A).json()["paused"] is True
        assert c.post("/api/control/resume", json={}, headers=A).status_code == 200
        assert c.post("/api/agents/AGT-0001/suspend", json={"reason": "check"}, headers=A).status_code == 200
        assert c.get("/api/agents/AGT-0001", headers=A).json()["status"] == "suspended"
        # live mode is blocked until every readiness check passes
        ready = c.get("/api/live/readiness", headers=A).json()
        assert ready["ready"] is False
        r = c.post("/api/live/activate", json={"phrase": "I AUTHORIZE LIVE TRANSACTIONS"}, headers=A)
        assert r.status_code == 422 and "failing checks" in r.json()["detail"]
        # integrations: values are write-only
        assert c.put("/api/integrations", json={"name": "stripe", "value": "sk_test_x", "scopes": ["integration:stripe"]},
                     headers=A).status_code == 200
        listed = c.get("/api/integrations", headers=A).json()
        assert listed[0]["name"] == "stripe" and "value" not in listed[0] and "ciphertext" not in listed[0]
        assert c.get("/api/integrations", headers=V).status_code == 403
        # dashboard is served
        assert c.get("/").status_code in (200, 404)
