// Adam's Sports Dashboard — frontend
const FAV_KEY = "adam-sports-favorites";
const DEFAULT_FAVS = {
  schools: [],
  f1Driver: "Isack Hadjar",
  rugbyTeam: "Leinster",
};
let FAVS = loadFavs();

const F1_TEAM_ALT = ["red bull", "rb", "vcarb", "racing bulls"];

const DATA_FILES = {
  f1: "data/f1.json",
  intl: "data/intl_rugby.json",
  prov: "data/provinces.json",
  schools: "data/schools.json",
  news: "data/news.json",
  watch: "data/watch.json",
  club: "data/dublin_club.json",
  highlights: "data/highlights.json",
};

let WATCH = {};
let HIGHLIGHTS = { competitions: {}, matches: {} };

function watchInfo(competition) {
  if (!competition || !WATCH) return null;
  const c = competition.toLowerCase();
  // exact-ish then partial match across keys (longest key first for specificity)
  const keys = Object.keys(WATCH).filter(k => !k.startsWith("_")).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (c.includes(k.toLowerCase())) return WATCH[k];
  }
  return WATCH._default || null;
}

function highlightsForCompetition(competition, matchKey) {
  if (matchKey && HIGHLIGHTS.matches && HIGHLIGHTS.matches[matchKey]) {
    return HIGHLIGHTS.matches[matchKey];
  }
  if (!competition) return null;
  const comps = HIGHLIGHTS.competitions || {};
  const c = competition.toLowerCase();
  const keys = Object.keys(comps).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (c.includes(k.toLowerCase())) return comps[k];
  }
  return null;
}

function highlightsChipHtml(competition, matchKey) {
  const entry = highlightsForCompetition(competition, matchKey);
  if (!entry || !entry.url) return "";
  const lbl = entry.label || "Recaps";
  return `<a class="watch-chip is-link is-highlights" href="${escapeAttr(safeHref(entry.url))}" target="_blank" rel="noopener" title="Open ${escapeAttr(lbl)} for highlights">🎬 Recaps on ${escapeHtml(lbl)} ↗</a>`;
}

function watchChipsHtml(competition, opts = {}) {
  const info = watchInfo(competition);
  if (!info) return "";
  const items = [];
  (info.live || []).forEach(x => items.push(x));
  if (opts.includeHighlights) (info.highlights || []).forEach(x => items.push(x));
  if (!items.length && !info.note) return "";

  const tierMeta = {
    free: { cls: "tier-free", lbl: "Free TV" },
    sky:  { cls: "tier-sky",  lbl: "Sky" },
    sub:  { cls: "tier-sub",  lbl: "Subscription" },
  };
  const chips = items.map(x => {
    const meta = tierMeta[x.tier] || null;
    const tierTag = meta ? `<span class="chip-tier">${meta.lbl}</span>` : "";
    const tierCls = meta ? meta.cls : "";
    if (x.url) {
      return `<a class="watch-chip is-link ${tierCls}" href="${escapeAttr(safeHref(x.url))}" target="_blank" rel="noopener" title="Open ${escapeAttr(x.label)}">📺 ${escapeHtml(x.label)} ${tierTag} ↗</a>`;
    }
    return `<span class="watch-chip ${tierCls}" title="On TV (Sky Signature)">📺 ${escapeHtml(x.label)} ${tierTag}</span>`;
  }).join("");
  const note = info.note ? `<span class="watch-note">${escapeHtml(info.note)}</span>` : "";
  return `<div class="watch-row">${chips}${note}</div>`;
}

// Restrict any URL coming from external JSON to http(s) before it hits an href.
// Anything else (javascript:, data:, custom schemes) collapses to "#".
function safeHref(u) {
  if (!u) return "#";
  try {
    const url = new URL(u, location.href);
    return (url.protocol === "https:" || url.protocol === "http:") ? url.href : "#";
  } catch { return "#"; }
}

function loadFavs() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return { ...DEFAULT_FAVS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FAVS, ...parsed, schools: parsed.schools || [] };
  } catch {
    return { ...DEFAULT_FAVS };
  }
}
function saveFavs() { localStorage.setItem(FAV_KEY, JSON.stringify(FAVS)); }

async function loadJson(path) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn("Failed to load", path, e);
    return null;
  }
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const diffMs = d - Date.now();
  const abs = Math.abs(diffMs);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let txt;
  if (m < 60) txt = `${m}m`;
  else if (h < 36) txt = `${h}h`;
  else txt = `${days}d`;
  return diffMs >= 0 ? `in ${txt}` : `${txt} ago`;
}

function isFavF1(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (FAVS.f1Driver && t.includes(FAVS.f1Driver.toLowerCase())) return true;
  return F1_TEAM_ALT.some(x => t.includes(x));
}
function isFavRugby(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (FAVS.rugbyTeam && t.includes(FAVS.rugbyTeam.toLowerCase())) return true;
  return false;
}
function isFavSchool(text) {
  if (!text || !FAVS.schools.length) return false;
  const t = text.toLowerCase();
  return FAVS.schools.some(s => s && t.includes(s.toLowerCase()));
}

// ---------- Live-match detection ----------
// Rugby (ESPN): prefer an explicit status if scripts emit it; otherwise
// fall back to a date-window heuristic (kickoff up to ~2.5h ago and no final score yet).
function isLiveRugby(m) {
  if (!m) return false;
  const st = (m.status || m.status_state || "").toString().toLowerCase();
  if (st === "in" || st === "in_progress" || st === "status_in_progress" ||
      st === "status_first_half" || st === "status_second_half" ||
      st === "status_halftime" || st === "live") return true;
  if (!m.date) return false;
  const start = new Date(m.date).getTime();
  if (isNaN(start)) return false;
  const now = Date.now();
  const finished = m.home_score != null && m.away_score != null && (now - start) > 2.5 * 3600 * 1000;
  return now >= start && now - start <= 2.5 * 3600 * 1000 && !finished;
}
// F1 session: live if now ∈ [start, start + duration]. Sessions are typed by name.
function f1SessionDurationMs(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("race") && !n.includes("sprint")) return 130 * 60 * 1000;
  if (n.includes("sprint qualifying") || n.includes("sprint shootout")) return 75 * 60 * 1000;
  if (n.includes("sprint")) return 75 * 60 * 1000;
  if (n.includes("qualif")) return 100 * 60 * 1000;
  return 95 * 60 * 1000; // FP1/FP2/FP3 default
}
function isLiveF1Session(sess) {
  if (!sess || !sess.datetime) return false;
  const start = new Date(sess.datetime).getTime();
  if (isNaN(start)) return false;
  const now = Date.now();
  return now >= start && now <= start + f1SessionDurationMs(sess.name);
}
// F1 race in feed: live if start ≤ now ≤ start + ~2.5h.
function isLiveF1Race(date) {
  if (!date) return false;
  const start = new Date(date).getTime();
  if (isNaN(start)) return false;
  const now = Date.now();
  return now >= start && now <= start + 150 * 60 * 1000;
}

