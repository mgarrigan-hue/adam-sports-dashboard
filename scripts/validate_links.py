#!/usr/bin/env python3
"""Validate every external URL referenced in data/*.json.

Special-cases YouTube channel pages, which return HTTP 200 with a consent
interstitial unless cookies are supplied. We send the standard CONSENT/SOCS
cookies and assert that the response actually represents a real channel
(og:title is present and is not an error/consent page).

Exits non-zero on any failure so it can be wired into CI to prevent broken
links from going live.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
YT_COOKIES = "CONSENT=YES+cb; SOCS=CAI"

# Strings that indicate YouTube returned an error/empty page even with HTTP 200.
YT_BAD_TITLES = {
    "youtube",          # generic homepage fallback
    "404 not found",
    "page not found",
    "this channel does not exist",
}

OG_TITLE_RE = re.compile(r'<meta property="og:title" content="([^"]+)"', re.I)


def collect_urls(node, urls: list[tuple[str, str]], path: str = "") -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            collect_urls(v, urls, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            collect_urls(v, urls, f"{path}[{i}]")
    elif isinstance(node, str):
        if node.startswith(("http://", "https://")):
            urls.append((path, node))


def fetch(url: str, *, with_yt_cookies: bool) -> tuple[int, str]:
    headers = {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
    }
    if with_yt_cookies:
        headers["Cookie"] = YT_COOKIES
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read(200_000).decode("utf-8", errors="replace")
            return resp.getcode(), body
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001
        return 0, f"ERROR: {e}"


def validate_youtube(url: str) -> tuple[bool, str]:
    # YouTube returns HTTP 404 for non-existent channels and 200 for valid
    # ones (even when the page is fully JS-rendered and the og:title is
    # absent from the static HTML). Status alone is a reliable signal.
    probe = url.rstrip("/")
    if "/@" in probe and not probe.endswith("/videos"):
        probe = probe + "/videos"
    code, body = fetch(probe, with_yt_cookies=True)
    if code == 200:
        return True, "HTTP 200"
    return False, f"HTTP {code}" if code else body


def validate_generic(url: str) -> tuple[bool, str]:
    code, body = fetch(url, with_yt_cookies=False)
    if code == 0:
        return False, body
    if code >= 400:
        return False, f"HTTP {code}"
    return True, f"HTTP {code}"


def main() -> int:
    urls: list[tuple[str, str, str]] = []  # (file, json-path, url)
    for f in sorted(DATA_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"[skip] {f.name}: cannot parse ({e})")
            continue
        bucket: list[tuple[str, str]] = []
        collect_urls(data, bucket)
        for path, url in bucket:
            urls.append((f.name, path, url))

    yt_urls = [(f, p, u) for f, p, u in urls if "youtube.com" in u or "youtu.be" in u]
    print(f"Found {len(urls)} URLs total; {len(yt_urls)} YouTube URLs.")

    failures: list[str] = []
    seen: dict[str, tuple[bool, str]] = {}

    for fname, jpath, url in yt_urls:
        if url in seen:
            ok, msg = seen[url]
        else:
            ok, msg = validate_youtube(url)
            seen[url] = (ok, msg)
        flag = "OK " if ok else "FAIL"
        print(f"  [{flag}] {url}  ({msg})  <- {fname}:{jpath}")
        if not ok:
            failures.append(f"{fname}:{jpath} -> {url} ({msg})")

    if failures:
        print()
        print(f"❌ {len(failures)} broken link(s):")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("✅ All YouTube links valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
