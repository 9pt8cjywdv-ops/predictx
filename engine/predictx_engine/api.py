"""HTTP API consumed by the dashboard: `uvicorn predictx_engine.api:app`."""
from __future__ import annotations

import hmac
import threading
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from . import jobs
from .config import get_settings
from .db import (
    Event,
    GradedPrediction,
    ModelRun,
    Prediction,
    SourceStatus,
    as_utc,
    init_db,
    session_scope,
    utcnow,
)
from .leagues import LEAGUES, SPORTS

@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield


app = FastAPI(title="PredictX Sports Probability Engine", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

DISCLAIMER = ("Probabilities are statistical estimates, not guarantees. "
              "This service does not offer or recommend bets.")


def _iso(dt: datetime | None) -> str | None:
    dt = as_utc(dt)
    return dt.isoformat() if dt else None


def _side_name(e: Event, side: str | None) -> str | None:
    return {"home": e.home_name, "away": e.away_name, "draw": "Draw"}.get(side or "")


def _source_map(session) -> dict[tuple[str, str], SourceStatus]:
    return {(s.source, s.scope): s for s in session.scalars(select(SourceStatus)).all()}


def _freshness(e: Event, pred: Prediction | None, sources: dict, now: datetime, stale_h: float) -> dict:
    st = sources.get(("espn", e.league))
    checked = as_utc(st.last_success) if st else None
    if pred is None:
        return {"is_current": False, "data_checked_at": _iso(checked), "reason": "No prediction computed yet"}
    if checked is None or checked < now - timedelta(hours=stale_h):
        return {"is_current": False, "data_checked_at": _iso(checked),
                "reason": f"Fixture data not refreshed in the last {stale_h:g}h"
                          + (f" (last error: {st.last_error})" if st and st.last_error else "")}
    return {"is_current": True, "data_checked_at": _iso(checked), "reason": None}


def _probs(pred: Prediction, prefix: str) -> dict | None:
    h = getattr(pred, f"{prefix}_home")
    if h is None:
        return None
    out = {"home": h, "away": getattr(pred, f"{prefix}_away")}
    d = getattr(pred, f"{prefix}_draw")
    if d is not None:
        out["draw"] = d
    return out


def _serialize(e: Event, pred: Prediction | None, fresh: dict) -> dict:
    lg = LEAGUES.get(e.league)
    item = {
        "event": {
            "id": e.id, "sport": e.sport, "sport_name": SPORTS[e.sport].name if e.sport in SPORTS else e.sport,
            "league": e.league, "league_name": lg.name if lg else e.league, "competition": e.competition,
            "start_time": _iso(e.start_time), "home": e.home_name, "away": e.away_name,
            "neutral": e.neutral, "draw_possible": e.draw_possible, "status": e.status,
        },
        "prediction": None,
        "freshness": fresh,
    }
    if pred is not None:
        item["prediction"] = {
            "status": pred.status,
            "predicted": pred.predicted,
            "predicted_name": _side_name(e, pred.predicted),
            "win_prob": pred.win_prob,
            "probs": _probs(pred, "p"),
            "model_probs": _probs(pred, "p_model"),
            "market_probs": _probs(pred, "p_market"),
            "confidence": pred.confidence,
            "confidence_label": pred.confidence_label,
            "factors": pred.factors,
            "missing": pred.missing,
            "model_version": pred.model_version,
            "updated_at": _iso(pred.created_at),
        }
    return item


def _latest_predictions(session, event_ids: list[str]) -> dict[str, Prediction]:
    if not event_ids:
        return {}
    sub = (select(Prediction.event_id, func.max(Prediction.id).label("mid"))
           .where(Prediction.event_id.in_(event_ids)).group_by(Prediction.event_id).subquery())
    rows = session.scalars(select(Prediction).join(sub, Prediction.id == sub.c.mid)).all()
    return {p.event_id: p for p in rows}


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "time": _iso(utcnow())}


