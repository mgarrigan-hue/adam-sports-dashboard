// Adam's Sports Dashboard — generic tournament fetcher (Node 18+, zero deps).
//
// Reads scripts/tournaments.config.json and, for every tournament currently
// inside its visibility window (lead_days before start … recap_days after end),
// pulls fixtures/results and writes them into data/tournaments.json.
//
// Two source types are supported:
//   espn  — ESPN's public scoreboard API, same endpoint the rugby fetchers use.
//   local — derive from a data/*.json file we already fetch (e.g. pull the
//           "Senior Cup" fixtures back out of schools.json). Zero extra network.
//
// Dormant tournaments cost nothing: they're skipped before any network call and
// simply omitted from the output, so the frontend never renders them.
//
// Output shape is deliberately identical to the other rugby feeds
// (results[] / fixtures[]) so the frontend reuses renderRugbyMatches().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG = path.join(__dirname, 'tournaments.config.json');
const OUT = path.join(DATA_DIR, 'tournaments.json');

const UA = 'Mozilla/5.0 (compatible; adam-dashboard/1.0)';
const TIMEOUT_MS = 25000;
const DAY_MS = 86400000;
const DEFAULT_LEAD_DAYS = 60;
const DEFAULT_RECAP_DAYS = 10;

// QA flags. `--date=YYYY-MM-DD` pretends it's another day so a tournament that
// is months away can still be generated and previewed; `--out=path` writes the
// preview somewhere harmless instead of clobbering the real data file.
// Pair with the frontend's ?tdate=YYYY-MM-DD to see the rendered result.
const ARGS = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; })
);
const OUT_FILE = typeof ARGS.out === 'string' ? path.resolve(ROOT, ARGS.out) : OUT;
const REF_NOW = typeof ARGS.date === 'string' ? new Date(`${ARGS.date}T12:00:00Z`) : new Date();

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

function startOf(t) { return new Date(`${t.start}T00:00:00Z`); }
function endOf(t) { return new Date(`${t.end}T23:59:59Z`); }

