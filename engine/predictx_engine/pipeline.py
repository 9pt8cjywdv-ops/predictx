"""Ingestion, prediction, grading and recalibration jobs."""
from __future__ import annotations

import hashlib
import json
import logging
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import Settings
from .db import (
    Calibration,
    Event,
    GradedPrediction,
    Injury,
    ModelRun,
    OddsSnapshot,
    Prediction,
    SourceStatus,
    as_utc,
    utcnow,
)
from .leagues import LEAGUES, SPORTS, League
from .models.base import Context, Game
from .models.combine import (
    DEFAULT_MARKET_WEIGHT,
    MIN_GRADED_FOR_FIT,
    fit_market_weight,
    fit_temperature,
    log_pool,
    temper,
)
from .models.registry import build_model
from .sources.espn import EspnClient, ParsedEvent
from .sources.odds_api import MarketLine, OddsApiClient, match_line

log = logging.getLogger(__name__)

ODDS_MAX_AGE = timedelta(hours=24)
INJURY_LEAGUES_NEEDING_DATA = {"basketball", "nfl", "baseball"}
OUT_STATUSES = ("out", "injured reserve", "suspended", "doubtful", "il")


# --------------------------------------------------------------------------- status
def _status(session: Session, source: str, scope: str) -> SourceStatus:
    st = session.scalar(select(SourceStatus).where(SourceStatus.source == source, SourceStatus.scope == scope))
    if st is None:
        st = SourceStatus(source=source, scope=scope)
        session.add(st)
        session.flush()
    return st


def _mark(session: Session, source: str, scope: str, error: Exception | str | None) -> None:
    st = _status(session, source, scope)
    st.last_attempt = utcnow()
    if error is None:
        st.last_success = st.last_attempt
        st.last_error = None
    else:
        st.last_error = str(error)[:500]


# --------------------------------------------------------------------------- fixtures
def upsert_events(session: Session, events: list[ParsedEvent]) -> int:
    n = 0
    now = utcnow()
    for pe in events:
        row = session.get(Event, pe.id)
        if row is None:
            row = Event(id=pe.id, source="espn")
            session.add(row)
        for f in ("sport", "league", "competition", "start_time", "home_id", "away_id", "home_name",
                  "away_name", "neutral", "draw_possible", "status", "home_score", "away_score",
                  "result", "extra"):
            setattr(row, f, getattr(pe, f))
        row.fetched_at = now
        n += 1
    session.flush()
    return n


def refresh_fixtures(session: Session, espn: EspnClient, league: League, settings: Settings,
                     today: date | None = None) -> dict:
    today = today or utcnow().date()
    st = _status(session, "espn", league.key)
    written = 0
    try:
        if league.espn_mode != "header" and st.backfilled_from is None:
            start = today - timedelta(days=settings.history_days)
            for _, _, rep in espn.fetch_window_chunks(league, start, today - timedelta(days=1)):
                written += upsert_events(session, rep.events)
            st.backfilled_from = datetime.combine(start, datetime.min.time(), timezone.utc)
        rep = espn.fetch_range(league, today - timedelta(days=3), today + timedelta(days=settings.lookahead_days + 1))
        written += upsert_events(session, rep.events)
        _mark(session, "espn", league.key, None)
        return {"league": league.key, "events": written, "skipped": rep.skipped}
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("fixtures %s failed: %s", league.key, exc)
        _mark(session, "espn", league.key, exc)
        return {"league": league.key, "error": str(exc)}


def refresh_injuries(session: Session, espn: EspnClient, league: League) -> dict:
    if not league.injuries:
        return {}
    try:
        rows = espn.fetch_injuries(league)
    except (httpx.HTTPError, ValueError) as exc:
        _mark(session, "espn-injuries", league.key, exc)
        return {"league": league.key, "error": str(exc)}
    session.query(Injury).filter(Injury.league == league.key).delete()
    now = utcnow()
    for r in rows:
        session.add(Injury(league=league.key, fetched_at=now, **r))
    _mark(session, "espn-injuries", league.key, None)
    return {"league": league.key, "injuries": len(rows)}


