/**
 * Deploy-time configuration. No secrets here — this file ships to the browser.
 */

/**
 * The Worker origin. Set this once after `npm run deploy` prints the
 * workers.dev URL.
 */
export const WORKER_BASE = 'https://the-helm.mlancourt.workers.dev';

/**
 * Dev-only API override: `?api=http://127.0.0.1:8787`.
 *
 * Deliberately refused unless the page itself is on localhost. Honouring it on
 * the real origin would turn any crafted link into a token exfiltration —
 * "?api=https://evil.example" and the page posts Matt's bearer token straight
 * at it. On localhost there is no token worth stealing.
 */
export function apiBase(search = location.search, host = location.hostname) {
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  if (isLocal) {
    const override = new URLSearchParams(search).get('api');
    if (override) {
      try {
        const u = new URL(override);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
      } catch {
        /* fall through to the default */
      }
    }
  }
  return WORKER_BASE;
}

/** How long a cached snapshot may be used before the banner calls it stale. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** Foreground refresh cadence for /api/data. The LIVE band has its own (M3). */
export const DATA_REFRESH_MS = 5 * 60 * 1000;

/**
 * The page's own version — the single source for both readouts.
 *
 * The chip beside the wordmark prints `v` + major.minor; the Ship Status
 * footer prints the whole thing. Two places, one constant, so they cannot
 * drift apart and leave Matt reading a version the phone is not running.
 *
 * Bump this with each ruling batch, alongside CACHE_VERSION in sw.js.
 */
export const APP_VERSION = '1.2.0';

/** `v1.0` — what the header chip shows. */
export const APP_VERSION_LABEL = `v${APP_VERSION.split('.').slice(0, 2).join('.')}`;
