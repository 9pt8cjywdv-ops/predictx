"""Money is stored as integer micro-USDC (6 decimals, matching the USDC token).

Floating point is never used for balances; only for display and for
simulation-model parameters.
"""
from decimal import ROUND_HALF_EVEN, Decimal

MICRO = 1_000_000


def usd(value) -> int:
    """Convert a dollar amount (str/int/float/Decimal) to integer micro-USDC."""
    return int((Decimal(str(value)) * MICRO).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def to_usd(micro: int) -> float:
    return micro / MICRO


def fmt(micro: int) -> str:
    sign = "-" if micro < 0 else ""
    return f"{sign}${abs(micro) / MICRO:,.2f}"


def bps(amount: int, basis_points: int) -> int:
    """Floor of amount * bps / 10_000 (never rounds a payout up)."""
    return (amount * basis_points) // 10_000