# --------------------------------------------------------------------------- odds
def refresh_odds(session: Session, client: OddsApiClient, leagues: list[League]) -> dict:
    now = utcnow()
    try:
        active = client.active_sports()
    except (httpx.HTTPError, ValueError) as exc:
        _mark(session, "the-odds-api", "*", exc)
        return {"error": str(exc)}
    active_keys = {s["key"]: s for s in active if s.get("active", True)}
    by_sport: dict[str, set[str]] = defaultdict(set)
    for lg in leagues:
        keys = {k for k in lg.odds_keys if k in active_keys}
        if lg.odds_group:
            keys |= {k for k, s in active_keys.items() if s.get("group") == lg.odds_group
                     and not s.get("has_outrights")}
        by_sport[lg.sport] |= keys

    upcoming = session.scalars(select(Event).where(
        Event.status == "scheduled", Event.start_time >= now,
        Event.start_time <= now + timedelta(days=8))).all()
    events_by_sport: dict[str, list[Event]] = defaultdict(list)
    for e in upcoming:
        events_by_sport[e.sport].append(e)

    matched = 0
    errors = []
    for sport, keys in by_sport.items():
        if not events_by_sport.get(sport):
            continue
        lines: list[MarketLine] = []
        for key in sorted(keys):
            try:
                lines += client.odds(key)
            except (httpx.HTTPError, ValueError) as exc:
                errors.append(f"{key}: {exc}")
        for e in events_by_sport[sport]:
            m = match_line(lines, e.home_name, e.away_name, as_utc(e.start_time))
            if not m:
                continue
            ln, swapped = m
            ph, pa = (ln.p_away, ln.p_home) if swapped else (ln.p_home, ln.p_away)
            pdraw = ln.p_draw if e.draw_possible else None
            if not e.draw_possible and ln.p_draw:
                ph, pa = ph / (ph + pa), pa / (ph + pa)
            session.add(OddsSnapshot(event_id=e.id, fetched_at=now, bookmakers=ln.bookmakers,
                                     p_home=ph, p_draw=pdraw, p_away=pa))
            matched += 1
    _mark(session, "the-odds-api", "*", "; ".join(errors) if errors else None)
    return {"matched": matched, "remaining_requests": client.remaining_requests, "errors": errors}


# --------------------------------------------------------------------------- predictions
def _game(e: Event) -> Game:
    return Game(event_id=e.id, league=e.league, competition=e.competition, start_time=as_utc(e.start_time),
                home_id=e.home_id, away_id=e.away_id, neutral=e.neutral, draw_possible=e.draw_possible,
                home_score=e.home_score, away_score=e.away_score, result=e.result)


def _latest_calibration(session: Session, sport: str) -> Calibration | None:
    return session.scalar(select(Calibration).where(Calibration.sport == sport)
                          .order_by(Calibration.fitted_at.desc(), Calibration.id.desc()).limit(1))


def _form(history_by_team: dict[str, list[Game]], team: str, n: int = 5) -> str:
    out = []
    for g in history_by_team.get(team, [])[-n:]:
        if g.result == "draw":
            out.append("D")
        elif (g.result == "home") == (g.home_id == team):
            out.append("W")
        else:
            out.append("L")
    return "".join(out)


def _h2h(history_by_team: dict[str, list[Game]], home: str, away: str, n: int = 5) -> dict:
    meetings = [g for g in history_by_team.get(home, []) if away in (g.home_id, g.away_id)][-n:]
    w = sum(1 for g in meetings if (g.result == "home") == (g.home_id == home) and g.result != "draw")
    d = sum(1 for g in meetings if g.result == "draw")
    return {"meetings": len(meetings), "home_side_wins": w, "draws": d, "away_side_wins": len(meetings) - w - d}