// ---------- Match-outcome highlighting (wins/losses for the team we follow) ----------
// Patterns that identify "us" on either side of a result. These are the teams
// Mark/Adam want visually called out across the whole site.
const FAV_TEAM_PATTERNS = [
  { key: "smc",      re: /\b(st\.?\s*mary'?s|saint\s*mary'?s|smtc|smc|st mary's college)\b/i },
  { key: "leinster", re: /\bleinster\b/i },
];
function matchSide(text) {
  if (!text) return null;
  for (const p of FAV_TEAM_PATTERNS) if (p.re.test(text)) return p.key;
  if (isFavSchool(text)) return "school";
  return null;
}
// Returns "win" | "loss" | "draw" | null for a match where one of our teams
// played and the result is known.
function favOutcome(m) {
  if (!m || m.home_score == null || m.away_score == null) return null;
  const homeKey = matchSide(m.home);
  const awayKey = matchSide(m.away);
  if (!homeKey && !awayKey) return null;
  // If both sides match (e.g. Leinster vs Leinster A in pre-season), bail.
  if (homeKey && awayKey) return null;
  const usHome = !!homeKey;
  const us  = usHome ? Number(m.home_score) : Number(m.away_score);
  const them = usHome ? Number(m.away_score) : Number(m.home_score);
  if (!isFinite(us) || !isFinite(them)) return null;
  if (us > them) return "win";
  if (us < them) return "loss";
  return "draw";
}
function outcomeClass(m) {
  const o = favOutcome(m);
  return o ? `fav-${o}` : "";
}
function outcomeBadge(m) {
  const o = favOutcome(m);
  if (!o) return "";
  if (o === "win")  return `<span class="outcome-badge win">🏆 WIN</span>`;
  if (o === "loss") return `<span class="outcome-badge loss">L</span>`;
  return `<span class="outcome-badge draw">DRAW</span>`;
}

// ---------- Club name normalisation ----------
// Source data has the same club recorded as "SMTC", "St Marys College RFC",
// "St Mary's College RFC", etc. Internal detection uses FAV_TEAM_PATTERNS +
// the upstream `involves_smc` flag, which already handles all aliases — so
// this normalisation is purely for DISPLAY consistency. Never mutate source.
const CLUB_ALIASES = {
  "SMTC": "St Mary's College RFC",
  "St Marys College RFC": "St Mary's College RFC",
  "St Mary's College": "St Mary's College RFC",
  "St Marys College": "St Mary's College RFC",
};
function normTeam(name) {
  if (!name) return name;
  const trimmed = String(name).trim();
  return CLUB_ALIASES[trimmed] || trimmed;
}
// Single-source-of-truth matcher for "is this Adam's club match?".
// Wrapping the flag keeps future upstream changes (e.g. renamed field) local.
function isAdamsMatch(m) {
  return !!m && m.involves_smc !== false;
}

// ---------- ICS (iCalendar) single-event export — RFC 5545 compliant ----------
// Produces a minimal VCALENDAR with one VEVENT. Handles:
//   - CRLF line endings (REQUIRED by spec)
//   - TEXT value escaping: backslash, comma, semicolon, newline
//   - 75-octet line folding (UTF-8 safe)
//   - UID per event (host-unique)
//   - DTSTAMP in UTC
//   - DTSTART/DTEND in UTC (basic format YYYYMMDDTHHMMSSZ)
function icsEscapeText(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function icsFormatUtc(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
// Fold lines to 75 octets (UTF-8 byte-safe — split at code points, not chars).
function icsFold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let buf = [];
  let bufLen = 0;
  const limitFirst = 75;
  const limitCont = 74; // continuation lines start with a single space
  let first = true;
  // Walk original string by code point so we don't split multi-byte chars.
  for (const ch of line) {
    const chBytes = new TextEncoder().encode(ch).length;
    const cap = first ? limitFirst : limitCont;
    if (bufLen + chBytes > cap) {
      out.push((first ? "" : " ") + buf.join(""));
      buf = [];
      bufLen = 0;
      first = false;
    }
    buf.push(ch);
    bufLen += chBytes;
  }
  if (buf.length) out.push((first ? "" : " ") + buf.join(""));
  return out.join("\r\n");
}
function buildIcs({ title, start, durationMin = 120, location, description }) {
  const dtStart = new Date(start);
  if (isNaN(dtStart)) return null;
  const dtEnd = new Date(dtStart.getTime() + durationMin * 60 * 1000);
  const dtStamp = new Date();
  const uid = `asd-${dtStart.getTime()}-${Math.random().toString(36).slice(2, 10)}@adam.garrigan.me`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Adam Sports Dashboard//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsFormatUtc(dtStamp)}`,
    `DTSTART:${icsFormatUtc(dtStart)}`,
    `DTEND:${icsFormatUtc(dtEnd)}`,
    `SUMMARY:${icsEscapeText(title)}`,
    location ? `LOCATION:${icsEscapeText(location)}` : null,
    description ? `DESCRIPTION:${icsEscapeText(description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).map(icsFold);
  return lines.join("\r\n") + "\r\n";
}
function downloadIcs(ics, filename = "fixture.ics") {
  if (!ics) return;
  try {
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer revoke — iOS Safari may still be reading the blob when the click
    // handler returns. 60s is more than enough for the download/calendar
    // hand-off to complete.
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  } catch (err) {
    console.warn("[ics] download failed", err);
  }
}
function icsFilenameFrom(title, iso) {
  const d = new Date(iso);
  const yyyymmdd = isNaN(d)
    ? "fixture"
    : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const slug = String(title || "fixture")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "fixture";
  return `${yyyymmdd}-${slug}.ics`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Whitelist of trusted hosts for team/competition logos. We only render
// images served over https from these domains; anything else (including
// javascript:/data: URIs from a hypothetical compromised upstream API) is
// silently dropped instead of being injected into the DOM.
const LOGO_HOST_ALLOWLIST = [
  "espncdn.com",
  "espn.com",
  "a.espncdn.com",
  "a1.espncdn.com",
  "a2.espncdn.com",
  "a3.espncdn.com",
  "a4.espncdn.com",
  "secure.espncdn.com",
  "ichef.bbci.co.uk",
  "static.files.bbci.co.uk",
  "media.formula1.com",
  "www.formula1.com"
];
function isSafeLogoUrl(url) {
  try {
    const u = new URL(url, location.href);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return LOGO_HOST_ALLOWLIST.some(h => host === h || host.endsWith("." + h));
  } catch { return false; }
}
function logoImg(url, name) {
  if (!url || !isSafeLogoUrl(url)) return "";
  return `<img class="team-logo" loading="lazy" src="${escapeAttr(url)}" alt=""/>`;
}
// CSP-safe replacement for the old inline onerror handler: hide any team
// logo that fails to load via a single delegated listener.
window.addEventListener("error", (e) => {
  const t = e.target;
  if (t && t.tagName === "IMG" && t.classList && t.classList.contains("team-logo")) {
    t.style.display = "none";
  }
}, true);

// ---------- News ----------
function newsCategoryLabel(c) {
  if (c === "f1") return "F1";
  if (c === "irish-rugby") return "Irish Rugby";
  if (c === "rugby") return "Rugby";
  return c || "News";
}

let NEWS_ITEMS = [];
let NEWS_FILTER = "all";

function renderNews() {
  const ul = document.getElementById("news-list");
  if (!NEWS_ITEMS.length) {
    ul.innerHTML = `<li class="empty">No headlines yet.</li>`;
    return;
  }
  const filtered = NEWS_ITEMS.filter(n => {
    if (NEWS_FILTER === "all") return true;
    if (NEWS_FILTER === "f1") return n.category === "f1";
    if (NEWS_FILTER === "rugby") return n.category === "rugby" || n.category === "irish-rugby";
    return true;
  }).slice(0, 8);

  if (!filtered.length) {
    ul.innerHTML = `<li class="empty">No ${NEWS_FILTER.toUpperCase()} headlines right now.</li>`;
    return;
  }

  ul.innerHTML = filtered.map(n => `
    <li>
      <a href="${escapeAttr(safeHref(n.url))}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>
      <span class="cat-badge ${escapeAttr(n.category || "")}">${escapeHtml(newsCategoryLabel(n.category))}</span>
      <div class="news-meta">
        <span>${escapeHtml(n.source || "")}</span>
        <span>·</span>
        <span title="${escapeAttr(n.published || "")}">${escapeHtml(relTime(n.published))}</span>
      </div>
    </li>
  `).join("");
}

function bindNewsFilters() {
  document.querySelectorAll("#news-filters .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#news-filters .chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      NEWS_FILTER = btn.dataset.filter;
      renderNews();
    });
  });
}

// ---------- Latest unified feed ----------
function buildFeed(all) {
  const items = _collectFeedItems(all);
  items.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : -Infinity;
    const db = b.date ? new Date(b.date).getTime() : -Infinity;
    return db - da;
  });
  // "Latest action" = things that have actually happened, with the
  // freshest at the top. Upcoming stuff is exposed via buildUpcoming().
  const now = Date.now();
  const past = items.filter(it => it.date && new Date(it.date).getTime() <= now);
  if (past.length) return past.slice(0, 30);
  return items
    .filter(it => it.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 10);
}

// Mirror of buildFeed but for future events. Sorted soonest-first, capped at 30.
function buildUpcoming(all) {
  const raw = _collectFeedItems(all);
  const now = Date.now();
  return raw
    .filter(it => it.date && new Date(it.date).getTime() > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 30);
}

// Internal: same item collection logic as buildFeed, factored so both
// past + future feeds can share it without duplication.
function _collectFeedItems(all) {
  const items = [];
  if (all.f1) {
    (all.f1.recent_results || []).forEach(r => {
      const detail = f1RaceDetailLine(r);
      items.push({
        date: r.date, tag: "f1",
        title: `🏆 ${r.race_name} — Winner: ${r.winner}`,
        meta: detail || (r.podium ? `Podium: ${r.podium.join(" · ")}` : ""),
        fav: isFavF1(r.winner) || (r.podium || []).some(isFavF1),
        watch: "Formula 1",
        isResult: true,
        competition: "Formula 1",
      });
    });
    (all.f1.upcoming || []).forEach(r => {
      items.push({
        date: r.date, tag: "f1",
        title: `🏁 ${r.race_name} — ${r.circuit || ""}`,
        meta: r.location || "", fav: false,
        watch: "Formula 1",
        competition: "Formula 1",
        live: isLiveF1Race(r.date),
      });
    });
  }
  const pushRugby = (m, tag, defaultComp) => {
    const homeCell = `<span class="team-cell">${logoImg(m.home_logo)}${escapeHtml(m.home)}</span>`;
    const awayCell = `<span class="team-cell">${logoImg(m.away_logo)}${escapeHtml(m.away)}</span>`;
    const htChip = m.half_time ? `<span class="ht-chip">HT ${escapeHtml(m.half_time)}</span>` : "";
    const badge = outcomeBadge(m);
    const titleHtml = m.home_score != null
      ? `${badge}${homeCell} <strong>${m.home_score} – ${m.away_score}</strong> ${awayCell} ${htChip}`
      : `${homeCell} v ${awayCell}`;
    items.push({
      date: m.date, tag,
      titleHtml,
      meta: m.competition || defaultComp,
      fav: isFavRugby(m.home) || isFavRugby(m.away) || isFavSchool(m.home) || isFavSchool(m.away),
      outcome: favOutcome(m),
      watch: m.competition || defaultComp,
      competition: m.competition || defaultComp,
      isResult: m.home_score != null,
      scoringSummary: m.scoring_summary || null,
      live: isLiveRugby(m),
    });
  };
  if (all.intl) {
    (all.intl.results || []).forEach(m => pushRugby(m, "intl", "International"));
    (all.intl.fixtures || []).forEach(m => pushRugby(m, "intl", "International"));
  }
  if (all.prov) {
    (all.prov.results || []).forEach(m => pushRugby(m, "urc", "URC"));
    (all.prov.fixtures || []).forEach(m => pushRugby(m, "urc", "URC"));
  }
  if (all.schools) {
    (all.schools.results || []).forEach(m => items.push({
      date: m.date, tag: "schools",
      title: `${m.home} ${m.home_score ?? ""} – ${m.away_score ?? ""} ${m.away}`,
      titleHtml: `${outcomeBadge(m)}${escapeHtml(m.home)} <strong>${m.home_score ?? "-"} – ${m.away_score ?? "-"}</strong> ${escapeHtml(m.away)}`,
      meta: m.competition || "Leinster Schools",
      fav: isFavSchool(m.home) || isFavSchool(m.away),
      outcome: favOutcome(m),
      watch: m.competition || "Schools",
      competition: m.competition || "Schools",
      isResult: true,
    }));
    (all.schools.fixtures || []).forEach(m => items.push({
      date: m.date, tag: "schools",
      title: `${m.home} v ${m.away}`,
      meta: m.competition || "Leinster Schools",
      fav: isFavSchool(m.home) || isFavSchool(m.away),
      watch: m.competition || "Schools",
      competition: m.competition || "Schools",
      isResult: false,
    }));
  }
  if (all.club) {
    const pushClub = (m, isResult) => {
      const homeCell = `<span class="team-cell">${escapeHtml(normTeam(m.home))}</span>`;
      const awayCell = `<span class="team-cell">${escapeHtml(normTeam(m.away))}</span>`;
      const badge = isResult ? outcomeBadge(m) : "";
      const titleHtml = isResult
        ? `${badge}${homeCell} <strong>${m.home_score} – ${m.away_score}</strong> ${awayCell}`
        : `${homeCell} v ${awayCell}`;
      const adamsTeam = isAdamsMatch(m);
      const u14 = isU14(m.competition || "");
      items.push({
        date: m.date, tag: "club",
        titleHtml,
        title: `${normTeam(m.home)} v ${normTeam(m.away)}`,
        meta: m.competition || "St Mary's College RFC",
        fav: adamsTeam,
        adamsTeam,
        u14,
        outcome: isResult ? favOutcome(m) : null,
        watch: m.competition || "Dublin Club",
        competition: m.competition || "Dublin Club",
        isResult,
        live: isLiveRugby(m),
        _raw: m,
      });
    };
    (all.club.results || []).slice(0, 25).forEach(m => pushClub(m, true));
    (all.club.fixtures || []).slice(0, 25).forEach(m => pushClub(m, false));
  }
  return items;
}

// ---------- F1 detail formatters ----------
function f1RaceDetailLine(r) {
  const bits = [];
  if (r.pole?.driver) {
    const t = r.pole.time ? ` (${r.pole.time})` : "";
    bits.push(`Pole: ${r.pole.driver}${t}`);
  }
  if (r.fastest_lap?.driver) {
    const t = r.fastest_lap.time ? ` (${r.fastest_lap.time})` : "";
    bits.push(`Fastest: ${r.fastest_lap.driver}${t}`);
  }
  if (r.top3 && r.top3.length >= 2) {
    const p2 = r.top3[1];
    if (p2 && p2.time && p2.time.startsWith("+")) bits.push(`P2 gap ${p2.time}`);
  }
  return bits.join(" · ");
}

// ---------- Rugby scorers timeline ----------
const RUGBY_ICONS = {
  "try": "🟢",
  "penalty try": "🟢",
  "conversion": "✅",
  "penalty goal": "🎯",
  "drop goal": "⚡",
  "yellow card": "🟨",
  "red card": "🟥",
};
function scorerTimelineHtml(summary, isFav) {
  if (!summary || !summary.length) return "";
  const items = summary.map(s => {
    const icon = RUGBY_ICONS[s.type] || "•";
    const team = s.team ? `<span class="scorer-team">${escapeHtml(s.team)}</span>` : "";
    const player = s.player ? `<span class="scorer-name">${escapeHtml(s.player)}</span>` : "";
    return `<li><span class="scorer-min">${escapeHtml(s.minute || "")}</span> <span class="scorer-icon">${icon}</span> ${team} ${player}</li>`;
  }).join("");
  return `<details class="scorers"${isFav ? " open" : ""}>
    <summary>📋 Scoring summary (${summary.length})</summary>
    <ol class="scorer-list">${items}</ol>
  </details>`;
}

function feedDateBlockHtml(iso) {
  if (!iso) return `<div class="feed-when"><div class="feed-day">—</div><div class="feed-month">TBD</div></div>`;
  const d = new Date(iso);
  if (isNaN(d)) return `<div class="feed-when"><div class="feed-day">—</div><div class="feed-month">TBD</div></div>`;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const past = d.getTime() < now.getTime();
  const cls = sameDay ? "today" : "";
  const day = d.toLocaleString(undefined, { day: "numeric" });
  const mon = d.toLocaleString(undefined, { month: "short" }).toUpperCase();
  const tm = past ? "" : d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `<div class="feed-when ${cls}">
    <div class="feed-day">${day}</div>
    <div class="feed-month">${mon}</div>
    ${tm ? `<div class="feed-time">${tm}</div>` : ""}
  </div>`;
}

function soonPillHtml(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfTarget - startOfToday) / 86400000);
  if (dayDiff < 0) return "";
  if (dayDiff === 0) return `<span class="soon-pill soon-pill--today">Today</span> `;
  if (dayDiff === 1) return `<span class="soon-pill soon-pill--tomorrow">Tomorrow</span> `;
  if (dayDiff <= 6) {
    const wk = d.toLocaleString(undefined, { weekday: "short" });
    return `<span class="soon-pill soon-pill--week">${escapeHtml(wk)}</span> `;
  }
  return "";
}

function renderFeed(items, targetId = "latest-feed", emptyMsg = "No data yet — the GitHub Action will populate this on next refresh.", opts = {}) {
  const { withSoonPills = false, withIcs = false } = opts;
  const ul = document.getElementById(targetId);
  if (!ul) return;
  if (!items.length) {
    ul.innerHTML = `<li class="empty">${escapeHtml(emptyMsg)}</li>`;
    return;
  }
  ul.innerHTML = items.slice(0, 25).map((i, idx) => {
    const isPast = i.date && new Date(i.date).getTime() < Date.now();
    const watch = i.watch ? watchChipsHtml(i.watch, { includeHighlights: isPast || i.isResult }) : "";
    const hl = (i.isResult || isPast) ? highlightsChipHtml(i.competition || i.watch) : "";
    const extraRow = hl ? `<div class="watch-row">${hl}</div>` : "";
    const scorers = i.scoringSummary ? scorerTimelineHtml(i.scoringSummary, i.fav) : "";
    const rel = i.date ? relTime(i.date) : "";
    const livePill = i.live ? `<span class="live-pill" aria-label="Live now">🔴 LIVE</span> ` : "";
    const adamsPill = i.adamsTeam ? `<span class="adams-pill" aria-label="Adam's team">🟢⚪ My team</span> ` : "";
    const u14Pill = i.u14 ? `<span class="u14-pill" aria-label="U14 squad">U14</span> ` : "";
    const soonPill = withSoonPills && !isPast ? soonPillHtml(i.date) : "";
    const titleSearch = (i.title || "") + " " + (i.titleHtml || "") + " " + (i.meta || "");
    const favStar = (isFavF1(titleSearch) || isFavRugby(titleSearch)) ? `<span class="fav-star" aria-label="Favourite">⭐</span> ` : "";
    // ICS export button — only on upcoming feeds, only for future events with valid dates.
    let icsBtn = "";
    if (withIcs && !isPast && i.date && !isNaN(new Date(i.date))) {
      icsBtn = `<button class="ics-btn" type="button" data-ics-idx="${idx}" aria-label="Add to calendar">➕ .ics</button>`;
    }
    return `
    <li class="feed-item ${i.fav ? "fav" : ""} ${i.adamsTeam ? "adams-team" : ""} ${i.u14 ? "u14" : ""} ${i.outcome ? "fav-" + i.outcome : ""} ${i.live ? "live" : ""}">
      ${feedDateBlockHtml(i.date)}
      <div class="feed-body">
        <div class="feed-title">${livePill}${adamsPill}${u14Pill}${soonPill}${favStar}${i.titleHtml || escapeHtml(i.title)}</div>
        <div class="feed-meta">${escapeHtml(i.meta || "")}</div>
        ${rel ? `<div class="feed-rel">${escapeHtml(rel)}</div>` : ""}
        ${watch}
        ${extraRow}
        ${scorers}
        ${icsBtn ? `<div class="feed-actions">${icsBtn}</div>` : ""}
      </div>
      <span class="feed-tag ${i.tag}">${i.tag}</span>
    </li>`;
  }).join("");

  // Event delegation for .ics buttons — lives on the ul, survives re-renders.
  if (withIcs && !ul.dataset.icsBound) {
    ul.dataset.icsBound = "1";
    ul.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".ics-btn");
      if (!btn) return;
      const idx = Number(btn.dataset.icsIdx);
      const item = ul.__icsItems?.[idx];
      if (!item) return;
      const plainTitle = (item.title || (item.titleHtml || "").replace(/<[^>]*>/g, "")).trim() || "Fixture";
      const ics = buildIcs({
        title: plainTitle,
        start: item.date,
        durationMin: item.tag === "f1" ? 150 : 120,
        location: item.meta || "",
        description: `${item.meta || ""}\nAdded from Adam's Sports Dashboard`,
      });
      downloadIcs(ics, icsFilenameFrom(plainTitle, item.date));
    });
  }
  if (withIcs) ul.__icsItems = items.slice(0, 25);
}

