// Adam's Sports Dashboard — FIFA World Cup 2026 fetcher (Node, zero deps).
//
// Pulls REAL match data (scores, statuses, knockout results, penalty
// shootouts) from ESPN's public hidden API and writes data/world_cup.json in
// the shape the frontend (wc.js) expects. wc_fallback.json remains the static
// source of truth for the group draw (team -> group, flag, TV broadcast) and
// the offline fallback if ESPN is unreachable.
//
// Requires Node 18+ (global fetch). Replaces the old stub fetch_world_cup.py.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FALLBACK = path.join(__dirname, 'wc_fallback.json');
const OUT = path.join(ROOT, 'data', 'world_cup.json');

const ESPN_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200';
const UA = 'Mozilla/5.0 (compatible; adam-dashboard/1.0; +https://mgarrigan-hue.github.io)';
const TIMEOUT_MS = 25000;

const TOURNAMENT_START = '2026-06-11';
const TOURNAMENT_END = '2026-07-19';

const STAGE_ORDER = [
  'group', 'round-of-32', 'round-of-16',
  'quarter-final', 'semi-final', 'third-place', 'final',
];

// Fixed FIFA WC 2026 knockout pyramid, in chronological order. Used to label
// knockout matches by structure (robust to UTC date-boundary quirks) rather
// than guessing rounds from dates.
const KO_STRUCTURE = [
  ['round-of-32', 16],
  ['round-of-16', 8],
  ['quarter-final', 4],
  ['semi-final', 2],
  ['third-place', 1],
  ['final', 1],
];

// Assign a stage label to each knockout match, sorted chronologically, by
// walking the fixed pyramid counts. Resilient if fixtures are still partial.
function labelKnockout(koMatches) {
  const sorted = koMatches.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let i = 0;
  for (const [stage, count] of KO_STRUCTURE) {
    for (let k = 0; k < count && i < sorted.length; k++, i++) sorted[i].stage = stage;
  }
  // Any overflow (shouldn't happen) -> label as final.
  for (; i < sorted.length; i++) sorted[i].stage = 'final';
}
const KO_ROUNDS = [
  ['round-of-16', 'Round of 16'],
  ['quarter-final', 'Quarter-finals'],
  ['semi-final', 'Semi-finals'],
  ['third-place', 'Third-place play-off'],
  ['final', 'Final'],
];

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

function loadFallback() {
  return JSON.parse(fs.readFileSync(FALLBACK, 'utf8'));
}

// Build lookups from the static group draw.
function buildRefs(fb) {
  const codeToTeam = {};      // "MEX" -> { name, flag, group }
  for (const g of fb.groups || []) {
    for (const t of g.teams || []) {
      codeToTeam[t.code] = { name: t.name, flag: t.flag, group: g.name };
    }
  }
  // Group-match id + broadcast keyed by unordered code pair.
  const groupMeta = {};
  for (const m of fb.matches || []) {
    const key = [m.home?.code, m.away?.code].sort().join('|');
    groupMeta[key] = { id: m.id, broadcast: m.broadcast || null, venue: m.venue || null };
  }
  return { codeToTeam, groupMeta };
}

function resolveTeam(competitor, codeToTeam) {
  const ab = competitor?.team?.abbreviation || '';
  const fb = codeToTeam[ab];
  if (fb) return { name: fb.name, code: ab, flag: fb.flag, group: fb.group };
  // Placeholder knockout slot (e.g. "RD16 W1", "SFW1") -> renders as TBD.
  return { name: null, code: null, flag: null, placeholder: competitor?.team?.displayName || null };
}

function statusFromEspn(ev) {
  const state = ev?.status?.type?.state; // pre | in | post
  if (state === 'in') return 'live';
  if (state === 'pre') return 'scheduled';
  return 'complete';
}

// "Morocco advance 3-2 on penalties" -> "3-2"
function parsePens(notes) {
  for (const n of notes || []) {
    const h = n?.headline || '';
    const m = h.match(/(\d+)\s*[-–]\s*(\d+)\s*on penalties/i);
    if (m) return { text: h, score: `${m[1]}-${m[2]}` };
  }
  return null;
}

const KNOCKOUT_BROADCAST = { uk: ['BBC / ITV'], ie: ['RTÉ / Virgin'] };

