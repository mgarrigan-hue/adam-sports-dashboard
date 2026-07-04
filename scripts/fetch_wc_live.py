"""FIFA World Cup 2026 — LIVE COMMENTARY fetcher (Item K, v34).

Self-gating: this script runs every refresh tick but exits immediately
unless the tournament is in its "during" window AND there is at least one
Brazil match either live (kickoff <= now <= kickoff + 2.5h) or starting in
the next 30 minutes.

Source priority (first hit wins):
  1. The-Sports-DB v1 (free, no API key, rate-limited ~100 req/day per IP).
     eventsday.php?d=YYYY-MM-DD&l=Soccer  → find idEvent
     lookuptimeline.php?id=NN             → events (goal/card/sub/etc.)
  2. ESPN site.api scoreboard (free, undocumented but stable).
     site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
     For each event, fetch summary?event=<id> → details[]
  3. BBC Sport page scrape (DOM changes frequently — best-effort).

On success we merge a `commentary: [...]` array into the matching
data/world_cup.json match. On failure (all three blocked/empty from the
GitHub Actions runner IPs) we just log and exit 0 — the UI keeps its
"Awaiting commentary source confirmation" placeholder. Mark can wire a
football-data.org key later if needed.

The commentary event schema we write is intentionally small and stable:
  { minute, type, team, player, detail, text }
The frontend (wc.js → renderWcCommentary) tolerates missing keys.

Standard-library only.
"""
from __future__ import annotations

import json
import sys
import re
import datetime as dt
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "world_cup.json"

USER_AGENT = "Mozilla/5.0 (compatible; adam-dashboard/1.0; +https://adam.garrigan.me)"
TIMEOUT = 15

WC_START = dt.date(2026, 6, 11)
WC_END = dt.date(2026, 7, 19)

# A match is "live or imminent" if it kicks off within +/- this window.
LIVE_WINDOW_MIN_BEFORE = 30          # start scraping 30 minutes before kickoff
LIVE_WINDOW_MIN_AFTER = 150          # keep scraping for 2.5h after kickoff

BRAZIL_ALIASES = {"brazil", "brasil", "bra"}

# ---------------------------------------------------------------------------
# Tiny HTTP helper — never raises, returns (status_or_None, body_text_or_None).
# ---------------------------------------------------------------------------
def _http(url: str, accept: str = "application/json") -> tuple[int | None, str | None]:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": accept},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError,) as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"  ! HTTP fail {url}: {e}", file=sys.stderr)
        return None, None


# ---------------------------------------------------------------------------
# Gating: do we have any Brazil match live or imminent?
# ---------------------------------------------------------------------------
def find_target_matches(payload: dict) -> list[dict]:
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()
    if today < WC_START or today > WC_END:
        return []
    out: list[dict] = []
    for m in payload.get("matches", []):
        try:
            kickoff = dt.datetime.fromisoformat(str(m.get("date", "")).replace("Z", "+00:00"))
        except Exception:
            continue
        home = (m.get("home", {}).get("name") or "").lower()
        away = (m.get("away", {}).get("name") or "").lower()
        if not (home in BRAZIL_ALIASES or "brazil" in home or "brazil" in away or away in BRAZIL_ALIASES):
            continue
        delta_min = (now - kickoff).total_seconds() / 60.0
        if -LIVE_WINDOW_MIN_BEFORE <= delta_min <= LIVE_WINDOW_MIN_AFTER:
            out.append(m)
    return out


# ---------------------------------------------------------------------------
# Source 1: The-Sports-DB v1
# ---------------------------------------------------------------------------
def _tsdb_find_event(date_iso: str, home: str, away: str) -> str | None:
    url = f"https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d={date_iso}&l=Soccer"
    status, body = _http(url)
    if status != 200 or not body:
        return None
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    events = data.get("events") or []
    h, a = home.lower(), away.lower()
    for ev in events:
        eh = (ev.get("strHomeTeam") or "").lower()
        ea = (ev.get("strAwayTeam") or "").lower()
        if (h in eh or eh in h) and (a in ea or ea in a):
            return str(ev.get("idEvent") or "") or None
        # Brazil might be home or away; swap-tolerant
        if (h in ea or ea in h) and (a in eh or eh in a):
            return str(ev.get("idEvent") or "") or None
    return None


def _tsdb_timeline(event_id: str) -> list[dict]:
    url = f"https://www.thesportsdb.com/api/v1/json/3/lookuptimeline.php?id={event_id}"
    status, body = _http(url)
    if status != 200 or not body:
        return []
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []
    raw = data.get("timeline") or []
    out: list[dict] = []
    for ev in raw:
        kind_raw = (ev.get("strTimeline") or ev.get("strType") or "").lower()
        # Normalise to our small vocabulary.
        if "goal" in kind_raw:
            kind = "goal"
        elif "yellow" in kind_raw:
            kind = "yellow"
        elif "red" in kind_raw:
            kind = "red"
        elif "sub" in kind_raw:
            kind = "sub"
        elif "kick" in kind_raw and "off" in kind_raw:
            kind = "kickoff"
        elif "half" in kind_raw and "time" in kind_raw:
            kind = "halftime"
        elif "full" in kind_raw and "time" in kind_raw:
            kind = "fulltime"
        else:
            kind = "info"
        team = ev.get("strTeam") or ""
        player = ev.get("strPlayer") or ev.get("strPlayer1") or ""
        detail = ev.get("strTimelineDetail") or ev.get("strDescription") or ""
        minute = ev.get("intTime") or ev.get("strTime") or ""
        text_parts = [p for p in (player, detail) if p]
        out.append({
            "minute": str(minute or ""),
            "type": kind,
            "team": team,
            "player": player,
            "detail": detail,
            "text": " — ".join(text_parts) or kind.title(),
        })
    return out


