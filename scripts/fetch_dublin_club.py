"""Scrape St Mary's College RFC (Dublin club) results & fixtures.

Source: https://www.stmaryscollegerfc.ie/results/ and /fixtures/
The site uses the SportLoMo WordPress plugin, which renders match data
inline as HTML. We parse it with regex (no extra deps) and write
data/dublin_club.json.

The fixtures page accepts a date range via POSTed `fdate` / `tdate`,
but the GET version returns "today + 6 months" by default which is
enough for our needs.
"""
from __future__ import annotations
from html import unescape
from pathlib import Path
import datetime as dt
import json
import re
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "dublin_club.json"
CLUB = "St Mary's College RFC"
SOURCES = [
    ("results",  "https://www.stmaryscollegerfc.ie/results/"),
    ("fixtures", "https://www.stmaryscollegerfc.ie/fixtures/"),
]
HEADERS = {
    "User-Agent": "AdamSportsDashboard/1.0 (+github.com/mgarrigan-hue/adam-sports-dashboard)"
}

DATE_RE  = re.compile(r'date-header[^>]*>\s*<label>\s*(\d{2})/(\d{2})/(\d{4})\s*</label>', re.I | re.S)
COMP_RE  = re.compile(r'compheader.*?<a[^>]*>\s*(.*?)\s*</a>', re.I | re.S)
ROW_RE   = re.compile(r'<ul class="column-six table-body">(.*?)</ul>', re.I | re.S)
TEAM1_RE = re.compile(r'team1[^>]*>\s*<span>\s*(.*?)\s*</span>', re.I | re.S)
TEAM2_RE = re.compile(r'team2[^>]*>\s*<span>\s*(.*?)\s*</span>', re.I | re.S)
SCORE_RE = re.compile(r"vs-result'?>\s*(\d+)\s*<span[^>]*>\s*V\s*</span>\s*(\d+)", re.I | re.S)
TIME_RE  = re.compile(r'>(\d{1,2}:\d{2})<', re.I)
TAG_RE   = re.compile(r'<[^>]+>')


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def strip_tags(s: str) -> str:
    return unescape(TAG_RE.sub('', s)).strip()


def parse_page(html: str, kind: str) -> list[dict]:
    """Walk the page in document order, tracking current date and competition."""
    # Tokenize: find all date-headers, compheaders, and match rows in order.
    tokens: list[tuple[int, str, object]] = []
    for m in DATE_RE.finditer(html):
        d, mo, y = m.groups()
        tokens.append((m.start(), "date", f"{y}-{mo}-{d}"))
    for m in COMP_RE.finditer(html):
        tokens.append((m.start(), "comp", strip_tags(m.group(1))))
    for m in ROW_RE.finditer(html):
        tokens.append((m.start(), "row", m.group(1)))
    tokens.sort(key=lambda t: t[0])

    matches = []
    cur_date = None
    cur_comp = None
    for _, kind_t, val in tokens:
        if kind_t == "date":
            cur_date = val
        elif kind_t == "comp":
            cur_comp = val
        elif kind_t == "row":
            row = val
            t1 = TEAM1_RE.search(row); t2 = TEAM2_RE.search(row)
            if not t1 or not t2:
                continue
            home = strip_tags(t1.group(1))
            away = strip_tags(t2.group(1))
            sc = SCORE_RE.search(row)
            home_score = away_score = None
            if sc:
                home_score, away_score = int(sc.group(1)), int(sc.group(2))
            tm = TIME_RE.search(row)
            time_str = tm.group(1) if tm else None
            iso_date = cur_date
            if iso_date and time_str:
                iso_date = f"{cur_date}T{time_str}:00+01:00"
            elif iso_date:
                iso_date = f"{cur_date}T12:00:00+01:00"
            matches.append({
                "date": iso_date,
                "home": home,
                "away": away,
                "home_score": home_score,
                "away_score": away_score,
                "competition": cur_comp or "Dublin Club Rugby",
                "involves_smc": (CLUB.lower() in home.lower() or CLUB.lower() in away.lower()
                                  or "st marys college" in home.lower() or "st marys college" in away.lower()
                                  or "smc" in home.lower().split() or "smc" in away.lower().split()
                                  or "smtc" in home.lower().split() or "smtc" in away.lower().split()),
            })
    return matches


def main() -> int:
    out: dict = {
        "club": CLUB,
        "results": [],
        "fixtures": [],
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    for kind, url in SOURCES:
        try:
            html = http_get(url)
        except Exception as e:
            print(f"[dublin_club] WARN: failed to fetch {url}: {e}", file=sys.stderr)
            continue
        items = parse_page(html, kind)
        # Results page lists past matches (have scores); fixtures page lists upcoming.
        if kind == "results":
            out["results"] = [m for m in items if m["home_score"] is not None]
        else:
            out["fixtures"] = [m for m in items if m["home_score"] is None]

    out["results"].sort(key=lambda m: m["date"] or "", reverse=True)
    out["fixtures"].sort(key=lambda m: m["date"] or "")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[dublin_club] {len(out['results'])} results, {len(out['fixtures'])} fixtures -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
