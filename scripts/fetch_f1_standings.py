#!/usr/bin/env python3
"""Fetch current F1 driver & constructor standings from Jolpica (Ergast successor).

Writes data/f1_standings.json. No API key required. Network-tolerant: if the
HTTP call fails we keep whatever the previous run wrote so the dashboard
never empties out mid-season.
"""
from __future__ import annotations
import datetime as _dt
import json
import os
import sys
import urllib.error
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), os.pardir, "data", "f1_standings.json")
UA = "AdamSportsDashboard/1.0 (+https://adam.garrigan.me)"
DRIVERS_URL = "https://api.jolpi.ca/ergast/f1/current/driverstandings.json"
CONS_URL    = "https://api.jolpi.ca/ergast/f1/current/constructorstandings.json"
TIMEOUT = 20


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:  # nosec - public read-only endpoint
        return json.loads(r.read().decode("utf-8"))


def _drivers(payload: dict) -> list[dict]:
    try:
        lst = (
            payload["MRData"]["StandingsTable"]["StandingsLists"][0]["DriverStandings"]
        )
    except (KeyError, IndexError):
        return []
    out = []
    for s in lst:
        d = s.get("Driver", {})
        t = (s.get("Constructors") or [{}])[0]
        out.append({
            "rank": int(s.get("position", 0) or 0),
            "driver": f"{d.get('givenName','').strip()} {d.get('familyName','').strip()}".strip(),
            "code": d.get("code", ""),
            "nationality": d.get("nationality", ""),
            "team": t.get("name", ""),
            "points": float(s.get("points", 0) or 0),
            "wins": int(s.get("wins", 0) or 0),
        })
    return out


def _cons(payload: dict) -> list[dict]:
    try:
        lst = (
            payload["MRData"]["StandingsTable"]["StandingsLists"][0]["ConstructorStandings"]
        )
    except (KeyError, IndexError):
        return []
    out = []
    for s in lst:
        c = s.get("Constructor", {})
        out.append({
            "rank": int(s.get("position", 0) or 0),
            "team": c.get("name", ""),
            "nationality": c.get("nationality", ""),
            "points": float(s.get("points", 0) or 0),
            "wins": int(s.get("wins", 0) or 0),
        })
    return out


def main() -> int:
    drivers, cons = [], []
    errors: list[str] = []
    try:
        drivers = _drivers(_get(DRIVERS_URL))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as e:  # noqa: BLE001
        errors.append(f"drivers: {e!r}")
    try:
        cons = _cons(_get(CONS_URL))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as e:  # noqa: BLE001
        errors.append(f"constructors: {e!r}")

    if not drivers and not cons:
        # Preserve previous file if everything failed — don't blank the dashboard.
        print(f"::warning::F1 standings fetch failed: {errors}", file=sys.stderr)
        if os.path.exists(OUT):
            print("keeping previous data/f1_standings.json", file=sys.stderr)
            return 0

    payload = {
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "source": "Jolpica F1 (Ergast successor)",
        "drivers": drivers,
        "constructors": cons,
        "errors": errors or None,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"wrote {OUT} ({len(drivers)} drivers, {len(cons)} constructors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
