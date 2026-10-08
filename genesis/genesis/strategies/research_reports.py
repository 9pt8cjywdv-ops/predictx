from ..money import usd
from .base import Param, Strategy, StrategySpec


class ResearchReports(Strategy):
    """AI-powered research service: sells niche research/analysis reports
    produced with Claude. Revenue is recognized only from verified payments."""

    spec = StrategySpec(
        key="research_reports",
        name="AI research reports",
        category="ai_service",
        description="Produce and sell niche market-research / document-analysis reports.",
        params={
            "price_usd": Param(5, 60, 19, "price per report"),
            "marketing_per_day_usd": Param(0, 3, 0.5, "daily paid-acquisition budget"),
            "quality": Param(0, 1, 0.4, "0 = cheapest model, 1 = most capable model"),
        },
        markets=("ecommerce-sellers", "real-estate-agents", "crypto-funds", "indie-saas", "law-firms",
                 "restaurants", "biotech-startups", "logistics-smes", "dental-clinics", "edtech"),
        live_requirements=("payment_processor", "storefront_hosting"),
        public_facing=True,
        risk_level=0.25,
        est_fixed_cost_per_day_usd=0.55,
        compliance_notes="Reports must carry 'not financial/legal advice' disclaimers; no unsolicited outreach.",
    )

    HOSTING_PER_DAY = 0.03
    PROCESSOR_PCT = 0.029
    PROCESSOR_FIXED = 0.30

    def on_day(self, tb, params, state):
        rep = state.get("reputation", 0.0) * 0.99
        mkt = params["marketing_per_day_usd"]
        tb.spend("hosting", usd(self.HOSTING_PER_DAY), "storefront hosting")
        if mkt > 0:
            mkt = tb.spend_up_to("marketing", usd(mkt), "paid acquisition")
        sales = tb.world_demand("research_report_sales", price=params["price_usd"], marketing=mkt / 1e6,
                                quality=params["quality"], reputation=rep)
        unit_cost = 0.02 + 0.28 * params["quality"]
        for _ in range(sales):
            tb.record_sale(usd(params["price_usd"]), product="research_report")
            tb.spend("payment_fees", usd(params["price_usd"] * self.PROCESSOR_PCT + self.PROCESSOR_FIXED), "card processing")
            tb.spend("claude_api", usd(unit_cost), "report production")
            rep = min(2.0, rep + 0.02)
        state["reputation"] = round(rep, 4)
        state["lifetime_sales"] = state.get("lifetime_sales", 0) + sales