@app.get("/api/meta")
def meta() -> dict:
    settings = get_settings()
    now = utcnow()
    with session_scope() as s:
        counts = dict(s.execute(select(Event.league, func.count()).where(
            Event.status == "scheduled", Event.start_time > now,
            Event.start_time <= now + timedelta(days=settings.lookahead_days + 1))
            .group_by(Event.league)).all())
        sources = [
            {"source": st.source, "scope": st.scope, "last_success": _iso(st.last_success),
             "last_attempt": _iso(st.last_attempt), "last_error": st.last_error}
            for st in s.scalars(select(SourceStatus).order_by(SourceStatus.source, SourceStatus.scope)).all()
        ]
    return {
        "sports": [{"key": sp.key, "name": sp.name, "three_way": sp.three_way} for sp in SPORTS.values()],
        "leagues": [{"key": lg.key, "sport": lg.sport, "name": lg.name, "upcoming": counts.get(lg.key, 0)}
                    for lg in LEAGUES.values()],
        "odds_configured": bool(settings.odds_api_key),
        "sources": sources,
        "stale_after_hours": settings.stale_after_hours,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/predictions")
def predictions(
    sport: str | None = None,
    league: str | None = None,
    start: datetime | None = Query(None, description="ISO time; default now"),
    end: datetime | None = Query(None, description="ISO time; default now + lookahead"),
    min_prob: float = Query(0.0, ge=0, le=1),
    top: int = Query(10, ge=1, le=50),
) -> dict:
    settings = get_settings()
    now = utcnow()
    start = max(as_utc(start) if start else now, now)
    end = as_utc(end) if end else now + timedelta(days=settings.lookahead_days)
    with session_scope() as s:
        q = select(Event).where(Event.status == "scheduled", Event.start_time > start, Event.start_time <= end)
        if sport:
            q = q.where(Event.sport == sport)
        if league:
            q = q.where(Event.league == league)
        events = s.scalars(q.order_by(Event.start_time)).all()
        preds = _latest_predictions(s, [e.id for e in events])
        sources = _source_map(s)
        items = [_serialize(e, preds.get(e.id), _freshness(e, preds.get(e.id), sources, now,
                                                            settings.stale_after_hours)) for e in events]

    def rank(it):
        p = it["prediction"]
        ok = p is not None and p["status"] == "ok" and it["freshness"]["is_current"]
        return (0 if ok else 1, -(p["win_prob"] or 0) if ok else 0, it["event"]["start_time"])

    items.sort(key=rank)
    ranked = [it for it in items if it["prediction"] and it["prediction"]["status"] == "ok"
              and it["freshness"]["is_current"] and it["prediction"]["win_prob"] >= min_prob]
    insufficient = [it for it in items if it["prediction"] and it["prediction"]["status"] == "insufficient_data"
                    and it["freshness"]["is_current"]]
    not_current = [it for it in items if not it["freshness"]["is_current"]]
    return {
        "generated_at": _iso(now),
        "window": {"start": _iso(start), "end": _iso(end)},
        "top": ranked[:top],
        "ranked": ranked,
        "insufficient": insufficient,
        "not_current": not_current,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/events/{event_id:path}")
def event_detail(event_id: str) -> dict:
    settings = get_settings()
    with session_scope() as s:
        e = s.get(Event, event_id)
        if e is None:
            raise HTTPException(404, "event not found")
        history = s.scalars(select(Prediction).where(Prediction.event_id == event_id)
                            .order_by(Prediction.created_at, Prediction.id)).all()
        latest = history[-1] if history else None
        item = _serialize(e, latest, _freshness(e, latest, _source_map(s), utcnow(), settings.stale_after_hours))
        item["history"] = [{"created_at": _iso(p.created_at), "status": p.status, "probs": _probs(p, "p"),
                            "predicted": p.predicted, "confidence": p.confidence} for p in history]
        g = s.get(GradedPrediction, event_id)
        item["graded"] = ({"outcome": g.outcome, "correct": g.correct, "brier": g.brier} if g else None)
        item["event"]["result"] = e.result
        item["event"]["score"] = [e.home_score, e.away_score]
    return item


@app.get("/api/accuracy")
def accuracy(sport: str | None = None) -> dict:
    with session_scope() as s:
        q = select(GradedPrediction)
        if sport:
            q = q.where(GradedPrediction.sport == sport)
        graded = s.scalars(q).all()
        runs = {}
        for sp in SPORTS:
            if sport and sp != sport:
                continue
            r = s.scalar(select(ModelRun).where(ModelRun.sport == sp)
                         .order_by(ModelRun.run_at.desc(), ModelRun.id.desc()).limit(1))
            if r:
                runs[sp] = {"run_at": _iso(r.run_at), "model_version": r.model_version,
                            "history_games": r.history_games, "backtest": r.backtest}
        recent_rows = s.execute(select(GradedPrediction, Event).join(Event, Event.id == GradedPrediction.event_id)
                                .order_by(Event.start_time.desc()).limit(50)).all()
        recent = [{"event_id": e.id, "sport": e.sport, "start_time": _iso(e.start_time),
                   "match": f"{e.home_name} vs {e.away_name}", "predicted": _side_name(e, g.predicted),
                   "win_prob": g.win_prob, "outcome": _side_name(e, g.outcome), "correct": g.correct,
                   "brier": g.brier} for g, e in recent_rows if not sport or e.sport == sport]

    by_sport: dict[str, list[GradedPrediction]] = defaultdict(list)
    for g in graded:
        by_sport[g.sport].append(g)

    def summarise(rows: list[GradedPrediction]) -> dict:
        n = len(rows)
        bins = []
        for lo in range(30, 100, 10):
            b = [r for r in rows if lo / 100 <= r.win_prob < (lo + 10) / 100 or (lo == 90 and r.win_prob >= 1)]
            if b:
                bins.append({"range": f"{lo}-{lo + 10}%", "n": len(b),
                             "mean_predicted": sum(r.win_prob for r in b) / len(b),
                             "observed": sum(r.correct for r in b) / len(b)})
        mk = [r.market_brier for r in rows if r.market_brier is not None]
        md = [r.model_brier for r in rows if r.model_brier is not None]
        return {
            "n": n,
            "accuracy": sum(r.correct for r in rows) / n,
            "brier": sum(r.brier for r in rows) / n,
            "log_loss": sum(r.log_loss for r in rows) / n,
            "model_only_brier": sum(md) / len(md) if md else None,
            "market_only_brier": sum(mk) / len(mk) if mk else None,
            "calibration": bins,
        }

    return {
        "overall": summarise(graded) if graded else None,
        "sports": [{"sport": sp, "name": SPORTS[sp].name,
                    "live": summarise(by_sport[sp]) if by_sport.get(sp) else None,
                    "backtest": runs.get(sp)} for sp in SPORTS if not sport or sp == sport],
        "recent": recent,
        "notes": [
            "Live = predictions recorded before kick-off and graded after the result. Never edited.",
            "Backtest = walk-forward replay on historical results (each game scored with pre-game ratings). "
            "Shown for context; it is not live performance.",
            "Brier score: lower is better. Two-outcome coin-flip = 0.50; three-outcome uniform = 0.667.",
        ],
    }


_refresh_lock = threading.Lock()


def _require_admin(authorization: str | None = Header(None)) -> None:
    token = get_settings().admin_token
    if not token:
        raise HTTPException(404, "admin endpoints disabled (ADMIN_TOKEN unset)")
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied, token):
        raise HTTPException(401, "invalid token")


@app.post("/api/admin/refresh", dependencies=[Depends(_require_admin)])
def admin_refresh(background: BackgroundTasks) -> dict:
    if _refresh_lock.locked():
        return {"started": False, "reason": "refresh already running"}

    def run():
        with _refresh_lock:
            jobs.job_full_refresh()

    background.add_task(run)
    return {"started": True}
