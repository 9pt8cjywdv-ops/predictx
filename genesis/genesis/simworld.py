"""Simulation environment: virtual markets and customer demand.

Everything here is an *assumption-driven model*, not a forecast. Parameters
are deliberately conservative: zero-drift prices (so trading is a fee-losing
game on average) and low, niche-dependent customer demand with a cold start.
Simulation results demonstrate the mechanics of the ecosystem, not real-world
profitability.
"""
import hashlib
import hmac
import math
import random
from collections import deque
from dataclasses import dataclass

SYMBOLS = {"BTC": (60_000.0, 0.60), "ETH": (3_000.0, 0.75), "SOL": (150.0, 0.95)}
HOURS_PER_YEAR = 24 * 365


@dataclass(frozen=True)
class RevenueEvidence:
    """Proof of an external payment. Only verifiers (the simulated market, or a
    live payment/exchange integration) can produce a valid signature."""

    source: str
    reference: str
    amount: int
    payer: str
    signature: str

    def payload(self) -> bytes:
        return f"{self.source}|{self.reference}|{self.amount}|{self.payer}".encode()


class EvidenceSigner:
    def __init__(self, source: str, key: bytes):
        self.source = source
        self._key = key

    def issue(self, reference: str, amount: int, payer: str) -> RevenueEvidence:
        ev = RevenueEvidence(self.source, reference, amount, payer, "")
        sig = hmac.new(self._key, ev.payload(), hashlib.sha256).hexdigest()
        return RevenueEvidence(self.source, reference, amount, payer, sig)

    def verify(self, ev: RevenueEvidence) -> bool:
        expected = hmac.new(self._key, ev.payload(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, ev.signature)


class SimWorld:
    def __init__(self, seed: int = 42, prices: dict | None = None):
        self.seed = seed
        self.rng = random.Random(seed)
        self.prices = dict(prices) if prices else {k: v[0] for k, v in SYMBOLS.items()}
        self.history: dict[str, deque] = {k: deque([self.prices[k]], maxlen=200) for k in SYMBOLS}
        self.evidence = EvidenceSigner("simulation", hashlib.sha256(f"sim-evidence-{seed}-{random.random()}".encode()).digest())
        self._sale_counter = 0

    # ----------------------------------------------------------- market
    def step(self, hours: int = 1) -> None:
        for _ in range(hours):
            for sym, (_, vol) in SYMBOLS.items():
                sigma = vol / math.sqrt(HOURS_PER_YEAR)
                # zero-drift geometric Brownian motion (mu = 0 => E[price] constant)
                shock = self.rng.gauss(0.0, 1.0)
                self.prices[sym] *= math.exp(-0.5 * sigma * sigma + sigma * shock)
                self.history[sym].append(self.prices[sym])

    def price(self, symbol: str) -> float:
        return self.prices[symbol]

    def momentum(self, symbol: str, lookback: int) -> float:
        h = self.history[symbol]
        if len(h) <= lookback:
            return 0.0
        return h[-1] / h[-1 - lookback] - 1.0

    # ----------------------------------------------------------- demand
    def niche_quality(self, market: str) -> float:
        """Hidden attractiveness of a target market. Lognormal: most niches are
        mediocre, a few are good. Deterministic per (seed, market)."""
        h = int(hashlib.sha256(f"{self.seed}:{market}".encode()).hexdigest()[:12], 16)
        r = random.Random(h)
        return math.exp(r.gauss(math.log(0.45), 0.9))

    def _poisson(self, lam: float) -> int:
        if lam <= 0:
            return 0
        l, k, p = math.exp(-lam), 0, 1.0
        while True:
            p *= self.rng.random()
            if p <= l:
                return k
            k += 1

    def research_report_sales(self, market: str, price: float, marketing: float, quality: float, reputation: float) -> int:
        lam = self.niche_quality(market) * 0.25 * (0.2 + math.sqrt(max(marketing, 0))) * (0.5 + quality)
        lam *= math.exp(-price / 25.0) * (1.0 + reputation)
        return self._poisson(lam)

    def saas_signups(self, market: str, price: float, marketing: float, build_quality: float, subscribers: int) -> int:
        lam = self.niche_quality(market) * 0.12 * (0.2 + math.sqrt(max(marketing, 0))) * math.exp(-price / 20.0)
        lam *= (0.5 + build_quality) * (1.0 + 0.02 * subscribers)
        return self._poisson(lam)

    def churned(self, monthly_churn: float = 0.08) -> bool:
        return self.rng.random() < monthly_churn

    def issue_sale(self, agent_id: str, amount: int, product: str) -> RevenueEvidence:
        self._sale_counter += 1
        ref = f"sim-sale-{self.seed}-{agent_id}-{self._sale_counter}-{self.rng.getrandbits(32):08x}"
        return self.evidence.issue(ref, amount, payer=f"sim-customer:{product}")
