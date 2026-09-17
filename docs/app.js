/**
 * The Helm — app shell.
 *
 * Boots, authenticates with one opaque token, fetches a snapshot, and renders
 * it as tiles. No framework, no build step, ES modules only.
 *
 * The three rules this file exists to enforce:
 *   8  graceful degradation — a dead Worker renders the last cached snapshot
 *      behind a "stale since" banner; a broken tile greys instead of taking
 *      the page down with it
 *   9  unknown tiles are fine — in both directions, and neither throws
 *  10  untrusted content is data — see lib/dom.js; there is no innerHTML here
 */

import { apiBase, STALE_AFTER_MS, DATA_REFRESH_MS } from './config.js';
import { REGISTRY, BAND_ORDER, BAND_LABEL } from './tiles/_registry.js';
import { createLiveBand } from './live/band.js';
import { el, clear, empty, pill } from './lib/dom.js';
import { ago, ctTime } from './lib/fmt.js';

const LS_TOKEN = 'helm.token';
const LS_SNAPSHOT = 'helm.snapshot';

const params = new URLSearchParams(location.search);
const MOCK_PARAM = params.get('mock');
const MOCK = !!MOCK_PARAM;
/**
 * `?mock=1` loads the standard fake snapshot; `?mock=<name>` loads
 * mock/<name>.json, which is how the schema-drift fixture gets exercised.
 * The name is restricted to a plain slug so it can only ever name a file that
 * is already committed under docs/mock/.
 */
const MOCK_FILE =
  MOCK_PARAM &&
  MOCK_PARAM !== '1' &&
  // Dots are allowed so gitignored fixtures like `live.local` work, but a
  // leading dot or any ".." is refused so the name can never walk the tree.
  /^[a-z0-9_][a-z0-9_.-]{0,39}$/i.test(MOCK_PARAM) &&
  !MOCK_PARAM.includes('..')
    ? `./mock/${MOCK_PARAM}.json`
    : './mock/helm-data.json';
const API = apiBase();

const state = {
  me: null,
  snapshot: null,
  pending: [],
  cachedAt: null, // when the snapshot we are showing was fetched
  offline: false, // true when the last fetch failed and we fell back to cache
  error: null,
  live: null, // M3 fills this: {games, grades, board, fetched_at, error}
};

let askController = null;
const modules = new Map(); // tile id -> render fn (or null if it failed to load)

/**
 * The LIVE band runs on its own clock — 45s while a game is in progress —
 * independently of the 5-minute snapshot refresh. It re-renders on its own
 * whenever grades move.
 */
const liveBand = createLiveBand((next) => {
  state.live = next;
  renderAll();
});

// --------------------------------------------------------------------- token

/**
 * Identity is one opaque token. It arrives once — via ?t= in a browser tab, or
 * pasted into the gate inside an installed app (iOS launches installed web
 * apps at the manifest start_url with their own storage partition, so ?t=
 * cannot reach them) — is stored in localStorage, and is stripped from the bar.
 */
function bootToken() {
  const fromUrl = params.get('t');
  if (fromUrl) {
    try {
      localStorage.setItem(LS_TOKEN, fromUrl);
    } catch {
      /* private mode — fall back to the in-memory value below */
    }
    params.delete('t');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    return fromUrl;
  }
  try {
    return localStorage.getItem(LS_TOKEN) || '';
  } catch {
    return '';
  }
}

let token = bootToken();

// ----------------------------------------------------------------- transport

/**
 * All API calls send the token as a Bearer header, never as ?t=. That keeps it
 * out of the service worker's cache keys, out of any proxy log, and out of the
 * URLs the SW stores for offline replay.
 */
async function api(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API + path, { method, headers, body: payload });
  } catch {
    throw new Error('offline — could not reach the Worker');
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }

  if (!res.ok) {
    const reason = data?.reason || `http ${res.status}`;
    const detail = data?.detail ? ` (${data.detail})` : '';
    const e = new Error(`${reason}${detail}`);
    e.status = res.status;
    e.reason = reason;
    throw e;
  }
  return data;
}