// Mirror of tournamentPhase() in tournaments.js — keep the two in sync.
function phaseOf(t, now = new Date()) {
  const start = startOf(t);
  const end = endOf(t);
  const lead = (t.lead_days ?? DEFAULT_LEAD_DAYS) * DAY_MS;
  const recap = (t.recap_days ?? DEFAULT_RECAP_DAYS) * DAY_MS;
  if (now.getTime() < start.getTime() - lead) return 'far';
  if (now.getTime() < start.getTime()) return 'soon';
  if (now.getTime() <= end.getTime()) return 'live';
  if (now.getTime() <= end.getTime() + recap) return 'recap';
  return 'past';
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

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function halfTime(team) {
  for (const l of team.linescores || []) {
    if (l.period === 1) {
      const v = parseInt(l.value, 10);
      return Number.isFinite(v) ? v : null;
    }
  }
  return null;
}

// ESPN event -> our match shape (same fields the rugby feeds emit).
function parseEvent(ev, competition) {
  const comp = (ev.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const type = ev.status?.type || {};
  const status = type.name || '';
  const state = type.state || '';
  const completed = type.completed === true || status === 'STATUS_FINAL' || status === 'STATUS_FULL_TIME';
  const live = state === 'in';

  const entry = {
    date: ev.date,
    home: home.team?.displayName || home.team?.name || 'TBD',
    away: away.team?.displayName || away.team?.name || 'TBD',
    home_logo: home.team?.logo || '',
    away_logo: away.team?.logo || '',
    competition,
    venue: comp.venue?.fullName
      ? [comp.venue.fullName, comp.venue.address?.city].filter(Boolean).join(', ')
      : '',
    status: status || null,
    status_state: state || null,
  };
  if (comp.notes?.length && comp.notes[0]?.headline) entry.stage = comp.notes[0].headline;

  if (completed || live) {
    const hs = parseInt(home.score, 10);
    const as = parseInt(away.score, 10);
    if (Number.isFinite(hs)) entry.home_score = hs;
    if (Number.isFinite(as)) entry.away_score = as;
  }
  if (completed) {
    const htH = halfTime(home);
    const htA = halfTime(away);
    if (htH != null && htA != null) entry.half_time = `${htH}-${htA}`;
  }
  return entry;
}

async function loadEspn(t) {
  const { sport = 'rugby', league } = t.source;
  // Widen the window slightly so warm-up fixtures and late finals are included.
  const from = new Date(startOf(t).getTime() - 7 * DAY_MS);
  const to = new Date(endOf(t).getTime() + 7 * DAY_MS);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=300`;
  const data = await fetchJson(url);
  const events = Array.isArray(data.events) ? data.events : [];
  return events.map(ev => parseEvent(ev, t.label)).filter(Boolean);
}

// Derive a tournament from a feed we already fetch, by competition name.
// Also scoped to the tournament's own date window — otherwise "Senior Cup"
// would match every previous season still sitting in schools.json.
function loadLocal(t) {
  const src = readJson(path.join(DATA_DIR, t.source.file));
  if (!src) throw new Error(`local source ${t.source.file} not found`);
  const needle = String(t.source.match || '').toLowerCase();
  const from = startOf(t).getTime() - 7 * DAY_MS;
  const to = endOf(t).getTime() + 7 * DAY_MS;
  return [...(src.results || []), ...(src.fixtures || [])].filter(m => {
    if (needle && !String(m.competition || '').toLowerCase().includes(needle)) return false;
    if (!m.date) return false;
    const ts = new Date(m.date).getTime();
    return Number.isFinite(ts) && ts >= from && ts <= to;
  });
}

function splitMatches(matches, now) {
  const cutoff = now.getTime() - 3 * 60 * 60 * 1000; // a match kicked off <3h ago is still "on"
  const results = matches
    .filter(m => m.home_score != null)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const fixtures = matches
    .filter(m => m.home_score == null && (!m.date || new Date(m.date).getTime() >= cutoff))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { results, fixtures };
}

async function main() {
  const cfg = readJson(CONFIG);
  if (!cfg || !Array.isArray(cfg.tournaments)) {
    console.error('[tournaments] config missing or invalid — nothing to do.');
    return 0;
  }

  // Keep the previous payload so a transient API failure never blanks a section.
  const prev = readJson(OUT_FILE, { tournaments: [] });
  const prevById = new Map((prev.tournaments || []).map(t => [t.id, t]));

  const now = REF_NOW;
  const out = [];

  for (const t of cfg.tournaments) {
    const phase = phaseOf(t, now);
    if (phase === 'far' || phase === 'past') {
      console.log(`[tournaments] ${t.id}: ${phase} — skipped`);
      continue;
    }

    let matches = null;
    try {
      matches = t.source?.type === 'local' ? loadLocal(t) : await loadEspn(t);
    } catch (e) {
      console.error(`[tournaments] ${t.id}: fetch failed (${e.message}) — keeping previous data`);
    }

    const base = {
      id: t.id,
      label: t.label,
      emoji: t.emoji || '🏆',
      blurb: t.blurb || '',
      start: t.start,
      end: t.end,
      lead_days: t.lead_days ?? DEFAULT_LEAD_DAYS,
      recap_days: t.recap_days ?? DEFAULT_RECAP_DAYS,
      fav_teams: t.fav_teams || [],
      source: t.source?.type === 'local'
        ? `local:${t.source.file}`
        : `espn:${t.source?.sport || 'rugby'}/${t.source?.league}`,
    };

    if (matches) {
      const { results, fixtures } = splitMatches(matches, now);
      out.push({ ...base, fetched_at: nowIso(), results: results.slice(0, 40), fixtures: fixtures.slice(0, 40) });
      console.log(`[tournaments] ${t.id}: ${phase} — ${results.length} results, ${fixtures.length} fixtures`);
    } else {
      const old = prevById.get(t.id);
      out.push({ ...base, fetched_at: old?.fetched_at || null, results: old?.results || [], fixtures: old?.fixtures || [] });
    }
  }

  const payload = { generated_at: nowIso(), tournaments: out };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[tournaments] wrote ${OUT_FILE} — ${out.length} active tournament(s)`);
  return 0;
}

main().then(code => { process.exitCode = code; }).catch(err => {
  console.error('[tournaments] fatal:', err);
  process.exitCode = 1;
});
