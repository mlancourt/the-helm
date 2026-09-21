/**
 * The Helm — service worker.
 *
 *   shell      stale-while-revalidate (instant open, updates in the background)
 *   /api/data  network-first, cache fallback (the offline snapshot)
 *   /api/ask   NEVER cached — answers are one-shot and can contain anything
 *   ESPN       NEVER cached — a stale score is worse than no score
 *   *.weather.gov  NEVER cached (Weather spec, W3) — a cached forecast is a
 *              stale forecast, and the RIDGE radar loop is a 1 MB GIF that
 *              would evict the shell from the cache inside a week
 *
 * Bump CACHE_VERSION to evict the old shell on deploy.
 */

const CACHE_VERSION = 'helm-v35';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './style.css',
  './manifest.webmanifest',
  './lib/bets.js',
  './lib/dom.js',
  './lib/fmt.js',
  './lib/header.js',
  './live/band.js',
  './live/espn.js',
  './live/graders.js',
  './live/nws.js',
  './tiles/_registry.js',
  './tiles/ask.js',
  './tiles/bets_ledger.js',
  './tiles/bets_live.js',
  './tiles/calendar.js',
  './tiles/cards.js',
  './tiles/dinner.js',
  './tiles/entertainment.js',
  './tiles/local_events.js',
  './tiles/newsstand.js',
  './tiles/purser_due.js',
  './tiles/reminders.js',
  './tiles/ship_status.js',
  './tiles/today_games.js',
  './tiles/weather.js',
  './tiles/wss_tape.js',
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
      // cache: 'reload' — precache from the NETWORK, never the HTTP cache.
      // GitHub Pages serves max-age=600; without this, a new SW version
      // re-bottles the previous deploy's files under a new cache name and a
      // deploy never lands on the phone (found 2026-09-17, three deploys deep).
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
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

  // Never cache: live scores, live weather, and anything from /ask.
  // The weather.gov bail covers BOTH amended origins — api.weather.gov, whose
  // whole point is being current, and radar.weather.gov, whose loop is ~1 MB
  // a pull and must never be allowed near a cache the shell also lives in.
  if (
    url.hostname.endsWith('espn.com') ||
    url.hostname.endsWith('weather.gov') ||
    url.pathname.endsWith('/api/ask')
  )
    return;

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
        // Revalidate against the server, not the 10-minute HTTP cache.
        const net = fetch(new Request(req, { cache: 'no-cache' }))
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
