// Adam's Sports Dashboard service worker
const VERSION = "v32-full-sweep";
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "wc.css",
  "app.js",
  "wc.js",
  "manifest.json",
  "icons/icon-192.svg",
  "icons/icon-512.svg",
  "fonts/InterVariable.woff2",
  "fonts/SpaceGrotesk-500.woff2",
  "fonts/SpaceGrotesk-600.woff2",
  "fonts/SpaceGrotesk-700.woff2",
];

self.addEventListener("install", (e) => {
  // Don't call skipWaiting() at install time — let the client decide when
  // to upgrade (via the SW update toast in app.js). The first-ever install
  // has no controller, so the new SW activates immediately anyway.
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  // Accept both raw string and {type: "SKIP_WAITING"} object format
  if (e.data === "SKIP_WAITING" || (e.data && e.data.type === "SKIP_WAITING")) {
    self.skipWaiting();
  }
});

// ===== PERIODIC BACKGROUND SYNC (Item N) =====
// Supported in Chromium-based browsers behind an installed PWA + permission.
// We refresh every data/*.json file and update the DATA_CACHE so the next
// app load is instantly fresh. Graceful no-op everywhere else.
const DATA_URLS = [
  "data/f1.json", "data/f1_standings.json",
  "data/intl_rugby.json", "data/provinces.json", "data/schools.json",
  "data/dublin_club.json", "data/news.json", "data/watch.json",
  "data/highlights.json", "data/world_cup.json", "data/rugby_tables.json",
];

async function refreshDataCache() {
  try {
    const cache = await caches.open(DATA_CACHE);
    await Promise.all(DATA_URLS.map(async (u) => {
      try {
        const res = await fetch(u, { cache: "no-store" });
        if (res && res.ok) await cache.put(u, res.clone());
      } catch { /* ignore individual failures — best-effort */ }
    }));
  } catch { /* cache open failed; nothing to do */ }
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "refresh-data") e.waitUntil(refreshDataCache());
});

// Click on a local/push notification → open the dashboard at the deep link
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification?.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.host)) { c.focus(); c.navigate(url); return; }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Network-first with cache fallback. Lets us update HTML/JS/CSS without
// the user being stuck on a stale shell — iOS PWAs in particular cling to
// the old cached HTML for hours otherwise.
function networkFirst(req, cacheName) {
  return fetch(req).then((res) => {
    if (res && res.status === 200 && res.type === "basic") {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for navigation requests (the HTML shell itself)
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html")) {
    e.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Network-first for data JSON (fresh scores beat cached ones)
  if (url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    e.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Network-first for the core shell assets (JS / CSS) so feature rollouts
  // don't get held back by yesterday's cache.
  if (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/wc.js") || url.pathname.endsWith("/styles.css") || url.pathname.endsWith("/wc.css") || url.pathname.endsWith("/manifest.json")) {
    e.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Cache-first for everything else (icons, fonts, anything immutable)
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});
