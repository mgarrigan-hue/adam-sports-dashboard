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
        completed = status in ("STATUS_FINAL", "STATUS_FULL_TIME") or ev.get("status", {}).get("type", {}).get("completed")
        league_name = (data.get("leagues", [{}])[0] or {}).get("name") or competition_label or ""
        entry = {
            "date": ev.get("date"),
            "home": home["team"].get("displayName") or home["team"].get("name"),
            "away": away["team"].get("displayName") or away["team"].get("name"),
            "competition": competition_label or league_name,
        }
        if completed:
            try:
                entry["home_score"] = int(home.get("score", 0))
                entry["away_score"] = int(away.get("score", 0))
            except (TypeError, ValueError):
                pass
        out.append(entry)
    return out

def split_results_fixtures(matches):
    today = dt.datetime.now(dt.timezone.utc).isoformat()
    results = [m for m in matches if "home_score" in m]
    fixtures = [m for m in matches if "home_score" not in m and (not m["date"] or m["date"] >= today)]
    results.sort(key=lambda m: m["date"] or "", reverse=True)
    fixtures.sort(key=lambda m: m["date"] or "9999")
    return results, fixtures