def confidence_score(*, min_games: int, model_ok: bool, market: OddsSnapshot | None,
                     skill: float | None, injuries_needed: bool, injuries_ok: bool) -> tuple[float, str]:
    """Reliability of a prediction (0-100). This is NOT a win probability."""
    score = 0.0
    if model_ok:
        score += 40 * min(1.0, min_games / 30)
    if market:
        score += 20 + (5 if market.bookmakers >= 5 else 0)
    if skill is not None:
        score += 25 * max(0.0, min(1.0, skill / 0.2))
    if not injuries_needed or injuries_ok:
        score += 10
    score = round(score, 1)
    label = "High" if score >= 70 else "Medium" if score >= 45 else "Low"
    return score, label


def _skill(summary: dict | None, three_way: bool) -> float | None:
    """Brier skill score vs. an uninformed forecast (uniform probabilities)."""
    if not summary or summary.get("n", 0) < 50:
        return None
    baseline = 2 / 3 if three_way else 0.5
    return 1 - summary["brier"] / baseline


def _hash(d: dict) -> str:
    return hashlib.sha256(json.dumps(d, sort_keys=True, default=str).encode()).hexdigest()


def predict_sport(session: Session, sport: str, settings: Settings, now: datetime | None = None) -> dict:
    now = now or utcnow()
    finished = session.scalars(select(Event).where(Event.sport == sport, Event.status == "final",
                                                   Event.start_time < now)).all()
    history = sorted((_game(e) for e in finished), key=lambda g: g.start_time)
    history_by_team: dict[str, list[Game]] = defaultdict(list)
    for g in history:
        if g.result in ("home", "away", "draw"):
            history_by_team[g.home_id].append(g)
            history_by_team[g.away_id].append(g)

    model = build_model(sport)
    backtest_window = timedelta(days=180 if sport == "soccer" else 365)
    model.fit(history, backtest_since=now - backtest_window)
    bt = model.backtest.summary()

    cal = _latest_calibration(session, sport)
    temperature = cal.temperature if cal else 1.0
    w_market = cal.market_weight if cal and cal.market_weight is not None else DEFAULT_MARKET_WEIGHT

    live = session.execute(select(func.count(), func.avg(GradedPrediction.brier))
                           .where(GradedPrediction.sport == sport)).one()
    skill_src = {"n": live[0], "brier": live[1]} if live[0] and live[0] >= 50 else bt

    upcoming = session.scalars(select(Event).where(
        Event.sport == sport, Event.status == "scheduled", Event.start_time > now,
        Event.start_time <= now + timedelta(days=settings.lookahead_days + 1))).all()

    injuries_by_league: dict[str, dict[str, list[Injury]]] = defaultdict(lambda: defaultdict(list))
    for inj in session.scalars(select(Injury).where(Injury.league.in_({e.league for e in upcoming}))).all():
        injuries_by_league[inj.league][inj.team_name].append(inj)

    written = 0
    for e in upcoming:
        g = _game(e)
        last_h = history_by_team.get(e.home_id, [])
        last_a = history_by_team.get(e.away_id, [])
        ctx = Context(
            home_rest_days=(g.start_time - last_h[-1].start_time).total_seconds() / 86400 if last_h else None,
            away_rest_days=(g.start_time - last_a[-1].start_time).total_seconds() / 86400 if last_a else None,
        )
        out = model.predict(g, ctx)
        min_games = min(out.home_games, out.away_games)
        model_ok = min_games >= model.min_games

        market = session.scalar(select(OddsSnapshot).where(
            OddsSnapshot.event_id == e.id, OddsSnapshot.fetched_at >= now - ODDS_MAX_AGE)
            .order_by(OddsSnapshot.fetched_at.desc(), OddsSnapshot.id.desc()).limit(1))

        keys = ("home", "draw", "away") if e.draw_possible else ("home", "away")
        p_model = {"home": out.p_home, "away": out.p_away}
        if e.draw_possible:
            p_model["draw"] = out.p_draw or 0.0
        p_market = None
        if market:
            p_market = {"home": market.p_home, "away": market.p_away}
            if e.draw_possible and market.p_draw is not None:
                p_market["draw"] = market.p_draw

        missing = []
        if not settings.odds_api_key:
            missing.append("Market odds not configured (ODDS_API_KEY unset)")
        elif not market:
            missing.append("No current bookmaker prices found for this event")
        if not model_ok:
            missing.append(f"Limited match history (fewest games: {min_games}, need {model.min_games})")

        league_inj = injuries_by_league.get(e.league, {})
        injuries_needed = sport in INJURY_LEAGUES_NEEDING_DATA and LEAGUES.get(e.league, None) is not None \
            and LEAGUES[e.league].injuries
        inj_status = session.scalar(select(SourceStatus).where(SourceStatus.source == "espn-injuries",
                                                               SourceStatus.scope == e.league))
        injuries_ok = bool(inj_status and inj_status.last_success
                           and as_utc(inj_status.last_success) >= now - timedelta(hours=settings.stale_after_hours))
        if injuries_needed and not injuries_ok:
            missing.append("Injury report unavailable")
        elif not injuries_needed:
            missing.append("Injury/lineup data not available for this competition")
        missing.append("Expected lineups are not modelled directly (reflected via market prices when available)")

        status = "ok"
        if model_ok:
            pooled = log_pool(p_model, p_market, w_market)
            basis = "model+market" if p_market else "model"
        elif p_market and set(p_market) == set(keys):
            pooled = dict(p_market)
            basis = "market"
        else:
            pooled = None
            basis = "none"
            status = "insufficient_data"

        conf, label = confidence_score(min_games=min_games, model_ok=model_ok, market=market,
                                       skill=_skill(skill_src, e.draw_possible),
                                       injuries_needed=injuries_needed, injuries_ok=injuries_ok)
        factors = {
            "basis": basis,
            "model": out.factors,
            "model_version": model.version,
            "games_in_history": {"home": out.home_games, "away": out.away_games},
            "form_last5": {"home": _form(history_by_team, e.home_id), "away": _form(history_by_team, e.away_id)},
            "head_to_head_last5": _h2h(history_by_team, e.home_id, e.away_id),
            "rest_days": {"home": _r(ctx.home_rest_days), "away": _r(ctx.away_rest_days)},
            "market": ({"bookmakers": market.bookmakers, "fetched_at": as_utc(market.fetched_at).isoformat(),
                        "weight": w_market} if market else None),
            "calibration_temperature": temperature,
            "injuries_reported": ({"home": _inj_count(league_inj, e.home_name),
                                   "away": _inj_count(league_inj, e.away_name)} if injuries_needed and injuries_ok
                                  else None),
            "notes": [
                "Form, head-to-head and injuries are shown for context; ratings already reflect results, "
                "and injury/lineup news enters through market prices.",
            ],
        }
        if pooled is not None:
            final = temper(pooled, temperature)
            predicted = max(keys, key=lambda k: final[k])
            win_prob = final[predicted]
        else:
            final, predicted, win_prob = {}, None, None

        digest = _hash({"p": {k: round(v, 4) for k, v in final.items()}, "status": status,
                        "conf": label, "missing": missing, "basis": basis})
        last = session.scalar(select(Prediction).where(Prediction.event_id == e.id)
                              .order_by(Prediction.created_at.desc(), Prediction.id.desc()).limit(1))
        if last is not None and last.inputs_hash == digest:
            continue
        session.add(Prediction(
            event_id=e.id, created_at=now, model_version=model.version, status=status,
            p_home=final.get("home"), p_draw=final.get("draw"), p_away=final.get("away"),
            p_model_home=p_model["home"] if model_ok else None,
            p_model_draw=p_model.get("draw") if model_ok else None,
            p_model_away=p_model["away"] if model_ok else None,
            p_market_home=p_market["home"] if p_market else None,
            p_market_draw=p_market.get("draw") if p_market else None,
            p_market_away=p_market["away"] if p_market else None,
            predicted=predicted, win_prob=win_prob, confidence=conf, confidence_label=label,
            factors=factors, missing=missing, inputs_hash=digest, inputs_as_of=now,
        ))
        written += 1

    session.add(ModelRun(sport=sport, run_at=now, model_version=model.version, history_games=len(history),
                         backtest=bt, predictions_written=written))
    session.flush()
    return {"sport": sport, "history": len(history), "upcoming": len(upcoming), "written": written,
            "backtest": bt}


