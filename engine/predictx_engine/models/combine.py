"""Combining the statistical model with market prices, and calibration.

* Market blend: logarithmic opinion pool  p ∝ p_model^(1-w) · p_market^w.
  The market weight w starts at a prior and is refitted per sport (by minimising
  log loss over graded predictions) once enough results exist. The model is never
  replaced by the market: favourites are not assumed to win.
* Calibration: temperature scaling  p ∝ p^(1/T), fitted per sport on graded
  predictions. T > 1 softens over-confident probabilities, T < 1 sharpens.
"""
from __future__ import annotations

import math

DEFAULT_MARKET_WEIGHT = 0.5
MIN_GRADED_FOR_FIT = 150


def _norm(p: dict[str, float]) -> dict[str, float]:
    t = sum(p.values())
    return {k: v / t for k, v in p.items()}


def log_pool(model: dict[str, float], market: dict[str, float] | None, w: float) -> dict[str, float]:
    if not market:
        return dict(model)
    keys = model.keys()
    if set(keys) != set(market.keys()):
        # e.g. market quotes no draw. Pool the two-way part and keep the model's
        # draw probability.
        if "draw" in model and "draw" not in market:
            two = _norm({k: model[k] for k in ("home", "away")})
            pooled = log_pool(two, market, w)
            return {"home": pooled["home"] * (1 - model["draw"]), "draw": model["draw"],
                    "away": pooled["away"] * (1 - model["draw"])}
        return dict(model)
    out = {k: math.exp((1 - w) * math.log(max(model[k], 1e-9)) + w * math.log(max(market[k], 1e-9)))
           for k in keys}
    return _norm(out)


def temper(p: dict[str, float], temperature: float) -> dict[str, float]:
    if abs(temperature - 1.0) < 1e-9:
        return dict(p)
    return _norm({k: max(v, 1e-12) ** (1.0 / temperature) for k, v in p.items()})


def log_loss(rows: list[tuple[dict[str, float], str]]) -> float:
    return sum(-math.log(max(p.get(o, 0.0), 1e-12)) for p, o in rows) / len(rows)


def fit_temperature(rows: list[tuple[dict[str, float], str]]) -> tuple[float, float, float]:
    """Grid + golden refinement. Returns (T, loss_before, loss_after)."""
    before = log_loss(rows)
    best_t, best = 1.0, before
    for i in range(50, 301, 5):
        t = i / 100
        loss = log_loss([(temper(p, t), o) for p, o in rows])
        if loss < best:
            best_t, best = t, loss
    return best_t, before, best


def fit_market_weight(rows: list[tuple[dict[str, float], dict[str, float], str]]) -> float:
    """rows = (model probs, market probs, outcome)."""
    best_w, best = DEFAULT_MARKET_WEIGHT, float("inf")
    for i in range(0, 101, 5):
        w = i / 100
        loss = log_loss([(log_pool(m, mk, w), o) for m, mk, o in rows])
        if loss < best:
            best_w, best = w, loss
    return best_w
