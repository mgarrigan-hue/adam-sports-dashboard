"""Leinster Schools rugby fetcher.

Uses the public JSON API at https://www.schoolsrugby.ie/api/matches.
Filters to Leinster organiser and the most recent season(s).
"""
from __future__ import annotations
import json, sys, datetime as dt
from pathlib import Path
import urllib.request

OUT = Path(__file__).resolve().parent.parent / "data" / "schools.json"
URL = "https://www.schoolsrugby.ie/api/matches"
UA = "Mozilla/5.0 (compatible; adam-dashboard/1.0)"

def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def normalize(m):
    return {
        "date": m.get("kickoffAt"),
        "home": (m.get("homeTeam") or {}).get("name") or "Home",
        "away": (m.get("awayTeam") or {}).get("name") or "Away",
        "competition": (m.get("competition") or {}).get("name") or "Schools Rugby",
        "venue": m.get("venue") or "",
        "round": m.get("round") or "",
        "home_score": m.get("homeScore"),
        "away_score": m.get("awayScore"),
        "status": m.get("status"),
    }

def is_leinster(m):
    comp = m.get("competition") or {}
    if (comp.get("organiser") or "").lower().startswith("leinster"):
        return True
    return "leinster" in (comp.get("slug") or "").lower()

def main():
    try:
        raw = fetch()
    except Exception as e:
        print(f"[schools] fetch failed: {e}", file=sys.stderr)
        raw = []

    leinster = [m for m in raw if is_leinster(m)]

    # Keep last 18 months only (otherwise we'd surface 10-year-old archives)
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=540)).isoformat()
    recent = [m for m in leinster if (m.get("kickoffAt") or "") >= cutoff]

    matches = [normalize(m) for m in recent]

    today = dt.datetime.now(dt.timezone.utc).isoformat()
    results, fixtures = [], []
    for m in matches:
        completed = m["status"] == "completed" or m["home_score"] is not None
        # Drop the score keys cleanly when not completed
        if not completed:
            m.pop("home_score", None); m.pop("away_score", None)
            if not m["date"] or m["date"] >= today:
                fixtures.append(m)
        else:
            results.append(m)

    results.sort(key=lambda m: m["date"] or "", reverse=True)
    fixtures.sort(key=lambda m: m["date"] or "9999")

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "results": results[:30],
        "fixtures": fixtures[:30],
        "source": "schoolsrugby.ie",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT} - {len(payload['results'])} results, {len(payload['fixtures'])} fixtures (from {len(leinster)} Leinster matches total)")

if __name__ == "__main__":
    main()
