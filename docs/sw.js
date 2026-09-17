/**
 * The Helm — service worker.
 *
 *   shell      stale-while-revalidate (instant open, updates in the background)
 *   /api/data  network-first, cache fallback (the offline snapshot)
 *   /api/ask   NEVER cached — answers are one-shot and can contain anything
 *   ESPN       NEVER cached — a stale score is worse than no score
 *
 * Bump CACHE_VERSION to evict the old shell on deploy.
 */

const CACHE_VERSION = 'helm-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './style.css',
  './manifest.webmanifest',
  './lib/dom.js',
  './lib/fmt.js',
  './live/band.js',
  './live/espn.js',
  './live/graders.js',
  './tiles/_registry.js',
  './tiles/ask.js',
  './tiles/bets_live.js',
  './tiles/calendar.js',
  './tiles/dinner.js',
  './tiles/mke_board.js',
  './tiles/newsstand.js',
  './tiles/purser_due.js',
  './tiles/radar.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      // One missing file must not fail the whole install, so each is added
      // individually and allowed to fail.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache: live scores, and anything from /ask.
  if (url.hostname.endsWith('espn.com') || url.pathname.endsWith('/api/ask')) return;

  // Network-first for the snapshot, so a live Worker always wins.
  if (url.pathname.endsWith('/api/data')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Everything else is shell: stale-while-revalidate.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
  }
});