def _r(x: float | None) -> float | None:
    return None if x is None else round(x, 1)


def _inj_count(by_team: dict[str, list[Injury]], team_name: str) -> int | None:
    rows = by_team.get(team_name)
    if rows is None:
        return 0
    return sum(1 for r in rows if any(s in r.status.lower() for s in OUT_STATUSES))


# --------------------------------------------------------------------------- grading
def _brier(p: dict[str, float], outcome: str) -> float:
    return sum((v - (1.0 if k == outcome else 0.0)) ** 2 for k, v in p.items())


def grade_finished(session: Session) -> dict:
    graded_ids = select(GradedPrediction.event_id)
    events = session.scalars(select(Event).where(Event.status == "final",
                                                 Event.result.in_(("home", "away", "draw")),
                                                 Event.id.not_in(graded_ids))).all()
    n = 0
    for e in events:
        pred = session.scalar(select(Prediction).where(
            Prediction.event_id == e.id, Prediction.status == "ok", Prediction.created_at < e.start_time)
            .order_by(Prediction.created_at.desc(), Prediction.id.desc()).limit(1))
        if pred is None:
            continue
        p = {"home": pred.p_home, "away": pred.p_away}
        if pred.p_draw is not None:
            p["draw"] = pred.p_draw
        if e.result not in p:
            continue
        model_p = market_p = None
        if pred.p_model_home is not None:
            model_p = {"home": pred.p_model_home, "away": pred.p_model_away}
            if pred.p_model_draw is not None:
                model_p["draw"] = pred.p_model_draw
        if pred.p_market_home is not None:
            market_p = {"home": pred.p_market_home, "away": pred.p_market_away}
            if pred.p_market_draw is not None:
                market_p["draw"] = pred.p_market_draw
        session.add(GradedPrediction(
            event_id=e.id, prediction_id=pred.id, sport=e.sport, league=e.league, outcome=e.result,
            predicted=pred.predicted, win_prob=pred.win_prob, p_outcome=p[e.result],
            correct=pred.predicted == e.result, brier=_brier(p, e.result),
            log_loss=-math.log(max(p[e.result], 1e-12)),
            market_brier=_brier(market_p, e.result) if market_p and e.result in market_p else None,
            model_brier=_brier(model_p, e.result) if model_p and e.result in model_p else None,
        ))
        n += 1
    session.flush()
    return {"graded": n}


