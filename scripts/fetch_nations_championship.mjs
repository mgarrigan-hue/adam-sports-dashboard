// Adam's Sports Dashboard — 2026 Nations Championship fetcher (Node, zero deps).
//
// The inaugural rugby Nations Championship (Southern Hemisphere series is live
// in Australia + others right now, Northern series in November, finals in
// London 27-29 Nov). Pulls real fixtures/results from ESPN's public rugby API
// (league 17567) and writes data/nations_championship.json in the same shape
// as the other rugby feeds (results[] / fixtures[]), so the frontend reuses
// renderRugbyMatches. Requires Node 18+ (global fetch).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'nations_championship.json');

const LEAGUE = '17567';
const UA = 'Mozilla/5.0 (compatible; adam-dashboard/1.0)';
const TIMEOUT_MS = 25000;
const COMPETITION = 'Nations Championship';
// Whole-tournament window: July SH series + November NH series + Nov finals.
const DATE_WINDOW = '20260701-20261201';

const SCORING_TYPES = new Set([
  'try', 'penalty try', 'conversion', 'penalty goal',
  'drop goal', 'yellow card', 'red card',
]);

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function halfTime(team) {
  const ls = team.linescores || [];
  if (!ls.length) return null;
  for (const l of ls) {
    if (l.period === 1) {
      const v = parseInt(l.value, 10);
      return Number.isFinite(v) ? v : null;
    }
  }
  return null;
}

function parseEvent(ev) {
  const comp = (ev.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const type = ev.status?.type || {};
  const status = type.name || '';
  const state = type.state || '';
  const completed = type.completed === true ||
    status === 'STATUS_FINAL' || status === 'STATUS_FULL_TIME';
  const live = state === 'in';

  const venue = comp.venue?.fullName
    ? [comp.venue.fullName, comp.venue.address?.city].filter(Boolean).join(', ')
    : '';

  const entry = {
    date: ev.date,
    home: home.team?.displayName || home.team?.name || 'TBD',
    away: away.team?.displayName || away.team?.name || 'TBD',
    home_logo: home.team?.logo || '',
    away_logo: away.team?.logo || '',
    competition: COMPETITION,
    venue,
    status: status || null,
    status_state: state || null,
  };

  if (completed || live) {
    const hs = parseInt(home.score, 10);
    const as = parseInt(away.score, 10);
    if (Number.isFinite(hs)) entry.home_score = hs;
    if (Number.isFinite(as)) entry.away_score = as;
  }
  if (completed) {
    const htH = halfTime(home);
    const htA = halfTime(away);
    if (htH != null && htA != null) {
      const total = (entry.home_score || 0) + (entry.away_score || 0);
      if (htH + htA > 0 || total === 0) entry.half_time = `${htH}-${htA}`;
    }

    const idToName = {
      [String(home.team?.id)]: entry.home,
      [String(away.team?.id)]: entry.away,
    };
    const scorers = [];
    for (const d of comp.details || []) {
      const t = ((d.type || {}).text || '').toLowerCase();
      if (!SCORING_TYPES.has(t)) continue;
      const clock = (d.clock || {}).displayValue || '';
      const teamName = idToName[String((d.team || {}).id || '')] || '';
      const ath = d.athletesInvolved || [];
      const player = ath.length
        ? (ath[0].shortName || ath[0].displayName || ath[0].fullName || '')
        : '';
      scorers.push({ minute: clock, team: teamName, player, type: t });
    }
    if (scorers.length) entry.scoring_summary = scorers;
  }
  return entry;
}

async function main() {
  const url = `https://site.api.espn.com/apis/site/v2/sports/rugby/${LEAGUE}/scoreboard?dates=${DATE_WINDOW}&limit=200`;
  let data;
  try {
    data = await fetchJson(url);
  } catch (e) {
    console.error(`[nations] ESPN fetch failed: ${e.message}`);
    // Don't clobber existing data on transient failure.
    if (!fs.existsSync(OUT)) {
      fs.writeFileSync(OUT, JSON.stringify({ generated_at: nowIso(), competition: COMPETITION, results: [], fixtures: [] }, null, 2));
    }
    return 0;
  }

  const events = Array.isArray(data.events) ? data.events : [];
  const matches = events.map(parseEvent).filter(Boolean);

  const nowT = Date.now();
  const results = matches
    .filter(m => 'home_score' in m)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const fixtures = matches
    .filter(m => !('home_score' in m) && (!m.date || new Date(m.date).getTime() >= nowT - 3 * 60 * 60 * 1000))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const payload = {
    generated_at: nowIso(),
    competition: COMPETITION,
    league_id: LEAGUE,
    results,
    fixtures,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[nations] wrote ${OUT} — ${results.length} results, ${fixtures.length} fixtures`);
  return 0;
}

main().then(code => { process.exitCode = code; }).catch(err => {
  console.error('[nations] fatal:', err);
  process.exitCode = 1;
});
