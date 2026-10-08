from .base import Assessment, Param, Strategy, StrategySpec
from .conservation import Conservation
from .micro_saas import MicroSaaS
from .research_reports import ResearchReports
from .spot_momentum import SpotMomentum

REGISTRY: dict[str, Strategy] = {s.spec.key: s for s in (ResearchReports(), MicroSaaS(), SpotMomentum(), Conservation())}


def register(strategy: Strategy) -> None:
    """Add a reviewed strategy implementation. New strategies are disabled until
    the administrator adds them to policy.enabled_strategies."""
    REGISTRY[strategy.spec.key] = strategy


def get(key: str) -> Strategy:
    return REGISTRY[key]


__all__ = ["REGISTRY", "register", "get", "Strategy", "StrategySpec", "Param", "Assessment"]
