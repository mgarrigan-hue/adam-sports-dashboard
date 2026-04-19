# Adam's Sports Dashboard 🏁🏉

A personal sports dashboard for Adam — tracking Formula 1, international rugby,
the Irish provinces (URC), and Leinster schools rugby. Items are sorted by
recency across every sport so the most recent action is always at the top.

**Live site:** https://mgarrigan-hue.github.io/adam-sports-dashboard/

## How it works
- 100% static site (HTML / CSS / vanilla JS) hosted on GitHub Pages.
- A scheduled GitHub Action (every 30 min) runs Python fetchers that pull data
  from public APIs / pages and writes JSON files into `data/`.
- The frontend reads `data/*.json` at page load and renders the dashboard.

## Data sources
| Sport | Source |
|---|---|
| F1 | [jolpi.ca](https://api.jolpi.ca/ergast/f1) (Ergast mirror, free) |
| International rugby | BBC Sport rugby union pages |
| Irish provinces (URC) | BBC Sport rugby union pages |
| Leinster schools | leinsterrugby.ie + schoolsrugby.ie |

## Local development
```bash
# 1. refresh data (writes data/*.json)
python scripts/fetch_f1.py
python scripts/fetch_intl_rugby.py
python scripts/fetch_provinces.py
python scripts/fetch_schools.py

# 2. serve the site
python -m http.server 8000
# then open http://localhost:8000
```

## Personalization
Adam's favourites are highlighted automatically:
- 🏎️ F1: **Red Bull / VCARB / Isack Hadjar**
- 🏉 Rugby: **Leinster**
