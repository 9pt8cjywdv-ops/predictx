"""Command line: `python -m predictx_engine.cli <command>`.

  init-db         create tables (and the immutability trigger on PostgreSQL)
  refresh         fetch fixtures/results, injuries, odds, then predict
  predict         grade + recalibrate + predict from data already stored
  check-sources   probe every configured data source and report what works
"""
import json
import logging
import sys
from datetime import timedelta

import httpx

from . import jobs
from .config import get_settings
from .db import init_db, utcnow
from .leagues import enabled_leagues
from .sources.espn import EspnClient
from .sources.odds_api import OddsApiClient


def check_sources() -> int:
    settings = get_settings()
    ok = True
    with httpx.Client(timeout=settings.http_timeout_s, headers={"User-Agent": jobs.USER_AGENT}) as http:
        espn = EspnClient(http)
        d = utcnow().date()
        for lg in enabled_leagues(settings.enabled_leagues):
            try:
                rep = espn.fetch_range(lg, d, d + timedelta(days=7))
                print(f"[ok]   espn {lg.key:16} next7d={len(rep.events):3} unparsed={rep.skipped}")
            except Exception as exc:  # noqa: BLE001 - report every failure
                ok = False
                print(f"[FAIL] espn {lg.key:16} {exc}")
        if settings.odds_api_key:
            try:
                sports = OddsApiClient(http, settings.odds_api_key).active_sports()
                print(f"[ok]   the-odds-api: {len(sports)} active sports")
            except Exception as exc:  # noqa: BLE001
                ok = False
                print(f"[FAIL] the-odds-api: {exc}")
        else:
            print("[skip] the-odds-api: ODDS_API_KEY not set")
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    cmd = argv[0] if argv else "help"
    if cmd == "init-db":
        init_db()
        print("database ready")
    elif cmd == "refresh":
        init_db()
        print(json.dumps(jobs.job_full_refresh(), indent=2, default=str))
    elif cmd == "predict":
        init_db()
        print(json.dumps(jobs.job_predict(), indent=2, default=str))
    elif cmd == "check-sources":
        return check_sources()
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
