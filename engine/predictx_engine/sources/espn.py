"""ESPN public site API adapter (fixtures, results, injuries). No API key needed.

The endpoints are public but undocumented, so every parser here is defensive:
anything it cannot interpret is skipped (and counted) rather than guessed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

import httpx

from ..leagues import League

log = logging.getLogger(__name__)

BASE = "https://site.api.espn.com/apis/site/v2/sports"
HEADER_URL = "https://site.api.espn.com/apis/personalized/v2/scoreboard/header"


@dataclass
class ParsedEvent:
    id: str
    sport: str
    league: str
    competition: str
    start_time: datetime
    home_id: str
    away_id: str
    home_name: str
    away_name: str
    neutral: bool
    draw_possible: bool
    status: str
    home_score: float | None
    away_score: float | None
    result: str | None
    extra: dict = field(default_factory=dict)


@dataclass
class ParseReport:
    events: list[ParsedEvent] = field(default_factory=list)
    skipped: int = 0


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    v = value.replace("Z", "+00:00")
    # ESPN sometimes omits seconds: 2026-10-25T15:00+00:00
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        try:
            dt = datetime.strptime(value, "%Y-%m-%dT%H:%MZ")
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def map_status(status: dict | None) -> str:
    t = (status or {}).get("type") or {}
    name = (t.get("name") or "").upper()
    state = (t.get("state") or "").lower()
    if "POSTPONED" in name or ("DELAYED" in name and state == "pre"):
        return "postponed"
    if any(k in name for k in ("CANCELED", "CANCELLED", "ABANDONED", "FORFEIT")):
        return "cancelled"
    if t.get("completed") or state == "post":
        return "final"
    if state == "in":
        return "in_progress"
    return "scheduled"


def _num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, dict):
        v = v.get("value", v.get("displayValue"))
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _result(status: str, home: dict, away: dict, hs: float | None, as_: float | None,
            draw_possible: bool, detail: str) -> str | None:
    if status == "cancelled":
        return "void"
    if status != "final":
        return None
    if home.get("winner") is True:
        return "home"
    if away.get("winner") is True:
        return "away"
    d = detail.lower()
    if "no result" in d or "abandon" in d:
        return "void"
    if hs is not None and as_ is not None:
        if hs > as_:
            return "home"
        if as_ > hs:
            return "away"
        return "draw" if draw_possible else "void"
    if "draw" in d or "tie" in d:
        return "draw" if draw_possible else "void"
    return None


def _competitor_identity(c: dict) -> tuple[str | None, str | None]:
    who = c.get("team") or c.get("athlete") or {}
    cid = who.get("id") or c.get("id")
    name = who.get("displayName") or who.get("name") or c.get("displayName") or c.get("name")
    return (str(cid) if cid else None), name


def _cricket_draw_possible(competition_name: str, comp: dict) -> bool:
    cls = comp.get("class") if isinstance(comp.get("class"), dict) else {}
    text = f"{competition_name} {cls.get('generalClassCard', '')} {comp.get('description', '')}".lower()
    return "test" in text and "t20" not in text


def _parse_competition(comp: dict, *, league: League, ev_id: str, ev_date: str | None,
                       competition_name: str, status_src: dict | None,
                       extra: dict) -> ParsedEvent | None:
    competitors = comp.get("competitors") or []
    if len(competitors) != 2:
        return None
    by_side = {c.get("homeAway"): c for c in competitors if c.get("homeAway") in ("home", "away")}
    if len(by_side) == 2:
        home, away = by_side["home"], by_side["away"]
    else:
        # Tennis and some neutral events: keep the provider's order.
        ordered = sorted(competitors, key=lambda c: c.get("order", 0))
        home, away = ordered[0], ordered[1]
    hid, hname = _competitor_identity(home)
    aid, aname = _competitor_identity(away)
    start = parse_time(comp.get("date") or comp.get("startDate") or ev_date)
    if not (hid and aid and hname and aname and start):
        return None
    status_obj = comp.get("status") or status_src
    status = map_status(status_obj)
    detail = ((status_obj or {}).get("type") or {}).get("detail") or comp.get("note", "") or ""
    if isinstance(detail, dict):
        detail = ""
    if league.sport == "soccer":
        draw_possible = True
        # Knockout ties can't end level, but ESPN reports the 90' score; a level
        # 90' score is a draw for a 1X2 prediction, which is what we grade.
    elif league.sport == "rugby":
        draw_possible = True
    elif league.sport == "cricket":
        draw_possible = _cricket_draw_possible(competition_name, comp)
    else:
        draw_possible = False
    hs, as_ = _num(home.get("score")), _num(away.get("score"))
    if league.sport in ("tennis", "cricket"):
        # Tennis "score" is sets won (or absent); cricket scores are strings like
        # "245/6". Only the winner flag is reliable for these sports.
        hs = hs if league.sport == "tennis" else None
        as_ = as_ if league.sport == "tennis" else None
    result = _result(status, home, away, hs, as_, draw_possible, detail)
    if league.sport == "tennis" and status == "final" and result not in ("home", "away"):
        result = "void" if "walkover" in detail.lower() or "retired" in detail.lower() else result
    neutral = bool(comp.get("neutralSite")) or league.sport == "tennis" or len(by_side) != 2
    sub_id = comp.get("id") or ev_id
    return ParsedEvent(
        id=f"espn:{league.key}:{sub_id}",
        sport=league.sport,
        league=league.key,
        competition=competition_name,
        start_time=start,
        home_id=f"{league.sport}:{hid}",
        away_id=f"{league.sport}:{aid}",
        home_name=hname,
        away_name=aname,
        neutral=neutral,
        draw_possible=draw_possible,
        status=status,
        home_score=hs,
        away_score=as_,
        result=result,
        extra=extra | {"status_detail": detail[:120]},
    )


def parse_scoreboard(payload: dict, league: League) -> ParseReport:
    report = ParseReport()
    league_name = league.name
    for lg in payload.get("leagues") or []:
        league_name = lg.get("name") or league_name
        break
    for ev in payload.get("events") or []:
        comps = ev.get("competitions") or []
        if league.espn_mode == "tennis":
            for grouping in ev.get("groupings") or []:
                g = grouping.get("grouping") or {}
                gname = f"{g.get('slug', '')} {g.get('displayName', '')}".lower()
                if "singles" not in gname:
                    continue
                for comp in grouping.get("competitions") or []:
                    comps_extra = {"tournament": ev.get("name"), "round": (comp.get("round") or {}).get("displayName")}
                    pe = _parse_competition(comp, league=league, ev_id=str(ev.get("id")), ev_date=ev.get("date"),
                                            competition_name=f"{league.name} · {ev.get('name', '')}".strip(" ·"),
                                            status_src=ev.get("status"), extra=comps_extra)
                    if pe and _is_singles(comp):
                        report.events.append(pe)
                    else:
                        report.skipped += 1
            continue
        if not comps:
            report.skipped += 1
            continue
        pe = _parse_competition(comps[0], league=league, ev_id=str(ev.get("id")), ev_date=ev.get("date"),
                                competition_name=league_name, status_src=ev.get("status"),
                                extra={"venue": ((comps[0].get("venue") or {}).get("fullName"))})
        if pe:
            report.events.append(pe)
        else:
            report.skipped += 1
    return report


def _is_singles(comp: dict) -> bool:
    for c in comp.get("competitors") or []:
        if c.get("type") == "team" or (c.get("roster") and not c.get("athlete")):
            return False
    return True


def parse_header(payload: dict, league: League) -> ParseReport:
    """ESPN header feed: sports[].leagues[].events[] with competitors at event level."""
    report = ParseReport()
    for sport in payload.get("sports") or []:
        for lg in sport.get("leagues") or []:
            cname = lg.get("name") or lg.get("shortName") or league.name
            for ev in lg.get("events") or []:
                comp = {
                    "competitors": ev.get("competitors") or [],
                    "date": ev.get("date"),
                    "status": {"type": {
                        "state": ev.get("status"),
                        "completed": ev.get("status") == "post",
                        "name": (ev.get("fullStatus") or {}).get("type", {}).get("name", ""),
                        "detail": ev.get("summary") or (ev.get("fullStatus") or {}).get("type", {}).get("detail", ""),
                    }},
                    "id": ev.get("id"),
                    "description": ev.get("description") or ev.get("name") or "",
                    "class": ev.get("class") or {},
                    "neutralSite": ev.get("neutralSite", False),
                }
                if isinstance(ev.get("fullStatus"), dict):
                    comp["status"] = ev["fullStatus"] | {"type": comp["status"]["type"] | ev["fullStatus"].get("type", {})}
                pe = _parse_competition(comp, league=league, ev_id=str(ev.get("id")), ev_date=ev.get("date"),
                                        competition_name=cname, status_src=None,
                                        extra={"series": cname})
                if pe:
                    report.events.append(pe)
                else:
                    report.skipped += 1
    return report


def parse_injuries(payload: dict) -> list[dict]:
    rows = []
    for team in payload.get("injuries") or []:
        tname = team.get("displayName") or (team.get("team") or {}).get("displayName")
        for inj in team.get("injuries") or []:
            ath = inj.get("athlete") or {}
            player = ath.get("displayName")
            status = inj.get("status") or (inj.get("type") or {}).get("description")
            if tname and player and status:
                rows.append({"team_name": tname, "player": player, "status": str(status),
                             "detail": inj.get("shortComment") or inj.get("longComment")})
    return rows


class EspnClient:
    def __init__(self, client: httpx.Client):
        self.client = client

    def _get(self, url: str, params: dict | None = None) -> dict:
        r = self.client.get(url, params=params)
        r.raise_for_status()
        return r.json()

    def fetch_range(self, league: League, start: date, end: date) -> ParseReport:
        if league.espn_mode == "header":
            payload = self._get(HEADER_URL, {"sport": league.sport, "lang": "en", "region": "gb"})
            return parse_header(payload, league)
        url = f"{BASE}/{league.espn_path}/scoreboard"
        params = {"dates": f"{start:%Y%m%d}-{end:%Y%m%d}", "limit": 1000}
        return parse_scoreboard(self._get(url, params), league)

    def fetch_window_chunks(self, league: League, start: date, end: date, chunk_days: int = 28):
        cur = start
        while cur <= end:
            stop = min(end, cur + timedelta(days=chunk_days - 1))
            yield cur, stop, self.fetch_range(league, cur, stop)
            cur = stop + timedelta(days=1)

    def fetch_injuries(self, league: League) -> list[dict]:
        return parse_injuries(self._get(f"{BASE}/{league.espn_path}/injuries"))
