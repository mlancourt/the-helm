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

import { apiBase, STALE_AFTER_MS, DATA_REFRESH_MS, APP_VERSION_LABEL } from './config.js';
import { REGISTRY, BAND_ORDER, BAND_LABEL } from './tiles/_registry.js';
import { createLiveBand } from './live/band.js';
import { normalizeEvent } from './live/espn.js';
import { el, clear, empty, genericCard, pill } from './lib/dom.js';
import { ago, ctTime } from './lib/fmt.js';
import { subheadText } from './lib/header.js';

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
  // Read from /api/data because it is part of the Worker contract, and
  // deliberately rendered nowhere: see lib/header.js.
  me: null,
  snapshot: null,
  pending: [],
  cachedAt: null, // when the snapshot we are showing was fetched
  offline: false, // true when the last fetch failed and we fell back to cache
  error: null,
  live: null, // the LIVE band fills this: {games, grades, today, fetched_at, error}
};

let askController = null;
const modules = new Map(); // tile id -> render fn (or null if it failed to load)

/**
 * `?mock=1` gets a FAKE ESPN slate too.
 *
 * Without this, mock mode would draw its invented leagues against the real
 * slate — which means the pre/in/post rows and the three watch-chip cases
 * (mapped, unmapped, another team's regional) could only be seen on a day when
 * the real world happened to supply them. docs/mock/espn-today.json is
 * invented by tools/make-mock-data.js and is fake by construction.
 *
 * Only for `?mock=1`. A NAMED fixture — `?mock=live.local` above all — exists
 * precisely to grade against real event ids on the real slate, so it keeps the
 * real feed.
 */
const MOCK_ESPN = MOCK && MOCK_PARAM === '1';