function espnEventToMatch(ev, refs) {
  const comp = (ev.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const homeC = competitors.find(c => c.homeAway === 'home');
  const awayC = competitors.find(c => c.homeAway === 'away');
  if (!homeC || !awayC) return null;

  const date = ev.date;
  const status = statusFromEspn(ev);
  const home = resolveTeam(homeC, refs.codeToTeam);
  const away = resolveTeam(awayC, refs.codeToTeam);

  let score = null;
  if (status !== 'scheduled') {
    const hs = parseInt(homeC.score, 10);
    const as = parseInt(awayC.score, 10);
    if (Number.isFinite(hs) && Number.isFinite(as)) score = { home: hs, away: as };
  }

  let winner = null;
  if (homeC.winner === true) winner = 'home';
  else if (awayC.winner === true) winner = 'away';

  const statusName = ev?.status?.type?.name || '';
  const pens = statusName === 'STATUS_FINAL_PEN' ? parsePens(comp.notes) : null;
  const aet = statusName === 'STATUS_FINAL_AET';

  const venueName = comp.venue?.fullName || '';
  const venueCity = comp.venue?.address?.city || '';
  const venue = [venueName, venueCity].filter(Boolean).join(', ');

  const match = {
    id: `wc-2026-e${ev.id}`,
    espn_id: String(ev.id),
    stage: null, // assigned during classification
    group: null,
    date,
    venue,
    home: { name: home.name, code: home.code, flag: home.flag },
    away: { name: away.name, code: away.code, flag: away.flag },
    score,
    status,
    winner,
    broadcast: null,
  };
  if (home.placeholder) match.home.placeholder = home.placeholder;
  if (away.placeholder) match.away.placeholder = away.placeholder;
  if (pens) { match.pens = pens.score; match.pens_text = pens.text; }
  if (aet) match.aet = true;
  // Carry group hints for classification.
  match._homeGroup = home.group || null;
  match._awayGroup = away.group || null;
  return match;
}

// Deterministic stage classification:
//  - group matches are the exact 72 fixtures in wc_fallback.json (matched by
//    unordered team code-pair), or any pair of teams sharing a group letter.
//  - everything else is knockout, labelled by the fixed pyramid structure.
function classifyStages(matches, refs) {
  const group = [], knockout = [];
  for (const m of matches) {
    const key = [m.home.code, m.away.code].filter(Boolean).sort().join('|');
    const inFallbackGroup = key && !!refs.groupMeta[key];
    const sameGroup = m._homeGroup && m._awayGroup && m._homeGroup === m._awayGroup;
    if (inFallbackGroup || sameGroup) {
      m.stage = 'group';
      m.group = m._homeGroup || m._awayGroup || null;
      const gm = refs.groupMeta[key];
      if (gm) {
        m.id = gm.id;
        m.broadcast = gm.broadcast;
        if (!m.venue) m.venue = gm.venue || '';
      }
      group.push(m);
    } else {
      knockout.push(m);
    }
  }
  labelKnockout(knockout);
  for (const m of knockout) {
    m.group = null;
    m.broadcast = KNOCKOUT_BROADCAST;
  }
  // Strip internal hints.
  for (const m of matches) { delete m._homeGroup; delete m._awayGroup; }
  return { group, knockout };
}

function computeGroups(fb, matches) {
  const stats = {}; // code -> tally
  for (const g of fb.groups || []) {
    for (const t of g.teams || []) {
      stats[t.code] = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
    }
  }
  for (const m of matches) {
    if (m.stage !== 'group' || m.status !== 'complete' || !m.score) continue;
    const h = m.home.code, a = m.away.code;
    if (!stats[h] || !stats[a]) continue;
    const hs = m.score.home, as = m.score.away;
    stats[h].played++; stats[a].played++;
    stats[h].gf += hs; stats[h].ga += as;
    stats[a].gf += as; stats[a].ga += hs;
    if (hs > as) { stats[h].won++; stats[h].points += 3; stats[a].lost++; }
    else if (hs < as) { stats[a].won++; stats[a].points += 3; stats[h].lost++; }
    else { stats[h].drawn++; stats[a].drawn++; stats[h].points++; stats[a].points++; }
  }
  for (const c of Object.keys(stats)) stats[c].gd = stats[c].gf - stats[c].ga;

  return (fb.groups || []).map(g => ({
    name: g.name,
    teams: (g.teams || []).map(t => ({
      name: t.name, code: t.code, flag: t.flag,
      ...stats[t.code],
      form: [],
    })),
  }));
}

function buildBracket(matches) {
  const rounds = KO_ROUNDS.map(([key, name]) => {
    const ms = matches
      .filter(m => m.stage === key)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { key, name, matches: ms.map(bracketMatch) };
  }).filter(r => r.matches.length);
  return rounds.length ? { rounds } : null;
}

function bracketMatch(m) {
  return {
    id: m.id, date: m.date, venue: m.venue,
    home: m.home, away: m.away, score: m.score,
    status: m.status, winner: m.winner,
    pens: m.pens || null, aet: m.aet || false,
  };
}

// Aggregate top scorers straight from the scoreboard scoring plays (goals),
// so we need no extra requests. Own goals are excluded.
function computeTopScorers(events, refs) {
  const tally = new Map(); // key -> { name, goals, team, flag }
  for (const ev of events) {
    const comp = (ev.competitions || [])[0] || {};
    // Map ESPN numeric team id -> resolved team (name/flag) for this event.
    const idToTeam = {};
    for (const c of comp.competitors || []) {
      const t = resolveTeam(c, refs.codeToTeam);
      idToTeam[String(c.team?.id)] = t;
    }
    for (const d of comp.details || []) {
      if (d.scoringPlay !== true) continue;
      const typ = ((d.type || {}).text || '').toLowerCase();
      if (!typ.includes('goal') || typ.includes('own goal')) continue;
      const ath = (d.athletesInvolved || [])[0];
      if (!ath) continue;
      const name = ath.displayName || ath.shortName || ath.fullName;
      if (!name) continue;
      const team = idToTeam[String((d.team || {}).id)] || {};
      const key = `${name}|${team.code || ''}`;
      const cur = tally.get(key) || { name, goals: 0, team: team.name || '', flag: team.flag || '' };
      cur.goals += 1;
      tally.set(key, cur);
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function computeStageAndChampion(matches) {
  const finalM = matches.find(m => m.stage === 'final');
  let champion = null;
  if (finalM && finalM.status === 'complete' && finalM.winner) {
    champion = finalM.winner === 'home' ? finalM.home.name : finalM.away.name;
  }
  if (champion) return { current_stage: 'complete', champion };

  // Earliest stage that still has an unfinished match = the "active" round.
  let active = null;
  for (const m of matches) {
    if (m.status === 'complete') continue;
    const idx = STAGE_ORDER.indexOf(m.stage);
    if (active === null || idx < active) active = idx;
  }
  const current_stage = active === null ? 'complete' : STAGE_ORDER[active];
  return { current_stage, champion: null };
}

function writeFallbackVerbatim(fb, reason) {
  fb.generated_at = nowIso();
  fb.source = 'embedded-fallback';
  const s = computeStageAndChampion(fb.matches || []);
  fb.tournament.current_stage = s.current_stage;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fb, null, 2), 'utf8');
  console.error(`[wc] ESPN unavailable (${reason}); wrote embedded fallback.`);
}

async function main() {
  const fb = loadFallback();
  const refs = buildRefs(fb);

  let espn;
  try {
    espn = await fetchJson(ESPN_URL);
  } catch (e) {
    writeFallbackVerbatim(fb, e.message);
    return 0;
  }

  const events = Array.isArray(espn?.events) ? espn.events : [];
  if (!events.length) {
    writeFallbackVerbatim(fb, 'no events returned');
    return 0;
  }

  const matches = events
    .map(ev => espnEventToMatch(ev, refs))
    .filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  classifyStages(matches, refs);

  const groups = computeGroups(fb, matches);
  const knockout_bracket = buildBracket(matches);
  const { current_stage, champion } = computeStageAndChampion(matches);
  const top_scorers = computeTopScorers(events, refs);

  const payload = {
    source: 'espn',
    generated_at: nowIso(),
    tournament: {
      ...fb.tournament,
      start_date: fb.tournament?.start_date || TOURNAMENT_START,
      end_date: fb.tournament?.end_date || TOURNAMENT_END,
      current_stage,
      champion,
    },
    groups,
    matches,
    knockout_bracket,
    top_scorers,
  };

  // Validate before write.
  const json = JSON.stringify(payload, null, 2);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json, 'utf8');

  const live = matches.filter(m => m.status === 'live').length;
  const done = matches.filter(m => m.status === 'complete').length;
  const ko = matches.filter(m => m.stage !== 'group').length;
  console.log(
    `[wc] wrote ${OUT} — ${matches.length} matches (${done} complete, ${live} live), ` +
    `${ko} knockout, stage=${current_stage}${champion ? `, champion=${champion}` : ''}`
  );
  return 0;
}

main().then(code => { process.exitCode = code; }).catch(err => {
  console.error('[wc] fatal:', err);
  process.exitCode = 1;
});
