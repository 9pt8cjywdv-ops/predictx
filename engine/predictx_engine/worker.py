"""Scheduler process: `python -m predictx_engine.worker`.

Runs one full refresh on start, then keeps fixtures/results, injuries and odds up to
date, re-running predictions after each data refresh. Predictions are only written
when their inputs actually change.
"""
import logging
import signal
import threading

from apscheduler.schedulers.background import BackgroundScheduler

from . import jobs
from .config import get_settings
from .db import init_db

log = logging.getLogger("predictx.worker")
_lock = threading.Lock()


def _run(*steps):
    def job():
        if not _lock.acquire(blocking=False):
            log.info("previous job still running; skipping this tick")
            return
        try:
            for step in steps:
                step()
            jobs.job_predict()
        except Exception:  # keep the scheduler alive; the error is in source_status/logs
            log.exception("job failed")
        finally:
            _lock.release()
    return job


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    init_db()
    _run(jobs.job_fixtures, jobs.job_injuries, jobs.job_odds)()

    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(_run(jobs.job_fixtures), "interval", minutes=settings.fixtures_interval_min, id="fixtures")
    sched.add_job(_run(jobs.job_injuries), "interval", minutes=settings.injuries_interval_min, id="injuries")
    sched.add_job(_run(jobs.job_odds), "interval", minutes=settings.odds_interval_min, id="odds")
    sched.start()
    log.info("scheduler started")

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    stop.wait()
    sched.shutdown()


if __name__ == "__main__":
    main()
