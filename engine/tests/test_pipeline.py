"""End-to-end: fake HTTP transport -> ingestion -> predictions -> API -> grading."""
import json
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from predictx_engine import pipeline
from predictx_engine.config import get_settings
from predictx_engine.db import Event, GradedPrediction, Prediction, session_scope, utcnow
from predictx_engine.leagues import LEAGUES
from predictx_engine.sources.espn import EspnClient
from predictx_engine.sources.odds_api import OddsApiClient

TEAMS = [("1", "Strong", 1.5), ("2", "Good", 0.7), ("3", "Middle", 0.0), ("4", "Weak", -0.7), ("5", "Rookie", None)]


def _comp(eid, when, h, a, state, hs=None, as_=None):
    def side(t, s, score):
        c = {"homeAway": s, "team": {"id": t[0], "displayName": t[1]}}
        if score is not None:
            c["score"] = str(score)
            c["winner"] = None
        return c
    return {"id": eid, "date": when.strftime("%Y-%m-%dT%H:%MZ"),
            "status": {"type": {"state": state, "completed": state == "post"}},
            "competitions": [{"id": eid, "date": when.strftime("%Y-%m-%dT%H:%MZ"),
                              "competitors": [side(h, "home", hs), side(a, "away", as_)]}]}


def build_history(now):
    """Deterministic results: the stronger side wins 3 of every 4 meetings."""
    events, n = [], 0
    rated = [t for t in TEAMS if t[2] is not None]
    for week in range(60):
        for i, h in enumerate(rated):
            for a in rated[i + 1:]:
                n += 1
                when = now - timedelta(days=400 - week * 6, hours=i)
                fav_home = h[2] > a[2]
                fav_wins = n % 4 != 0
                home_wins = fav_home == fav_wins
                events.append(_comp(f"h{n}", when, h, a, "post", 110 if home_wins else 100,
                                    100 if home_wins else 110))
    return events


@pytest.fixture()
def world(sqlite_db, monkeypatch):
    now = utcnow()
    history = build_history(now)
    upcoming = [
        _comp("u1", now + timedelta(days=1), TEAMS[0], TEAMS[3], "pre"),
        _comp("u2", now + timedelta(days=2), TEAMS[2], TEAMS[1], "pre"),
        _comp("u3", now + timedelta(days=2), TEAMS[0], TEAMS[4], "pre"),  # Rookie: no history
    ]
    calls = []

    def handler(req: httpx.Request):
        calls.append(str(req.url))
        if "the-odds-api" in req.url.host:
            if req.url.path.endswith("/sports"):
                return httpx.Response(200, json=[{"key": "basketball_nba", "group": "Basketball", "active": True}])
            return httpx.Response(200, json=[{
                "home_team": "Strong", "away_team": "Weak",
                "commence_time": upcoming[0]["date"].replace("Z", ":00Z"),
                "bookmakers": [{"markets": [{"key": "h2h", "outcomes": [
                    {"name": "Strong", "price": 1.25}, {"name": "Weak", "price": 4.2}]}]}] * 6}],
                headers={"x-requests-remaining": "480"})
        if req.url.path.endswith("/injuries"):
            return httpx.Response(200, json={"injuries": []})
        dates = req.url.params.get("dates", "")
        lo, hi = (datetime.strptime(d, "%Y%m%d").date() for d in dates.split("-"))
        evs = [e for e in history + upcoming
               if lo <= datetime.strptime(e["date"], "%Y-%m-%dT%H:%MZ").date() <= hi]
        return httpx.Response(200, json={"events": evs})

    monkeypatch.setenv("ODDS_API_KEY", "test-key")
    monkeypatch.setenv("HISTORY_DAYS", "420")
    get_settings.cache_clear()
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return {"http": http, "now": now, "calls": calls}


def run_all(http, settings):
    with session_scope() as s:
        r = pipeline.refresh_fixtures(s, EspnClient(http), LEAGUES["nba"], settings)
        assert "error" not in r, r
    with session_scope() as s:
        pipeline.refresh_injuries(s, EspnClient(http), LEAGUES["nba"])
    with session_scope() as s:
        o = pipeline.refresh_odds(s, OddsApiClient(http, "test-key"), [LEAGUES["nba"]])
        assert o["matched"] == 1
    with session_scope() as s:
        return pipeline.predict_sport(s, "basketball", settings)