// ---------- Adam page (focused view: Adam's club + U14 + form) ----------
function buildAdamItem(m, isResult) {
  const homeCell = `<span class="team-cell">${escapeHtml(normTeam(m.home))}</span>`;
  const awayCell = `<span class="team-cell">${escapeHtml(normTeam(m.away))}</span>`;
  const badge = isResult ? outcomeBadge(m) : "";
  const titleHtml = isResult
    ? `${badge}${homeCell} <strong>${m.home_score ?? "-"} – ${m.away_score ?? "-"}</strong> ${awayCell}`
    : `${homeCell} v ${awayCell}`;
  return {
    date: m.date,
    tag: "club",
    title: `${normTeam(m.home)} v ${normTeam(m.away)}`,
    titleHtml,
    meta: m.competition || "St Mary's College RFC",
    fav: true,
    adamsTeam: true,
    u14: isU14(m.competition || ""),
    outcome: isResult ? favOutcome(m) : null,
    watch: m.competition || "Dublin Club",
    competition: m.competition || "Dublin Club",
    isResult,
    live: !isResult && isLiveRugby(m),
  };
}

function renderAdam(all) {
  const wrap = document.getElementById("adam-body");
  if (!wrap) return;
  const club = all.club;
  if (!club) { wrap.innerHTML = `<p class="empty">No club data yet.</p>`; return; }

  const byDateAsc = (a, b) => new Date(a.date) - new Date(b.date);
  const byDateDesc = (a, b) => new Date(b.date) - new Date(a.date);
  const hasDate = (m) => m?.date && !isNaN(new Date(m.date));

  const upcoming = (club.fixtures || [])
    .filter(m => isAdamsMatch(m) && hasDate(m) && new Date(m.date).getTime() > Date.now())
    .sort(byDateAsc);
  const results = (club.results || [])
    .filter(m => isAdamsMatch(m) && hasDate(m))
    .sort(byDateDesc);

  const nextMatch = upcoming[0] || null;
  const recent10 = results.slice(0, 10);
  const last5 = results.slice(0, 5); // for form strip, newest → oldest

  // Next-match hero
  let nextHtml = "";
  if (nextMatch) {
    const when = new Date(nextMatch.date);
    const title = `${normTeam(nextMatch.home)} v ${normTeam(nextMatch.away)}`;
    const u14Tag = isU14(nextMatch.competition) ? ` · U14` : "";
    nextHtml = `
      <div class="adam-next">
        <div class="adam-next-eyebrow">🟢⚪ Adam's next match${u14Tag}</div>
        <div class="adam-next-title">${escapeHtml(title)}</div>
        <div class="adam-next-meta">${escapeHtml(nextMatch.competition || "")} · ${escapeHtml(when.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</div>
        <div class="adam-next-cta">
          <button class="btn ics-btn-primary" type="button" id="adam-next-ics">➕ Add to calendar</button>
        </div>
      </div>`;
  } else {
    nextHtml = `<div class="adam-next empty"><div class="adam-next-eyebrow">🟢⚪ Adam's next match</div><div class="adam-next-meta">No upcoming SMC fixtures right now — enjoy the off-season. 🌴</div></div>`;
  }

  // Form strip (last 5 results, oldest → newest read left-to-right feels natural)
  const formPills = last5.length
    ? last5.slice().reverse().map(m => {
        const o = favOutcome(m);
        const letter = o === "win" ? "W" : o === "loss" ? "L" : o === "draw" ? "D" : "·";
        const cls = o ? `form-${o}` : "form-unknown";
        const tip = `${normTeam(m.home)} ${m.home_score ?? "-"}–${m.away_score ?? "-"} ${normTeam(m.away)}`;
        return `<span class="form-pill ${cls}" title="${escapeHtml(tip)}">${letter}</span>`;
      }).join("")
    : `<span class="muted small">No recent results.</span>`;

  // Quick stats (last 30 days SMC)
  const stats30 = (() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let w = 0, l = 0, dr = 0;
    for (const m of results) {
      if (new Date(m.date).getTime() < cutoff) break;
      const o = favOutcome(m);
      if (o === "win") w++;
      else if (o === "loss") l++;
      else if (o === "draw") dr++;
    }
    return { w, l, dr, total: w + l + dr };
  })();

  wrap.innerHTML = `
    ${nextHtml}

    <div class="adam-form-card">
      <div class="adam-form-head">
        <h3>Form · last 5</h3>
        <div class="adam-form-stats">
          <span class="form-stat win">${stats30.w}W</span>
          <span class="form-stat loss">${stats30.l}L</span>
          <span class="form-stat draw">${stats30.dr}D</span>
          <span class="muted small">· last 30 days</span>
        </div>
      </div>
      <div class="adam-form-pills">${formPills}</div>
    </div>

    <div class="adam-grid">
      <section class="card card-feed">
        <div class="section-head">
          <div class="section-title">
            <span class="accent-bar accent-bar--upcoming"></span>
            <h2>Upcoming — Adam's team</h2>
          </div>
          <p class="section-sub">Soonest first · tap ➕ to add to your calendar</p>
        </div>
        <ul class="feed" id="adam-upcoming-feed"></ul>
      </section>

      <section class="card card-feed">
        <div class="section-head">
          <div class="section-title">
            <span class="accent-bar accent-bar--mixed"></span>
            <h2>Recent results</h2>
          </div>
          <p class="section-sub">Last 10 · newest first</p>
        </div>
        <ul class="feed" id="adam-results-feed"></ul>
      </section>
    </div>
  `;

  // Wire the hero "Add to calendar" button
  if (nextMatch) {
    const icsBtn = document.getElementById("adam-next-ics");
    if (icsBtn) {
      icsBtn.addEventListener("click", () => {
        const title = `${normTeam(nextMatch.home)} v ${normTeam(nextMatch.away)}`;
        const ics = buildIcs({
          title,
          start: nextMatch.date,
          durationMin: 120,
          location: nextMatch.competition || "",
          description: `${nextMatch.competition || "St Mary's College RFC"}\nAdded from Adam's Sports Dashboard`,
        });
        downloadIcs(ics, icsFilenameFrom(title, nextMatch.date));
      });
    }
  }

  // Render the two feeds (reuse renderFeed for consistent styling + ics buttons)
  renderFeed(
    upcoming.map(m => buildAdamItem(m, false)),
    "adam-upcoming-feed",
    "No upcoming SMC fixtures — off-season or data not yet refreshed.",
    { withSoonPills: true, withIcs: true }
  );
  renderFeed(
    recent10.map(m => buildAdamItem(m, true)),
    "adam-results-feed",
    "No recent SMC results yet."
  );
}

