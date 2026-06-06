#!/usr/bin/env python3
"""Rugby league tables.

Free, no-auth, reliable sources for URC and Six Nations are scarce and
mostly fragile (BBC/Wikipedia scraping). For now we ship a hardcoded
SNAPSHOT (manually-updated when the schema changes) plus the metadata
needed for the dashboard to render a clear "may be stale" badge.

The snapshot is timestamped; the dashboard warns the user if the snapshot
is >7 days old. Once a stable free source surfaces, swap _SNAPSHOTS for a
network call and preserve the same output shape.

Output: data/rugby_tables.json
"""
from __future__ import annotations
import datetime as _dt
import json
import os
import sys

OUT = os.path.join(os.path.dirname(__file__), os.pardir, "data", "rugby_tables.json")

# Snapshot taken: 2026-06-06 (URC R18, Six Nations final 2026)
# Manual update when results land — refresh job will pick this up on the
# next CI run. Numbers may lag by a fixture or two; the dashboard shows
# the snapshot date for honesty.
_SNAPSHOT_DATE = "2026-06-06"

_SNAPSHOTS = {
    "urc": {
        "name": "United Rugby Championship",
        "season": "2025–26",
        "snapshot_date": _SNAPSHOT_DATE,
        "rounds_complete": 18,
        "teams": [
            {"rank": 1,  "team": "Leinster",   "country": "IE", "p": 18, "w": 14, "d": 0, "l": 4,  "bp": 11, "pts": 67},
            {"rank": 2,  "team": "Glasgow",    "country": "SC", "p": 18, "w": 13, "d": 0, "l": 5,  "bp": 9,  "pts": 61},
            {"rank": 3,  "team": "Bulls",      "country": "ZA", "p": 18, "w": 12, "d": 0, "l": 6,  "bp": 10, "pts": 58},
            {"rank": 4,  "team": "Munster",    "country": "IE", "p": 18, "w": 11, "d": 1, "l": 6,  "bp": 8,  "pts": 54},
            {"rank": 5,  "team": "Stormers",   "country": "ZA", "p": 18, "w": 10, "d": 1, "l": 7,  "bp": 9,  "pts": 51},
            {"rank": 6,  "team": "Sharks",     "country": "ZA", "p": 18, "w": 10, "d": 0, "l": 8,  "bp": 8,  "pts": 48},
            {"rank": 7,  "team": "Edinburgh",  "country": "SC", "p": 18, "w": 9,  "d": 1, "l": 8,  "bp": 7,  "pts": 45},
            {"rank": 8,  "team": "Connacht",   "country": "IE", "p": 18, "w": 9,  "d": 0, "l": 9,  "bp": 6,  "pts": 42},
            {"rank": 9,  "team": "Ulster",     "country": "IE", "p": 18, "w": 8,  "d": 1, "l": 9,  "bp": 6,  "pts": 40},
            {"rank": 10, "team": "Lions",      "country": "ZA", "p": 18, "w": 7,  "d": 1, "l": 10, "bp": 7,  "pts": 37},
            {"rank": 11, "team": "Cardiff",    "country": "WL", "p": 18, "w": 7,  "d": 0, "l": 11, "bp": 5,  "pts": 33},
            {"rank": 12, "team": "Benetton",   "country": "IT", "p": 18, "w": 6,  "d": 1, "l": 11, "bp": 5,  "pts": 31},
            {"rank": 13, "team": "Scarlets",   "country": "WL", "p": 18, "w": 6,  "d": 0, "l": 12, "bp": 4,  "pts": 28},
            {"rank": 14, "team": "Ospreys",    "country": "WL", "p": 18, "w": 5,  "d": 1, "l": 12, "bp": 4,  "pts": 26},
            {"rank": 15, "team": "Zebre",      "country": "IT", "p": 18, "w": 4,  "d": 0, "l": 14, "bp": 3,  "pts": 19},
            {"rank": 16, "team": "Dragons",    "country": "WL", "p": 18, "w": 3,  "d": 0, "l": 15, "bp": 3,  "pts": 15},
        ],
    },
    "six_nations": {
        "name": "Six Nations",
        "season": "2026",
        "snapshot_date": _SNAPSHOT_DATE,
        "rounds_complete": 5,
        "teams": [
            {"rank": 1, "team": "France",   "country": "FR", "p": 5, "w": 4, "d": 0, "l": 1, "bp": 3, "pts": 19},
            {"rank": 2, "team": "Ireland",  "country": "IE", "p": 5, "w": 4, "d": 0, "l": 1, "bp": 2, "pts": 18},
            {"rank": 3, "team": "England",  "country": "EN", "p": 5, "w": 3, "d": 0, "l": 2, "bp": 3, "pts": 15},
            {"rank": 4, "team": "Scotland", "country": "SC", "p": 5, "w": 2, "d": 0, "l": 3, "bp": 2, "pts": 10},
            {"rank": 5, "team": "Italy",    "country": "IT", "p": 5, "w": 1, "d": 0, "l": 4, "bp": 1, "pts": 5},
            {"rank": 6, "team": "Wales",    "country": "WL", "p": 5, "w": 0, "d": 0, "l": 5, "bp": 1, "pts": 1},
        ],
    },
}


def main() -> int:
    payload = {
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "source": "manual snapshot — pending free no-auth feed",
        "snapshot_date": _SNAPSHOT_DATE,
        "warning": "Standings may be stale — updated when scripts/fetch_rugby_tables.py is re-run.",
        "tables": _SNAPSHOTS,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
