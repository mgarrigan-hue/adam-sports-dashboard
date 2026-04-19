"""News fetcher — pulls RSS/Atom feeds from F1 and rugby sources.

Writes a unified, de-duplicated, sorted feed to data/news.json.
Standard library only (Python 3.12).
"""
from __future__ import annotations

import json
import re
import sys
import datetime as dt
import urllib.request
import urllib.error
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

# Use defusedxml to harden against entity-expansion / billion-laughs attacks
# from any compromised upstream feed. Falls back to stdlib for local dev if
# defusedxml isn't installed (CI installs it).
try:
    from defusedxml.ElementTree import fromstring as _safe_fromstring
except ImportError:  # pragma: no cover
    _safe_fromstring = ET.fromstring

OUT = Path(__file__).resolve().parent.parent / "data" / "news.json"
USER_AGENT = "Mozilla/5.0 (compatible; adam-dashboard/1.0)"
TIMEOUT = 20
MAX_ITEMS = 60
SUMMARY_LEN = 200

FEEDS = [
    ("F1.com - Latest",       "f1",          "https://www.formula1.com/content/fom-website/en/latest/all.xml"),
    ("BBC Sport - F1",        "f1",          "https://feeds.bbci.co.uk/sport/formula1/rss.xml"),
    ("BBC Sport - Rugby Union","rugby",      "https://feeds.bbci.co.uk/sport/rugby-union/rss.xml"),
    ("RTÉ - Rugby",           "irish-rugby", "https://www.rte.ie/feeds/rss/?index=/sport/rugby/"),
    ("Irish Rugby",           "irish-rugby", "https://www.irishrugby.ie/feed/"),
]

# Strip XML namespaces for easier traversal.
_NS_RE = re.compile(r"^\{[^}]+\}")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def localname(tag: str) -> str:
    return _NS_RE.sub("", tag)


def find_child(elem, name: str):
    for c in elem:
        if localname(c.tag) == name:
            return c
    return None


def find_children(elem, name: str):
    return [c for c in elem if localname(c.tag) == name]


def strip_html(s: str) -> str:
    if not s:
        return ""
    s = _TAG_RE.sub(" ", s)
    # Decode common entities.
    s = (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
           .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
           .replace("&apos;", "'"))
    s = _WS_RE.sub(" ", s).strip()
    return s


def to_iso_utc(s: str) -> str:
    if not s:
        return ""
    s = s.strip()
    # Try RFC 822 (RSS).
    try:
        d = parsedate_to_datetime(s)
        if d is not None:
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, IndexError):
        pass
    # Try ISO-8601 (Atom). Handle trailing Z.
    iso = s.replace("Z", "+00:00")
    try:
        d = dt.datetime.fromisoformat(iso)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return ""


def parse_rss(root, source: str, category: str):
    items = []
    channel = find_child(root, "channel")
    if channel is None:
        channel = root
    for it in find_children(channel, "item"):
        title = (find_child(it, "title").text if find_child(it, "title") is not None else "") or ""
        link_el = find_child(it, "link")
        url = (link_el.text if link_el is not None else "") or ""
        desc_el = find_child(it, "description")
        desc = (desc_el.text if desc_el is not None else "") or ""
        date_el = find_child(it, "pubDate")
        if date_el is None:
            date_el = find_child(it, "date")
        published = to_iso_utc(date_el.text if date_el is not None else "")
        items.append(_make_item(title, desc, url, source, category, published))
    return items


def parse_atom(root, source: str, category: str):
    items = []
    for it in find_children(root, "entry"):
        title_el = find_child(it, "title")
        title = (title_el.text if title_el is not None else "") or ""
        # link: prefer rel="alternate" or first link with href.
        url = ""
        for l in find_children(it, "link"):
            href = l.get("href")
            if not href:
                continue
            rel = l.get("rel", "alternate")
            if rel == "alternate":
                url = href
                break
            if not url:
                url = href
        summary_el = find_child(it, "summary")
        if summary_el is None:
            summary_el = find_child(it, "content")
        desc = (summary_el.text if summary_el is not None else "") or ""
        date_el = find_child(it, "updated")
        if date_el is None:
            date_el = find_child(it, "published")
        published = to_iso_utc(date_el.text if date_el is not None else "")
        items.append(_make_item(title, desc, url, source, category, published))
    return items


def _make_item(title, desc, url, source, category, published):
    summary = strip_html(desc)
    if len(summary) > SUMMARY_LEN:
        summary = summary[:SUMMARY_LEN].rstrip() + "…"
    return {
        "title": strip_html(title),
        "summary": summary,
        "url": (url or "").strip(),
        "source": source,
        "category": category,
        "published": published,
    }


def parse_feed(raw: bytes, source: str, category: str):
    root = _safe_fromstring(raw)
    tag = localname(root.tag).lower()
    if tag == "rss":
        return parse_rss(root, source, category)
    if tag == "feed":
        return parse_atom(root, source, category)
    if tag == "channel":
        return parse_rss(root, source, category)
    # Fallback: try RSS-style parse.
    return parse_rss(root, source, category)


def main() -> int:
    all_items = []
    feeds_ok = 0
    failures = []
    for source, category, url in FEEDS:
        try:
            raw = fetch(url)
            items = parse_feed(raw, source, category)
            items = [i for i in items if i["url"] and i["title"]]
            all_items.extend(items)
            feeds_ok += 1
            print(f"  ok  {source}: {len(items)} items", file=sys.stderr)
        except (urllib.error.URLError, ET.ParseError, TimeoutError, OSError, ValueError) as e:
            failures.append((source, str(e)))
            print(f"  FAIL {source}: {e}", file=sys.stderr)

    # De-dupe by URL (keep first occurrence).
    seen = set()
    deduped = []
    for it in all_items:
        u = it["url"]
        if u in seen:
            continue
        seen.add(u)
        deduped.append(it)

    # Sort by published desc; empties last.
    deduped.sort(key=lambda i: i["published"] or "", reverse=True)
    deduped = deduped[:MAX_ITEMS]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": deduped,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"wrote {OUT} — {len(deduped)} items from {feeds_ok} feeds")
    if failures:
        print(f"  ({len(failures)} feed(s) failed: {', '.join(s for s, _ in failures)})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
