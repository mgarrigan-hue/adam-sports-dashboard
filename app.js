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
  return `<a class="watch-chip is-link is-highlights" href="${escapeAttr(entry.url)}" target="_blank" rel="noopener" title="Open ${escapeAttr(lbl)} for highlights">🎬 Recaps on ${escapeHtml(lbl)} ↗</a>`;
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
      return `<a class="watch-chip is-link ${tierCls}" href="${escapeAttr(x.url)}" target="_blank" rel="noopener" title="Open ${escapeAttr(x.label)}">📺 ${escapeHtml(x.label)} ${tierTag} ↗</a>`;
    }
    return `<span class="watch-chip ${tierCls}" title="On TV (Sky Signature)">📺 ${escapeHtml(x.label)} ${tierTag}</span>`;
  }).join("");
  const note = info.note ? `<span class="watch-note">${escapeHtml(info.note)}</span>` : "";
  return `<div class="watch-row">${chips}${note}</div>`;
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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function logoImg(url, name) {
  if (!url) return "";
  return `<img class="team-logo" loading="lazy" src="${escapeAttr(url)}" alt="" onerror="this.style.display='none'"/>`;
}

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
      <a href="${escapeAttr(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>
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
      const homeCell = `<span class="team-cell">${escapeHtml(m.home)}</span>`;
      const awayCell = `<span class="team-cell">${escapeHtml(m.away)}</span>`;
      const badge = isResult ? outcomeBadge(m) : "";
      const titleHtml = isResult
        ? `${badge}${homeCell} <strong>${m.home_score} – ${m.away_score}</strong> ${awayCell}`
        : `${homeCell} v ${awayCell}`;
      items.push({
        date: m.date, tag: "club",
        titleHtml,
        meta: m.competition || "St Mary's College RFC",
        fav: m.involves_smc !== false,
        outcome: isResult ? favOutcome(m) : null,
        watch: m.competition || "Dublin Club",
        competition: m.competition || "Dublin Club",
        isResult,
      });
    };
    (all.club.results || []).slice(0, 25).forEach(m => pushClub(m, true));
    (all.club.fixtures || []).slice(0, 25).forEach(m => pushClub(m, false));
  }
  items.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : -Infinity;
    const db = b.date ? new Date(b.date).getTime() : -Infinity;
    return db - da;
  });
  // "Latest action" = things that have actually happened, with the
  // freshest at the top. Upcoming stuff lives in the hero / sport panels.
  const now = Date.now();
  const past = items.filter(it => it.date && new Date(it.date).getTime() <= now);
  if (past.length) return past.slice(0, 30);
  return items
    .filter(it => it.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 10);
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

