// Adam's Sports Dashboard — World Cup 2026 module
// Extracted from app.js in Wave 4 polish. Loaded BEFORE app.js so the
// global function/const declarations are visible by the time main() runs.
// Depends on app.js globals: escapeHtml, escapeAttr, loadJson, DATA_FILES, DATA, document, location.

// World Cup — nations Adam is rooting for. Used by isAdamsWcTeam everywhere
// we render WC content (today list, group ring highlight, hero on /#adam).
const FAV_WC_NATIONS = ["Brazil"];
const isAdamsWcTeam = (name) =>
  !!name && FAV_WC_NATIONS.some(n => String(name).toLowerCase().includes(n.toLowerCase()));

// ===== WORLD CUP =====
// All `wc*` helpers + renderers live below. WC_START / WC_END drive the
// phase-aware UI (pre / during / recap / post) — see wcPhase().
const WC_START = new Date("2026-06-11T00:00:00Z");
const WC_END   = new Date("2026-07-19T23:59:59Z");
const WC_RECAP_UNTIL = new Date("2026-07-31T23:59:59Z");

// Live-match heuristics + auto-refresh cadence. Kept as named constants so
// the magic numbers don't get scattered across renderers.
const WC_LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000; // kickoff window when no explicit status
const WC_LIVE_REFRESH_MS = 60 * 1000;           // refetch data/world_cup.json this often during live windows
let WC_LIVE_TIMER = null;
let WC_HERO_TIMER = null;

function wcPhase(now = new Date()) {
  if (now < WC_START) return "pre";
  if (now <= WC_END) return "during";
  if (now <= WC_RECAP_UNTIL) return "recap";
  return "post";
}

function wcCountdownString(target, from = new Date()) {
  const ms = Math.max(0, target.getTime() - from.getTime());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function wcKickoffLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-IE", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function wcBroadcastBadge(b, opts = {}) {
  if (!b) return "";
  const parts = [];
  if (opts.bothRegions) {
    const uk = (b.uk || []).join(" / ");
    const ie = (b.ie || []).join(" / ");
    if (uk) parts.push(`<span class="wc-broadcast" title="UK broadcast">🇬🇧 ${escapeHtml(uk)}</span>`);
    if (ie) parts.push(`<span class="wc-broadcast" title="Ireland broadcast">🇮🇪 ${escapeHtml(ie)}</span>`);
    return parts.join(" ");
  }
  const ie = (b.ie || []).join(" / ");
  if (!ie) return "";
  return `<span class="wc-broadcast">📺 ${escapeHtml(ie)}</span>`;
}

function wcMatchHasTeam(match, name) {
  return isAdamsWcTeam(match?.home?.name) || isAdamsWcTeam(match?.away?.name);
}

// "Is this WC match currently live?" — explicit status wins, otherwise we
// treat (kickoff ≤ now ≤ kickoff + 2.5h) AND no final score as live. Mirrors
// isLiveRugby/isLiveF1Race so behaviour stays consistent across sports.
function wcIsLive(match) {
  if (!match || !match.date) return false;
  const st = String(match.status || "").toLowerCase();
  if (st === "live" || st === "in" || st === "in_progress") return true;
  if (st === "complete" || st === "complete-unknown" || st === "final") return false;
  const start = new Date(match.date).getTime();
  if (isNaN(start)) return false;
  const now = Date.now();
  const hasFinal = match.score && match.score.home != null && match.score.away != null && (now - start) > WC_LIVE_WINDOW_MS;
  return now >= start && (now - start) <= WC_LIVE_WINDOW_MS && !hasFinal;
}

function wcAnyLive(matches) {
  return (matches || []).some(wcIsLive);
}

