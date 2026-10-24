"""Job entry points used by the scheduler worker, CLI and admin API."""
from __future__ import annotations

import logging

import httpx

from . import pipeline
from .config import Settings, get_settings
from .db import session_scope
from .leagues import enabled_leagues
from .sources.espn import EspnClient
from .sources.odds_api import OddsApiClient

log = logging.getLogger(__name__)

USER_AGENT = "PredictX-Sports/1.0 (+https://github.com/9pt8cjywdv-ops/predictx)"


def _http(settings: Settings) -> httpx.Client:
    return httpx.Client(timeout=settings.http_timeout_s, headers={"User-Agent": USER_AGENT},
                        follow_redirects=True)


def job_fixtures(settings: Settings | None = None) -> list[dict]:
    settings = settings or get_settings()
    out = []
    with _http(settings) as http:
        espn = EspnClient(http)
        for lg in enabled_leagues(settings.enabled_leagues):
            with session_scope() as s:
                out.append(pipeline.refresh_fixtures(s, espn, lg, settings))
    log.info("fixtures: %s", out)
    return out


def job_injuries(settings: Settings | None = None) -> list[dict]:
    settings = settings or get_settings()
    out = []
    with _http(settings) as http:
        espn = EspnClient(http)
        for lg in enabled_leagues(settings.enabled_leagues):
            if lg.injuries:
                with session_scope() as s:
                    out.append(pipeline.refresh_injuries(s, espn, lg))
    return out


def job_odds(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    if not settings.odds_api_key:
        return {"skipped": "ODDS_API_KEY not set"}
    with _http(settings) as http, session_scope() as s:
        client = OddsApiClient(http, settings.odds_api_key, settings.odds_api_regions)
        out = pipeline.refresh_odds(s, client, enabled_leagues(settings.enabled_leagues))
    log.info("odds: %s", out)
    return out


def job_predict(settings: Settings | None = None) -> list[dict]:
    """Grade finished events, recalibrate, then (re)predict upcoming ones."""
    settings = settings or get_settings()
    sports = sorted({lg.sport for lg in enabled_leagues(settings.enabled_leagues)})
    results = []
    with session_scope() as s:
        results.append(pipeline.grade_finished(s))
    for sport in sports:
        with session_scope() as s:
            results.append(pipeline.recalibrate(s, sport))
        with session_scope() as s:
            results.append(pipeline.predict_sport(s, sport, settings))
    log.info("predict: %s", results)
    return results


def job_full_refresh(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    return {
        "fixtures": job_fixtures(settings),
        "injuries": job_injuries(settings),
        "odds": job_odds(settings),
        "predict": job_predict(settings),
    }