async function mockSlate() {
  // Re-read every call rather than caching in a module variable, so editing
  // the file during dev lands without a reload. It is a few KB off our own
  // origin; the service worker's stale-while-revalidate means an edit shows up
  // a tick later than the save, which is fine for a mock.
  try {
    const res = await fetch('./mock/espn-today.json', { cache: 'no-store' });
    if (!res.ok) return {};
    const j = await res.json();
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

const mockEspn = {
  async fetchScoreboard(league) {
    const slate = await mockSlate();
    const raw = Array.isArray(slate.leagues?.[league]) ? slate.leagues[league] : [];
    return raw.map((e) => normalizeEvent(e, league)).filter(Boolean);
  },
  async fetchSummary(_league, eventId) {
    const slate = await mockSlate();
    const s = slate.summaries?.[eventId] || {};
    return {
      scoringPlays: Array.isArray(s.scoringPlays) ? s.scoringPlays : [],
      keyEvents: Array.isArray(s.keyEvents) ? s.keyEvents : [],
    };
  },
};

/**
 * The LIVE band runs on its own clock — 45s while a game is in progress —
 * independently of the 5-minute snapshot refresh. It re-renders on its own
 * whenever grades move.
 */
const liveBand = createLiveBand(
  (next) => {
    state.live = next;
    renderAll();
  },
  MOCK_ESPN ? mockEspn : {}
);

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

  /**
   * A tile asking for the detail sheet. It hands over a title and a builder
   * and never touches the sheet itself — Ask's body stays Ask's.
   */
  openPanel(title, build) {
    openPanel(title, build);
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
        genericCard(body, tile);
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

/**
 * The build chip beside the wordmark. Written once at boot — it cannot change
 * without a reload, and it must be on screen even when boot() bails at the
 * token gate, because "which build is this phone running" is the first
 * question worth answering when the board looks wrong.
 */
function renderVersion() {
  const chip = document.getElementById('version-chip');
  if (chip) chip.textContent = APP_VERSION_LABEL;
}

function renderHeader() {
  const sub = document.getElementById('subhead');
  clear(sub);
  // The whole line comes from lib/header.js, which has no way to reach
  // state.me — that is the point of it being a separate, tested function.
  sub.appendChild(el('span', { text: subheadText(state.snapshot) }));

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

/**
 * Keyboard-aware sheets.
 *
 * Both sheets are `position: fixed`, which anchors them to the LAYOUT viewport
 * — the one the on-screen keyboard does not shrink. Left alone, iOS draws the
 * keyboard over the composer and then scrolls the page to chase the focused
 * input, which is exactly the floating-input-in-a-void Matt photographed.
 *
 * So the CSS reads two numbers from visualViewport instead:
 *
 *   --kb    how much of the bottom edge the keyboard is covering right now
 *   --vvh   how much height is actually visible
 *
 * and the sheets sit on --kb and cap their scrollers against --vvh. Nothing
 * scrolls and nothing jumps: the sheet simply stops where the keyboard starts.
 *
 * `bottom`, not `transform`, carries --kb — transform is already spoken for by
 * the open/close slide, and a 200ms transition on it would make the sheet lag
 * the keyboard by a fifth of a second on every keystroke that resizes it.
 */
let viewportTracked = false;
function trackViewport() {
  // boot() runs again when a token is pasted at the gate; the listeners below
  // are for the life of the page, not the life of a boot.
  if (viewportTracked) return;
  viewportTracked = true;

  const root = document.documentElement;
  const vv = window.visualViewport;

  if (!vv) {
    // Desktop Firefox and anything older. No keyboard to dodge; --kb stays 0
    // and the caps fall back to the layout viewport.
    root.style.setProperty('--vvh', `${window.innerHeight}px`);
    window.addEventListener('resize', () =>
      root.style.setProperty('--vvh', `${window.innerHeight}px`)
    );
    return;
  }

  const sync = () => {
    // offsetTop is how far the visual viewport has been scrolled down inside
    // the layout viewport. Without it, a page iOS has already scrolled reports
    // a keyboard taller than it is and the sheet lifts clean off the screen.
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb', `${Math.round(kb)}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  };

  sync();
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  // Rotation settles after the resize event fires, so measure again once it has.
  window.addEventListener('orientationchange', () => setTimeout(sync, 250));
}

/**
 * Two sheets share one scrim: Ask, which is mounted once and keeps its
 * transcript alive in a closure, and the generic detail panel, which any tile
 * can fill and which is cleared on every open. Nothing is ever rendered into
 * Ask's body but Ask, and only one sheet is ever up at a time.
 *
 * The scrim is DERIVED from the two rather than toggled by each handler — the
 * version that was not left a dead scrim over the board whenever a sheet
 * closed underneath it.
 */
function syncScrim() {
  const open =
    document.getElementById('sheet').classList.contains('open') ||
    document.getElementById('panel').classList.contains('open');
  document.getElementById('scrim').classList.toggle('open', open);
}

function openSheet() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('sheet').classList.add('open');
  syncScrim();
}

function closeSheet() {
  document.getElementById('sheet').classList.remove('open');
  syncScrim();
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
  syncScrim();
}

function closeAll() {
  document.getElementById('sheet').classList.remove('open');
  document.getElementById('panel').classList.remove('open');
  syncScrim();
}

/**
 * The detail panel. `build` fills the body; a builder that throws greys the
 * panel rather than the board (rule 8).
 */
function openPanel(title, build) {
  const body = document.getElementById('panel-body');
  clear(body);
  document.getElementById('panel-title').textContent = String(title || '');
  try {
    build(body);
  } catch (e) {
    clear(body);
    body.appendChild(el('p', { cls: 'card-error', text: `This panel failed to render: ${e.message}` }));
  }
  document.getElementById('sheet').classList.remove('open');
  document.getElementById('panel').classList.add('open');
  syncScrim();
  body.scrollTop = 0;
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
  document.getElementById('scrim').addEventListener('click', closeAll);
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
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
  renderVersion();
  trackViewport();

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
