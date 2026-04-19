"""Shared helpers for ESPN rugby scoreboard fetchers."""
from __future__ import annotations
import json, sys, datetime as dt
import urllib.request

UA = "Mozilla/5.0 (compatible; adam-dashboard/1.0)"
BASE = "https://site.api.espn.com/apis/site/v2/sports/rugby"

def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def fetch_league(league_id: int, *, days_back: int = 90, days_forward: int = 90):
    """Fetch a league scoreboard with a wide date window so we get history + fixtures."""
    today = dt.date.today()
    start = (today - dt.timedelta(days=days_back)).strftime("%Y%m%d")
    end = (today + dt.timedelta(days=days_forward)).strftime("%Y%m%d")
    url = f"{BASE}/{league_id}/scoreboard?dates={start}-{end}&limit=200"
    try:
        return get(url)
    except Exception as e:
        print(f"[espn] league {league_id} failed: {e}", file=sys.stderr)
        return {"events": [], "leagues": [{"name": str(league_id)}]}

def parse_events(data, competition_label: str | None = None):
    """Convert ESPN events into our match dict format."""
    out = []
    for ev in data.get("events", []):
        comp = ev.get("competitions", [{}])[0]
        competitors = comp.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        status = ev.get("status", {}).get("type", {}).get("name", "")
        state = ev.get("status", {}).get("type", {}).get("state", "")
        completed = status in ("STATUS_FINAL", "STATUS_FULL_TIME") or ev.get("status", {}).get("type", {}).get("completed")
        league_name = (data.get("leagues", [{}])[0] or {}).get("name") or competition_label or ""
        entry = {
            "date": ev.get("date"),
            "home": home["team"].get("displayName") or home["team"].get("name"),
            "away": away["team"].get("displayName") or away["team"].get("name"),
            "home_logo": home.get("team", {}).get("logo") or "",
            "away_logo": away.get("team", {}).get("logo") or "",
            "competition": competition_label or league_name,
            "status": status or None,
            "status_state": state or None,
        }
        if completed:
            try:
                entry["home_score"] = int(home.get("score", 0))
                entry["away_score"] = int(away.get("score", 0))
            except (TypeError, ValueError):
                pass

            # Half-time score from per-period linescores (period 1 = first half).
            # Only emit if linescores actually exist for both teams; some feeds
            # return empty arrays which would produce a misleading "0-0".
            def _ht(team):
                ls_arr = team.get("linescores") or []
                if not ls_arr:
                    return None
                for ls in ls_arr:
                    if ls.get("period") == 1:
                        try:
                            return int(ls.get("value") or 0)
                        except (TypeError, ValueError):
                            return None
                return None
            ht_h = _ht(home)
            ht_a = _ht(away)
            if ht_h is not None and ht_a is not None:
                # Suppress if both 0 but the final wasn't 0-0 (means feed didn't provide HT)
                final_total = (entry.get("home_score") or 0) + (entry.get("away_score") or 0)
                if ht_h + ht_a > 0 or final_total == 0:
                    entry["half_time"] = f"{ht_h}-{ht_a}"

            # Scoring summary (player-level plays) from competitions[0].details.
            # Filter to actual scoring/discipline events — skip substitutions etc.
            SCORING_TYPES = {
                "try", "penalty try", "conversion", "penalty goal",
                "drop goal", "yellow card", "red card",
            }
            id_to_team = {
                str(home.get("team", {}).get("id")): entry["home"],
                str(away.get("team", {}).get("id")): entry["away"],
            }
            scorers = []
            for det in comp.get("details", []) or []:
                t = ((det.get("type") or {}).get("text") or "").lower()
                if t not in SCORING_TYPES:
                    continue
                clk = (det.get("clock") or {}).get("displayValue") or ""
                team_id = str((det.get("team") or {}).get("id") or "")
                team_name = id_to_team.get(team_id, "")
                ath = (det.get("athletesInvolved") or [])
                player = ""
                if ath:
                    a = ath[0]
                    player = a.get("shortName") or a.get("displayName") or a.get("fullName") or ""
                scorers.append({
                    "minute": clk,
                    "team": team_name,
                    "player": player,
                    "type": t,
                })
            if scorers:
                entry["scoring_summary"] = scorers
        out.append(entry)
    return out

def split_results_fixtures(matches):
    today = dt.datetime.now(dt.timezone.utc).isoformat()
    results = [m for m in matches if "home_score" in m]
    fixtures = [m for m in matches if "home_score" not in m and (not m["date"] or m["date"] >= today)]
    results.sort(key=lambda m: m["date"] or "", reverse=True)
    fixtures.sort(key=lambda m: m["date"] or "9999")
    return results, fixtures
