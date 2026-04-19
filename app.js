// Adam's Sports Dashboard — frontend
const FAV = {
  f1Driver: "Isack Hadjar",
  f1Team: "Red Bull",
  f1TeamAlt: ["RB", "VCARB", "Racing Bulls"],
  rugbyTeam: "Leinster",
};

const DATA_FILES = {
  f1: "data/f1.json",
  intl: "data/intl_rugby.json",
  prov: "data/provinces.json",
  schools: "data/schools.json",
};

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
  if (t.includes(FAV.f1Driver.toLowerCase()) || t.includes("hadjar")) return true;
  if (t.includes("red bull")) return true;
  return FAV.f1TeamAlt.some(x => t.includes(x.toLowerCase()));
}
function isFavRugby(text) {
  return text && text.toLowerCase().includes(FAV.rugbyTeam.toLowerCase());
}

// ---------- Latest unified feed ----------
function buildFeed(all) {
  const items = [];
  // F1 — recent races as past items, schedule as upcoming
  if (all.f1) {
    (all.f1.recent_results || []).forEach(r => {
      items.push({
        date: r.date,
        tag: "f1",
        title: `🏆 ${r.race_name} — Winner: ${r.winner}`,
        meta: r.podium ? `Podium: ${r.podium.join(" · ")}` : "",
        fav: isFavF1(r.winner) || (r.podium || []).some(isFavF1),
      });
    });
    (all.f1.upcoming || []).forEach(r => {
      items.push({
        date: r.date,
        tag: "f1",
        title: `🏁 ${r.race_name} — ${r.circuit || ""}`,
        meta: r.location || "",
        fav: false,
      });
    });
  }
  // International rugby
  if (all.intl) {
    (all.intl.results || []).forEach(m => items.push({
      date: m.date, tag: "intl",
      title: `${m.home} ${m.home_score} – ${m.away_score} ${m.away}`,
      meta: m.competition || "International",
      fav: isFavRugby(m.home) || isFavRugby(m.away),
    }));
    (all.intl.fixtures || []).forEach(m => items.push({
      date: m.date, tag: "intl",
      title: `${m.home} v ${m.away}`,
      meta: m.competition || "International",
      fav: false,
    }));
  }
  // URC / provinces
  if (all.prov) {
    (all.prov.results || []).forEach(m => items.push({
      date: m.date, tag: "urc",
      title: `${m.home} ${m.home_score} – ${m.away_score} ${m.away}`,
      meta: m.competition || "URC",
      fav: isFavRugby(m.home) || isFavRugby(m.away),
    }));
    (all.prov.fixtures || []).forEach(m => items.push({
      date: m.date, tag: "urc",
      title: `${m.home} v ${m.away}`,
      meta: m.competition || "URC",
      fav: isFavRugby(m.home) || isFavRugby(m.away),
    }));
  }
  // Schools
  if (all.schools) {
    (all.schools.results || []).forEach(m => items.push({
      date: m.date, tag: "schools",
      title: `${m.home} ${m.home_score ?? ""} – ${m.away_score ?? ""} ${m.away}`,
      meta: m.competition || "Leinster Schools",
      fav: false,
    }));
    (all.schools.fixtures || []).forEach(m => items.push({
      date: m.date, tag: "schools",
      title: `${m.home} v ${m.away}`,
      meta: m.competition || "Leinster Schools",
      fav: false,
    }));
  }
  // Sort by date desc; items without a date go to the bottom.
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
        <div class="what">${escapeHtml(i.title)}</div>
        <div class="who">${escapeHtml(i.meta || "")}</div>
      </span>
      <span class="tag ${i.tag}">${i.tag}</span>
    </li>
  `).join("");
}

// ---------- Hero (next big event) ----------
function renderHero(all) {
  // pick the soonest upcoming event across all sports
  const upcoming = [];
  (all.f1?.upcoming || []).forEach(r => upcoming.push({
    date: r.date, title: `🏁 ${r.race_name}`, meta: `${r.circuit || ""} · ${r.location || ""}`
  }));
  (all.intl?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, title: `🌍 ${m.home} v ${m.away}`, meta: m.competition || "International"
  }));
  (all.prov?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, title: `☘️ ${m.home} v ${m.away}`,
    meta: m.competition || "URC",
    boost: isFavRugby(m.home) || isFavRugby(m.away),
  }));
  (all.schools?.fixtures || []).forEach(m => upcoming.push({
    date: m.date, title: `🎓 ${m.home} v ${m.away}`, meta: m.competition || "Leinster Schools"
  }));

  const future = upcoming
    .filter(e => e.date && new Date(e.date).getTime() > Date.now())
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!future.length) {
    document.getElementById("hero-title").textContent = "Nothing scheduled right now";
    document.getElementById("hero-meta").textContent = "Check back soon!";
    return;
  }
  // prefer a Leinster fixture in the next 7 days, else the soonest
  const week = Date.now() + 7 * 86400000;
  const leinsterSoon = future.find(e => e.boost && new Date(e.date).getTime() < week);
  const pick = leinsterSoon || future[0];

  document.getElementById("hero-title").textContent = pick.title;
  document.getElementById("hero-meta").textContent = `${pick.meta} · ${fmtDate(pick.date)}`;
  startCountdown(new Date(pick.date));
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
  clearInterval(window.__cd);
  window.__cd = setInterval(tick, 1000);
}

// ---------- Per-sport panels ----------
function renderF1(d) {
  const el = document.getElementById("f1-body");
  if (!d) { el.textContent = "No F1 data yet."; return; }
  const driverRows = (d.driver_standings || []).slice(0, 10).map((s, i) => `
    <tr class="${isFavF1(s.driver) ? "fav-row" : ""}">
      <td>${i + 1}</td><td>${escapeHtml(s.driver)}</td>
      <td>${escapeHtml(s.team || "")}</td><td>${s.points ?? ""}</td>
    </tr>`).join("");
  const teamRows = (d.constructor_standings || []).slice(0, 10).map((s, i) => `
    <tr class="${(s.team || "").toLowerCase().includes("red bull") ? "fav-row" : ""}">
      <td>${i + 1}</td><td>${escapeHtml(s.team)}</td><td>${s.points ?? ""}</td>
    </tr>`).join("");
  el.innerHTML = `
    <div class="sub">Driver standings</div>
    <table><tr><th>#</th><th>Driver</th><th>Team</th><th>Pts</th></tr>${driverRows || `<tr><td colspan="4">—</td></tr>`}</table>
    <div class="sub">Constructors</div>
    <table><tr><th>#</th><th>Team</th><th>Pts</th></tr>${teamRows || `<tr><td colspan="3">—</td></tr>`}</table>
  `;
}

function renderRugbyMatches(elId, d, label) {
  const el = document.getElementById(elId);
  if (!d) { el.textContent = `No ${label} data yet.`; return; }
  const rec = (d.results || []).slice(0, 5).map(m => `
    <tr class="${isFavRugby(m.home) || isFavRugby(m.away) ? "fav-row" : ""}">
      <td>${m.date ? fmtDate(m.date) : ""}</td>
      <td>${escapeHtml(m.home)}</td>
      <td class="score">${m.home_score ?? "-"}<span class="vs">v</span>${m.away_score ?? "-"}</td>
      <td>${escapeHtml(m.away)}</td>
    </tr>`).join("");
  const upc = (d.fixtures || []).slice(0, 5).map(m => `
    <tr class="${isFavRugby(m.home) || isFavRugby(m.away) ? "fav-row" : ""}">
      <td>${m.date ? fmtDate(m.date) : "TBD"}</td>
      <td>${escapeHtml(m.home)}</td><td>v</td><td>${escapeHtml(m.away)}</td>
    </tr>`).join("");
  el.innerHTML = `
    <div class="sub">Recent results</div>
    <table>${rec || `<tr><td>—</td></tr>`}</table>
    <div class="sub">Upcoming fixtures</div>
    <table>${upc || `<tr><td>—</td></tr>`}</table>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------- Boot ----------
(async function main() {
  const [f1, intl, prov, schools] = await Promise.all([
    loadJson(DATA_FILES.f1),
    loadJson(DATA_FILES.intl),
    loadJson(DATA_FILES.prov),
    loadJson(DATA_FILES.schools),
  ]);
  const all = { f1, intl, prov, schools };

  // last updated = max generated_at across files
  const stamps = [f1, intl, prov, schools].map(d => d?.generated_at).filter(Boolean);
  document.getElementById("last-updated").textContent = stamps.length
    ? `Updated ${relTime(stamps.sort().pop())}`
    : "Awaiting first data refresh";

  renderHero(all);
  renderFeed(buildFeed(all));
  renderF1(f1);
  renderRugbyMatches("intl-body", intl, "international rugby");
  renderRugbyMatches("prov-body", prov, "URC");
  renderRugbyMatches("schools-body", schools, "schools");

  // Hello, Adam
  const greet = document.createElement("div");
  greet.style.cssText = "color:var(--muted);font-size:12px;margin-top:4px";
  greet.textContent = "Hi Adam 👋 — Up the Blues, and Forza Hadjar!";
  document.querySelector(".tagline").after(greet);
})();
