from ..money import usd
from .base import Param, Strategy, StrategySpec


class MicroSaaS(Strategy):
    """Builds a small subscription software utility, then sells subscriptions."""

    spec = StrategySpec(
        key="micro_saas",
        name="Micro-SaaS utility",
        category="digital_business",
        description="Build and operate a niche subscription web utility.",
        params={
            "monthly_price_usd": Param(3, 49, 9, "subscription price"),
            "marketing_per_day_usd": Param(0, 3, 0.4, "daily paid-acquisition budget"),
            "build_budget_usd": Param(2, 20, 5, "one-off build spend (model + compute)"),
        },
        markets=("shopify-merchants", "podcasters", "freelance-designers", "tutors", "property-managers",
                 "fitness-coaches", "etsy-sellers", "accountants", "youtubers", "nonprofits"),
        live_requirements=("payment_processor", "app_hosting", "code_repository", "domain"),
        public_facing=True,
        risk_level=0.35,
        est_fixed_cost_per_day_usd=0.5,
        compliance_notes="Needs privacy policy, ToS and data-protection review before public launch.",
    )

    HOSTING_PER_DAY = 0.05
    BUILD_DAYS = 5

    def on_day(self, tb, params, state):
        if not state.get("built"):
            daily = usd(params["build_budget_usd"] / self.BUILD_DAYS)
            tb.spend("claude_api", daily * 7 // 10, "product build: code generation")
            tb.spend("compute", daily - daily * 7 // 10, "product build: test runs")
            state["build_days"] = state.get("build_days", 0) + 1
            state["build_quality"] = min(1.0, params["build_budget_usd"] / 12)
            if state["build_days"] >= self.BUILD_DAYS:
                state["built"] = True
                tb.log("milestone", "product build complete (passed isolated test stage)")
            return
        tb.spend("software", usd(self.HOSTING_PER_DAY), "app hosting")
        mkt = params["marketing_per_day_usd"]
        if mkt > 0:
            mkt = tb.spend_up_to("marketing", usd(mkt), "paid acquisition")
        subs = state.setdefault("subscribers", [])  # list of days-until-renewal
        price = usd(params["monthly_price_usd"])
        renewed = []
        for days_left in subs:
            days_left -= 1
            if days_left <= 0:
                if tb.world_churned():
                    continue
                tb.record_sale(price, product="saas_renewal")
                tb.spend("payment_fees", price * 29 // 1000 + usd(0.30), "card processing")
                days_left = 30
            renewed.append(days_left)
        new = tb.world_demand("saas_signups", price=params["monthly_price_usd"], marketing=mkt / 1e6,
                              build_quality=state.get("build_quality", 0.5), subscribers=len(renewed))
        for _ in range(new):
            tb.record_sale(price, product="saas_subscription")
            tb.spend("payment_fees", price * 29 // 1000 + usd(0.30), "card processing")
            renewed.append(30)
        state["subscribers"] = renewed
        state["subscriber_count"] = len(renewed)