def recalibrate(session: Session, sport: str) -> dict:
    rows = session.execute(select(Prediction, GradedPrediction.outcome)
                           .join(GradedPrediction, GradedPrediction.prediction_id == Prediction.id)
                           .where(GradedPrediction.sport == sport)).all()
    if len(rows) < MIN_GRADED_FOR_FIT:
        return {"sport": sport, "skipped": f"{len(rows)} graded (< {MIN_GRADED_FOR_FIT})"}

    def probs(pred: Prediction, prefix: str) -> dict[str, float] | None:
        h = getattr(pred, f"{prefix}_home")
        if h is None:
            return None
        p = {"home": h, "away": getattr(pred, f"{prefix}_away")}
        d = getattr(pred, f"{prefix}_draw")
        if d is not None:
            p["draw"] = d
        return p

    both = [(probs(p, "p_model"), probs(p, "p_market"), o) for p, o in rows
            if probs(p, "p_model") and probs(p, "p_market")]
    w = fit_market_weight(both) if len(both) >= MIN_GRADED_FOR_FIT else None
    w_use = w if w is not None else DEFAULT_MARKET_WEIGHT
    pooled = []
    for p, o in rows:
        m, mk = probs(p, "p_model"), probs(p, "p_market")
        base = log_pool(m, mk, w_use) if m else mk
        if base and o in base:
            pooled.append((base, o))
    t, before, after = fit_temperature(pooled)
    session.add(Calibration(sport=sport, n=len(pooled), temperature=t, market_weight=w,
                            log_loss_before=before, log_loss_after=after))
    return {"sport": sport, "n": len(pooled), "temperature": t, "market_weight": w}


# --------------------------------------------------------------------------- orchestration
def all_sports() -> list[str]:
    return list(SPORTS)
