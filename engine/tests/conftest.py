"""Test helpers. All data here is synthetic and exists only inside the test run."""
import os
import random
from datetime import datetime, timedelta, timezone

import pytest

from predictx_engine import db as dbmod
from predictx_engine.models.base import Game


@pytest.fixture()
def sqlite_db(tmp_path, monkeypatch):
    """Fresh database per test: SQLite by default, or TEST_DATABASE_URL (PostgreSQL)."""
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}"
    if url.startswith("postgresql"):
        from sqlalchemy import create_engine, text
        eng = create_engine(url)
        with eng.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
        eng.dispose()
    monkeypatch.setenv("DATABASE_URL", url)
    from predictx_engine.config import get_settings
    get_settings.cache_clear()
    dbmod._engine = None
    dbmod.init_db(url)
    yield url
    get_settings.cache_clear()
    dbmod._engine.dispose()
    dbmod._engine = None


def simulate_league(strengths: dict[str, float], *, rounds: int, start: datetime, sport: str,
                    league: str = "test", seed: int = 7, draws: bool = False, home_adv: float = 0.3,
                    goals: bool = False) -> list[Game]:
    """Round-robin games from known team strengths (logistic or Poisson)."""
    import math
    rng = random.Random(seed)
    teams = list(strengths)
    games, t = [], start
    for r in range(rounds):
        for i, h in enumerate(teams):
            for a in teams[i + 1:]:
                if r % 2:
                    h, a = a, h
                t += timedelta(hours=8)
                if goals:
                    lh = math.exp(0.25 + strengths[h] - strengths[a] / 2)
                    la = math.exp(0.05 + strengths[a] - strengths[h] / 2)
                    hs, as_ = _pois(rng, lh), _pois(rng, la)
                else:
                    p = 1 / (1 + math.exp(-(strengths[h] - strengths[a] + home_adv)))
                    hs, as_ = (1, 0) if rng.random() < p else (0, 1)
                    if draws and rng.random() < 0.03:
                        hs, as_ = 1, 1
                res = "home" if hs > as_ else "away" if as_ > hs else "draw"
                games.append(Game(f"g{len(games)}", league, "Test", t, f"{sport}:{h}", f"{sport}:{a}",
                                  False, draws, float(hs), float(as_), res))
    return games


def _pois(rng, lam):
    import math
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


UTC = timezone.utc
