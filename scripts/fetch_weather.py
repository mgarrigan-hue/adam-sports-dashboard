#!/usr/bin/env python3
"""Open-Meteo weather enrichment for upcoming fixtures.

For each WC, F1, rugby, and club fixture in the next ~10 days, geocode the
venue (cached) and fetch hourly weather for the match date. Writes a
weather block back into the source data files so the dashboard renders
chips without any client-side network call.

Open-Meteo: NO API KEY needed. Geocoding + forecast both free.
Caches venue->lat/lng in data/_weather_cache.json so we don't re-geocode
every CI run.
"""
from __future__ import annotations
import datetime as _dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "_weather_cache.json"
UA = "AdamSportsDashboard/1.0 (+https://adam.garrigan.me)"
TIMEOUT = 15
WINDOW_DAYS = 10
GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST = "https://api.open-meteo.com/v1/forecast"

# Files we enrich. Each entry: (path, list keys, date key, venue key)
TARGETS = [
    (DATA / "intl_rugby.json", [("fixtures",)], "date", "venue"),
    (DATA / "provinces.json", [("fixtures",)], "date", "venue"),
    (DATA / "schools.json", [("fixtures",)], "date", "venue"),
    (DATA / "dublin_club.json", [("fixtures",)], "date", "venue"),
]

WCODE_MAP = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    80: "Showers", 81: "Heavy showers", 82: "Violent showers",
    95: "Thunderstorm", 96: "T-storm + hail", 99: "T-storm + heavy hail",
}


def _get(url: str, params: dict) -> dict | None:
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}"
    try:
        req = urllib.request.Request(full, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:  # nosec
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError, OSError) as e:
        print(f"  ! HTTP failed for {full}: {e}", file=sys.stderr)
        return None


def load_cache() -> dict:
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save_cache(c: dict) -> None:
    CACHE.write_text(json.dumps(c, indent=2, ensure_ascii=False), encoding="utf-8")


def geocode(venue: str, cache: dict) -> tuple[float, float] | None:
    key = venue.strip().lower()
    if key in cache:
        v = cache[key]
        if v is None:
            return None
        return tuple(v)  # type: ignore[return-value]
    # First word/two of the venue often gets a better hit than the full string
    name = venue.split(",")[0].strip() or venue
    res = _get(GEOCODE, {"name": name, "count": 1, "language": "en"})
    if res and res.get("results"):
        r0 = res["results"][0]
        cache[key] = [r0["latitude"], r0["longitude"]]
        return r0["latitude"], r0["longitude"]
    cache[key] = None
    return None


def hourly_at(lat: float, lng: float, iso_dt: str) -> dict | None:
    # Get hourly forecast for that date, snap to the nearest hour of the kickoff
    try:
        d = _dt.datetime.fromisoformat(iso_dt.replace("Z", "+00:00"))
    except ValueError:
        return None
    date_str = d.strftime("%Y-%m-%d")
    res = _get(FORECAST, {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lng:.4f}",
        "hourly": "temperature_2m,precipitation,wind_speed_10m,weather_code",
        "start_date": date_str,
        "end_date": date_str,
        "timezone": "UTC",
    })
    if not res or "hourly" not in res:
        return None
    h = res["hourly"]
    times = h.get("time") or []
    if not times:
        return None
    # Find the hour closest to kickoff
    target = d.strftime("%Y-%m-%dT%H:00")
    idx = 0
    best_delta = 1e9
    for i, t in enumerate(times):
        try:
            tt = _dt.datetime.fromisoformat(t)
        except ValueError:
            continue
        delta = abs((tt - d.replace(tzinfo=None)).total_seconds())
        if delta < best_delta:
            best_delta = delta
            idx = i
    if best_delta > 6 * 3600:
        return None
    temp = (h.get("temperature_2m") or [None])[idx]
    wind = (h.get("wind_speed_10m") or [None])[idx]
    code = (h.get("weather_code") or [None])[idx]
    precip = (h.get("precipitation") or [None])[idx]
    return {
        "temp_c": round(temp, 1) if isinstance(temp, (int, float)) else None,
        "wind_kph": round(wind * 3.6, 0) if isinstance(wind, (int, float)) else None,  # m/s → km/h
        "precip_mm": round(precip, 1) if isinstance(precip, (int, float)) else None,
        "code": code,
        "condition": WCODE_MAP.get(code or -1, "—"),
        "fetched_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
    }


def enrich(path: Path, list_paths: list[tuple[str, ...]], date_key: str, venue_key: str, cache: dict, now: _dt.datetime) -> int:
    if not path.exists():
        return 0
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"  ! bad JSON in {path}: {e}", file=sys.stderr)
        return 0
    horizon = now + _dt.timedelta(days=WINDOW_DAYS)
    n = 0
    for lp in list_paths:
        cur = doc
        for k in lp:
            cur = cur.get(k) if isinstance(cur, dict) else None
        if not isinstance(cur, list):
            continue
        for m in cur:
            if not isinstance(m, dict):
                continue
            date_iso = m.get(date_key)
            venue = m.get(venue_key)
            if not date_iso or not venue:
                continue
            try:
                d = _dt.datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                continue
            if d.tzinfo is None:
                d = d.replace(tzinfo=_dt.timezone.utc)
            if d < now or d > horizon:
                continue
            ll = geocode(venue, cache)
            if not ll:
                continue
            w = hourly_at(ll[0], ll[1], date_iso)
            if w:
                m["weather"] = w
                n += 1
            time.sleep(0.15)  # be polite to free API
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    return n


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    cache = load_cache()
    now = _dt.datetime.now(_dt.timezone.utc)
    total = 0
    for path, list_paths, date_key, venue_key in TARGETS:
        n = enrich(path, list_paths, date_key, venue_key, cache, now)
        if n:
            print(f"  + enriched {n} fixtures in {path.name}")
        total += n
    save_cache(cache)
    print(f"weather enrichment: {total} fixtures updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