def try_tsdb(match: dict) -> list[dict]:
    date_iso = str(match.get("date", ""))[:10]
    if not date_iso:
        return []
    home = match.get("home", {}).get("name") or ""
    away = match.get("away", {}).get("name") or ""
    ev_id = _tsdb_find_event(date_iso, home, away)
    if not ev_id:
        return []
    print(f"  ~ TSDB matched event id={ev_id} for {home} vs {away}")
    return _tsdb_timeline(ev_id)


# ---------------------------------------------------------------------------
# Source 2: ESPN site.api scoreboard
# ---------------------------------------------------------------------------
def try_espn(match: dict) -> list[dict]:
    date_iso = str(match.get("date", ""))[:10].replace("-", "")
    if not date_iso:
        return []
    url = (
        "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/"
        f"scoreboard?dates={date_iso}"
    )
    status, body = _http(url)
    if status != 200 or not body:
        return []
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []
    home_l = (match.get("home", {}).get("name") or "").lower()
    away_l = (match.get("away", {}).get("name") or "").lower()
    target_id = None
    for ev in (data.get("events") or []):
        teams = [
            (c.get("team", {}).get("displayName") or "").lower()
            for comp in (ev.get("competitions") or [])
            for c in (comp.get("competitors") or [])
        ]
        joined = " ".join(teams)
        if home_l and away_l and home_l in joined and away_l in joined:
            target_id = str(ev.get("id") or "")
            break
    if not target_id:
        return []
    print(f"  ~ ESPN matched event id={target_id}")
    s2, body2 = _http(
        "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/"
        f"summary?event={target_id}"
    )
    if s2 != 200 or not body2:
        return []
    try:
        summary = json.loads(body2)
    except json.JSONDecodeError:
        return []
    out: list[dict] = []
    for d in (summary.get("details") or []):
        typ = ((d.get("type") or {}).get("text") or "").lower()
        if "goal" in typ:
            kind = "goal"
        elif "yellow" in typ:
            kind = "yellow"
        elif "red" in typ:
            kind = "red"
        elif "substitut" in typ:
            kind = "sub"
        else:
            kind = "info"
        team = ((d.get("team") or {}).get("displayName")) or ""
        player = ((d.get("athletesInvolved") or [{}])[0].get("displayName")) or ""
        clock = ((d.get("clock") or {}).get("displayValue")) or ""
        detail = (d.get("type") or {}).get("text") or ""
        text_parts = [p for p in (player, detail) if p]
        out.append({
            "minute": clock,
            "type": kind,
            "team": team,
            "player": player,
            "detail": detail,
            "text": " — ".join(text_parts) or kind.title(),
        })
    return out


# ---------------------------------------------------------------------------
# Source 3: BBC scrape — minimal, best-effort. Returns reachable signal only.
# ---------------------------------------------------------------------------
def try_bbc(match: dict) -> list[dict]:
    # Without a stable URL pattern for individual match pages we just
    # confirm BBC reachability. Real per-event parsing is future work.
    status, _ = _http("https://www.bbc.com/sport/football/world-cup/scores-fixtures", accept="text/html")
    if status == 200:
        print("  ~ BBC reachable but per-event parsing not implemented (DOM unstable)")
    return []


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def fetch_for_match(match: dict) -> tuple[str, list[dict]]:
    for name, fn in (("tsdb", try_tsdb), ("espn", try_espn), ("bbc", try_bbc)):
        try:
            events = fn(match)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {name} raised, continuing: {e}", file=sys.stderr)
            events = []
        if events:
            return name, events
    return "none", []


def main() -> int:
    if not OUT.exists():
        print(f"  · {OUT} missing — run fetch_world_cup.mjs first.")
        return 0
    try:
        payload = json.loads(OUT.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FATAL: world_cup.json invalid: {e}", file=sys.stderr)
        return 0  # never fail the pipeline
    targets = find_target_matches(payload)
    if not targets:
        print("  · No Brazil match live or imminent — skipping live commentary fetch.")
        return 0

    changed = False
    for m in targets:
        home = m.get("home", {}).get("name") or "?"
        away = m.get("away", {}).get("name") or "?"
        print(f"  > Brazil match in window: {home} vs {away} ({m.get('date')})")
        source, events = fetch_for_match(m)
        if not events:
            print(f"    · all sources empty; keeping placeholder for {m.get('id')}")
            continue
        # Stable de-dup: by (minute, type, player) tuple. Merge with any
        # existing commentary so we don't lose earlier ticks if the upstream
        # truncates the timeline.
        existing = m.get("commentary") or []
        seen = {(str(e.get("minute","")), e.get("type",""), e.get("player","")) for e in existing}
        merged = list(existing)
        for ev in events:
            key = (str(ev.get("minute","")), ev.get("type",""), ev.get("player",""))
            if key in seen:
                continue
            seen.add(key)
            merged.append(ev)
        # Sort by minute (numeric where possible) ascending.
        def _mkey(ev):
            raw = re.sub(r"[^0-9]", "", str(ev.get("minute", "")))
            try:
                return int(raw or 0)
            except ValueError:
                return 0
        merged.sort(key=_mkey)
        m["commentary"] = merged
        m["commentary_source"] = source
        m["commentary_fetched_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        print(f"    ✓ wrote {len(events)} event(s) from {source} (total {len(merged)})")
        changed = True

    if not changed:
        return 0

    try:
        json.dumps(payload)
    except (TypeError, ValueError) as e:
        print(f"FATAL: refusing to write invalid JSON: {e}", file=sys.stderr)
        return 0
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"  · live commentary merged into {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