function renderFeed(items) {
  const ul = document.getElementById("latest-feed");
  if (!items.length) {
    ul.innerHTML = `<li class="empty">No data yet — the GitHub Action will populate this on next refresh.</li>`;
    return;
  }
  ul.innerHTML = items.slice(0, 25).map(i => {
    const isPast = i.date && new Date(i.date).getTime() < Date.now();
    const watch = i.watch ? watchChipsHtml(i.watch, { includeHighlights: isPast || i.isResult }) : "";
    const hl = (i.isResult || isPast) ? highlightsChipHtml(i.competition || i.watch) : "";
    const extraRow = hl ? `<div class="watch-row">${hl}</div>` : "";
    const scorers = i.scoringSummary ? scorerTimelineHtml(i.scoringSummary, i.fav) : "";
    const rel = i.date ? relTime(i.date) : "";
    return `
    <li class="feed-item ${i.fav ? "fav" : ""} ${i.outcome ? "fav-" + i.outcome : ""}">
      ${feedDateBlockHtml(i.date)}
      <div class="feed-body">
        <div class="feed-title">${i.titleHtml || escapeHtml(i.title)}</div>
        <div class="feed-meta">${escapeHtml(i.meta || "")}</div>
        ${rel ? `<div class="feed-rel">${escapeHtml(rel)}</div>` : ""}
        ${watch}
        ${extraRow}
        ${scorers}
      </div>
      <span class="feed-tag ${i.tag}">${i.tag}</span>
    </li>`;
  }).join("");
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
    title: `🟢⚪ ${m.home} v ${m.away}`,
    meta: m.competition || "St Mary's College RFC",
    boost: m.involves_smc !== false,
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

  if (!future.length) {
    titleEl.textContent = "Nothing scheduled right now";
    metaEl.textContent = "Check back soon!";
    document.getElementById("hero-countdown").textContent = "";
    dotsEl.innerHTML = "";
    return;
  }

  HERO_EVENTS = future.slice(0, 3);
  HERO_IDX = 0;

  dotsEl.innerHTML = HERO_EVENTS.map((_, i) => `<span class="dot ${i === 0 ? "active" : ""}" data-idx="${i}"></span>`).join("");
  dotsEl.querySelectorAll(".dot").forEach(d => {
    d.addEventListener("click", () => showHero(parseInt(d.dataset.idx, 10)));
  });

  showHero(0);
  clearInterval(HERO_TIMER);
  if (HERO_EVENTS.length > 1) {
    HERO_TIMER = setInterval(() => showHero((HERO_IDX + 1) % HERO_EVENTS.length), 8000);
  }
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
    dotsEl.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("active", i === idx));
    startCountdown(new Date(ev.date));
    // Sport-themed background
    if (ev.sport) card.dataset.sport = ev.sport; else delete card.dataset.sport;
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
    <tr class="${isFav(m) ? "fav-row" : ""} ${outcomeClass(m)}">
      <td>${m.date ? fmtDate(m.date) : ""}</td>
      <td>${teamCell(m.home, m.home_logo)}</td>
      <td class="score">${outcomeBadge(m)}${m.home_score ?? "-"}<span class="vs">v</span>${m.away_score ?? "-"} ${ht}</td>
      <td>${teamCell(m.away, m.away_logo)}</td>
    </tr>${subContent ? `<tr class="watch-sub"><td colspan="4">${subContent}</td></tr>` : ""}`;
  }).join("");
  const upc = (d.fixtures || []).slice(0, 5).map(m => {
    const watch = watchChipsHtml(m.competition || label);
    return `
    <tr class="${isFav(m) ? "fav-row" : ""}">
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
  const isOurs = (m) => m.involves_smc !== false;
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
    return { html: "", count: 0 };
  }
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recent = d.results.filter(m =>
    m.involves_smc !== false &&
    isU14(m.competition) &&
    m.date && new Date(m.date).getTime() >= cutoff
  );
  let w = 0, l = 0, dr = 0;
  for (const m of recent) {
    if (m.home_score == null || m.away_score == null) continue;
    const homeIsUs = /st mary|smtc|smc/i.test(m.home);
    const us = homeIsUs ? m.home_score : m.away_score;
    const them = homeIsUs ? m.away_score : m.home_score;
    if (us > them) w++; else if (us < them) l++; else dr++;
  }
  const html = `
    <div class="club-strip u14-strip">
      <div class="club-strip-title">🟢⚪ Adam's squad — U14 <small>· last 90 days · ${recent.length} match${recent.length === 1 ? "" : "es"}</small></div>
      <div class="club-stat win"><div class="stat-num">${w}</div><div class="stat-lbl">Wins</div></div>
      <div class="club-stat loss"><div class="stat-num">${l}</div><div class="stat-lbl">Losses</div></div>
      <div class="club-stat draw"><div class="stat-num">${dr}</div><div class="stat-lbl">Draws</div></div>
      <div class="club-stat"><div class="stat-num">${recent.length}</div><div class="stat-lbl">Played</div></div>
    </div>`;
  return { html, count: recent.length };
}

