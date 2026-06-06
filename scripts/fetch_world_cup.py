"""FIFA World Cup 2026 fetcher.

Loads the embedded 104-match schedule from scripts/wc_fallback.json (the
canonical fallback shipped with the repo) and tries to overlay live status +
scores + standings from BBC Sport. If BBC fails entirely the fallback is
written verbatim with a fresh generated_at — the frontend always has data.

Standard library only (plus defusedxml if/when needed for HTML hardening).
"""
from __future__ import annotations
import json
import re
import sys
import datetime as dt
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FALLBACK = Path(__file__).resolve().parent / "wc_fallback.json"
OUT = ROOT / "data" / "world_cup.json"

USER_AGENT = "Mozilla/5.0 (compatible; adam-dashboard/1.0; +https://adam.garrigan.me)"
TIMEOUT = 20

BBC_PAGES = [
    "https://www.bbc.com/sport/football/world-cup/scores-fixtures",
    "https://www.bbc.com/sport/football/world-cup/table",
    "https://www.bbc.com/sport/football/world-cup/top-scorers",
]


def now_iso() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def fetch_text(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = r.read()
        # BBC is utf-8; decode loosely so weird bytes never crash us.
        return data.decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        print(f"  ! BBC fetch failed for {url}: {e}", file=sys.stderr)
        return None


def derive_stage(today: dt.date, start: dt.date, end: dt.date) -> str:
    """Time-based stage approximation when BBC overlay isn't available."""
    if today < start:
        return "pre-tournament"
    if today > end:
        return "complete"
    # Group: Jun 11 – Jun 27 ; R32 28 Jun – 3 Jul ; R16 4–8 Jul ;
    # QF 10–11 Jul ; SF 14–15 Jul ; 3rd 18 Jul ; Final 19 Jul.
    days = {
        "group": (dt.date(2026, 6, 11), dt.date(2026, 6, 27)),
        "round-of-32": (dt.date(2026, 6, 28), dt.date(2026, 7, 3)),
        "round-of-16": (dt.date(2026, 7, 4), dt.date(2026, 7, 8)),
        "quarter-final": (dt.date(2026, 7, 9), dt.date(2026, 7, 11)),
        "semi-final": (dt.date(2026, 7, 12), dt.date(2026, 7, 15)),
        "final": (dt.date(2026, 7, 16), dt.date(2026, 7, 19)),
    }
    for label, (s, e) in days.items():
        if s <= today <= e:
            return label
    return "group"


def mark_live_status(matches: list[dict]) -> tuple[int, int]:
    """Without parsed scores, infer kickoff-window 'live' purely from clock.
    A real BBC overlay would replace this; this still gives sensible UX.
    Returns (live_count, complete_count).
    """
    now = dt.datetime.now(dt.timezone.utc)
    live = 0
    complete = 0
    for m in matches:
        try:
            kickoff = dt.datetime.fromisoformat(m["date"].replace("Z", "+00:00"))
        except Exception:
            continue
        # Status only changes when fetcher hasn't been able to pull a real
        # score. We treat 0–110 min window as "live", >110 min as "complete-ish"
        # ONLY if we have no score data (so the UI still shows the match as
        # finished after the clock passes). BBC overlay (TODO) will override.
        delta = (now - kickoff).total_seconds() / 60.0
        if m.get("score") is None and m.get("status") == "scheduled":
            if 0 <= delta <= 110:
                m["status"] = "live"
                live += 1
            elif delta > 110:
                m["status"] = "complete-unknown"
                complete += 1
    return live, complete


# --- BBC overlay (best-effort; degrades silently) -------------------------
_SCORE_RE = re.compile(
    r'<span[^>]+class="[^"]*sp-c-fixture__number[^"]*"[^>]*>(\d+)</span>',
    re.IGNORECASE,
)


def try_bbc_overlay(payload: dict) -> int:
    """Lightweight BBC scrape. Returns count of matches successfully overlaid.

    BBC's markup changes frequently and we have no API access, so this is
    deliberately defensive: failures here never break the build.
    """
    overlaid = 0
    for url in BBC_PAGES:
        html = fetch_text(url)
        if not html:
            continue
        # Today's parser surface area: just look for any "score" tokens so we
        # at least log that the page was reachable. Real per-fixture mapping
        # would need BBC's fragment IDs — left as TODO until tournament starts
        # and we can see the live markup.
        scores = _SCORE_RE.findall(html)
        print(f"  ~ BBC reachable: {url} ({len(scores)} score tokens seen)")
    return overlaid


def main() -> int:
    if not FALLBACK.exists():
        print(f"FATAL: {FALLBACK} missing — cannot continue.", file=sys.stderr)
        return 1
    try:
        payload = json.loads(FALLBACK.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FATAL: fallback JSON invalid: {e}", file=sys.stderr)
        return 1

    payload["generated_at"] = now_iso()
    payload.setdefault("source", "embedded-fallback")

    today = dt.datetime.now(dt.timezone.utc).date()
    start = dt.date(2026, 6, 11)
    end = dt.date(2026, 7, 19)
    payload["tournament"]["current_stage"] = derive_stage(today, start, end)

    try:
        overlaid = try_bbc_overlay(payload)
        if overlaid:
            payload["source"] = "bbc-overlay+fallback"
    except Exception as e:  # noqa: BLE001 — never fail the pipeline
        print(f"  ! BBC overlay raised, ignoring: {e}", file=sys.stderr)

    live, completeish = mark_live_status(payload["matches"])

    # Validate before write.
    try:
        json.dumps(payload)
    except (TypeError, ValueError) as e:
        print(f"FATAL: refusing to write invalid JSON: {e}", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    total = len(payload["matches"])
    print(
        f"wrote {OUT} — {total} matches, {live} live-window, "
        f"{completeish} past-kickoff, stage={payload['tournament']['current_stage']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
