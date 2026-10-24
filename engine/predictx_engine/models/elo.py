"""Elo-family models for rugby, tennis, basketball, cricket, NFL and MLB.

Each sport has its own parameters (K-factor, home advantage, margin-of-victory
multiplier, off-season regression, rest effects). Defaults follow published
methodologies — FiveThirtyEight's NBA/NFL/MLB/tennis Elo and World Rugby-style
international ratings — and are starting priors: the calibration layer refits the
final probabilities against this system's own graded predictions.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

from .base import Backtest, Context, Game, ModelOutput, SportModel


@dataclass(frozen=True)
class EloParams:
    k: float
    home_adv: float
    mov: str | None = None  # None | "log" | "nba"
    offseason_days: float = 75
    regress: float = 0.25  # fraction pulled to the mean after an off-season gap
    dynamic_k: bool = False  # tennis: K shrinks with experience
    back_to_back_penalty: float = 0.0  # Elo points, applied when rest < 1.5 days
    long_rest_bonus: float = 0.0  # Elo points, applied when rest >= long_rest_days
    long_rest_days: float = 10.0
    # Draws: Beta prior for the draw rate of evenly-matched games.
    draw_prior_mean: float = 0.0
    draw_prior_weight: float = 0.0
    draw_width: float = 200.0  # Elo gap at which the draw rate falls to ~37%


PARAMS: dict[str, EloParams] = {
    "rugby": EloParams(k=32, home_adv=60, mov="log", offseason_days=60, regress=0.2,
                       draw_prior_mean=0.03, draw_prior_weight=40, draw_width=150),
    "tennis": EloParams(k=0, home_adv=0, dynamic_k=True, offseason_days=10_000, regress=0.0),
    "basketball": EloParams(k=20, home_adv=70, mov="nba", offseason_days=90, regress=0.25,
                            back_to_back_penalty=25),
    "cricket": EloParams(k=28, home_adv=45, offseason_days=10_000, regress=0.0,
                         draw_prior_mean=0.15, draw_prior_weight=20, draw_width=10_000),
    "nfl": EloParams(k=20, home_adv=48, mov="log", offseason_days=120, regress=1 / 3,
                     long_rest_bonus=25, long_rest_days=12),
    "baseball": EloParams(k=4, home_adv=24, mov="log", offseason_days=90, regress=1 / 3),
}


def expected(diff: float) -> float:
    return 1.0 / (1.0 + 10 ** (-diff / 400.0))


class EloModel(SportModel):
    def __init__(self, sport: str, params: EloParams | None = None):
        self.sport = sport
        self.p = params or PARAMS[sport]
        self.version = f"{sport}-elo-v1"
        self.rating: dict[str, float] = defaultdict(lambda: 1500.0)
        self.games: dict[str, int] = defaultdict(int)
        self.last: dict[str, datetime] = {}
        self.draws = 0
        self.draw_eligible = 0
        self.backtest = Backtest()

    # --- state helpers
    def games_played(self, team_id: str) -> int:
        return self.games.get(team_id, 0)

    def _effective(self, team: str, when: datetime) -> float:
        """Rating at `when`, regressed toward the mean after an off-season gap."""
        r = self.rating[team]
        last = self.last.get(team)
        if last and self.p.regress and (when - last).days >= self.p.offseason_days:
            r += (1500.0 - r) * self.p.regress
        return r

    def _k(self, team: str) -> float:
        if self.p.dynamic_k:
            return 250.0 / (self.games[team] + 5) ** 0.4
        return self.p.k

    def _mov_mult(self, margin: float | None, winner_diff: float) -> float:
        if margin is None or self.p.mov is None:
            return 1.0
        m = abs(margin)
        if self.p.mov == "nba":
            return ((m + 3) ** 0.8) / (7.5 + 0.006 * winner_diff)
        return math.log(m + 1) * 2.2 / (winner_diff * 0.001 + 2.2)

    def draw_rate(self) -> float:
        a = self.p.draw_prior_mean * self.p.draw_prior_weight + self.draws
        b = self.p.draw_prior_weight + self.draw_eligible
        return a / b if b else 0.0

    def _rest_adj(self, rest: float | None) -> float:
        if rest is None:
            return 0.0
        if rest < 1.5 and self.p.back_to_back_penalty:
            return -self.p.back_to_back_penalty
        if rest >= self.p.long_rest_days and self.p.long_rest_bonus:
            return self.p.long_rest_bonus
        return 0.0

    def _diff(self, g: Game, ctx: Context | None) -> tuple[float, dict]:
        hfa = 0.0 if g.neutral else self.p.home_adv
        rh, ra = self._effective(g.home_id, g.start_time), self._effective(g.away_id, g.start_time)
        rest_h = self._rest_adj(ctx.home_rest_days) if ctx else 0.0
        rest_a = self._rest_adj(ctx.away_rest_days) if ctx else 0.0
        diff = rh + hfa + rest_h - (ra + rest_a)
        return diff, {"home_rating": round(rh, 1), "away_rating": round(ra, 1),
                      "home_advantage_elo": hfa, "rest_adj_home": rest_h, "rest_adj_away": rest_a}

    def _probs(self, g: Game, diff: float) -> dict[str, float]:
        e = expected(diff)
        if not g.draw_possible:
            return {"home": e, "away": 1 - e}
        pd = self.draw_rate() * math.exp(-((diff / self.p.draw_width) ** 2))
        return {"home": (1 - pd) * e, "draw": pd, "away": (1 - pd) * (1 - e)}

    # --- API
    def fit(self, history: list[Game], backtest_since: datetime | None = None) -> None:
        last_rest: dict[str, datetime] = {}
        for g in sorted(history, key=lambda x: x.start_time):
            if g.result not in ("home", "away", "draw"):
                continue
            for t in (g.home_id, g.away_id):
                self.rating[t] = self._effective(t, g.start_time)
                self.last[t] = g.start_time  # so the regression is applied once
            ctx = Context(
                home_rest_days=_days(last_rest.get(g.home_id), g.start_time),
                away_rest_days=_days(last_rest.get(g.away_id), g.start_time),
            )
            diff, _ = self._diff(g, ctx)
            if backtest_since and g.start_time >= backtest_since and \
                    min(self.games[g.home_id], self.games[g.away_id]) >= self.min_games:
                self.backtest.add(self._probs(g, diff), g.result)
            e = expected(diff)
            score = {"home": 1.0, "away": 0.0, "draw": 0.5}[g.result]
            margin = None
            if g.home_score is not None and g.away_score is not None:
                margin = g.home_score - g.away_score
            winner_diff = diff if score == 1.0 else -diff
            mult = self._mov_mult(margin, winner_diff) if g.result != "draw" else 1.0
            kh, ka = self._k(g.home_id), self._k(g.away_id)
            self.rating[g.home_id] += kh * mult * (score - e)
            self.rating[g.away_id] -= ka * mult * (score - e)
            if g.draw_possible:
                self.draw_eligible += 1
                self.draws += g.result == "draw"
            for t in (g.home_id, g.away_id):
                self.games[t] += 1
                self.last[t] = g.start_time
                last_rest[t] = g.start_time

    def predict(self, game: Game, ctx: Context) -> ModelOutput:
        diff, factors = self._diff(game, ctx)
        p = self._probs(game, diff)
        factors |= {"elo_diff": round(diff, 1)}
        if game.draw_possible:
            factors["base_draw_rate"] = round(self.draw_rate(), 4)
        return ModelOutput(p["home"], p.get("draw"), p["away"],
                           self.games_played(game.home_id), self.games_played(game.away_id), factors)


def _days(prev: datetime | None, now: datetime) -> float | None:
    return None if prev is None else (now - prev).total_seconds() / 86400.0