// ---------- Hero (rotating) ----------
let HERO_EVENTS = [];
let HERO_IDX = 0;
let HERO_TIMER = null;
let CD_TIMER = null;

function collectUpcoming(all) {
  const upcoming = [];
  (all.f1?.upcoming || []).forEach(r => upcoming.push({
    date: r.date, label: "Next Up · F1", sport: "f1",
    title: `🏁 ${r.race_name}`,
    meta: `${r.circuit || ""}${r.location ? " · " + r.location : ""}`,
    watch: "Formula 1",
  }));
  (all.intl?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, label: "Next Up · International Rugby", sport: "rugby",
    title: `🌍 ${m.home} v ${m.away}`,
    meta: m.competition || "International",
    boost: isFavRugby(m.home) || isFavRugby(m.away),
    watch: m.competition || "International",
  }));
  (all.prov?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, label: "Next Up · URC", sport: "rugby",
    title: `☘️ ${m.home} v ${m.away}`,
    meta: m.competition || "URC",
    boost: isFavRugby(m.home) || isFavRugby(m.away),
    watch: m.competition || "URC",
  }));
  (all.schools?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, label: "Next Up · Schools", sport: "rugby",
    title: `🎓 ${m.home} v ${m.away}`,
    meta: m.competition || "Leinster Schools",
    boost: isFavSchool(m.home) || isFavSchool(m.away),
    watch: m.competition || "Schools",
  }));
  (all.club?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, label: "Next Up · Adam's Club", sport: "club",
    title: `🟢⚪ ${normTeam(m.home)} v ${normTeam(m.away)}`,
    meta: m.competition || "St Mary's College RFC",
    boost: isAdamsMatch(m),
    isAdamsTeam: isAdamsMatch(m),
    isU14: isU14(m.competition || ""),
    watch: m.competition || "Dublin Club",
  }));
  return upcoming
    .filter(e => e.date && new Date(e.date).getTime() > Date.now())
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

