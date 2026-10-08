"""Strategy plug-in framework.

A strategy is reviewed, version-controlled code. Agents (and Claude) can only
*choose* a strategy and tune its declared parameters inside declared bounds;
they cannot alter strategy code at runtime. Every money-moving action a
strategy takes goes through the Toolbox, which GENESIS CORE validates.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Param:
    lo: float
    hi: float
    default: float
    description: str = ""

    def clamp(self, value) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return self.default
        if v != v:  # NaN
            return self.default
        return min(self.hi, max(self.lo, v))


@dataclass(frozen=True)
class StrategySpec:
    key: str
    name: str
    category: str
    description: str
    params: dict[str, Param]
    markets: tuple[str, ...]
    live_requirements: tuple[str, ...] = ()
    regulated: bool = False  # requires licensing/registration => disabled until authorized
    public_facing: bool = False  # needs security & compliance review before live deployment
    risk_level: float = 0.3  # 0..1, compared with the agent's risk tolerance
    est_fixed_cost_per_day_usd: float = 0.0
    compliance_notes: str = ""


@dataclass
class Assessment:
    """The 8-step opportunity evaluation (steps 1-6 are computed here; 7-8
    happen through the small-scale test and performance evaluation)."""

    feasibility: str
    est_cost_per_day_usd: float
    risk_score: float
    compliance: dict
    expected_revenue_per_day_usd: float
    expected_revenue_basis: str
    break_even_days: float | None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class Strategy:
    spec: StrategySpec

    def default_params(self) -> dict:
        return {k: p.default for k, p in self.spec.params.items()}

    def clamp_params(self, params: dict | None) -> dict:
        params = params or {}
        return {k: p.clamp(params.get(k, p.default)) for k, p in self.spec.params.items()}

    def on_hour(self, tb, params: dict, state: dict) -> None:
        """Hourly hook (trading strategies)."""

    def on_day(self, tb, params: dict, state: dict) -> None:
        """Daily hook (business strategies)."""

    def assess(self, *, mode: str, ecosystem_stats: dict, risk_tolerance: float) -> Assessment:
        spec = self.spec
        stats = ecosystem_stats.get(spec.key)
        if stats and stats.get("agent_days", 0) >= 7:
            exp_rev = stats["revenue_per_agent_day"]
            exp_cost = stats["cost_per_agent_day"]
            basis = f"observed: {stats['agent_days']} agent-days across the ecosystem"
        else:
            exp_rev = 0.0
            exp_cost = spec.est_fixed_cost_per_day_usd
            basis = "no evidence yet - revenue assumed zero until tested"
        net = exp_rev - exp_cost
        missing = [r for r in spec.live_requirements] if mode == "live" else []
        compliance = {
            "regulated": spec.regulated,
            "requires_authorization": spec.regulated or (mode == "live" and spec.public_facing),
            "missing_integrations": missing,
            "notes": spec.compliance_notes,
        }
        feasible = "feasible" if not missing else "blocked: awaiting integrations " + ", ".join(missing)
        notes = []
        if spec.risk_level > risk_tolerance:
            notes.append("risk above agent tolerance")
        return Assessment(
            feasibility=feasible,
            est_cost_per_day_usd=round(exp_cost, 4),
            risk_score=spec.risk_level,
            compliance=compliance,
            expected_revenue_per_day_usd=round(exp_rev, 4),
            expected_revenue_basis=basis,
            break_even_days=None if net <= 0 else 0.0,
            notes=notes,
        )