def test_end_to_end(world):
    settings = get_settings()
    out = run_all(world["http"], settings)
    assert out["upcoming"] == 3 and out["written"] == 3
    assert out["backtest"]["n"] > 50

    # Second run with unchanged inputs writes nothing new (append-only, change-driven).
    with session_scope() as s:
        assert pipeline.predict_sport(s, "basketball", settings)["written"] == 0

    from predictx_engine.api import app
    client = TestClient(app)
    body = client.get("/api/predictions").json()
    top = body["top"]
    assert [t["event"]["home"] for t in top] == ["Strong", "Middle"]
    first = top[0]["prediction"]
    assert first["predicted_name"] == "Strong" and first["win_prob"] > 0.7
    assert abs(sum(first["probs"].values()) - 1) < 1e-9
    assert first["market_probs"] is not None and first["factors"]["basis"] == "model+market"
    assert 0 <= first["confidence"] <= 100 and first["confidence_label"] in ("High", "Medium", "Low")
    assert top[1]["prediction"]["market_probs"] is None
    # Rookie side has no history and no market price -> Insufficient Data, no number.
    assert [i["event"]["away"] for i in body["insufficient"]] == ["Rookie"]
    assert body["insufficient"][0]["prediction"]["win_prob"] is None

    assert client.get("/api/predictions", params={"min_prob": 0.99}).json()["top"] == []
    assert client.get("/api/predictions", params={"sport": "soccer"}).json()["top"] == []
    meta = client.get("/api/meta").json()
    assert meta["odds_configured"] is True
    assert "test-key" not in json.dumps(meta)
    detail = client.get(f"/api/events/{top[0]['event']['id']}").json()
    assert len(detail["history"]) == 1


def test_predictions_are_immutable(world):
    run_all(world["http"], get_settings())
    with session_scope() as s:
        with pytest.raises(Exception):
            s.execute(text("UPDATE predictions SET win_prob = 0.99"))
            s.flush()
    with session_scope() as s:
        with pytest.raises(Exception):
            s.execute(text("DELETE FROM predictions"))
            s.flush()


def test_grading_uses_last_pre_start_prediction(world):
    settings = get_settings()
    run_all(world["http"], settings)
    with session_scope() as s:
        e = s.get(Event, "espn:nba:u1")
        pre = s.scalar(select(Prediction).where(Prediction.event_id == e.id))
        e.start_time = pre.created_at + timedelta(minutes=1)
        e.status, e.result, e.home_score, e.away_score = "final", "away", 90, 100
    with session_scope() as s:
        assert pipeline.grade_finished(s)["graded"] == 1
        g = s.get(GradedPrediction, "espn:nba:u1")
        assert g.prediction_id == pre.id and g.correct is False
        assert abs(g.brier - 2 * pre.p_home ** 2) < 1e-9
        assert pipeline.grade_finished(s)["graded"] == 0


def test_prediction_made_after_start_is_never_graded(world):
    run_all(world["http"], get_settings())
    with session_scope() as s:
        e = s.get(Event, "espn:nba:u1")
        e.start_time = utcnow() - timedelta(days=1)
        e.status, e.result = "final", "home"
    with session_scope() as s:
        assert pipeline.grade_finished(s)["graded"] == 0


def test_stale_data_is_not_shown_as_current(world):
    run_all(world["http"], get_settings())
    with session_scope() as s:
        st = pipeline._status(s, "espn", "nba")
        st.last_success = utcnow() - timedelta(hours=30)
        st.last_error = "HTTP 503"
    from predictx_engine.api import app
    body = TestClient(app).get("/api/predictions").json()
    assert body["top"] == [] and len(body["not_current"]) == 3
    assert "503" in body["not_current"][0]["freshness"]["reason"]


def test_fetch_failure_is_recorded(sqlite_db):
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    with session_scope() as s:
        out = pipeline.refresh_fixtures(s, EspnClient(http), LEAGUES["nba"], get_settings())
        assert "error" in out
        st = pipeline._status(s, "espn", "nba")
        assert st.last_success is None and st.last_error
