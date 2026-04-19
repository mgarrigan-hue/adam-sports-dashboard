"""F1 data fetcher — uses the Jolpica mirror of the Ergast API (free, no key)."""
from __future__ import annotations
import json, datetime as dt, sys
from pathlib import Path
import urllib.request

BASE = "https://api.jolpi.ca/ergast/f1"
OUT = Path(__file__).resolve().parent.parent / "data" / "f1.json"

def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "adam-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def fetch_schedule(season: str):
    d = get(f"{BASE}/{season}.json")
    races = d["MRData"]["RaceTable"]["Races"]
    out = []
    for r in races:
        date = r.get("date", "")
        time = r.get("time", "")
        iso = f"{date}T{time}" if date and time else date
        out.append({
            "round": r.get("round"),
            "race_name": r.get("raceName"),
            "circuit": r.get("Circuit", {}).get("circuitName"),
            "location": ", ".join(filter(None, [
                r.get("Circuit", {}).get("Location", {}).get("locality"),
                r.get("Circuit", {}).get("Location", {}).get("country"),
            ])),
            "date": iso,
        })
    return out

def fetch_recent_results(season: str, limit: int = 5):
    d = get(f"{BASE}/{season}/results.json?limit=200")
    races = d["MRData"]["RaceTable"]["Races"]
    out = []
    for r in races[-limit:][::-1]:
        results = r.get("Results", [])
        podium = [f"{x['Driver']['givenName']} {x['Driver']['familyName']}" for x in results[:3]]
        winner = podium[0] if podium else ""
        date = r.get("date", "")
        time = r.get("time", "")
        iso = f"{date}T{time}" if date and time else date
        out.append({
            "race_name": r.get("raceName"),
            "date": iso,
            "winner": winner,
            "podium": podium,
        })
    return out

def fetch_driver_standings(season: str):
    d = get(f"{BASE}/{season}/driverstandings.json")
    lists = d["MRData"]["StandingsTable"]["StandingsLists"]
    if not lists:
        return []
    return [{
        "position": s["position"],
        "driver": f"{s['Driver']['givenName']} {s['Driver']['familyName']}",
        "team": s["Constructors"][0]["name"] if s.get("Constructors") else "",
        "points": s["points"],
        "wins": s["wins"],
    } for s in lists[0]["DriverStandings"]]

def fetch_constructor_standings(season: str):
    d = get(f"{BASE}/{season}/constructorstandings.json")
    lists = d["MRData"]["StandingsTable"]["StandingsLists"]
    if not lists:
        return []
    return [{
        "position": s["position"],
        "team": s["Constructor"]["name"],
        "points": s["points"],
        "wins": s["wins"],
    } for s in lists[0]["ConstructorStandings"]]

def main():
    season = str(dt.datetime.now(dt.timezone.utc).year)
    try:
        schedule = fetch_schedule(season)
    except Exception as e:
        print(f"schedule failed: {e}", file=sys.stderr); schedule = []
    try:
        recent = fetch_recent_results(season)
    except Exception as e:
        print(f"results failed: {e}", file=sys.stderr); recent = []
    try:
        ds = fetch_driver_standings(season)
    except Exception as e:
        print(f"driver standings failed: {e}", file=sys.stderr); ds = []
    try:
        cs = fetch_constructor_standings(season)
    except Exception as e:
        print(f"constructor standings failed: {e}", file=sys.stderr); cs = []

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    upcoming = [r for r in schedule if r["date"] and r["date"] >= now][:8]

    payload = {
        "generated_at": now,
        "season": season,
        "upcoming": upcoming,
        "recent_results": recent,
        "driver_standings": ds,
        "constructor_standings": cs,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT} — {len(upcoming)} upcoming, {len(recent)} recent, {len(ds)} drivers, {len(cs)} teams")

if __name__ == "__main__":
    main()
