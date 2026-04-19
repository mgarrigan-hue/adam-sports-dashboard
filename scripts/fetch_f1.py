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

def _combine(date: str, time: str) -> str:
    if date and time:
        # Ergast time is e.g. "13:00:00Z"; ensure single Z suffix
        t = time if time.endswith("Z") else time + "Z"
        return f"{date}T{t}"
    return date

def fetch_schedule(season: str):
    d = get(f"{BASE}/{season}.json")
    races = d["MRData"]["RaceTable"]["Races"]
    out = []
    for r in races:
        out.append({
            "round": r.get("round"),
            "race_name": r.get("raceName"),
            "circuit": r.get("Circuit", {}).get("circuitName"),
            "location": ", ".join(filter(None, [
                r.get("Circuit", {}).get("Location", {}).get("locality"),
                r.get("Circuit", {}).get("Location", {}).get("country"),
            ])),
            "date": _combine(r.get("date", ""), r.get("time", "")),
            "_raw": r,
        })
    return out

def build_next_race_sessions(schedule, upcoming):
    if not upcoming:
        return None
    nxt = upcoming[0]
    raw = None
    for r in schedule:
        if r.get("round") == nxt.get("round"):
            raw = r.get("_raw")
            break
    if not raw:
        return None
    session_keys = [
        ("FirstPractice", "Practice 1"),
        ("SecondPractice", "Practice 2"),
        ("ThirdPractice", "Practice 3"),
        ("Qualifying", "Qualifying"),
        ("SprintQualifying", "Sprint Qualifying"),
        ("SprintShootout", "Sprint Shootout"),
        ("Sprint", "Sprint"),
    ]
    sessions = []
    for key, label in session_keys:
        block = raw.get(key)
        if isinstance(block, dict):
            iso = _combine(block.get("date", ""), block.get("time", ""))
            if iso:
                sessions.append({"name": label, "datetime": iso})
    race_iso = _combine(raw.get("date", ""), raw.get("time", ""))
    if race_iso:
        sessions.append({"name": "Race", "datetime": race_iso})
    return {
        "race_name": nxt.get("race_name"),
        "round": nxt.get("round"),
        "circuit": nxt.get("circuit"),
        "sessions": sessions,
    }

def _most_recent_past_race(schedule, now_iso):
    past = [r for r in schedule if r.get("date") and r["date"] < now_iso]
    if not past:
        return None
    past.sort(key=lambda r: int(r.get("round") or 0))
    return past[-1]

def fetch_qualifying(season: str, rnd: str):
    d = get(f"{BASE}/{season}/{rnd}/qualifying.json")
    races = d["MRData"]["RaceTable"]["Races"]
    if not races:
        return None
    race = races[0]
    results = []
    for q in race.get("QualifyingResults", [])[:10]:
        drv = q.get("Driver", {})
        results.append({
            "position": int(q.get("position", 0)),
            "driver": f"{drv.get('givenName','')} {drv.get('familyName','')}".strip(),
            "team": q.get("Constructor", {}).get("name", ""),
            "q1": q.get("Q1", ""),
            "q2": q.get("Q2", ""),
            "q3": q.get("Q3", ""),
        })
    return {
        "race_name": race.get("raceName"),
        "round": race.get("round"),
        "date": _combine(race.get("date", ""), race.get("time", "")),
        "results": results,
    }

def fetch_sprint(season: str, rnd: str):
    try:
        d = get(f"{BASE}/{season}/{rnd}/sprint.json")
    except Exception:
        return None
    races = d["MRData"]["RaceTable"]["Races"]
    if not races:
        return None
    race = races[0]
    sprint_results = race.get("SprintResults", [])
    if not sprint_results:
        return None
    results = []
    for s in sprint_results[:8]:
        drv = s.get("Driver", {})
        results.append({
            "position": int(s.get("position", 0)),
            "driver": f"{drv.get('givenName','')} {drv.get('familyName','')}".strip(),
            "team": s.get("Constructor", {}).get("name", ""),
            "points": s.get("points", "0"),
        })
    return {
        "race_name": race.get("raceName"),
        "round": race.get("round"),
        "date": _combine(race.get("date", ""), race.get("time", "")),
        "results": results,
    }

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

    last_qualifying = None
    last_sprint = None
    next_race_sessions = None
    recent_race = _most_recent_past_race(schedule, now)
    if recent_race:
        rnd = recent_race.get("round")
        try:
            last_qualifying = fetch_qualifying(season, rnd)
        except Exception as e:
            print(f"qualifying failed: {e}", file=sys.stderr)
        try:
            last_sprint = fetch_sprint(season, rnd)
        except Exception as e:
            print(f"sprint failed: {e}", file=sys.stderr)
    try:
        next_race_sessions = build_next_race_sessions(schedule, upcoming)
    except Exception as e:
        print(f"next race sessions failed: {e}", file=sys.stderr)

    upcoming_clean = [{k: v for k, v in r.items() if k != "_raw"} for r in upcoming]

    payload = {
        "generated_at": now,
        "season": season,
        "upcoming": upcoming_clean,
        "recent_results": recent,
        "driver_standings": ds,
        "constructor_standings": cs,
        "last_qualifying": last_qualifying,
        "last_sprint": last_sprint,
        "next_race_sessions": next_race_sessions,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT} — {len(upcoming)} upcoming, {len(recent)} recent, {len(ds)} drivers, {len(cs)} teams")
    extras = []
    extras.append(f"qualifying: {len(last_qualifying['results']) if last_qualifying else 0}")
    extras.append(f"sprint: {len(last_sprint['results']) if last_sprint else 0}")
    extras.append(f"next-race sessions: {len(next_race_sessions['sessions']) if next_race_sessions else 0}")
    print("extras — " + ", ".join(extras))

if __name__ == "__main__":
    main()
