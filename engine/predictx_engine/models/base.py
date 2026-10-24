"""Shared types for the sport models."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Game:
    """A fixture or a finished result, independent of the storage layer."""

    event_id: str
    league: str
    competition: str
    start_time: datetime
    home_id: str
    away_id: str
    neutral: bool
    draw_possible: bool
    home_score: float | None = None
    away_score: float | None = None
    result: str | None = None  # home|away|draw|void


@dataclass
class Context:
    """Pre-match information computed from stored data for one fixture."""

    home_rest_days: float | None = None
    away_rest_days: float | None = None


@dataclass
class ModelOutput:
    p_home: float
    p_draw: float | None
    p_away: float
    home_games: int
    away_games: int
    factors: dict = field(default_factory=dict)

    def as_tuple(self) -> tuple[float, float, float]:
        return self.p_home, (self.p_draw or 0.0), self.p_away


@dataclass
class Backtest:
    """Walk-forward scores: each game scored with the probabilities the model
    would have produced before it was played."""

    n: int = 0
    brier_sum: float = 0.0
    logloss_sum: float = 0.0
    correct: int = 0

    def add(self, probs: dict[str, float], outcome: str) -> None:
        keys = [k for k in ("home", "draw", "away") if k in probs]
        if outcome not in keys:
            return
        self.n += 1
        self.brier_sum += sum((probs[k] - (1.0 if k == outcome else 0.0)) ** 2 for k in keys)
        self.logloss_sum += -math.log(max(probs[outcome], 1e-12))
        if max(keys, key=lambda k: probs[k]) == outcome:
            self.correct += 1

    def summary(self) -> dict | None:
        if not self.n:
            return None
        return {
            "n": self.n,
            "brier": self.brier_sum / self.n,
            "log_loss": self.logloss_sum / self.n,
            "accuracy": self.correct / self.n,
        }


class SportModel:
    version = "base"
    min_games = 5  # below this for either side (and no market) => Insufficient Data

    def fit(self, history: list[Game], backtest_since: datetime | None = None) -> None:
        raise NotImplementedError

    def predict(self, game: Game, ctx: Context) -> ModelOutput:
        raise NotImplementedError

    def games_played(self, team_id: str) -> int:
        raise NotImplementedError

    backtest: Backtest


def normalise(p: dict[str, float]) -> dict[str, float]:
    total = sum(p.values())
    return {k: v / total for k, v in p.items()}
