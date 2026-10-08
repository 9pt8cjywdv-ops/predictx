from .base import Strategy, StrategySpec


class Conservation(Strategy):
    """Pause revenue attempts and minimise spend while re-planning."""

    spec = StrategySpec(
        key="conservation",
        name="Capital conservation",
        category="defensive",
        description="No revenue activity; only unavoidable base costs. Used while re-planning.",
        params={},
        markets=("none",),
        risk_level=0.0,
        est_fixed_cost_per_day_usd=0.02,
    )
