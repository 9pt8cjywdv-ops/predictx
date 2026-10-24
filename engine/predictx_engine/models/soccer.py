"""Football (soccer): time-weighted Poisson goals model with Dixon-Coles correction.

Each team has an attack and a defence strength. Expected goals:
    home λ = μ_home(league) · attack_home · defence_away
    away λ = μ_away(league) · attack_away · defence_home
Strengths are fitted by weighted maximum likelihood (iterative proportional
updates), with exponential time decay so recent form counts more, and Bayesian
shrinkage (pseudo-games at league average) so teams with few games are not
over-rated. Home/draw/away probabilities come from the score matrix.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta

from .base import Backtest, Context, Game, ModelOutput, SportModel

MAX_GOALS = 10


def poisson_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def dc_tau(x: int, y: int, lh: float, la: float, rho: float) -> float:
    if x == 0 and y == 0:
        return 1 - lh * la * rho
    if x == 0 and y == 1:
        return 1 + lh * rho
    if x == 1 and y == 0:
        return 1 + la * rho
    if x == 1 and y == 1:
        return 1 - rho
    return 1.0


def outcome_probs(lh: float, la: float, rho: float = -0.05) -> dict[str, float]:
    ph = pd = pa = 0.0
    hp = [poisson_pmf(i, lh) for i in range(MAX_GOALS + 1)]
    ap = [poisson_pmf(j, la) for j in range(MAX_GOALS + 1)]
    for i in range(MAX_GOALS + 1):
        for j in range(MAX_GOALS + 1):
            p = hp[i] * ap[j] * dc_tau(i, j, lh, la, rho)
            if i > j:
                ph += p
            elif i == j:
                pd += p
            else:
                pa += p
    t = ph + pd + pa
    return {"home": ph / t, "draw": pd / t, "away": pa / t}


class SoccerPoissonModel(SportModel):
    version = "soccer-poisson-dc-v1"
    min_games = 5

    def __init__(self, half_life_days: float = 240.0, prior_games: float = 4.0,
                 rho: float = -0.05, iterations: int = 40):
        self.decay = math.log(2) / half_life_days
        self.prior = prior_games
        self.rho = rho
        self.iterations = iterations
        self.attack: dict[str, float] = {}
        self.defence: dict[str, float] = {}
        self.mu: dict[str, tuple[float, float]] = {}
        self.mu_global = (1.5, 1.2)
        self.games: dict[str, int] = defaultdict(int)
        self.backtest = Backtest()

    def games_played(self, team_id: str) -> int:
        return self.games.get(team_id, 0)

    def _fit_at(self, games: list[Game], now: datetime) -> None:
        w = [math.exp(-self.decay * max((now - g.start_time).days, 0)) for g in games]
        # League goal averages (home and away), weighted.
        sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
        tot = [0.0, 0.0, 0.0]
        for g, wi in zip(games, w):
            s = sums[g.league]
            s[0] += wi * g.home_score
            s[1] += wi * g.away_score
            s[2] += wi
            tot[0] += wi * g.home_score
            tot[1] += wi * g.away_score
            tot[2] += wi
        if tot[2] == 0:
            return
        self.mu_global = (tot[0] / tot[2], tot[1] / tot[2])
        self.mu = {}
        for lg, (h, a, n) in sums.items():
            # Shrink league averages toward the global average (20 pseudo-games).
            k = 20.0
            self.mu[lg] = ((h + k * self.mu_global[0]) / (n + k), (a + k * self.mu_global[1]) / (n + k))

        teams = {g.home_id for g in games} | {g.away_id for g in games}
        att = {t: 1.0 for t in teams}
        dfn = {t: 1.0 for t in teams}
        for _ in range(self.iterations):
            gf = defaultdict(float)
            exp_gf = defaultdict(float)
            ga = defaultdict(float)
            exp_ga = defaultdict(float)
            for g, wi in zip(games, w):
                mh, ma = self._mu(g)
                # attack update terms: goals scored vs expected / attack
                gf[g.home_id] += wi * g.home_score
                exp_gf[g.home_id] += wi * mh * dfn[g.away_id]
                gf[g.away_id] += wi * g.away_score
                exp_gf[g.away_id] += wi * ma * dfn[g.home_id]
            for t in teams:
                att[t] = (gf[t] + self.prior * self._avg_rate()) / (exp_gf[t] + self.prior * self._avg_rate())
            for g, wi in zip(games, w):
                mh, ma = self._mu(g)
                ga[g.away_id] += wi * g.home_score
                exp_ga[g.away_id] += wi * mh * att[g.home_id]
                ga[g.home_id] += wi * g.away_score
                exp_ga[g.home_id] += wi * ma * att[g.away_id]
            for t in teams:
                dfn[t] = (ga[t] + self.prior * self._avg_rate()) / (exp_ga[t] + self.prior * self._avg_rate())
            # Identifiability: geometric mean attack = 1.
            gm = math.exp(sum(math.log(a) for a in att.values()) / len(att))
            for t in teams:
                att[t] /= gm
                dfn[t] *= gm
        self.attack, self.defence = att, dfn

    def _avg_rate(self) -> float:
        return (self.mu_global[0] + self.mu_global[1]) / 2

    def _mu(self, g: Game) -> tuple[float, float]:
        mh, ma = self.mu.get(g.league, self.mu_global)
        if g.neutral:
            m = (mh + ma) / 2
            return m, m
        return mh, ma

    def _lambdas(self, g: Game) -> tuple[float, float]:
        mh, ma = self._mu(g)
        lh = mh * self.attack.get(g.home_id, 1.0) * self.defence.get(g.away_id, 1.0)
        la = ma * self.attack.get(g.away_id, 1.0) * self.defence.get(g.home_id, 1.0)
        return lh, la

    def fit(self, history: list[Game], backtest_since: datetime | None = None) -> None:
        games = sorted(
            (g for g in history if g.result in ("home", "away", "draw")
             and g.home_score is not None and g.away_score is not None),
            key=lambda g: g.start_time)
        if backtest_since:
            # Walk-forward: refit every 14 days and score the following fortnight.
            cut = backtest_since
            end = games[-1].start_time if games else cut
            while cut <= end:
                past = [g for g in games if g.start_time < cut]
                nxt = [g for g in games if cut <= g.start_time < cut + timedelta(days=14)]
                if past and nxt:
                    self.games = defaultdict(int)
                    for g in past:
                        self.games[g.home_id] += 1
                        self.games[g.away_id] += 1
                    self._fit_at(past, cut)
                    for g in nxt:
                        if min(self.games[g.home_id], self.games[g.away_id]) >= self.min_games:
                            self.backtest.add(outcome_probs(*self._lambdas(g), self.rho), g.result)
                cut += timedelta(days=14)
        self.games = defaultdict(int)
        for g in games:
            self.games[g.home_id] += 1
            self.games[g.away_id] += 1
        if games:
            self._fit_at(games, games[-1].start_time)

    def predict(self, game: Game, ctx: Context) -> ModelOutput:
        lh, la = self._lambdas(game)
        p = outcome_probs(lh, la, self.rho)
        factors = {
            "expected_goals_home": round(lh, 2),
            "expected_goals_away": round(la, 2),
            "attack_home": round(self.attack.get(game.home_id, 1.0), 3),
            "defence_home": round(self.defence.get(game.home_id, 1.0), 3),
            "attack_away": round(self.attack.get(game.away_id, 1.0), 3),
            "defence_away": round(self.defence.get(game.away_id, 1.0), 3),
            "home_advantage": not game.neutral,
        }
        return ModelOutput(p["home"], p["draw"], p["away"], self.games_played(game.home_id),
                           self.games_played(game.away_id), factors)
