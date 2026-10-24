"""The Odds API adapter (https://the-odds-api.com) — market-implied probabilities.

Used only as one input to the probability engine. Bookmaker margin is removed per
bookmaker (proportional normalisation), then the median across bookmakers is taken
so a single outlier book cannot move the consensus.
"""
from __future__ import annotations

import logging
import re
import statistics
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from difflib import SequenceMatcher

import httpx

from .espn import parse_time

log = logging.getLogger(__name__)

BASE = "https://api.the-odds-api.com/v4"


@dataclass
class MarketLine:
    home_team: str
    away_team: str
    commence_time: datetime
    bookmakers: int
    p_home: float
    p_draw: float | None
    p_away: float
    sport_key: str


def devig(prices: dict[str, float]) -> dict[str, float] | None:
    """Decimal odds -> probabilities with the bookmaker overround removed."""
    if any(p is None or p <= 1.0 for p in prices.values()):
        return None
    raw = {k: 1.0 / v for k, v in prices.items()}
    total = sum(raw.values())
    return {k: v / total for k, v in raw.items()}


def consensus(game: dict) -> MarketLine | None:
    home, away = game.get("home_team"), game.get("away_team")
    start = parse_time(game.get("commence_time"))
    if not (home and away and start):
        return None
    per_book = []
    for bk in game.get("bookmakers") or []:
        for m in bk.get("markets") or []:
            if m.get("key") != "h2h":
                continue
            prices = {}
            for o in m.get("outcomes") or []:
                name = o.get("name")
                if name == home:
                    prices["home"] = o.get("price")
                elif name == away:
                    prices["away"] = o.get("price")
                elif name and name.lower() == "draw":
                    prices["draw"] = o.get("price")
            if "home" in prices and "away" in prices:
                p = devig(prices)
                if p:
                    per_book.append(p)
    if not per_book:
        return None
    has_draw = sum(1 for p in per_book if "draw" in p) > len(per_book) / 2
    books = [p for p in per_book if ("draw" in p) == has_draw]
    med = {k: statistics.median(p[k] for p in books) for k in (("home", "draw", "away") if has_draw else ("home", "away"))}
    total = sum(med.values())
    med = {k: v / total for k, v in med.items()}
    return MarketLine(home, away, start, len(books), med["home"], med.get("draw"), med["away"],
                      game.get("sport_key", ""))


_STOP = {"fc", "afc", "cf", "sc", "ac", "the", "club", "de", "rugby", "rfc", "cricket", "team"}


def norm_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(t for t in s.split() if t not in _STOP)


def name_similarity(a: str, b: str) -> float:
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ta, tb = set(na.split()), set(nb.split())
    jacc = len(ta & tb) / len(ta | tb)
    # Surnames for tennis ("N. Djokovic" vs "Novak Djokovic").
    last = 1.0 if na.split()[-1] == nb.split()[-1] else 0.0
    return max(SequenceMatcher(None, na, nb).ratio(), jacc, 0.9 * last)


def match_line(lines: list[MarketLine], home: str, away: str, start: datetime,
               threshold: float = 0.72) -> tuple[MarketLine, bool] | None:
    """Find the market line for an event. Returns (line, swapped)."""
    best = None
    for ln in lines:
        if abs(ln.commence_time - start) > timedelta(hours=6):
            continue
        straight = min(name_similarity(home, ln.home_team), name_similarity(away, ln.away_team))
        swapped = min(name_similarity(home, ln.away_team), name_similarity(away, ln.home_team))
        score, sw = (straight, False) if straight >= swapped else (swapped, True)
        if score >= threshold and (best is None or score > best[0]):
            best = (score, ln, sw)
    return (best[1], best[2]) if best else None


class OddsApiClient:
    def __init__(self, client: httpx.Client, api_key: str, regions: str = "uk,eu"):
        self.client = client
        self.api_key = api_key
        self.regions = regions
        self.remaining_requests: str | None = None

    def _get(self, path: str, params: dict) -> list | dict:
        r = self.client.get(f"{BASE}{path}", params={"apiKey": self.api_key, **params})
        self.remaining_requests = r.headers.get("x-requests-remaining", self.remaining_requests)
        r.raise_for_status()
        return r.json()

    def active_sports(self) -> list[dict]:
        # Listing sports does not count against the usage quota.
        return self._get("/sports", {})

    def odds(self, sport_key: str) -> list[MarketLine]:
        games = self._get(f"/sports/{sport_key}/odds",
                          {"regions": self.regions, "markets": "h2h", "oddsFormat": "decimal"})
        out = []
        for g in games:
            line = consensus(g)
            if line:
                out.append(line)
        return out
