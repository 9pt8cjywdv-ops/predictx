from .base import Param, Strategy, StrategySpec


class SpotMomentum(Strategy):
    """Unleveraged spot momentum trading. Long-only, no margin, no shorting."""

    spec = StrategySpec(
        key="spot_momentum",
        name="Spot momentum (unleveraged)",
        category="crypto_trading",
        description="Long-only spot trend following with a stop-loss. Pays exchange fees on every trade.",
        params={
            "lookback_hours": Param(6, 72, 24, "momentum window"),
            "entry_threshold": Param(0.002, 0.05, 0.01, "minimum momentum to enter"),
            "position_fraction": Param(0.05, 0.5, 0.2, "fraction of available capital per entry"),
            "stop_loss_pct": Param(0.02, 0.2, 0.05, "exit if price falls this far below entry"),
        },
        markets=("BTC", "ETH", "SOL"),
        live_requirements=("exchange_api",),
        risk_level=0.45,
        est_fixed_cost_per_day_usd=0.05,
        compliance_notes="Own-capital spot trading only. Exchange account (KYC) must belong to the administrator.",
    )

    def on_hour(self, tb, params, state):
        sym = tb.market
        mom = tb.world_momentum(sym, int(params["lookback_hours"]))
        pos_qty = tb.position_qty(sym)
        price = tb.price(sym)
        if pos_qty > 0:
            entry = state.get("entry_price", price)
            if mom < 0 or price < entry * (1 - params["stop_loss_pct"]):
                tb.sell(sym, pos_qty)
                state.pop("entry_price", None)
        elif mom > params["entry_threshold"]:
            notional = int(tb.available() * params["position_fraction"])
            if notional >= 1_000_000:  # $1 minimum order
                tb.buy(sym, notional)
                state["entry_price"] = price
