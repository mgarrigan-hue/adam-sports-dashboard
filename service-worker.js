// Adam's Sports Dashboard service worker
const VERSION = "v26-wc-fixtures";
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "icons/icon-192.svg",
  "icons/icon-512.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
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
  if (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/styles.css") || url.pathname.endsWith("/manifest.json")) {
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
