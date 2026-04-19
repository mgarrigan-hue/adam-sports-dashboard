"""International rugby fetcher — ESPN scoreboard.

Combines: Six Nations, Rugby Championship, Rugby World Cup, and Autumn
Internationals (covered loosely by Six Nations + RWC + RC date ranges).
"""
from __future__ import annotations
import json, datetime as dt
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from espn_rugby import fetch_league, parse_events, split_results_fixtures

OUT = Path(__file__).resolve().parent.parent / "data" / "intl_rugby.json"

LEAGUES = [
    (180659, "Six Nations"),
    (244293, "Rugby Championship"),
    (164205, "Rugby World Cup"),
]

def main():
    all_matches = []
    for lid, label in LEAGUES:
        data = fetch_league(lid, days_back=120, days_forward=180)
        all_matches.extend(parse_events(data, competition_label=label))

    results, fixtures = split_results_fixtures(all_matches)

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
