"""Irish provinces rugby fetcher - ESPN scoreboard.

Pulls URC and European Champions Cup, then filters to matches involving
Leinster, Munster, Ulster, or Connacht.
"""
from __future__ import annotations
import json, datetime as dt
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from espn_rugby import fetch_league, parse_events, split_results_fixtures

OUT = Path(__file__).resolve().parent.parent / "data" / "provinces.json"

LEAGUES = [
    (270557, "URC"),
    (271937, "Champions Cup"),
]
PROVINCES = {"leinster", "munster", "ulster", "connacht"}

def is_irish(m):
    h = (m["home"] or "").lower()
    a = (m["away"] or "").lower()
    return any(p in h for p in PROVINCES) or any(p in a for p in PROVINCES)

def main():
    all_matches = []
    for lid, label in LEAGUES:
        data = fetch_league(lid, days_back=120, days_forward=180)
        all_matches.extend(parse_events(data, competition_label=label))
    irish = [m for m in all_matches if is_irish(m)]
    results, fixtures = split_results_fixtures(irish)

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "results": results[:30],
        "fixtures": fixtures[:30],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT} - {len(payload['results'])} results, {len(payload['fixtures'])} fixtures")

if __name__ == "__main__":
    main()
