"""Registry of sports and competitions.

Adding a competition = adding a League entry. Adding a sport = adding a model in
predictx_engine/models/ and listing it in SPORTS below.

ESPN paths are the `{sport}/{league}` segment of
https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard.
ESPN's endpoints are public but undocumented; if a path stops returning events,
check it with `python -m predictx_engine.cli check-sources` and update it here.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Sport:
    key: str
    name: str
    # Outcomes the dashboard shows. Three-way sports also get a draw probability.
    three_way: bool
    model: str  # key into models.registry


SPORTS: dict[str, Sport] = {
    s.key: s
    for s in [
        Sport("soccer", "Football (Soccer)", True, "soccer_poisson"),
        Sport("rugby", "Rugby Union", True, "rugby_elo"),
        Sport("tennis", "Tennis", False, "tennis_elo"),
        Sport("basketball", "Basketball", False, "basketball_elo"),
        Sport("cricket", "Cricket", False, "cricket_elo"),
        Sport("nfl", "American Football", False, "nfl_elo"),
        Sport("baseball", "Baseball", False, "baseball_elo"),
    ]
}


@dataclass(frozen=True)
class League:
    key: str
    sport: str
    name: str
    espn_path: str | None
    # "scoreboard": standard team-vs-team scoreboard; "tennis": events grouped by
    # tournament; "header": ESPN's live header feed (used for cricket, whose series
    # ids change every season).
    espn_mode: str = "scoreboard"
    # The Odds API sport keys for this competition (explicit), and/or a group whose
    # active keys are scanned (for tennis tournaments, which have per-event keys).
    odds_keys: tuple[str, ...] = ()
    odds_group: str | None = None
    # ESPN injuries endpoint is available for these leagues.
    injuries: bool = False
    # Cricket: Test matches can be drawn; limited-overs cannot (ties are rare and
    # treated as void).
    draws: bool | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)


LEAGUES: dict[str, League] = {
    lg.key: lg
    for lg in [
        # --- Football (Soccer)
        League("eng.1", "soccer", "Premier League", "soccer/eng.1", odds_keys=("soccer_epl",)),
        League("esp.1", "soccer", "La Liga", "soccer/esp.1", odds_keys=("soccer_spain_la_liga",)),
        League("ger.1", "soccer", "Bundesliga", "soccer/ger.1", odds_keys=("soccer_germany_bundesliga",)),
        League("ita.1", "soccer", "Serie A", "soccer/ita.1", odds_keys=("soccer_italy_serie_a",)),
        League("fra.1", "soccer", "Ligue 1", "soccer/fra.1", odds_keys=("soccer_france_ligue_one",)),
        League("uefa.champions", "soccer", "UEFA Champions League", "soccer/uefa.champions",
               odds_keys=("soccer_uefa_champs_league",)),
        League("usa.1", "soccer", "MLS", "soccer/usa.1", odds_keys=("soccer_usa_mls",)),
        # --- Rugby Union (ESPN uses numeric league ids)
        League("rugby.6n", "rugby", "Six Nations", "rugby/180659", odds_group="Rugby Union"),
        League("rugby.trc", "rugby", "The Rugby Championship", "rugby/244293", odds_group="Rugby Union"),
        League("rugby.tests", "rugby", "International Tests", "rugby/289234", odds_group="Rugby Union"),
        League("rugby.prem", "rugby", "Premiership Rugby", "rugby/267979", odds_group="Rugby Union"),
        League("rugby.urc", "rugby", "United Rugby Championship", "rugby/270557", odds_group="Rugby Union"),
        League("rugby.ecc", "rugby", "European Champions Cup", "rugby/271937", odds_group="Rugby Union"),
        League("rugby.super", "rugby", "Super Rugby Pacific", "rugby/242041", odds_group="Rugby Union"),
        # --- Tennis (singles only)
        League("atp", "tennis", "ATP Tour", "tennis/atp", espn_mode="tennis", odds_group="Tennis"),
        League("wta", "tennis", "WTA Tour", "tennis/wta", espn_mode="tennis", odds_group="Tennis"),
        # --- Basketball
        League("nba", "basketball", "NBA", "basketball/nba", odds_keys=("basketball_nba",), injuries=True),
        League("wnba", "basketball", "WNBA", "basketball/wnba", odds_keys=("basketball_wnba",), injuries=True),
        League("euroleague", "basketball", "EuroLeague", "basketball/euroleague",
               odds_keys=("basketball_euroleague",)),
        # --- Cricket
        League("cricket", "cricket", "Cricket (all ESPN series)", None, espn_mode="header",
               odds_group="Cricket"),
        # --- American Football
        League("nfl", "nfl", "NFL", "football/nfl", odds_keys=("americanfootball_nfl",), injuries=True),
        # --- Baseball
        League("mlb", "baseball", "MLB", "baseball/mlb", odds_keys=("baseball_mlb",), injuries=True),
    ]
}


def enabled_leagues(csv: str | None) -> list[League]:
    if not csv:
        return list(LEAGUES.values())
    keys = [k.strip() for k in csv.split(",") if k.strip()]
    unknown = [k for k in keys if k not in LEAGUES]
    if unknown:
        raise ValueError(f"Unknown league keys in ENABLED_LEAGUES: {unknown}")
    return [LEAGUES[k] for k in keys]
