# Adam's Sports Dashboard 🏁🏉⚽

A personal, install-as-an-app sports dashboard for Adam — tracking Formula 1,
international & Irish rugby, the FIFA World Cup 2026, and the 2026 rugby Nations
Championship. Everything is sorted by recency so the most recent action is always
at the top, with Adam's teams highlighted throughout.

**Live site:** https://adam.garrigan.me
(also https://mgarrigan-hue.github.io/adam-sports-dashboard/)

## Features
- ⚽ **World Cup 2026** — forward-looking view: current-stage hero (Brazil's next
  match + countdown to the final), today's matches, a real knockout bracket
  (Round of 16 → Final) with penalty results and TBD slots, group standings with
  qualification-zone colours, and a live top-scorers table.
- 🏉 **Rugby** — international, Irish provinces (URC), Leinster schools, Adam's
  club (St Mary's College RFC), plus the 2026 Nations Championship.
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
| FIFA World Cup 2026 | ESPN hidden API (`soccer/fifa.world`) — live scores, knockout bracket, penalties |
| Nations Championship 2026 | ESPN hidden API (`rugby/17567`) — results, fixtures, live scores |

## Local development
```bash
# 1. refresh data (writes data/*.json)
python scripts/fetch_f1.py
python scripts/fetch_intl_rugby.py
python scripts/fetch_provinces.py
python scripts/fetch_schools.py
node scripts/fetch_world_cup.mjs             # World Cup (real ESPN data, Node ≥18)
node scripts/fetch_nations_championship.mjs  # Nations Championship (ESPN rugby)

# 2. serve the site
python -m http.server 8000
# then open http://localhost:8000
```

## Personalization
Adam's teams are highlighted automatically:
- 🏎️ F1: **Red Bull / VCARB / Isack Hadjar**
- 🏉 Rugby: **Leinster** (provinces) · **Ireland** (Nations Championship)
- ⚽ World Cup: **Brazil**