// ------------------------------------------------------------- local cache

function cacheSnapshot(snapshot) {
  try {
    localStorage.setItem(LS_SNAPSHOT, JSON.stringify({ snapshot, cached_at: new Date().toISOString() }));
  } catch {
    /* quota or private mode — the page works without a cache, just not offline */
  }
}

function readCachedSnapshot() {
  try {
    const raw = localStorage.getItem(LS_SNAPSHOT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.snapshot) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ actions

const actions = {
  async submitEvent(event) {
    if (MOCK) {
      // Mock mode has no Worker. Say so rather than pretending it landed.
      throw new Error('mock mode — events are not sent');
    }
    const stored = await api('/api/event', { method: 'POST', body: event });
    state.pending = [...state.pending, stored];
    renderAll();
    return stored;
  },

  async withdrawEvent(id) {
    if (MOCK) {
      state.pending = state.pending.filter((e) => e.id !== id);
      renderAll();
      return;
    }
    await api(`/api/event/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.pending = state.pending.filter((e) => e.id !== id);
    renderAll();
  },

  async ask(payload) {
    if (MOCK) throw new Error('mock mode — ask is not wired up');
    return api('/api/ask', { method: 'POST', body: payload });
  },

  openAsk(tileId, data) {
    openSheet();
    if (askController && tileId) askController.pin(tileId, data);
    else if (askController) askController.focus();
  },
};

// -------------------------------------------------------------------- load

async function loadData() {
  if (MOCK) {
    // Dev path. The mock file is fake by construction; see tools/make-mock-data.js.
    const [snapRes, pendRes] = await Promise.all([
      fetch(MOCK_FILE, { cache: 'no-store' }),
      fetch('./mock/pending.json', { cache: 'no-store' }).catch(() => null),
    ]);
    state.snapshot = await snapRes.json();
    state.pending = pendRes && pendRes.ok ? await pendRes.json() : [];
    state.me = { name: 'Matt (mock)', role: 'owner' };
    state.cachedAt = new Date().toISOString();
    state.offline = false;
    state.error = null;
    return;
  }

  try {
    const data = await api('/api/data');
    state.me = data.me || null;
    state.snapshot = data.snapshot || null;
    state.pending = Array.isArray(data.pending) ? data.pending : [];
    state.cachedAt = new Date().toISOString();
    state.offline = false;
    state.error = data.snapshot_error || null;
    if (state.snapshot) cacheSnapshot(state.snapshot);
  } catch (e) {
    // Rule 8: fall back to the last good snapshot rather than a blank page.
    const cached = readCachedSnapshot();
    if (cached) {
      state.snapshot = cached.snapshot;
      state.cachedAt = cached.cached_at;
      state.offline = true;
      state.error = e.message;
    } else {
      state.snapshot = null;
      state.offline = true;
      state.error = e.message;
      throw e;
    }
  }
}

// ------------------------------------------------------------------ render

/** A snapshot tile with no render module: generic key/value card (rule 9). */
function renderGeneric(body, tile) {
  const data = tile.data;
  if (data === null || data === undefined || (typeof data === 'object' && !Object.keys(data).length)) {
    body.appendChild(empty('No data.'));
    return;
  }
  if (typeof data !== 'object') {
    body.appendChild(el('div', { cls: 'row-value', text: String(data) }));
    return;
  }

  const list = el('div', { cls: 'generic' });
  for (const [k, v] of Object.entries(data)) {
    const text =
      v === null || v === undefined
        ? '—'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
    list.appendChild(
      el('div', { cls: 'row' }, [
        el('span', { cls: 'row-label', text: k }),
        el('span', { cls: 'row-value', text }),
      ])
    );
  }
  body.appendChild(list);
  body.appendChild(el('p', { cls: 'tile-foot', text: 'No render module for this tile yet.' }));
}

/** Long-press / right-click -> Explain, on every card. */
function attachExplain(card, tileId, data) {
  const open = () => actions.openAsk(tileId, data);

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    open();
  });

  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  card.addEventListener(
    'touchstart',
    (e) => {
      // Don't hijack a long press that started on a control.
      if (e.target.closest('button, a, textarea, input')) return;
      cancel();
      timer = setTimeout(open, 500);
    },
    { passive: true }
  );
  card.addEventListener('touchmove', cancel, { passive: true });
  card.addEventListener('touchend', cancel);
  card.addEventListener('touchcancel', cancel);
}

function tileCard(id, entry, tile) {
  const title = entry?.title || id;
  const status = tile?.status || (tile ? 'ok' : 'missing');
  const degraded = status === 'error' || status === 'stale' || status === 'missing';

  const card = el('section', { cls: `card ${degraded ? 'card-degraded' : ''}`.trim() });

  const head = el('div', { cls: 'card-head' }, [
    el('h2', { cls: 'card-title', text: title }),
    el('div', { cls: 'card-head-right' }, [
      degraded ? pill(status, status === 'error' ? 'bad' : 'warn') : null,
      el('button', {
        cls: 'explain-btn',
        text: '?',
        attrs: { type: 'button', title: 'Explain this tile', 'aria-label': `Explain ${title}` },
        on: {
          click: (e) => {
            e.stopPropagation();
            actions.openAsk(id, tile?.data);
          },
        },
      }),
    ]),
  ]);
  card.appendChild(head);

  const body = el('div', { cls: 'card-body' });
  card.appendChild(body);

  if (!tile) {
    // Registered here but absent from the snapshot (rule 9).
    body.appendChild(empty('Not in this snapshot.'));
  } else {
    if (tile.error) body.appendChild(el('p', { cls: 'card-error', text: String(tile.error) }));

    const mod = modules.get(id);
    try {
      if (mod) {
        mod(body, tile, { id, title, snapshot: state.snapshot, pending: state.pending, actions, live: state.live });
      } else {
        renderGeneric(body, tile);
      }
    } catch (e) {
      // One bad tile must never take the page down.
      clear(body);
      card.classList.add('card-degraded');
      body.appendChild(el('p', { cls: 'card-error', text: `This tile failed to render: ${e.message}` }));
    }

    if (tile.updated_at) {
      card.appendChild(
        el('div', { cls: 'card-foot', text: `updated ${ago(tile.updated_at)} · ${ctTime(tile.updated_at)} CT` })
      );
    }
  }

  attachExplain(card, id, tile?.data);
  return card;
}

function bandRank(band) {
  const i = BAND_ORDER.indexOf(band);
  return i === -1 ? BAND_ORDER.length : i;
}

function renderBanner() {
  const bar = document.getElementById('banner');
  clear(bar);
  bar.className = 'banner';

  if (MOCK) {
    bar.classList.add('banner-info', 'show');
    bar.appendChild(el('span', { text: 'mock data — no Worker, no real anything' }));
    return;
  }

  if (state.offline) {
    const since = state.cachedAt ? ago(state.cachedAt) : 'unknown';
    bar.classList.add('banner-warn', 'show');
    bar.appendChild(el('span', { text: `Worker unreachable — showing cached snapshot from ${since}` }));
    if (state.error) bar.appendChild(el('span', { cls: 'banner-detail', text: state.error }));
    return;
  }

  const age = state.cachedAt ? Date.now() - Date.parse(state.cachedAt) : 0;
  if (age > STALE_AFTER_MS) {
    bar.classList.add('banner-warn', 'show');
    bar.appendChild(el('span', { text: `stale since ${ago(state.cachedAt)}` }));
  }
}

function renderHeader() {
  const sub = document.getElementById('subhead');
  clear(sub);
  const bits = [];
  if (state.me?.name) bits.push(state.me.name);
  if (state.snapshot?.generated_at) bits.push(`snapshot ${ago(state.snapshot.generated_at)}`);
  sub.appendChild(el('span', { text: bits.join('  ·  ') }));

  const count = state.pending.length;
  const chip = document.getElementById('pending-chip');
  clear(chip);
  if (count) {
    chip.appendChild(pill(`${count} pending`, 'pending'));
    chip.classList.add('show');
  } else {
    chip.classList.remove('show');
  }
}

function renderAll() {
  renderBanner();
  renderHeader();

  const main = document.getElementById('board');
  clear(main);

  const tiles = state.snapshot?.tiles;
  if (!tiles || typeof tiles !== 'object') {
    main.appendChild(
      el('div', { cls: 'card card-degraded' }, [
        el('div', { cls: 'card-head' }, [el('h2', { cls: 'card-title', text: 'No snapshot' })]),
        el('div', { cls: 'card-body' }, [
          empty(state.error || 'Nothing published yet. The engine publishes to /api/admin/publish.'),
        ]),
      ])
    );
    return;
  }

  // Union of what the snapshot carries and what the registry knows about, so
  // both directions of drift render something (rule 9).
  const ids = new Set([...Object.keys(REGISTRY), ...Object.keys(tiles)]);

  const grouped = new Map();
  for (const id of ids) {
    const entry = REGISTRY[id];
    const tile = tiles[id] || null;
    if (entry?.band === 'ASK') continue; // the ask panel lives in the sheet

    // Registry band wins for layout; an unknown tile falls back to whatever
    // band it declares, and then to DAILY.
    const band = entry?.band || tile?.band || 'DAILY';
    if (!grouped.has(band)) grouped.set(band, []);
    grouped.get(band).push({ id, entry, tile });
  }

  const bands = [...grouped.keys()].sort((a, b) => bandRank(a) - bandRank(b) || a.localeCompare(b));
  for (const band of bands) {
    const items = grouped.get(band).sort(
      (a, b) => (a.entry?.position ?? 500) - (b.entry?.position ?? 500) || a.id.localeCompare(b.id)
    );
    main.appendChild(el('h3', { cls: 'band-label', text: BAND_LABEL[band] || band }));
    const grid = el('div', { cls: 'grid' });
    for (const { id, entry, tile } of items) grid.appendChild(tileCard(id, entry, tile));
    main.appendChild(grid);
  }
}

// ------------------------------------------------------------- module load

/**
 * Import every registered render module up front. A module that fails to load
 * is recorded as null and its tile falls back to the generic card — a typo in
 * one tile file must not blank the board.
 */
async function loadModules() {
  await Promise.all(
    Object.entries(REGISTRY).map(async ([id, entry]) => {
      if (!entry.module || entry.band === 'ASK') return;
      try {
        const m = await import(entry.module);
        modules.set(id, typeof m.render === 'function' ? m.render : null);
      } catch (e) {
        console.warn(`tile module failed to load: ${id}`, e.message);
        modules.set(id, null);
      }
    })
  );
}

// -------------------------------------------------------------- ask sheet

function openSheet() {
  document.getElementById('sheet').classList.add('open');
  document.getElementById('scrim').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheet').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
}

async function mountAsk() {
  const body = document.getElementById('sheet-body');
  try {
    const m = await import(REGISTRY.ask.module);
    // Rendered exactly once — the transcript lives inside that closure.
    askController = m.render(body, state.snapshot?.tiles?.ask || { data: {} }, {
      id: 'ask',
      actions,
    });
  } catch (e) {
    clear(body);
    body.appendChild(el('p', { cls: 'card-error', text: `Ask panel failed to load: ${e.message}` }));
  }

  document.getElementById('ask-fab').addEventListener('click', () => {
    openSheet();
    askController?.focus();
  });
  document.getElementById('scrim').addEventListener('click', closeSheet);
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

// ------------------------------------------------------------------- gates

function showGate(title, lines, { tokenForm = false } = {}) {
  const main = document.getElementById('board');
  clear(main);
  document.getElementById('banner').classList.remove('show');
  const body = el('div', { cls: 'card-body' }, lines.map((l) => el('p', { cls: 'gate-line', text: l })));
  if (tokenForm) {
    // An installed iOS web app launches at the manifest's start_url, not the
    // bookmarked URL, and has its own storage partition — so ?t= can never
    // reach it. The token is pasted once here instead and stored in that
    // partition. Same box also rescues a plain tab whose storage was cleared.
    const input = el('input', { cls: 'gate-input', attrs: { id: 'gate-token', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'paste token' } });
    const btn = el('button', { cls: 'gate-btn', attrs: { id: 'gate-save', type: 'button' }, text: 'Save token' });
    const submit = () => {
      const v = (input.value || '').trim();
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(v)) { input.classList.add('bad'); return; }
      try { localStorage.setItem(LS_TOKEN, v); } catch { /* private mode */ }
      token = v;
      // boot() exited early at the gate, so modules + the ask sheet are not
      // loaded yet; a rejected-token gate arrives after boot, so only refresh.
      if (modules.size) refresh(); else boot();
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    body.appendChild(el('div', { cls: 'gate-form' }, [input, btn]));
  }
  main.appendChild(
    el('div', { cls: 'card gate' }, [
      el('div', { cls: 'card-head' }, [el('h2', { cls: 'card-title', text: title })]),
      body,
    ])
  );
}

// -------------------------------------------------------------------- boot

async function refresh() {
  try {
    await loadData();
    renderAll();
  } catch (e) {
    if (e.status === 401) {
      try {
        localStorage.removeItem(LS_TOKEN);
      } catch {
        /* ignore */
      }
      token = '';
      showGate('Token rejected', [
        'The Worker did not recognise this token. Paste the current one below.',
      ], { tokenForm: true });
      return;
    }
    showGate('Cannot reach the Worker', [
      e.message || 'unknown error',
      'No cached snapshot is available on this device yet.',
    ]);
  }
}

/**
 * Manual refresh: snapshot + live band + a shell-update check, in one tap.
 * Cannot run the engine — it re-reads what is already published (rule 2).
 */
async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  if (!btn || btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  try {
    await refresh();
    liveBand.refreshNow(() => state.snapshot);
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
      if (reg) reg.update().catch(() => {});
    }
  } finally {
    setTimeout(() => btn.classList.remove('busy'), 400);
  }
}

/** Start the LIVE band once there is a snapshot telling us what to watch. */
function startLiveBand() {
  if (!state.snapshot) return;
  liveBand.start(() => state.snapshot);
}

async function boot() {
  if (!MOCK && !token) {
    showGate('No token', [
      'The Helm needs its token once. Paste it below and it is remembered on this device.',
    ], { tokenForm: true });
    return;
  }

  await loadModules();
  await mountAsk();
  document.getElementById('refresh-btn')?.addEventListener('click', refreshAll);
  await refresh();
  startLiveBand();

  // Foreground refresh only — a backgrounded phone should not poll.
  setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, DATA_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      // A phone in a pocket has no business hitting ESPN every 45 seconds.
      liveBand.stop();
      return;
    }
    refresh();
    // Scores may have moved a long way while the tab was hidden.
    liveBand.start(() => state.snapshot);
  });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus, never a requirement */
    });
  });
  // When a new service worker takes over (skipWaiting + clients.claim), the
  // page that triggered the update is still running the OLD shell from cache.
  // Reload once so a deploy lands on the first open, not the second. The guard
  // stops a reload loop if the controller flips twice during install.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !navigator.serviceWorker.controller) return;
    reloaded = true;
    location.reload();
  });
}

boot();