function renderClub(d) {
  const el = document.getElementById("club-body");
  if (!d) { el.textContent = "No club data yet."; return; }
  const fmtRow = (m, isResult) => {
    const watch = watchChipsHtml(m.competition || "Dublin Club", { includeHighlights: isResult });
    const hl = isResult ? highlightsChipHtml(m.competition || "Dublin Club") : "";
    const subContent = [watch, hl ? `<div class="watch-row">${hl}</div>` : ""].filter(Boolean).join("");
    const score = isResult ? `${m.home_score ?? "-"}<span class="vs">v</span>${m.away_score ?? "-"}` : "v";
    const u14Tag = isU14(m.competition) ? `<span class="u14-pill" title="Adam's age grade">U14</span>` : "";
    const badge = isResult ? outcomeBadge(m) : "";
    return `
    <tr class="${m.involves_smc ? "fav-row" : ""} ${isU14(m.competition) ? "u14-row" : ""} ${isResult ? outcomeClass(m) : ""}">
      <td>${m.date ? fmtDate(m.date) : (isResult ? "" : "TBD")}</td>
      <td>${escapeHtml(m.home)}</td>
      <td class="score">${badge}${score}</td>
      <td>${escapeHtml(m.away)}</td>
      <td class="muted small">${escapeHtml(m.competition || "")} ${u14Tag}</td>
    </tr>${subContent ? `<tr class="watch-sub"><td colspan="5">${subContent}</td></tr>` : ""}`;
  };

  // Adam's U14 squad — pinned card at top
  const u14Results = (d.results || []).filter(m => isU14(m.competition) && m.involves_smc !== false);
  const u14Fixtures = (d.fixtures || []).filter(m => isU14(m.competition) && m.involves_smc !== false);
  const u14Stats = clubU14Stats(d);
  const u14RecRows = u14Results.slice(0, 5).map(m => fmtRow(m, true)).join("");
  const u14UpcRows = u14Fixtures.slice(0, 5).map(m => fmtRow(m, false)).join("");
  const u14Card = (u14Results.length || u14Fixtures.length) ? `
    <section class="u14-card">
      <div class="u14-card-head">
        <h3>🟢⚪ Adam's U14 squad</h3>
        <span class="muted small">St Mary's College RFC · Under-14</span>
      </div>
      ${u14Stats.html}
      ${u14RecRows ? `<div class="sub">Recent U14 results</div><table>${u14RecRows}</table>` : ""}
      ${u14UpcRows ? `<div class="sub">Upcoming U14 fixtures</div><table>${u14UpcRows}</table>` : ""}
    </section>` : "";

  const recRows = (d.results || []).slice(0, 8).map(m => fmtRow(m, true)).join("");
  const upcRows = (d.fixtures || []).slice(0, 8).map(m => fmtRow(m, false)).join("");
  el.innerHTML = `
    ${u14Card}
    ${clubQuickStats(d)}
    <div class="club-blurb">Adam Garrigan (U14) plays here. His squad is pinned at the top; below is everything across the club.</div>
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

  // Scroll-spy
  const sections = tabs
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
  document.getElementById("home")?.style.setProperty("order", "0");
  order.forEach((it, i) => {
    const sec = document.getElementById(it.id);
    if (sec) sec.style.order = String(i + 1);
  });

  // 2. Reorder the nav tabs (keep Home first, News last)
  const tabsWrap = document.getElementById("nav-tabs");
  if (tabsWrap) {
    const indicator = document.getElementById("nav-indicator");
    const home = tabsWrap.querySelector('[data-target="home"]');
    const news = tabsWrap.querySelector('[data-target="news"]');
    const sportTabs = order
      .map(it => tabsWrap.querySelector(`[data-target="${it.id}"]`))
      .filter(Boolean);
    if (home) tabsWrap.appendChild(home);
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
  greet.style.cssText = "color:var(--muted);font-size:12px;margin-top:4px";
  greet.textContent = "Hi Adam 👋 — Up the Blues, MARYS abú, and Forza Hadjar!";
  document.querySelector(".tagline").after(greet);
})();
