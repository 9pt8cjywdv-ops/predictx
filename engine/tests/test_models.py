from datetime import datetime, timedelta

from predictx_engine.models.base import Context, Game
from predictx_engine.models.combine import fit_temperature, log_pool, temper
from predictx_engine.models.elo import EloModel, expected
from predictx_engine.models.soccer import SoccerPoissonModel, outcome_probs

from .conftest import UTC, simulate_league

START = datetime(2025, 1, 1, tzinfo=UTC)
STRENGTHS = {"A": 1.2, "B": 0.6, "C": 0.0, "D": -0.6, "E": -1.2}


def fixture(h, a, sport, draw=False, neutral=False, when=None):
    return Game("x", "test", "Test", when or START + timedelta(days=400), f"{sport}:{h}", f"{sport}:{a}",
                neutral, draw)


def test_expected_is_symmetric():
    assert abs(expected(0) - 0.5) < 1e-12
    assert abs(expected(100) + expected(-100) - 1) < 1e-12


def test_elo_learns_strength_order_and_sums_to_one():
    games = simulate_league(STRENGTHS, rounds=12, start=START, sport="basketball")
    m = EloModel("basketball")
    m.fit(games, backtest_since=START + timedelta(days=5))
    order = sorted(STRENGTHS, key=lambda t: -m.rating[f"basketball:{t}"])
    assert order[0] == "A" and order[-1] == "E"
    out = m.predict(fixture("A", "E", "basketball"), Context())
    assert abs(out.p_home + out.p_away - 1) < 1e-9
    assert out.p_home > 0.7
    bt = m.backtest.summary()
    assert bt and bt["accuracy"] > 0.6 and bt["brier"] < 0.5


def test_home_advantage_and_neutral():
    m = EloModel("nfl")
    home = m.predict(fixture("X", "Y", "nfl"), Context())
    neutral = m.predict(fixture("X", "Y", "nfl", neutral=True), Context())
    assert home.p_home > 0.5
    assert abs(neutral.p_home - 0.5) < 1e-9


def test_back_to_back_penalty_lowers_probability():
    m = EloModel("basketball")
    rested = m.predict(fixture("X", "Y", "basketball"), Context(home_rest_days=2, away_rest_days=2))
    tired = m.predict(fixture("X", "Y", "basketball"), Context(home_rest_days=1, away_rest_days=2))
    assert tired.p_home < rested.p_home


def test_offseason_regression_is_not_cumulative():
    games = simulate_league(STRENGTHS, rounds=6, start=START, sport="nfl")
    m = EloModel("nfl")
    m.fit(games)
    later = games[-1].start_time + timedelta(days=200)
    a = m.predict(fixture("A", "E", "nfl", when=later), Context()).p_home
    b = m.predict(fixture("A", "E", "nfl", when=later), Context()).p_home
    assert a == b


def test_rugby_three_way_sums_to_one():
    games = simulate_league(STRENGTHS, rounds=6, start=START, sport="rugby", draws=True)
    m = EloModel("rugby")
    m.fit(games)
    out = m.predict(fixture("C", "D", "rugby", draw=True), Context())
    assert out.p_draw is not None and 0 < out.p_draw < 0.1
    assert abs(sum(out.as_tuple()) - 1) < 1e-9


def test_tennis_dynamic_k_no_home_advantage():
    m = EloModel("tennis")
    out = m.predict(fixture("P1", "P2", "tennis", neutral=True), Context())
    assert out.p_home == 0.5


def test_poisson_outcomes_sum_to_one():
    p = outcome_probs(1.6, 1.1)
    assert abs(sum(p.values()) - 1) < 1e-9
    assert p["home"] > p["away"]


def test_soccer_model_recovers_strengths():
    mild = {k: v / 3 for k, v in STRENGTHS.items()}
    games = simulate_league(mild, rounds=10, start=START, sport="soccer", goals=True, draws=True)
    m = SoccerPoissonModel()
    m.fit(games, backtest_since=START + timedelta(days=10))
    strong = m.predict(fixture("A", "E", "soccer", draw=True, when=games[-1].start_time + timedelta(days=3)),
                       Context())
    assert strong.p_home > 0.6 and strong.p_draw > 0.05
    assert abs(strong.p_home + strong.p_draw + strong.p_away - 1) < 1e-9
    assert m.attack["soccer:A"] > m.attack["soccer:E"]
    assert m.backtest.summary()["n"] > 0


def test_log_pool_and_temperature():
    model = {"home": 0.7, "away": 0.3}
    market = {"home": 0.5, "away": 0.5}
    pooled = log_pool(model, market, 0.5)
    assert 0.5 < pooled["home"] < 0.7
    assert log_pool(model, None, 0.5) == model
    soft = temper({"home": 0.8, "away": 0.2}, 2.0)
    assert 0.5 < soft["home"] < 0.8


def test_log_pool_keeps_model_draw_when_market_two_way():
    model = {"home": 0.5, "draw": 0.2, "away": 0.3}
    out = log_pool(model, {"home": 0.6, "away": 0.4}, 0.5)
    assert abs(out["draw"] - 0.2) < 1e-12 and abs(sum(out.values()) - 1) < 1e-9


def test_fit_temperature_softens_overconfidence():
    # Says 90% but is right 60% of the time.
    rows = [({"home": 0.9, "away": 0.1}, "home")] * 60 + [({"home": 0.9, "away": 0.1}, "away")] * 40
    t, before, after = fit_temperature(rows)
    assert t > 1.5 and after < before


def test_recalibrate_needs_enough_results(sqlite_db):
    from predictx_engine import pipeline
    from predictx_engine.db import session_scope
    with session_scope() as s:
        assert "skipped" in pipeline.recalibrate(s, "basketball")
