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
};

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
      items.push({
        date: r.date, tag: "f1",
        title: `🏆 ${r.race_name} — Winner: ${r.winner}`,
        meta: r.podium ? `Podium: ${r.podium.join(" · ")}` : "",
        fav: isFavF1(r.winner) || (r.podium || []).some(isFavF1),
      });
    });
    (all.f1.upcoming || []).forEach(r => {
      items.push({
        date: r.date, tag: "f1",
        title: `🏁 ${r.race_name} — ${r.circuit || ""}`,
        meta: r.location || "", fav: false,
      });
    });
  }
  const pushRugby = (m, tag, defaultComp) => {
    const homeCell = `<span class="team-cell">${logoImg(m.home_logo)}${escapeHtml(m.home)}</span>`;
    const awayCell = `<span class="team-cell">${logoImg(m.away_logo)}${escapeHtml(m.away)}</span>`;
    const titleHtml = m.home_score != null
      ? `${homeCell} <strong>${m.home_score} – ${m.away_score}</strong> ${awayCell}`
      : `${homeCell} v ${awayCell}`;
    items.push({
      date: m.date, tag,
      titleHtml,
      meta: m.competition || defaultComp,
      fav: isFavRugby(m.home) || isFavRugby(m.away) || isFavSchool(m.home) || isFavSchool(m.away),
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
      meta: m.competition || "Leinster Schools",
      fav: isFavSchool(m.home) || isFavSchool(m.away),
    }));
    (all.schools.fixtures || []).forEach(m => items.push({
      date: m.date, tag: "schools",
      title: `${m.home} v ${m.away}`,
      meta: m.competition || "Leinster Schools",
      fav: isFavSchool(m.home) || isFavSchool(m.away),
    }));
  }
  items.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : -Infinity;
    const db = b.date ? new Date(b.date).getTime() : -Infinity;
    return db - da;
  });
  return items;
}

function renderFeed(items) {
  const ul = document.getElementById("latest-feed");
  if (!items.length) {
    ul.innerHTML = `<li class="empty">No data yet — the GitHub Action will populate this on next refresh.</li>`;
    return;
  }
  ul.innerHTML = items.slice(0, 25).map(i => `
    <li class="${i.fav ? "fav" : ""}">
      <span class="when">${i.date ? `${fmtDate(i.date)}<br><small>${relTime(i.date)}</small>` : "TBD"}</span>
      <span>
        <div class="what">${i.titleHtml || escapeHtml(i.title)}</div>
        <div class="who">${escapeHtml(i.meta || "")}</div>
      </span>
      <span class="tag ${i.tag}">${i.tag}</span>
    </li>
  `).join("");
}

// ---------- Hero (rotating) ----------
let HERO_EVENTS = [];
let HERO_IDX = 0;
let HERO_TIMER = null;
let CD_TIMER = null;