function renderHero(all) {
  const future = collectUpcoming(all);
  const titleEl = document.getElementById("hero-title");
  const metaEl = document.getElementById("hero-meta");
  const labelEl = document.getElementById("hero-label");
  const dotsEl = document.getElementById("hero-dots");
  const cdEl = document.getElementById("hero-countdown");

  // One-time a11y setup on the carousel-dots container and countdown.
  if (dotsEl && !dotsEl.dataset.a11yInit) {
    dotsEl.setAttribute("aria-label", "Carousel controls");
    dotsEl.addEventListener("keydown", onHeroDotsKeydown);
    dotsEl.dataset.a11yInit = "1";
  }
  if (cdEl && !cdEl.dataset.a11yInit) {
    // Intentionally NOT aria-live: the countdown text changes every second,
    // which would spam screen readers. Instead we describe the slide via
    // aria-label (updated per slide) with the absolute target date.
    cdEl.setAttribute("aria-live", "off");
    cdEl.setAttribute("aria-atomic", "true");
    cdEl.dataset.a11yInit = "1";
  }

  if (!future.length) {
    titleEl.textContent = "Nothing scheduled right now";
    metaEl.textContent = "Check back soon!";
    if (cdEl) {
      cdEl.textContent = "";
      cdEl.removeAttribute("aria-label");
    }
    dotsEl.innerHTML = "";
    return;
  }

  HERO_EVENTS = future.slice(0, 3);

  // Always pin Adam's next team match into the rotation. Prefer U14 if one
  // exists within the soonest 3 club fixtures (so we don't leap past a more
  // imminent senior game just to reach a far-future U14 one).
  const adamsFixtures = future.filter(e => e.isAdamsTeam);
  if (adamsFixtures.length) {
    const soonest3 = adamsFixtures.slice(0, 3);
    const u14Pick = soonest3.find(e => e.isU14);
    const adamPick = u14Pick || adamsFixtures[0];
    adamPick.label = adamPick.isU14
      ? "🟢⚪ Adam's U14 — Next match"
      : "🟢⚪ Adam's team — Next match";
    if (!HERO_EVENTS.includes(adamPick)) {
      // Replace the last slot so the two soonest events still lead.
      HERO_EVENTS = HERO_EVENTS.slice(0, 2).concat(adamPick);
    } else {
      // Already in the rotation — just make sure the special label sticks.
      HERO_EVENTS = HERO_EVENTS.map(e => e === adamPick ? adamPick : e);
    }
  }

  HERO_IDX = 0;

  dotsEl.innerHTML = HERO_EVENTS.map((ev, i) => {
    const label = `${ev.label || "Next Up"} — ${ev.title || ""}`;
    const current = i === 0 ? ' aria-current="true"' : "";
    const active = i === 0 ? " active" : "";
    return `<button type="button" class="dot${active}" data-idx="${i}" aria-label="${escapeAttr(label)}"${current}></button>`;
  }).join("");
  dotsEl.querySelectorAll(".dot").forEach(d => {
    d.addEventListener("click", () => {
      showHero(parseInt(d.dataset.idx, 10));
      resetHeroTimer();
    });
  });

  showHero(0);
  resetHeroTimer();
}

function resetHeroTimer() {
  clearInterval(HERO_TIMER);
  if (HERO_EVENTS.length > 1) {
    HERO_TIMER = setInterval(() => showHero((HERO_IDX + 1) % HERO_EVENTS.length), 8000);
  }
}

function onHeroDotsKeydown(event) {
  if (!event.target.classList || !event.target.classList.contains("dot")) return;
  const n = HERO_EVENTS.length;
  if (!n) return;
  let next = null;
  switch (event.key) {
    case "ArrowRight": case "ArrowDown": next = (HERO_IDX + 1) % n; break;
    case "ArrowLeft":  case "ArrowUp":   next = (HERO_IDX - 1 + n) % n; break;
    case "Home": next = 0; break;
    case "End":  next = n - 1; break;
    default: return;
  }
  event.preventDefault();
  showHero(next);
  resetHeroTimer();
  const dotsEl = document.getElementById("hero-dots");
  const btn = dotsEl && dotsEl.querySelector(`.dot[data-idx="${next}"]`);
  if (btn) btn.focus();
}

function showHero(idx) {
  const card = document.getElementById("hero-card");
  const titleEl = document.getElementById("hero-title");
  const metaEl = document.getElementById("hero-meta");
  const labelEl = document.getElementById("hero-label");
  const dotsEl = document.getElementById("hero-dots");

  const ev = HERO_EVENTS[idx];
  if (!ev) return;
  HERO_IDX = idx;

  card.classList.add("fading");
  setTimeout(() => {
    labelEl.textContent = ev.label || "Next Up";
    titleEl.textContent = ev.title;
    metaEl.textContent = `${ev.meta} · ${fmtDate(ev.date)}`;
    dotsEl.querySelectorAll(".dot").forEach((d, i) => {
      const on = i === idx;
      d.classList.toggle("active", on);
      if (on) d.setAttribute("aria-current", "true");
      else d.removeAttribute("aria-current");
    });
    // Describe the countdown for assistive tech using an absolute date rather
    // than the ticking "Xd Yh Zm Ns" text (which would spam a live region).
    const cdEl = document.getElementById("hero-countdown");
    if (cdEl) {
      const abs = fmtDate(ev.date);
      cdEl.setAttribute("aria-label", `${ev.label || "Next Up"} — ${ev.title} — ${abs}`);
    }
    startCountdown(new Date(ev.date));
    // Sport-themed background
    if (ev.sport) card.dataset.sport = ev.sport; else delete card.dataset.sport;
    // Adam's team gets its own pronounced highlight on top of sport theming.
    card.classList.toggle("is-adams-team", !!ev.isAdamsTeam);
    // Favourite highlight: title or meta references the fav driver/team
    const favHit = isFavF1(ev.title) || isFavF1(ev.meta) || isFavRugby(ev.title) || isFavRugby(ev.meta);
    card.classList.toggle("is-favorite", !!favHit);
    // Watch info under the meta line
    const watchEl = document.getElementById("hero-watch");
    if (watchEl) watchEl.innerHTML = ev.watch ? watchChipsHtml(ev.watch) : "";
    card.classList.remove("fading");
  }, 250);
}