// Last N completed matches for a given nation, oldest→newest, as W/L/D pills.
// Returns [] before any matches are played (pre-tournament).
function wcFormPills(matches, nationName, n = 3) {
  if (!matches || !nationName) return [];
  const name = String(nationName).toLowerCase();
  const completed = matches.filter(m => {
    if (!m.score || m.score.home == null || m.score.away == null) return false;
    return m.home?.name?.toLowerCase() === name || m.away?.name?.toLowerCase() === name;
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const recent = completed.slice(-n);
  return recent.map(m => {
    const isHome = m.home?.name?.toLowerCase() === name;
    const us  = isHome ? Number(m.score.home) : Number(m.score.away);
    const them = isHome ? Number(m.score.away) : Number(m.score.home);
    let r = "D";
    if (us > them) r = "W";
    else if (us < them) r = "L";
    return { result: r, score: `${us}-${them}` };
  });
}

// Windows renders flag emoji as styled "country code" boxes (MX, ZA, KR…)
// rather than actual flag pictures. To get consistent flags everywhere we
// resolve the ISO 2-letter code from the flag's regional-indicator code points
// and render a real <img> from flagcdn.com.
function flagToCC(flag) {
  if (!flag) return null;
  const cps = [...flag].map(c => c.codePointAt(0));
  if (cps.length < 2) return null;
  const A = 0x1F1E6;
  if (cps[0] < A || cps[0] > A + 25 || cps[1] < A || cps[1] > A + 25) return null;
  return String.fromCharCode(cps[0] - A + 97, cps[1] - A + 97);
}

function wcFlagImg(team, opts = {}) {
  const flag = team?.flag || "";
  const cc = flagToCC(flag);
  const cls = "wc-flag" + (opts.extraClass ? " " + opts.extraClass : "");
  if (!cc) {
    return `<span class="${cls}" aria-hidden="true">${escapeHtml(flag)}</span>`;
  }
  const alt = team?.name ? `${team.name} flag` : "";
  return `<img class="${cls}" src="https://flagcdn.com/${cc}.svg" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" />`;
}

function renderWcMatchCard(match, opts = {}) {
  if (!match) return "";
  const isBrazil = wcMatchHasTeam(match);
  const live = wcIsLive(match);
  const done = !live && (match.status === "complete" || match.status === "complete-unknown" || match.status === "final");
  const cls = [
    "wc-match-card",
    live ? "wc-match-card--live" : "",
    isBrazil ? "wc-match-card--brazil" : "",
    done ? "wc-match-card--done" : "",
  ].filter(Boolean).join(" ");
  const hasScore = match.score && match.score.home != null && match.score.away != null;
  const score = hasScore
    ? `<span class="wc-score${live ? " wc-score--pulse" : ""}">${escapeHtml(String(match.score.home))}–${escapeHtml(String(match.score.away))}</span>`
    : live
      ? `<span class="wc-live-dot">● LIVE</span>`
      : `<span class="wc-vs">vs</span>`;
  const groupTag = match.group ? `<span class="wc-group-tag">Group ${escapeHtml(match.group)}</span>` : "";
  const stageTag = match.stage && match.stage !== "group"
    ? `<span class="wc-group-tag wc-stage-tag">${escapeHtml(match.stage.replace(/-/g, " "))}</span>`
    : "";
  const anchorId = match.id ? `wc-m-${escapeAttr(match.id)}` : "";
  const homeName = match.home?.name || "TBD";
  const awayName = match.away?.name || "TBD";
  const shareTitle = `${homeName} vs ${awayName} — World Cup 2026`;
  const shareText = `${shareTitle} · ${wcKickoffLabel(match.date)}`;
  const shareBtn = match.id
    ? `<button type="button" class="wc-share-btn" data-share-id="${anchorId}" data-share-title="${escapeAttr(shareTitle)}" data-share-text="${escapeAttr(shareText)}" aria-label="Share this match" title="Share match">🔗</button>`
    : "";
  const bcastList = []
    .concat((match.broadcast?.uk || []).map(b => `UK: ${b}`))
    .concat((match.broadcast?.ie || []).map(b => `IE: ${b}`))
    .join(" · ");
  const icsBtn = (typeof icsBtnHtml === "function" && match.date)
    ? icsBtnHtml({
        uid: match.id ? `wc-${match.id}` : "",
        title: shareTitle,
        dtStart: match.date,
        durationMin: 120,
        venue: match.venue || "",
        description: `${shareText}${bcastList ? "\n📺 " + bcastList : ""}\nhttps://adam.garrigan.me/#${anchorId}`,
      })
    : "";
  return `
    <article class="${cls}"${anchorId ? ` id="${anchorId}"` : ""} data-match-id="${escapeAttr(match.id || "")}">
      <div class="wc-match-head">
        ${groupTag}${stageTag}
        <span class="wc-kickoff">${escapeHtml(wcKickoffLabel(match.date))}</span>
        ${icsBtn}${shareBtn}
      </div>
      <div class="wc-match-teams">
        <span class="wc-team wc-team--home${isAdamsWcTeam(match.home?.name) ? " is-brazil" : ""}">
          ${wcFlagImg(match.home)}
          <span class="wc-team-name">${escapeHtml(match.home?.name || "TBD")}</span>
        </span>
        <span class="wc-score-wrap">${score}</span>
        <span class="wc-team wc-team--away${isAdamsWcTeam(match.away?.name) ? " is-brazil" : ""}">
          ${wcFlagImg(match.away)}
          <span class="wc-team-name">${escapeHtml(match.away?.name || "TBD")}</span>
        </span>
      </div>
      <div class="wc-match-foot">
        <span class="wc-venue">${escapeHtml(match.venue || "")}</span>
        ${wcBroadcastBadge(match.broadcast)}
      </div>
    </article>`;
}

function wcMatchesToday(matches, now = new Date()) {
  const y = now.getFullYear(), mo = now.getMonth(), da = now.getDate();
  return (matches || []).filter(m => {
    const d = new Date(m.date);
    if (isNaN(d)) return false;
    return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === da;
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function wcNextBrazilMatch(matches, now = new Date()) {
  return (matches || [])
    .filter(m => wcMatchHasTeam(m) && new Date(m.date).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;
}

function wcMatchdayLabel(d) {
  return d.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" });
}

function renderWcFixtures(matches, opts = {}) {
  if (!matches || !matches.length) return "";
  const fromIso = opts.fromIso || null;
  const stageFilter = opts.stage || null;
  const heading = opts.heading || "All fixtures";
  const buckets = new Map();
  for (const m of matches) {
    if (stageFilter && m.stage !== stageFilter) continue;
    const d = new Date(m.date);
    if (isNaN(d)) continue;
    if (fromIso && d.toISOString() < fromIso) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    if (!buckets.has(key)) buckets.set(key, { date: d, items: [] });
    buckets.get(key).items.push(m);
  }
  if (!buckets.size) return "";
  const days = [...buckets.values()].sort((a, b) => a.date - b.date);
  const dayHtml = days.map(day => {
    day.items.sort((a, b) => {
      const ba = wcMatchHasTeam(a) ? 0 : 1;
      const bb = wcMatchHasTeam(b) ? 0 : 1;
      if (ba !== bb) return ba - bb;
      return new Date(a.date) - new Date(b.date);
    });
    const hasBrazil = day.items.some(wcMatchHasTeam);
    return `<details class="wc-day${hasBrazil ? " wc-day--brazil" : ""}" ${hasBrazil ? "open" : ""}>
      <summary>
        <span class="wc-day-label">${escapeHtml(wcMatchdayLabel(day.date))}</span>
        <span class="wc-day-count">${day.items.length} match${day.items.length === 1 ? "" : "es"}</span>
        ${hasBrazil ? `<span class="wc-day-brazil">${wcFlagImg({flag:'🇧🇷', name:'Brazil'})} Brazil</span>` : ""}
      </summary>
      <div class="wc-day-grid">${day.items.map(m => renderWcMatchCard(m)).join("")}</div>
    </details>`;
  }).join("");
  return `<section class="wc-fixtures">
    <h3 class="wc-subheading">${escapeHtml(heading)} <span class="wc-count">${matches.length}</span></h3>
    ${dayHtml}
  </section>`;
}

function renderWcCountdown(tournament, matches) {
  const start = new Date(tournament.start_date + "T16:00:00Z"); // ~opener kickoff
  const cd = wcCountdownString(start);
  const brazil = wcNextBrazilMatch(matches);
  const brazilHtml = brazil ? `
    <div class="wc-countdown-brazil">
      ${wcFlagImg({flag:'🇧🇷', name:'Brazil'})}
      Brazil's opener: <strong>${escapeHtml(brazil.home?.name)} vs ${escapeHtml(brazil.away?.name)}</strong>
      · ${escapeHtml(wcKickoffLabel(brazil.date))}
      <span class="wc-cd-mini">in ${escapeHtml(wcCountdownString(new Date(brazil.date)))}</span>
    </div>` : "";
  return `
    <div class="wc-countdown-hero">
      <div class="wc-countdown-eyebrow">⚽ FIFA World Cup 2026</div>
      <div class="wc-countdown-big">Kicks off in <span class="wc-cd-num">${escapeHtml(cd)}</span></div>
      <div class="wc-countdown-meta">11 Jun – 19 Jul · USA · Canada · Mexico</div>
      ${brazilHtml}
    </div>`;
}

function renderWcToday(matches) {
  const today = wcMatchesToday(matches);
  if (!today.length) return "";
  // Brazil pinned to top
  today.sort((a, b) => {
    const ba = wcMatchHasTeam(a) ? 0 : 1;
    const bb = wcMatchHasTeam(b) ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return new Date(a.date) - new Date(b.date);
  });
  return `
    <section class="wc-today">
      <h3 class="wc-subheading">⚽ Today's matches <span class="wc-count">${today.length}</span></h3>
      <div class="wc-today-grid">${today.map(m => renderWcMatchCard(m)).join("")}</div>
    </section>`;
}

function renderWcGroups(groups, allMatches) {
  if (!groups || !groups.length) return "";
  const tables = groups.map(g => {
    const hasBrazil = (g.teams || []).some(t => isAdamsWcTeam(t.name));
    // Sort: pts DESC, gd DESC, gf DESC — standard FIFA tiebreak order. The
    // fetcher writes teams in the published group draw order; we re-sort on
    // render so the live table reflects standings during the tournament.
    const sortedTeams = (g.teams || []).slice().sort((a, b) =>
      (b.points|0) - (a.points|0) ||
      (b.gd|0)     - (a.gd|0)     ||
      (b.gf|0)     - (a.gf|0)
    );
    const rows = sortedTeams.map(t => {
      const fav = isAdamsWcTeam(t.name) ? " is-brazil-row" : "";
      let sparkHtml = "";
      if (typeof formSparkline === "function" && typeof wcFormPills === "function" && allMatches) {
        const form = wcFormPills(allMatches, t.name, 5);
        if (form.length) sparkHtml = formSparkline(form.map(f => f.result));
      }
      return `<tr class="${fav}">
        <td class="wc-tn">${wcFlagImg(t)} ${escapeHtml(t.name)} ${sparkHtml}</td>
        <td>${t.played|0}</td><td>${t.won|0}</td><td>${t.drawn|0}</td><td>${t.lost|0}</td>
        <td>${t.gd|0}</td><td><strong>${t.points|0}</strong></td>
      </tr>`;
    }).join("");
    return `<div class="wc-group-table${hasBrazil ? " wc-group-table--brazil" : ""}">
      <div class="wc-group-name">Group ${escapeHtml(g.name)}</div>
      <table><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  }).join("");
  return `<section class="wc-groups">
    <h3 class="wc-subheading">Groups</h3>
    <div class="wc-groups-grid">${tables}</div>
  </section>`;
}

function renderWcBracket(bracket) {
  if (bracket == null) return "";
  // Placeholder structure — populated once knockout starts.
  return `<section class="wc-bracket">
    <h3 class="wc-subheading">Knockout bracket</h3>
    <p class="empty">Bracket appears once Round of 32 begins.</p>
  </section>`;
}

function renderWcScorers(scorers, opts = {}) {
  const list = Array.isArray(scorers) ? scorers : [];
  if (!list.length) {
    if (!opts.showEmpty) return "";
    return `<section class="wc-scorers wc-scorers--empty">
      <h3 class="wc-subheading">Top scorers</h3>
      <p class="empty">Top scorers will appear once matches kick off ⚽</p>
    </section>`;
  }
  const rows = list.slice(0, 10).map((s, i) => `<li>
    <span class="wc-scorer-rank">${i + 1}</span>
    ${wcFlagImg(s)}
    <span class="wc-scorer-name">${escapeHtml(s.name)}</span>
    <span class="wc-scorer-team">${escapeHtml(s.team || "")}</span>
    <span class="wc-scorer-goals">${(s.goals|0)} ⚽</span>
  </li>`).join("");
  return `<section class="wc-scorers">
    <h3 class="wc-subheading">Top scorers</h3>
    <ol>${rows}</ol>
  </section>`;
}

function renderWorldCup(data) {
  const root = document.getElementById("wc-body");
  if (!root) return null;
  const wc = data?.worldCup;
  if (!wc || !wc.tournament) {
    root.innerHTML = `<p class="empty">World Cup data unavailable.</p>`;
    stopWcLiveRefresh();
    return null;
  }
  const phase = wcPhase();
  document.body.classList.toggle("wc-phase-pre", phase === "pre");
  document.body.classList.toggle("wc-phase-during", phase === "during");
  document.body.classList.toggle("wc-phase-recap", phase === "recap");
  document.body.classList.toggle("wc-phase-post", phase === "post");

  if (phase === "post") {
    root.innerHTML = "";
    stopWcLiveRefresh();
    return null;
  }

  const t = wc.tournament;
  let html = "";
  if (phase === "pre") {
    html += renderWcCountdown(t, wc.matches);
    html += renderWcGroups(wc.groups, wc.matches);
    html += renderWcFixtures(wc.matches, { heading: "All fixtures" });
  } else if (phase === "during") {
    html += renderWcCountdown(t, wc.matches);
    html += renderWcToday(wc.matches);
    html += renderWcGroups(wc.groups, wc.matches);
    html += renderWcBracket(wc.knockout_bracket);
    html += renderWcScorers(wc.top_scorers, { showEmpty: true });
    html += renderWcFixtures(wc.matches, { fromIso: new Date(Date.now() + 24*60*60*1000).toISOString(), heading: "Upcoming fixtures" });
  } else { // recap
    const champ = t.champion ? `<div class="wc-countdown-big">🏆 Champions: ${escapeHtml(t.champion)}</div>` : "";
    html += `<div class="wc-countdown-hero">
      <div class="wc-countdown-eyebrow">⚽ World Cup 2026 — wrap</div>
      ${champ}
      <div class="wc-countdown-meta">Group + bracket archive below</div>
    </div>`;
    html += renderWcGroups(wc.groups, wc.matches);
    html += renderWcScorers(wc.top_scorers);
  }
  root.innerHTML = html;
  bindWcShareButtons(root);

  // Kick off (or stop) the 60s live refresh based on whether any match is live.
  if (phase === "during" && wcAnyLive(wc.matches)) startWcLiveRefresh();
  else stopWcLiveRefresh();

  return phase;
}

// ----- Live auto-refresh -----
// Re-fetch data/world_cup.json on a 60s cadence whenever a WC match is live.
// Cheap: it's served by the same SW network-first rule that handles the rest
// of the data tier, so cache stays warm and offline still works.
function startWcLiveRefresh() {
  if (WC_LIVE_TIMER) return;
  WC_LIVE_TIMER = setInterval(async () => {
    if (document.hidden) return; // don't poll while backgrounded
    const fresh = await loadJson(DATA_FILES.worldCup);
    if (!fresh) return;
    DATA.worldCup = fresh;
    renderWorldCup(DATA);
    renderWcTopbarChip(DATA);
    renderWcAdamHero(DATA);
  }, WC_LIVE_REFRESH_MS);
}
function stopWcLiveRefresh() {
  if (WC_LIVE_TIMER) { clearInterval(WC_LIVE_TIMER); WC_LIVE_TIMER = null; }
}

// Wire up the per-card 🔗 share button. As of the v32 sweep, app.js's
// bindGlobalShareButtons() handles both .share-btn-inline AND .wc-share-btn
// via the Web Share API (with clipboard fallback). This binder is kept as
// a delegating shim so older call sites (renderWorldCup) still work, but
// the real logic lives in app.js.
function bindWcShareButtons(scope) {
  if (typeof bindGlobalShareButtons === "function") bindGlobalShareButtons();
  if (typeof bindGlobalIcsButtons === "function") bindGlobalIcsButtons();
}

function renderWcTopbarChip(data) {
  const chip = document.getElementById("wc-topbar-chip");
  if (!chip) return;
  const wc = data?.worldCup;
  const phase = wcPhase();
  if (!wc || phase === "post") { chip.hidden = true; chip.textContent = ""; return; }
  if (phase === "pre") {
    const start = new Date((wc.tournament.start_date || "2026-06-11") + "T16:00:00Z");
    chip.hidden = false;
    chip.textContent = `⚽ kicks off in ${wcCountdownString(start)}`;
    chip.title = "World Cup countdown — tap to view";
    return;
  }
  if (phase === "during") {
    const today = wcMatchesToday(wc.matches);
    chip.hidden = false;
    chip.textContent = today.length
      ? `⚽ ${today.length} match${today.length === 1 ? "" : "es"} today`
      : `⚽ World Cup live`;
    chip.title = "Jump to the World Cup section";
    return;
  }
  // recap
  chip.hidden = false;
  chip.textContent = `⚽ WC 2026 wrap`;
}

function renderWcAdamHero(data) {
  // Inject a Brazil hero ABOVE the existing rugby hero on #adam, only when
  // Brazil is playing today during the tournament window.
  const wrap = document.getElementById("adam-body");
  if (!wrap) return;
  // Tear down any prior injection + per-second ticker so this is idempotent.
  wrap.querySelectorAll(".adam-next--wc").forEach(n => n.remove());
  if (WC_HERO_TIMER) { clearInterval(WC_HERO_TIMER); WC_HERO_TIMER = null; }
  if (wcPhase() !== "during") return;
  const wc = data?.worldCup;
  if (!wc) return;
  const today = wcMatchesToday(wc.matches).filter(wcMatchHasTeam);
  if (!today.length) return;
  const m = today[0];

  const live = wcIsLive(m);
  const hasScore = m.score && m.score.home != null && m.score.away != null;
  // Brazil's form going into this match — last 3 completed BR matches
  const brName = isAdamsWcTeam(m.home?.name) ? m.home.name : m.away?.name;
  const form = wcFormPills(wc.matches, brName, 3);
  const formHtml = form.length
    ? `<div class="wc-hero-form" title="Brazil's last ${form.length} match${form.length === 1 ? "" : "es"}">
         ${form.map(f => `<span class="wc-form-pill wc-form-pill--${f.result.toLowerCase()}" title="${escapeAttr(f.score)}">${f.result}</span>`).join("")}
       </div>`
    : "";

  const oppTeam = isAdamsWcTeam(m.home?.name) ? m.away : m.home;
  const oppHtml = oppTeam
    ? `<span class="wc-hero-opp">vs ${wcFlagImg(oppTeam)} <strong>${escapeHtml(oppTeam.name || "TBD")}</strong></span>`
    : "";

  const bcast = wcBroadcastBadge(m.broadcast, { bothRegions: true });
  const venueHtml = m.venue ? `<span class="wc-hero-venue">📍 ${escapeHtml(m.venue)}</span>` : "";

  // The countdown/score span is updated in place by the per-second ticker.
  const cdInit = live && hasScore
    ? `<span class="wc-score wc-score--pulse">${escapeHtml(String(m.score.home))}–${escapeHtml(String(m.score.away))}</span>`
    : live
      ? `<span class="wc-live-dot">● LIVE</span>`
      : `<span class="wc-cd-mini">Kickoff in <span class="wc-hero-cd-num">${escapeHtml(wcCountdownString(new Date(m.date)))}</span></span>`;

  const anchorId = m.id ? `wc-m-${escapeAttr(m.id)}` : "";
  const html = `
    <div class="adam-next adam-next--wc wc-hero-takeover" data-match-id="${escapeAttr(m.id || "")}">
      <div class="adam-next-eyebrow">${wcFlagImg({flag:'🇧🇷', name:'Brazil'})} Brazil today — World Cup</div>
      <div class="adam-next-title">${escapeHtml(m.home?.name)} ${oppHtml ? "v" : ""} ${escapeHtml(m.away?.name)}</div>
      <div class="adam-next-meta">${escapeHtml(wcKickoffLabel(m.date))} ${venueHtml}</div>
      <div class="adam-next-meta wc-hero-bcast">${bcast}</div>
      <div class="adam-next-meta wc-hero-cd-row" data-iso="${escapeAttr(m.date)}" data-match-id="${escapeAttr(m.id || "")}">${cdInit}</div>
      ${formHtml}
      ${anchorId ? `<a class="wc-hero-jump" href="#${anchorId}" aria-label="Jump to match card">View match card →</a>` : ""}
    </div>`;
  wrap.insertAdjacentHTML("afterbegin", html);

  // Tick the countdown (or live state) every second. Pauses while hidden.
  WC_HERO_TIMER = setInterval(() => {
    if (document.hidden) return;
    const row = wrap.querySelector(".wc-hero-cd-row");
    if (!row) { clearInterval(WC_HERO_TIMER); WC_HERO_TIMER = null; return; }
    const iso = row.getAttribute("data-iso");
    const matchId = row.getAttribute("data-match-id");
    const cur = (DATA.worldCup?.matches || []).find(x => x.id === matchId) || m;
    const curLive = wcIsLive(cur);
    const curScore = cur.score && cur.score.home != null && cur.score.away != null;
    if (curLive && curScore) {
      row.innerHTML = `<span class="wc-score wc-score--pulse">${escapeHtml(String(cur.score.home))}–${escapeHtml(String(cur.score.away))}</span>`;
    } else if (curLive) {
      row.innerHTML = `<span class="wc-live-dot">● LIVE</span>`;
    } else {
      const cd = wcCountdownString(new Date(iso));
      const numEl = row.querySelector(".wc-hero-cd-num");
      if (numEl) numEl.textContent = cd;
      else row.innerHTML = `<span class="wc-cd-mini">Kickoff in <span class="wc-hero-cd-num">${escapeHtml(cd)}</span></span>`;
    }
  }, 1000);
}
