#!/usr/bin/env node
/**
 * The Helm — service worker policy tests. Node, zero deps.
 *
 *   node tools/test-sw.js
 *
 * sw.js cannot be exercised in a normal test runner, so it is evaluated in a
 * vm with stubbed globals and its listeners are driven directly.
 *
 * What matters here is the routing policy, because getting it wrong fails
 * silently and badly: a cached ESPN response shows a stale score as if it were
 * live, and a cached /ask response replays one answer forever. "Never cached"
 * is asserted by checking that respondWith is not called at all, which leaves
 * the request to the browser's default path.
 */

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
const ORIGIN = 'https://mlancourt.github.io';

// Read the version out of the source rather than hardcoding it, so bumping
// CACHE_VERSION on a deploy does not fail these tests for the wrong reason.
const VERSION = (SRC.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
if (!VERSION) {
  console.error('could not find CACHE_VERSION in sw.js');
  process.exit(1);
}
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const STALE_CACHE = 'helm-v0-shell';

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Build a fresh sandbox with instrumented caches + fetch. */
function makeWorld({ netOk = true, cacheHas = true } = {}) {
  const log = { puts: [], added: [], deleted: [], opened: [], skipWaiting: 0, claimed: 0 };

  const cacheObj = (name) => ({
    put: async (req, res) => log.puts.push({ cache: name, url: req.url ?? String(req), res }),
    add: async (u) => {
      if (String(u).includes('MISSING')) throw new Error('404');
      log.added.push(String(u));
    },
    keys: async () => [],
  });

  const caches = {
    _names: [SHELL_CACHE, DATA_CACHE, STALE_CACHE, 'stray-cache'],
    open: async (name) => {
      log.opened.push(name);
      return cacheObj(name);
    },
    keys: async () => caches._names,
    delete: async (name) => {
      log.deleted.push(name);
      return true;
    },
    match: async () => (cacheHas ? { marker: 'CACHE', ok: true } : undefined),
  };

  const listeners = {};
  const self = {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {
      log.skipWaiting++;
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        log.claimed++;
        return Promise.resolve();
      },
    },
  };

  const sandbox = {
    self,
    caches,
    location: { origin: ORIGIN },
    URL,
    Promise,
    console,
    Response: { error: () => ({ marker: 'RESPONSE_ERROR' }) },
    fetch: async () =>
      netOk
        ? { ok: true, marker: 'NET', clone: () => ({ marker: 'NET_CLONE' }) }
        : Promise.reject(new Error('offline')),
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { listeners, log, sandbox };
}

/** Drive a fetch event and report what the worker decided. */
async function route(world, url, method = 'GET') {
  let responded = null;
  const evt = {
    request: { method, url },
    respondWith: (p) => {
      responded = p;
    },
    waitUntil: () => {},
  };
  world.listeners.fetch(evt);
  if (responded === null) return { handled: false };
  return { handled: true, value: await responded };
}

(async () => {
  console.log('The Helm — service worker policy\n');

  console.log('never cached');
  {
    const w = makeWorld();
    const espn = await route(w, 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260917');
    check('ESPN scoreboard is left entirely alone', espn.handled === false);
    const espn2 = await route(w, 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401770114');
    check('ESPN summary is left entirely alone', espn2.handled === false);
    const ask = await route(w, 'https://the-helm.example.workers.dev/api/ask');
    check('/api/ask is left entirely alone', ask.handled === false);
    check('nothing was written to any cache', w.log.puts.length === 0);
  }

  console.log('\nsnapshot: network-first');
  {
    const w = makeWorld({ netOk: true });
    const r = await route(w, 'https://the-helm.example.workers.dev/api/data');
    check('/api/data is handled', r.handled === true);
    check('a live Worker wins over the cache', r.value?.marker === 'NET');
    check('the fresh response is cached for offline', w.log.puts.some((p) => p.cache.includes('data')));
  }
  {
    const w = makeWorld({ netOk: false, cacheHas: true });
    const r = await route(w, 'https://the-helm.example.workers.dev/api/data');
    check('a dead Worker falls back to the cached snapshot', r.value?.marker === 'CACHE');
  }
  {
    const w = makeWorld({ netOk: false, cacheHas: false });
    const r = await route(w, 'https://the-helm.example.workers.dev/api/data');
    check('dead Worker + empty cache resolves rather than hanging', r.value?.marker === 'RESPONSE_ERROR');
  }

  console.log('\nshell: stale-while-revalidate');
  {
    const w = makeWorld({ netOk: true, cacheHas: true });
    const r = await route(w, `${ORIGIN}/the-helm/app.js`);
    check('a cached shell asset returns instantly from cache', r.value?.marker === 'CACHE');
  }
  {
    const w = makeWorld({ netOk: true, cacheHas: false });
    const r = await route(w, `${ORIGIN}/the-helm/style.css`);
    check('an uncached shell asset falls through to the network', r.value?.marker === 'NET');
  }
  {
    const w = makeWorld({ netOk: false, cacheHas: true });
    const r = await route(w, `${ORIGIN}/the-helm/index.html`);
    check('offline shell still serves from cache', r.value?.marker === 'CACHE');
  }

  console.log('\nscope');
  {
    const w = makeWorld();
    const other = await route(w, 'https://example.com/anything.js');
    check('an unrelated cross-origin request is not intercepted', other.handled === false);
    const post = await route(w, `${ORIGIN}/the-helm/app.js`, 'POST');
    check('non-GET requests are not intercepted', post.handled === false);
    const evtPost = await route(w, 'https://the-helm.example.workers.dev/api/event', 'POST');
    check('POST /api/event is never cached', evtPost.handled === false);
  }

  console.log('\ninstall and activate');
  {
    const w = makeWorld();
    let installed;
    w.listeners.install({ waitUntil: (p) => (installed = p) });
    await installed;
    check('install precaches the shell', w.log.added.length >= 15, `added ${w.log.added.length}`);
    check('install precaches index.html', w.log.added.includes('./index.html'));
    check('install precaches every tile module', w.log.added.filter((u) => u.includes('/tiles/')).length === 9);
    check('install precaches the LIVE band modules', w.log.added.filter((u) => u.includes('/live/')).length === 3);
    check('install precaches the icons', w.log.added.filter((u) => u.includes('/icons/')).length === 3);
    check('install calls skipWaiting', w.log.skipWaiting === 1);
  }
  {
    // A shell entry that 404s must not abort the whole install.
    const w = makeWorld();
    const src = SRC.replace("'./style.css'", "'./MISSING.css'");
    const sandbox = { ...w.sandbox };
    let installed;
    const listeners = {};
    sandbox.self = { ...w.sandbox.self, addEventListener: (t, f) => (listeners[t] = f) };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    listeners.install({ waitUntil: (p) => (installed = p) });
    let threw = false;
    try {
      await installed;
    } catch {
      threw = true;
    }
    check('one missing shell file does not fail the install', !threw);
  }
  {
    const w = makeWorld();
    let activated;
    w.listeners.activate({ waitUntil: (p) => (activated = p) });
    await activated;
    check('activate evicts caches from older versions', w.log.deleted.includes(STALE_CACHE));
    check('activate evicts unrelated caches', w.log.deleted.includes('stray-cache'));
    check(`activate keeps the current shell cache (${SHELL_CACHE})`, !w.log.deleted.includes(SHELL_CACHE));
    check(`activate keeps the current data cache (${DATA_CACHE})`, !w.log.deleted.includes(DATA_CACHE));
    check('activate claims open clients', w.log.claimed === 1);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})();