function startCountdown(target) {
  const el = document.getElementById("hero-countdown");
  function tick() {
    const ms = target - new Date();
    if (ms <= 0) { el.textContent = "🟢 Happening now"; return; }
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${d}d ${h}h ${m}m ${s}s`;
  }
  tick();
  clearInterval(CD_TIMER);
  CD_TIMER = setInterval(tick, 1000);
}

// ---------- F1 panel ----------
function renderF1(d) {
  const el = document.getElementById("f1-body");
  if (!d) { el.textContent = "No F1 data yet."; return; }

  const driverRows = (d.driver_standings || []).slice(0, 10).map((s, i) => `
    <tr data-team="${escapeAttr((s.team || "").toLowerCase())}" class="${isFavF1(s.driver) ? "fav-row" : ""}">
      <td>${i + 1}</td><td>${escapeHtml(s.driver)}</td>
      <td>${escapeHtml(s.team || "")}</td><td>${s.points ?? ""}</td>
    </tr>`).join("");
  const teamRows = (d.constructor_standings || []).slice(0, 10).map((s, i) => `
    <tr data-team="${escapeAttr((s.team || "").toLowerCase())}" class="${(s.team || "").toLowerCase().includes("red bull") || (s.team || "").toLowerCase().includes("racing bull") ? "fav-row" : ""}">
      <td>${i + 1}</td><td>${escapeHtml(s.team)}</td><td>${s.points ?? ""}</td>
    </tr>`).join("");

  // Weekend timeline
  let timelineHtml = "";
  if (d.next_race_sessions?.sessions?.length) {
    const ns = d.next_race_sessions;
    const watch = watchChipsHtml("Formula 1");
    timelineHtml = `
      <div class="sub">Race weekend · ${escapeHtml(ns.race_name || "")}${ns.circuit ? " · " + escapeHtml(ns.circuit) : ""}</div>
      ${watch}
      <ul class="timeline">
        ${(() => {
          let nextMarked = false;
          return ns.sessions.map(sess => {
            const past = sess.datetime && new Date(sess.datetime).getTime() < Date.now();
            let cls = past ? "past" : "";
            if (!past && !nextMarked) { cls += " next"; nextMarked = true; }
            return `<li class="${cls.trim()}">
              <div class="sess-name">${escapeHtml(sess.name)}</div>
              <div class="sess-when">${fmtTime(sess.datetime)}</div>
              ${past ? "" : `<div class="sess-cd">${relTime(sess.datetime)}</div>`}
            </li>`;
          }).join("");
        })()}
      </ul>`;
  }

  // Last qualifying
  let qualiHtml = "";
  if (d.last_qualifying?.results?.length) {
    const lq = d.last_qualifying;
    qualiHtml = `
      <div class="sub">Last qualifying · ${escapeHtml(lq.race_name || "")}</div>
      <table>
        <tr><th>#</th><th>Driver</th><th>Team</th><th>Best</th></tr>
        ${lq.results.slice(0, 10).map(r => {
          const best = r.q3 || r.q2 || r.q1 || "";
          const fav = isFavF1(r.driver) || isFavF1(r.team);
          return `<tr class="${fav ? "fav-row" : ""}">
            <td>${r.position ?? ""}</td>
            <td>${escapeHtml(r.driver)}</td>
            <td>${escapeHtml(r.team || "")}</td>
            <td>${escapeHtml(best)}</td>
          </tr>`;
        }).join("")}
      </table>`;
  }

  // Last sprint (optional)
  let sprintHtml = "";
  if (d.last_sprint?.results?.length) {
    const ls = d.last_sprint;
    sprintHtml = `
      <div class="sub">Last sprint · ${escapeHtml(ls.race_name || "")}</div>
      <table>
        <tr><th>#</th><th>Driver</th><th>Team</th><th>Pts</th></tr>
        ${ls.results.slice(0, 8).map(r => {
          const fav = isFavF1(r.driver) || isFavF1(r.team);
          return `<tr class="${fav ? "fav-row" : ""}">
            <td>${r.position ?? ""}</td>
            <td>${escapeHtml(r.driver)}</td>
            <td>${escapeHtml(r.team || "")}</td>
            <td>${r.points ?? ""}</td>
          </tr>`;
        }).join("")}
      </table>`;
  }

  // Recent races (with pole + fastest + gap)
  let recentHtml = "";
  if (d.recent_results?.length) {
    const items = d.recent_results.slice(0, 4).map(r => {
      const detail = f1RaceDetailLine(r);
      const top3 = (r.top3 || []).map(t => {
        const teamLc = (t.team || "").toLowerCase();
        return `<li data-team="${escapeAttr(teamLc)}"><span class="pos">P${t.position}</span> <span class="drv">${escapeHtml(t.driver)}</span> <span class="muted">${escapeHtml(t.team || "")}</span> <span class="gap tabular">${escapeHtml(t.time || "")}</span></li>`;
      }).join("");
      return `<div class="f1-race-card">
        <div class="f1-race-head">
          <div class="f1-race-name">🏆 ${escapeHtml(r.race_name)}</div>
          <div class="muted small">${fmtDate(r.date)}</div>
        </div>
        ${detail ? `<div class="f1-race-detail">${escapeHtml(detail)}</div>` : ""}
        ${top3 ? `<ol class="f1-podium">${top3}</ol>` : ""}
      </div>`;
    }).join("");
    recentHtml = `<div class="sub">Recent races</div><div class="f1-races">${items}</div>`;
  }

  el.innerHTML = `
    <div class="f1-weekend">
      <div>${timelineHtml || `<div class="sub">No upcoming weekend on file</div>`}</div>
      <div class="f1-tables">
        ${qualiHtml}
        ${sprintHtml}
      </div>
    </div>
    ${recentHtml}
    <div class="standings-grid">
      <div>
        <div class="sub">Driver standings</div>
        <table class="standings"><tr><th>#</th><th>Driver</th><th>Team</th><th>Pts</th></tr>${driverRows || `<tr><td colspan="4">—</td></tr>`}</table>
      </div>
      <div>
        <div class="sub">Constructors</div>
        <table class="standings"><tr><th>#</th><th>Team</th><th>Pts</th></tr>${teamRows || `<tr><td colspan="3">—</td></tr>`}</table>
      </div>
    </div>
  `;
}

// ---------- Rugby panels ----------
function renderRugbyMatches(elId, d, label, { withLogos = false, schoolsFav = false } = {}) {
  const el = document.getElementById(elId);
  if (!d) { el.textContent = `No ${label} data yet.`; return; }
  const isFav = (m) => isFavRugby(m.home) || isFavRugby(m.away) || (schoolsFav && (isFavSchool(m.home) || isFavSchool(m.away)));
  const isFavTeamRow = (m) => isFavRugby(m.home) || isFavRugby(m.away);

  const teamCell = (name, logo) => withLogos
    ? `<span class="team-cell">${logoImg(logo)}${escapeHtml(name)}</span>`
    : escapeHtml(name);

  const rec = (d.results || []).slice(0, 5).map(m => {
    const watch = watchChipsHtml(m.competition || label, { includeHighlights: true });
    const hl = highlightsChipHtml(m.competition || label);
    const scorers = scorerTimelineHtml(m.scoring_summary, isFav(m));
    const ht = m.half_time ? `<span class="ht-chip">HT ${escapeHtml(m.half_time)}</span>` : "";
    const subContent = [watch, hl ? `<div class="watch-row">${hl}</div>` : "", scorers].filter(Boolean).join("");
    return `
    <tr class="${isFav(m) ? "fav-row" : ""} ${isFavTeamRow(m) ? "fav-team-row" : ""} ${outcomeClass(m)}">
      <td>${m.date ? fmtDate(m.date) : ""}</td>
      <td>${teamCell(m.home, m.home_logo)}</td>
      <td class="score">${outcomeBadge(m)}${m.home_score ?? "-"}<span class="vs">v</span>${m.away_score ?? "-"} ${ht}</td>
      <td>${teamCell(m.away, m.away_logo)}</td>
    </tr>${subContent ? `<tr class="watch-sub"><td colspan="4">${subContent}</td></tr>` : ""}`;
  }).join("");
  const upc = (d.fixtures || []).slice(0, 5).map(m => {
    const watch = watchChipsHtml(m.competition || label);
    return `
    <tr class="${isFav(m) ? "fav-row" : ""} ${isFavTeamRow(m) ? "fav-team-row" : ""}">
      <td>${m.date ? fmtDate(m.date) : "TBD"}</td>
      <td>${teamCell(m.home, m.home_logo)}</td><td>v</td><td>${teamCell(m.away, m.away_logo)}</td>
    </tr>${watch ? `<tr class="watch-sub"><td colspan="4">${watch}</td></tr>` : ""}`;
  }).join("");
  el.innerHTML = `
    <div class="sub">Recent results</div>
    <table>${rec || `<tr><td>—</td></tr>`}</table>
    <div class="sub">Upcoming fixtures</div>
    <table>${upc || `<tr><td>—</td></tr>`}</table>
  `;
}

function clubQuickStats(d) {
  if (!d || !Array.isArray(d.results) || !d.results.length) return "";
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const isOurs = isAdamsMatch;
  const recent = d.results.filter(m => isOurs(m) && new Date(m.date).getTime() >= cutoff);
  let w = 0, l = 0, dr = 0;
  for (const m of recent) {
    if (m.home_score == null || m.away_score == null) continue;
    const homeIsUs = /st mary|smtc|smc/i.test(m.home);
    const us = homeIsUs ? m.home_score : m.away_score;
    const them = homeIsUs ? m.away_score : m.home_score;
    if (us > them) w++; else if (us < them) l++; else dr++;
  }
  return `
    <div class="club-strip">
      <div class="club-strip-title">St Mary's College RFC <small>· last 30 days · ${recent.length} match${recent.length === 1 ? "" : "es"}</small></div>
      <div class="club-stat win"><div class="stat-num">${w}</div><div class="stat-lbl">Wins</div></div>
      <div class="club-stat loss"><div class="stat-num">${l}</div><div class="stat-lbl">Losses</div></div>
      <div class="club-stat draw"><div class="stat-num">${dr}</div><div class="stat-lbl">Draws</div></div>
      <div class="club-stat"><div class="stat-num">${recent.length}</div><div class="stat-lbl">Played</div></div>
    </div>`;
}

function isU14(competition) {
  return /\bU\s?14\b/i.test(competition || "");
}

function clubU14Stats(d) {
  if (!d || !Array.isArray(d.results) || !d.results.length) {
    return { html: "", html2: "", count: 0, scored: 0, conceded: 0, diff: 0, streak: 0 };
  }
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recent = d.results
    .filter(m =>
      isAdamsMatch(m) &&
      isU14(m.competition) &&
      m.date && new Date(m.date).getTime() >= cutoff
    )
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  let w = 0, l = 0, dr = 0, scored = 0, conceded = 0;
  let streak = 0, streakLocked = false;
  for (const m of recent) {
    if (m.home_score == null || m.away_score == null) continue;
    const homeIsUs = /st mary|smtc|smc/i.test(m.home);
    const us = homeIsUs ? m.home_score : m.away_score;
    const them = homeIsUs ? m.away_score : m.home_score;
    scored += us;
    conceded += them;
    if (us > them) { w++; if (!streakLocked) streak++; }
    else if (us < them) { l++; streakLocked = true; }
    else { dr++; streakLocked = true; }
  }
  const diff = scored - conceded;
  const diffStr = (diff >= 0 ? "+" : "") + diff;
  const html = `
    <div class="club-strip u14-strip">
      <div class="club-strip-title">🟢⚪ My squad — U14 <small>· last 90 days · ${recent.length} match${recent.length === 1 ? "" : "es"}</small></div>
      <div class="club-stat win"><div class="stat-num">${w}</div><div class="stat-lbl">Wins</div></div>
      <div class="club-stat loss"><div class="stat-num">${l}</div><div class="stat-lbl">Losses</div></div>
      <div class="club-stat draw"><div class="stat-num">${dr}</div><div class="stat-lbl">Draws</div></div>
      <div class="club-stat"><div class="stat-num">${recent.length}</div><div class="stat-lbl">Played</div></div>
    </div>`;
  const html2 = `
    <div class="club-strip u14-strip u14-strip-pts">
      <div class="club-strip-title">Points & form <small>· same window</small></div>
      <div class="club-stat"><div class="stat-num">${scored}</div><div class="stat-lbl">For</div></div>
      <div class="club-stat"><div class="stat-num">${conceded}</div><div class="stat-lbl">Against</div></div>
      <div class="club-stat ${diff > 0 ? "win" : diff < 0 ? "loss" : "draw"}"><div class="stat-num">${diffStr}</div><div class="stat-lbl">Diff</div></div>
      <div class="club-stat ${streak > 0 ? "win" : ""}"><div class="stat-num">${streak}</div><div class="stat-lbl">Win streak</div></div>
    </div>`;
  return { html, html2, count: recent.length, scored, conceded, diff, streak };
}

function renderClub(d) {
  const el = document.getElementById("club-body");
  if (!d) { el.textContent = "No club data yet."; return; }
  const fmtRow = (m, isResult) => {
    const watch = watchChipsHtml(m.competition || "Dublin Club", { includeHighlights: isResult });
    const hl = isResult ? highlightsChipHtml(m.competition || "Dublin Club") : "";
    const subContent = [watch, hl ? `<div class="watch-row">${hl}</div>` : ""].filter(Boolean).join("");
    const score = isResult ? `${m.home_score ?? "-"}<span class="vs">v</span>${m.away_score ?? "-"}` : "v";
    const u14Tag = isU14(m.competition) ? `<span class="u14-pill">U14</span>` : "";
    const badge = isResult ? outcomeBadge(m) : "";
    return `
    <tr class="${isAdamsMatch(m) ? "fav-row" : ""} ${isU14(m.competition) ? "u14-row" : ""} ${isResult ? outcomeClass(m) : ""}">
      <td>${m.date ? fmtDate(m.date) : (isResult ? "" : "TBD")}</td>
      <td>${escapeHtml(normTeam(m.home))}</td>
      <td class="score">${badge}${score}</td>
      <td>${escapeHtml(normTeam(m.away))}</td>
      <td class="muted small">${escapeHtml(m.competition || "")} ${u14Tag}</td>
    </tr>${subContent ? `<tr class="watch-sub"><td colspan="5">${subContent}</td></tr>` : ""}`;
  };

  // Adam's U14 squad — pinned card at top
  const u14Results = (d.results || []).filter(m => isU14(m.competition) && isAdamsMatch(m));
  const u14Fixtures = (d.fixtures || []).filter(m => isU14(m.competition) && isAdamsMatch(m));
  const u14Stats = clubU14Stats(d);
  const u14RecRows = u14Results.slice(0, 5).map(m => fmtRow(m, true)).join("");
  const u14UpcRows = u14Fixtures.slice(0, 5).map(m => fmtRow(m, false)).join("");
  const u14Card = (u14Results.length || u14Fixtures.length) ? `
    <section class="u14-card">
      <div class="u14-card-head">
        <h3>🟢⚪ My U14 squad</h3>
        <span class="muted small">St Mary's College RFC</span>
      </div>
      ${u14Stats.html}
      ${u14Stats.html2}
      ${u14RecRows ? `<div class="sub">Recent U14 results</div><table>${u14RecRows}</table>` : ""}
      ${u14UpcRows ? `<div class="sub">Upcoming U14 fixtures</div><table>${u14UpcRows}</table>` : ""}
    </section>` : "";

  const recRows = (d.results || []).slice(0, 8).map(m => fmtRow(m, true)).join("");
  const upcRows = (d.fixtures || []).slice(0, 8).map(m => fmtRow(m, false)).join("");
  el.innerHTML = `
    ${u14Card}
    ${clubQuickStats(d)}
    <div class="club-blurb">My squad is pinned at the top; below is everything across the club.</div>
    <div class="sub">Recent results — all teams</div>
    <table>${recRows || `<tr><td>—</td></tr>`}</table>
    <div class="sub">Upcoming fixtures — all teams</div>
    <table>${upcRows || `<tr><td>—</td></tr>`}</table>
    <div class="muted small" style="margin-top:8px">Source: <a href="https://www.stmaryscollegerfc.ie/results/" target="_blank" rel="noopener">stmaryscollegerfc.ie</a></div>
  `;
}

// ---------- Settings panel ----------
function renderSchoolsChips() {
  const wrap = document.getElementById("schools-chips");
  if (!FAVS.schools.length) {
    wrap.innerHTML = `<span style="color:var(--muted);font-size:12px">No favorite schools yet.</span>`;
    return;
  }
  wrap.innerHTML = FAVS.schools.map((s, i) => `
    <span class="chip-x">${escapeHtml(s)} <button data-i="${i}" aria-label="Remove">✕</button></span>
  `).join("");
  wrap.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      FAVS.schools.splice(parseInt(b.dataset.i, 10), 1);
      renderSchoolsChips();
    });
  });
}

function openSettings() {
  document.getElementById("fav-driver").value = FAVS.f1Driver || "";
  document.getElementById("fav-rugby").value = FAVS.rugbyTeam || "";
  renderSchoolsChips();
  document.getElementById("settings-panel").hidden = false;
}
function closeSettings() {
  document.getElementById("settings-panel").hidden = true;
}

function bindSettings(rerender) {
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  document.getElementById("settings-backdrop").addEventListener("click", closeSettings);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("settings-panel").hidden) closeSettings();
  });
  document.getElementById("schools-add").addEventListener("click", () => {
    const inp = document.getElementById("schools-input");
    const v = inp.value.trim();
    if (v && !FAVS.schools.includes(v)) {
      FAVS.schools.push(v);
      renderSchoolsChips();
    }
    inp.value = "";
    inp.focus();
  });
  document.getElementById("schools-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); document.getElementById("schools-add").click(); }
  });
  document.getElementById("settings-save").addEventListener("click", () => {
    FAVS.f1Driver = document.getElementById("fav-driver").value.trim() || DEFAULT_FAVS.f1Driver;
    FAVS.rugbyTeam = document.getElementById("fav-rugby").value.trim() || DEFAULT_FAVS.rugbyTeam;
    saveFavs();
    closeSettings();
    rerender();
  });
}

// ---------- PWA ----------
function bindInstallPrompt() {
  let deferred = null;
  const btn = document.getElementById("install-btn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener("click", async () => {
    if (!deferred) return;
    btn.hidden = true;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    deferred = null;
  });
  window.addEventListener("appinstalled", () => { btn.hidden = true; });
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(err => console.warn("SW register failed", err));
  });
}

// ---------- Sticky nav: scroll-spy + sliding indicator ----------
function bindNav() {
  const tabs = Array.from(document.querySelectorAll(".nav-tab"));
  const indicator = document.getElementById("nav-indicator");
  const tabsWrap = document.getElementById("nav-tabs");
  if (!tabs.length || !indicator || !tabsWrap) return;

  const moveIndicator = (tab) => {
    if (!tab) return;
    // offsetLeft/offsetWidth are layout-stable and relative to the
    // positioned offsetParent (.nav-tabs has position: relative), so they
    // don't race with viewport scroll, font-swap reflow, or transforms.
    indicator.style.transform = `translateX(${tab.offsetLeft - 4}px)`;
    indicator.style.width = `${tab.offsetWidth}px`;
  };

  const setActive = (id) => {
    tabs.forEach(t => {
      const on = t.dataset.target === id;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      if (on) moveIndicator(t);
    });
  };

  // Single source of truth used by reorderSections + font-load + resize.
  const refresh = () => {
    const cur = document.querySelector(".nav-tab.active") || tabs[0];
    moveIndicator(cur);
  };
  window.__refreshNavIndicator = refresh;

  // Initial active = home (or whatever .active is in HTML)
  requestAnimationFrame(refresh);
  window.addEventListener("resize", refresh);

  // Re-position after web fonts swap in — Inter changes tab widths.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => requestAnimationFrame(refresh));
  }

  tabs.forEach(t => t.addEventListener("click", () => {
    setActive(t.dataset.target);
  }));

  // Scroll-spy — skip "inline" tabs like Upcoming that point inside another section
  const sections = tabs
    .filter(t => !t.hasAttribute("data-nav-inline"))
    .map(t => document.getElementById(t.dataset.target))
    .filter(Boolean);
  if (!("IntersectionObserver" in window) || !sections.length) return;
  const obs = new IntersectionObserver((entries) => {
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setActive(visible[0].target.id);
  }, { rootMargin: "-40% 0px -50% 0px", threshold: 0 });
  sections.forEach(s => obs.observe(s));
}

// ---------- Staggered fade-in ----------
function applyFadeIn() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const els = document.querySelectorAll(".section, .card, .feed-item, .news li");
  els.forEach((el, i) => {
    el.classList.add("fade-up");
    el.style.animationDelay = `${Math.min(i * 60, 600)}ms`;
  });
}

// ---------- Activity-based section reordering ----------
function sportActivity(all) {
  const now = Date.now();
  const DAY = 86400000;

  function bestDates(matches) {
    let lastPast = null, nextFuture = null;
    for (const m of matches || []) {
      if (!m?.date) continue;
      const t = new Date(m.date).getTime();
      if (isNaN(t)) continue;
      if (t <= now) { if (lastPast === null || t > lastPast) lastPast = t; }
      else { if (nextFuture === null || t < nextFuture) nextFuture = t; }
    }
    return { lastPast, nextFuture };
  }

  function scoreFor(past, future) {
    // Lower is "more active right now". Live (within ~6h either side) wins outright.
    const liveWindow = 6 * 3600 * 1000;
    if (past !== null && now - past < liveWindow) return -1;
    if (future !== null && future - now < liveWindow) return -1;
    const dPast = past !== null ? (now - past) / DAY : Infinity;
    const dFut = future !== null ? (future - now) / DAY : Infinity;
    // Bias slightly toward upcoming (future events feel "active" sooner)
    return Math.min(dPast, dFut * 0.85);
  }

  const f1Past = (all.f1?.last_results || all.f1?.recent || []);
  const f1Fut = (all.f1?.upcoming || []);
  const f1 = bestDates([
    ...f1Past.map(r => ({ date: r.date })),
    ...f1Fut.map(r => ({ date: r.date })),
  ]);

  const rugbyPast = [
    ...(all.intl?.results || []),
    ...(all.prov?.results || []),
    ...(all.schools?.results || []),
  ];
  const rugbyFut = [
    ...(all.intl?.fixtures || []),
    ...(all.prov?.fixtures || []),
    ...(all.schools?.fixtures || []),
  ];
  const rugby = bestDates([...rugbyPast, ...rugbyFut]);

  const club = bestDates([
    ...(all.club?.results || []),
    ...(all.club?.fixtures || []),
  ]);

  const items = [
    { id: "f1",    score: scoreFor(f1.lastPast,    f1.nextFuture) },
    { id: "rugby", score: scoreFor(rugby.lastPast, rugby.nextFuture) },
    { id: "club",  score: scoreFor(club.lastPast,  club.nextFuture) },
  ];
  items.sort((a, b) => a.score - b.score);
  return items;
}

function reorderSections(all) {
  const order = sportActivity(all);

  // 1. Reorder the section panels via CSS `order`
  //    Home = 0, Adam = 1 (always right after Home), sports = 2..N, News trails.
  document.getElementById("home")?.style.setProperty("order", "0");
  document.getElementById("adam")?.style.setProperty("order", "1");
  order.forEach((it, i) => {
    const sec = document.getElementById(it.id);
    if (sec) sec.style.order = String(i + 2);
  });

  // 2. Reorder the nav tabs (keep Home first, Upcoming + Adam pinned after Home, News last)
  const tabsWrap = document.getElementById("nav-tabs");
  if (tabsWrap) {
    const indicator = document.getElementById("nav-indicator");
    const home = tabsWrap.querySelector('[data-target="home"]');
    const upcoming = tabsWrap.querySelector('[data-target="upcoming"]');
    const adam = tabsWrap.querySelector('[data-target="adam"]');
    const news = tabsWrap.querySelector('[data-target="news"]');
    const sportTabs = order
      .map(it => tabsWrap.querySelector(`[data-target="${it.id}"]`))
      .filter(Boolean);
    if (home) tabsWrap.appendChild(home);
    if (upcoming) tabsWrap.appendChild(upcoming);
    if (adam) tabsWrap.appendChild(adam);
    sportTabs.forEach(t => tabsWrap.appendChild(t));
    if (news) tabsWrap.appendChild(news);
    if (indicator) tabsWrap.appendChild(indicator);
  }

  // 3. Tag the most-active section with an "Active now" chip
  document.querySelectorAll(".section .live-now-chip").forEach(n => n.remove());
  const top = order[0];
  if (top && isFinite(top.score)) {
    const sec = document.getElementById(top.id);
    const head = sec?.querySelector(".section-title");
    if (head) {
      const chip = document.createElement("span");
      chip.className = "live-now-chip";
      chip.textContent = top.score < 0 ? "🔴 Live window" : "🔥 Most active";
      head.appendChild(chip);
    }
  }

  // 4. Refresh nav indicator position (DOM order changed → tab offsets shifted)
  if (typeof window.__refreshNavIndicator === "function") {
    requestAnimationFrame(window.__refreshNavIndicator);
  }
}

// ---------- Boot ----------
let DATA = {};

function rerenderAll() {
  renderHero(DATA);
  renderFeed(buildFeed(DATA));
  renderFeed(buildUpcoming(DATA), "upcoming-feed", "No upcoming fixtures — check back after the next refresh.", { withSoonPills: true, withIcs: true });
  renderAdam(DATA);
  renderF1(DATA.f1);
  renderRugbyMatches("intl-body", DATA.intl, "international rugby", { withLogos: true });
  renderRugbyMatches("prov-body", DATA.prov, "URC", { withLogos: true });
  renderRugbyMatches("schools-body", DATA.schools, "schools", { withLogos: false, schoolsFav: true });
  renderClub(DATA.club);
  reorderSections(DATA);
}

(async function main() {
  bindNewsFilters();
  bindInstallPrompt();
  registerSW();

  const [f1, intl, prov, schools, news, watch, club, highlights] = await Promise.all([
    loadJson(DATA_FILES.f1),
    loadJson(DATA_FILES.intl),
    loadJson(DATA_FILES.prov),
    loadJson(DATA_FILES.schools),
    loadJson(DATA_FILES.news),
    loadJson(DATA_FILES.watch),
    loadJson(DATA_FILES.club),
    loadJson(DATA_FILES.highlights),
  ]);
  DATA = { f1, intl, prov, schools, news, club };
  WATCH = watch || {};
  HIGHLIGHTS = highlights || { competitions: {}, matches: {} };

  const stamps = [f1, intl, prov, schools, news, club].map(d => d?.generated_at || d?.fetched_at).filter(Boolean);
  document.getElementById("last-updated").textContent = stamps.length
    ? `Updated ${relTime(stamps.sort().pop())}`
    : "Awaiting first data refresh";

  NEWS_ITEMS = (news?.items || []);
  renderNews();
  rerenderAll();
  bindSettings(rerenderAll);
  bindNav();
  applyFadeIn();

  const greet = document.createElement("div");
  greet.className = "adam-greet";
  greet.innerHTML = `Hi Adam 👋 — Go <strong>Leinster</strong> 💙, come on <strong>St Mary's</strong> 🟢⚪, and <strong>Go Hadjar</strong> 🏎️`;
  document.querySelector(".tagline").after(greet);
})();