function collectUpcoming(all) {
  const upcoming = [];
  (all.f1?.upcoming || []).forEach(r => upcoming.push({
    date: r.date, label: "Next Up · F1",
    title: `🏁 ${r.race_name}`,
    meta: `${r.circuit || ""}${r.location ? " · " + r.location : ""}`,
  }));
  (all.intl?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, label: "Next Up · International Rugby",
    title: `🌍 ${m.home} v ${m.away}`,
    meta: m.competition || "International",
    boost: isFavRugby(m.home) || isFavRugby(m.away),
  }));
  (all.prov?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, label: "Next Up · URC",
    title: `☘️ ${m.home} v ${m.away}`,
    meta: m.competition || "URC",
    boost: isFavRugby(m.home) || isFavRugby(m.away),
  }));
  (all.schools?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, label: "Next Up · Schools",
    title: `🎓 ${m.home} v ${m.away}`,
    meta: m.competition || "Leinster Schools",
    boost: isFavSchool(m.home) || isFavSchool(m.away),
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
    <tr class="${isFavF1(s.driver) ? "fav-row" : ""}">
      <td>${i + 1}</td><td>${escapeHtml(s.driver)}</td>
      <td>${escapeHtml(s.team || "")}</td><td>${s.points ?? ""}</td>
    </tr>`).join("");
  const teamRows = (d.constructor_standings || []).slice(0, 10).map((s, i) => `
    <tr class="${(s.team || "").toLowerCase().includes("red bull") || (s.team || "").toLowerCase().includes("racing bull") ? "fav-row" : ""}">
      <td>${i + 1}</td><td>${escapeHtml(s.team)}</td><td>${s.points ?? ""}</td>
    </tr>`).join("");

  // Weekend timeline
  let timelineHtml = "";
  if (d.next_race_sessions?.sessions?.length) {
    const ns = d.next_race_sessions;
    timelineHtml = `
      <div class="sub">Race weekend · ${escapeHtml(ns.race_name || "")}${ns.circuit ? " · " + escapeHtml(ns.circuit) : ""}</div>
      <ul class="timeline">
        ${ns.sessions.map(sess => {
          const past = sess.datetime && new Date(sess.datetime).getTime() < Date.now();
          return `<li class="${past ? "past" : ""}">
            <div class="sess-name">${escapeHtml(sess.name)}</div>
            <div class="sess-when">${fmtTime(sess.datetime)}</div>
            ${past ? "" : `<div class="sess-cd">${relTime(sess.datetime)}</div>`}
          </li>`;
        }).join("")}
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

  el.innerHTML = `
    <div class="f1-weekend">
      <div>${timelineHtml || `<div class="sub">No upcoming weekend on file</div>`}</div>
      <div class="f1-tables">
        ${qualiHtml}
        ${sprintHtml}
      </div>
    </div>
    <div class="standings-grid">
      <div>
        <div class="sub">Driver standings</div>
        <table><tr><th>#</th><th>Driver</th><th>Team</th><th>Pts</th></tr>${driverRows || `<tr><td colspan="4">—</td></tr>`}</table>
      </div>
      <div>
        <div class="sub">Constructors</div>
        <table><tr><th>#</th><th>Team</th><th>Pts</th></tr>${teamRows || `<tr><td colspan="3">—</td></tr>`}</table>
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

  const rec = (d.results || []).slice(0, 5).map(m => `
    <tr class="${isFav(m) ? "fav-row" : ""}">
      <td>${m.date ? fmtDate(m.date) : ""}</td>
      <td>${teamCell(m.home, m.home_logo)}</td>
      <td class="score">${m.home_score ?? "-"}<span class="vs">v</span>${m.away_score ?? "-"}</td>
      <td>${teamCell(m.away, m.away_logo)}</td>
    </tr>`).join("");
  const upc = (d.fixtures || []).slice(0, 5).map(m => `
    <tr class="${isFav(m) ? "fav-row" : ""}">
      <td>${m.date ? fmtDate(m.date) : "TBD"}</td>
      <td>${teamCell(m.home, m.home_logo)}</td><td>v</td><td>${teamCell(m.away, m.away_logo)}</td>
    </tr>`).join("");
  el.innerHTML = `
    <div class="sub">Recent results</div>
    <table>${rec || `<tr><td>—</td></tr>`}</table>
    <div class="sub">Upcoming fixtures</div>
    <table>${upc || `<tr><td>—</td></tr>`}</table>
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

// ---------- Boot ----------
let DATA = {};

function rerenderAll() {
  renderHero(DATA);
  renderFeed(buildFeed(DATA));
  renderF1(DATA.f1);
  renderRugbyMatches("intl-body", DATA.intl, "international rugby", { withLogos: true });
  renderRugbyMatches("prov-body", DATA.prov, "URC", { withLogos: true });
  renderRugbyMatches("schools-body", DATA.schools, "schools", { withLogos: false, schoolsFav: true });
}

(async function main() {
  bindNewsFilters();
  bindInstallPrompt();
  registerSW();

  const [f1, intl, prov, schools, news] = await Promise.all([
    loadJson(DATA_FILES.f1),
    loadJson(DATA_FILES.intl),
    loadJson(DATA_FILES.prov),
    loadJson(DATA_FILES.schools),
    loadJson(DATA_FILES.news),
  ]);
  DATA = { f1, intl, prov, schools, news };

  const stamps = [f1, intl, prov, schools, news].map(d => d?.generated_at).filter(Boolean);
  document.getElementById("last-updated").textContent = stamps.length
    ? `Updated ${relTime(stamps.sort().pop())}`
    : "Awaiting first data refresh";

  NEWS_ITEMS = (news?.items || []);
  renderNews();
  rerenderAll();
  bindSettings(rerenderAll);

  const greet = document.createElement("div");
  greet.style.cssText = "color:var(--muted);font-size:12px;margin-top:4px";
  greet.textContent = "Hi Adam 👋 — Up the Blues, and Forza Hadjar!";
  document.querySelector(".tagline").after(greet);
})();
