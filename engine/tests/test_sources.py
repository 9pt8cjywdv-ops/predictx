from datetime import datetime

from predictx_engine.leagues import LEAGUES
from predictx_engine.sources.espn import parse_header, parse_injuries, parse_scoreboard
from predictx_engine.sources.odds_api import MarketLine, consensus, devig, match_line, name_similarity

from .conftest import UTC


def team(id_, name, side, score=None, winner=None):
    c = {"homeAway": side, "team": {"id": id_, "displayName": name}}
    if score is not None:
        c["score"] = score
    if winner is not None:
        c["winner"] = winner
    return c


def test_scoreboard_parses_scheduled_and_final():
    payload = {"leagues": [{"name": "Premier League"}], "events": [
        {"id": "1", "date": "2026-10-25T15:00Z", "status": {"type": {"state": "pre", "name": "STATUS_SCHEDULED"}},
         "competitions": [{"id": "1", "date": "2026-10-25T15:00Z", "competitors": [
             team("10", "Home FC", "home"), team("20", "Away FC", "away")]}]},
        {"id": "2", "date": "2026-10-18T15:00Z",
         "status": {"type": {"state": "post", "completed": True, "name": "STATUS_FULL_TIME"}},
         "competitions": [{"id": "2", "competitors": [
             team("10", "Home FC", "home", "2"), team("20", "Away FC", "away", "2")]}]},
        {"id": "3", "competitions": [{"competitors": []}]},
    ]}
    rep = parse_scoreboard(payload, LEAGUES["eng.1"])
    assert rep.skipped == 1
    sched, final = rep.events
    assert sched.status == "scheduled" and sched.result is None and sched.draw_possible
    assert sched.start_time == datetime(2026, 10, 25, 15, tzinfo=UTC)
    assert final.status == "final" and final.result == "draw"
    assert final.home_id == "soccer:10"


def test_nba_two_way_uses_winner_flag_and_postponed():
    payload = {"events": [
        {"id": "5", "date": "2026-10-20T23:30Z",
         "status": {"type": {"state": "post", "completed": True}},
         "competitions": [{"competitors": [team("1", "A", "home", "101", False), team("2", "B", "away", "99", True)]}]},
        {"id": "6", "date": "2026-10-21T23:30Z", "status": {"type": {"state": "pre", "name": "STATUS_POSTPONED"}},
         "competitions": [{"competitors": [team("1", "A", "home"), team("2", "B", "away")]}]},
    ]}
    a, b = parse_scoreboard(payload, LEAGUES["nba"]).events
    assert a.result == "away" and not a.draw_possible
    assert b.status == "postponed"


def test_tennis_groupings_singles_only():
    def ath(id_, name, order, winner=None):
        c = {"athlete": {"id": id_, "displayName": name}, "order": order, "type": "athlete"}
        if winner is not None:
            c["winner"] = winner
        return c
    payload = {"events": [{"id": "t1", "name": "Paris Masters", "date": "2026-10-27T10:00Z", "groupings": [
        {"grouping": {"slug": "mens-singles", "displayName": "Men's Singles"}, "competitions": [
            {"id": "m1", "date": "2026-10-27T10:00Z", "status": {"type": {"state": "pre"}},
             "competitors": [ath("1", "Player One", 1), ath("2", "Player Two", 2)]},
            {"id": "m2", "date": "2026-10-26T10:00Z", "status": {"type": {"state": "post", "completed": True}},
             "competitors": [ath("1", "Player One", 1, False), ath("3", "Player Three", 2, True)]}]},
        {"grouping": {"slug": "mens-doubles"}, "competitions": [{"id": "d1"}]},
    ]}]}
    rep = parse_scoreboard(payload, LEAGUES["atp"])
    assert [e.id for e in rep.events] == ["espn:atp:m1", "espn:atp:m2"]
    assert rep.events[0].neutral and rep.events[1].result == "away"
    assert "Paris Masters" in rep.events[0].competition


def test_header_feed_cricket_test_draw():
    payload = {"sports": [{"leagues": [{"name": "India tour of England", "events": [
        {"id": "c1", "date": "2026-10-20T10:00Z", "status": "post", "description": "3rd Test",
         "summary": "Match drawn",
         "competitors": [{"id": "1", "displayName": "England", "homeAway": "home", "winner": False},
                         {"id": "2", "displayName": "India", "homeAway": "away", "winner": False}]},
        {"id": "c2", "date": "2026-10-28T10:00Z", "status": "pre", "description": "1st ODI",
         "competitors": [{"id": "1", "displayName": "England", "homeAway": "home"},
                         {"id": "2", "displayName": "India", "homeAway": "away"}]},
    ]}]}]}
    test, odi = parse_header(payload, LEAGUES["cricket"]).events
    assert test.draw_possible and test.result == "draw"
    assert not odi.draw_possible and odi.status == "scheduled"


def test_injuries_parse():
    rows = parse_injuries({"injuries": [{"displayName": "Lakers", "injuries": [
        {"athlete": {"displayName": "P"}, "status": "Out"}, {"athlete": {}}]}]})
    assert rows == [{"team_name": "Lakers", "player": "P", "status": "Out", "detail": None}]


def test_devig_and_consensus_median():
    p = devig({"home": 1.8, "away": 2.1})
    assert abs(sum(p.values()) - 1) < 1e-12 and p["home"] > p["away"]
    assert devig({"home": 1.0, "away": 3}) is None
    game = {"home_team": "Arsenal", "away_team": "Chelsea", "commence_time": "2026-10-25T15:00:00Z",
            "bookmakers": [{"markets": [{"key": "h2h", "outcomes": [
                {"name": "Arsenal", "price": p1}, {"name": "Chelsea", "price": p2}, {"name": "Draw", "price": 3.6}]}]}
                for p1, p2 in ((1.9, 4.2), (1.95, 4.0), (1.5, 6.0))]}
    line = consensus(game)
    assert line.bookmakers == 3 and line.p_draw is not None
    assert abs(line.p_home + line.p_draw + line.p_away - 1) < 1e-9


def test_name_matching_and_swap():
    assert name_similarity("Manchester United", "Manchester United FC") == 1.0
    assert name_similarity("Novak Djokovic", "N. Djokovic") >= 0.85
    t = datetime(2026, 10, 25, 15, tzinfo=UTC)
    ln = MarketLine("Chelsea", "Arsenal", t, 5, 0.3, 0.25, 0.45, "soccer_epl")
    m = match_line([ln], "Arsenal FC", "Chelsea FC", t)
    assert m and m[1] is True
    assert match_line([ln], "Liverpool", "Everton", t) is None
