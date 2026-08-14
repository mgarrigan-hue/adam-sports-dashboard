# Adam's Sports Dashboard 🏁🏉

A personal, install-as-an-app sports dashboard for Adam — tracking Formula 1,
international & Irish rugby, and the 2026 rugby Nations
Championship. Everything is sorted by recency so the most recent action is always
at the top, with Adam's teams highlighted throughout.

**Live site:** https://adam.garrigan.me
(also https://mgarrigan-hue.github.io/adam-sports-dashboard/)

## Features
- 🏉 **Rugby** — international, Irish provinces (URC), Leinster schools, Adam's
  club (St Mary's College RFC), plus the 2026 Nations Championship.
- 🏆 **Auto-appearing tournaments** — big events (Rugby World Cup, Six Nations,
  Leinster Schools Cup) grow their own section + nav tab as they approach, get
  a countdown, then a live tracker, then a recap — and retire themselves
  automatically. Fully config-driven, see below.
- 🏎️ **Formula 1** — race-weekend timeline, standings, recent races.
- 📱 **Installable PWA** — add to Home Screen on iPhone/Android, offline-capable,
  match reminders.
- 🎨 Premium, responsive UI (dark/light) that works on phone and desktop.

## How it works
- 100% static site (HTML / CSS / vanilla JS) hosted on GitHub Pages.
- A scheduled GitHub Action (every 30 min) runs Python + Node fetchers that pull
  data from public APIs / pages and writes JSON files into `data/`.
- The frontend reads `data/*.json` at page load and renders the dashboard.

## Data sources
| Sport | Source |
|---|---|
| F1 | [jolpi.ca](https://api.jolpi.ca/ergast/f1) (Ergast mirror, free) |
| International rugby | BBC Sport rugby union pages |
| Irish provinces (URC) | BBC Sport rugby union pages |
| Leinster schools | leinsterrugby.ie + schoolsrugby.ie |
| Nations Championship 2026 | ESPN hidden API (`rugby/17567`) — results, fixtures, live scores |
| Tournaments | ESPN hidden API, or derived from another `data/*.json` — see below |

## Tournament engine 🏆

Big tournaments shouldn't need a code change, and shouldn't clutter the page for
the 10 months a year they aren't on. `scripts/tournaments.config.json` is the
single source of truth — add an entry and the dashboard does the rest.

Each tournament moves through phases automatically:

| Phase | When | What Adam sees |
|---|---|---|
| `far` | more than `lead_days` before the start | nothing — not even fetched |
| `soon` | within `lead_days` of the start | section appears with a big countdown |
| `live` | between `start` and `end` | "Under way", progress bar, next/live matches |
| `recap` | up to `recap_days` after the end | "That's a wrap" + final results |
| `past` | after that | section and nav tab remove themselves |

Adding a tournament:

```jsonc
{
  "id": "six-nations-2027",          // slug, becomes the #t-six-nations-2027 anchor
  "label": "Six Nations 2027",
  "emoji": "🏆",
  "blurb": "Ireland's Championship campaign",
  "start": "2027-02-06",
  "end":   "2027-03-20",
  "lead_days": 45,                    // appear 45 days early
  "recap_days": 14,                   // linger 14 days after
  "fav_teams": ["Ireland"],           // highlighted in the tables
  "source": { "type": "espn", "sport": "rugby", "league": "180659" }
}
```

Two source types:
- `espn` — ESPN's public scoreboard API. Verified rugby league IDs:
  `180659` Six Nations · `164205` Rugby World Cup · `244293` The Rugby
  Championship · `17567` Nations Championship. (`270559` is French Top 14, not
  the URC.)
- `local` — derive it from a feed we already fetch, e.g. pull the Senior Cup out
  of `schools.json`: `{ "type": "local", "file": "schools.json", "match": "Senior Cup" }`.
  Matches are filtered by competition name **and** the tournament's date window,
  so last season's Cup never leaks into this season's section.

Previewing a tournament that isn't due for months:

```bash
# generate what the data WOULD look like on that date, without touching real data
node scripts/fetch_tournaments.mjs --date=2027-10-05 --out=data/preview.json
cp data/preview.json data/tournaments.json

# then load the site with a matching ?tdate= to see it rendered
# http://localhost:8000/?tdate=2027-10-05
```

ESPN only publishes fixtures a few months ahead, so an empty feed for a distant
tournament is expected — the section shows a friendly "fixtures not published
yet" message and fills in automatically once they are.

## Local development
```bash
# 1. refresh data (writes data/*.json)
python scripts/fetch_f1.py
python scripts/fetch_intl_rugby.py
python scripts/fetch_provinces.py
python scripts/fetch_schools.py
node scripts/fetch_nations_championship.mjs  # Nations Championship (ESPN rugby)
node scripts/fetch_tournaments.mjs          # auto-appearing big tournaments

# 2. serve the site
python -m http.server 8000
# then open http://localhost:8000
```

## Personalization
Adam's teams are highlighted automatically:
- 🏎️ F1: **Red Bull / VCARB / Isack Hadjar**
- 🏉 Rugby: **Leinster** (provinces) · **Ireland** (Nations Championship)
