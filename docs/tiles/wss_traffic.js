/**
 * wss_traffic — Site Pulse.
 *
 * The WSS website's previous day, as a glance. Vault spec
 * `Site-Pulse-Tile-Spec.md`, rulings S1–S10. The engine reads the daily
 * script's `traffic-pulse.json` into this payload; the page lays it out.
 *
 * TWO INDICATORS PER NUMBER, AND THEY HAVE DIFFERENT JOBS (S3).
 *   - The ARROW is day-over-day, printed as given: movement, not meaning, so
 *     it carries no colour at all. It is built in exactly one function,
 *     `arrow()`, and that function is the only place in this file that reads
 *     the day-over-day field (a source scan holds it).
 *   - The DOT is the engine's `ratio` — yesterday against the same-weekday
 *     baseline. `dotTone()` is the one function that chooses a colour, and it
 *     chooses from `ratio` alone. Against the day prior every Monday is green
 *     and every Saturday red; against the same weekday a red means something.
 *
 * EACH BLOCK WEARS ITS OWN DATE (S4). GA4 and Cloudflare are yesterday;
 * Search Console lags 2–3 days. The two face chips print each block's own
 * `date` through `shortDay()` and nothing here relabels, averages or
 * interpolates across the lag — a Thursday that reads as Thursday is the truth.
 *
 * THE PAGE COMPUTES NO BASELINE (S10). No middle value, no ratio, no average: a null
 * ratio is a hollow dot with "no baseline yet". The arithmetic in this file is
 * the sparkline geometry (min/max to pixels), the 5xx bar heights, the channel
 * bar widths and one subtraction — a query's position against its prior week.
 *
 * A FAILED SOURCE IS GREYED, DATED AND SAYS WHY (S6) — never a blank, never a
 * zero: a zero is a fact and a failure is not. Three or more of the newest
 * days with that block missing turns its dots black.
 *
 * NO MONEY, NO NAMES, NO BUTTONS (S8). Purchases is a count. The face is one
 * tap target (a role=button div, the Ledger's pattern, so long-press-to-Explain
 * still reaches it); the sheet's only links are three plain read-only
 * destinations at the bottom. This file contains no dollar sign at all — which
 * is also why every string below is joined with `+` rather than a template.
 *
 * RULE 7: every date is a Central 'YYYY-MM-DD' string, rendered through
 * `shortDay()` off its parts. No Date constructor, no date parser, no clock.
 * RULE 10: everything lands through textContent, via `el()` / `svgEl()`.
 */

import { el, svgEl, empty, extLink } from '../lib/dom.js';
import { shortDay } from '../lib/fmt.js';

const TITLE = '📈 Site Pulse';

/** Used only when the producer does not publish its own list (it does, today). */
const LOWER_DEFAULT = ['position', 'err5xx_pct'];

const SOURCES = ['ga4', 'gsc', 'cf'];
const SOURCE_LABEL = { ga4: 'GA4', gsc: 'GSC', cf: 'CF' };

/** S9: the metric keys the contract names, per block. Anything else metric-shaped is listed, never dropped. */
const NAMED = {
  ga4: ['sessions', 'users', 'leads', 'carts', 'purchases'],
  gsc: ['clicks', 'impressions', 'ctr', 'position'],
  cf: ['requests', 'page_views', 'err5xx_pct'],
};

const CHANNELS = ['organic', 'paid', 'direct', 'referral', 'other'];

const LINKS = [
  ['GA4', 'https://analytics.google.com/analytics/web/#/p347141060/reports/intelligenthome'],
  ['Search Console', 'https://search.google.com/search-console?resource_id=sc-domain%3Awisconsinscrubandsweep.com'],
  ['Cloudflare', 'https://dash.cloudflare.com/'],
];

const LAG_TIP = 'Search Console reports 2–3 days behind';
const DEAD_AFTER = 3;

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A plain object, or null. An array is not one. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** A finite number, or null — a string where a number belongs is not one. */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A metric object — value, day-over-day, baseline, ratio — or null. */
function metric(block, key) {
  const b = obj(block);
  return b ? obj(b[key]) : null;
}

/** 12345 -> '12,345'; 2.4 -> '2.4'; anything else -> '—'. */
function fmtNum(v) {
  const n = num(v);
  if (n === null) return '—';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : String(n);
}

/** A 'YYYY-MM-DD' through shortDay, or '' when there is none. */
function day(ymd) {
  return typeof ymd === 'string' && ymd ? shortDay(ymd) : '';
}

function lowerList(data) {
  const list = arr(data.lower_is_better).filter((k) => typeof k === 'string');
  return list.length ? list : LOWER_DEFAULT;
}

// ------------------------------------------------------- the two indicators

/**
 * THE ONE COLOUR DECISION, and it reads `ratio` only (S3).
 *
 * Higher-is-better: ≥ 0.8 good · 0.6–0.8 warn · < 0.6 bad. Lower-is-better
 * (position, 5xx): the same bands turned over — ≤ 1.25 good · 1.25–1.67 warn
 * · > 1.67 bad — because the engine's ratio stays value / baseline. A null
 * ratio is `none`, the hollow dot: the tile never invents a baseline (S10).
 */
export function dotTone(metricKey, ratio, lowerIsBetter) {
  const r = num(ratio);
  if (r === null) return 'none';
  if (lowerIsBetter) {
    if (r <= 1.25) return 'good';
    if (r <= 1.67) return 'warn';
    return 'bad';
  }
  if (r >= 0.8) return 'good';
  if (r >= 0.6) return 'warn';
  return 'bad';
}

function dot(key, m, lower, dead) {
  const tone = dead ? 'dead' : dotTone(key, m ? m.ratio : null, lower.includes(key));
  const title =
    tone === 'dead'
      ? 'no data ' + DEAD_AFTER + '+ days'
      : tone === 'none'
        ? 'no baseline yet'
        : 'usual for this weekday: ' + fmtNum(m.baseline);
  return el('span', { cls: 'pulse-dot pulse-dot-' + tone, attrs: { title, 'aria-label': title } });
}

/**
 * The arrow and its delta — day-over-day, printed as given, no colour (S3).
 */
function arrow(m) {
  // The ONLY reader of `dod` in this module: the dot never sees it.
  const d = num(m ? m.dod : null);
  if (d === null) return null;
  const text = d > 0 ? '▲ ' + String(d) : d < 0 ? '▼ ' + String(-d) : '– 0';
  return el('span', { cls: 'pulse-arrow', text, attrs: { title: 'vs the day before' } });
}

/** One number's pair: arrow + dot. */
function marks(key, m, lower, dead) {
  return el('span', { cls: 'pulse-marks' }, [arrow(m), dot(key, m, lower, dead)]);
}

// ------------------------------------------------------------- source state

/** `sources_status.<k>` when it says the source failed, else null. */
function failed(data, src) {
  const s = obj(obj(data.sources_status)?.[src]);
  return s && s.ok === false ? s : null;
}

/** How many of the newest days carry no block for this source. */
function nullRun(days, src) {
  let n = 0;
  for (const row of days) {
    if (obj(row) && obj(row[src])) break;
    n++;
  }
  return n;
}

/** S6: `GSC · last good Thu 10/30 · 403 permission`. */
function statusLine(src, s) {
  const parts = [SOURCE_LABEL[src], s.last_good ? 'last good ' + day(str(s.last_good)) : 'no good pull yet'];
  if (s.error) parts.push(str(s.error));
  return el('p', { cls: 'pulse-src-down', text: parts.join(' · ') });
}

// ------------------------------------------------------------------ the face

function dateChip(block, tip) {
  const b = obj(block);
  if (!b || typeof b.date !== 'string') return null;
  return el('span', { cls: 'pulse-date', text: day(b.date), attrs: { title: tip || null } });
}

function cell(label, valueText, markNodes, grey) {
  return el('div', { cls: 'pulse-cell' + (grey ? ' pulse-cell-grey' : '') }, [
    el('span', { cls: 'pulse-label', text: label }),
    el('span', { cls: 'pulse-value', text: grey ? '—' : valueText }),
    el('span', { cls: 'pulse-ind' }, markNodes),
  ]);
}

function group(cls, chip, cells, down) {
  return el('div', { cls: 'pulse-group ' + cls }, [
    chip ? el('div', { cls: 'pulse-group-head' }, [chip]) : null,
    el('div', { cls: 'pulse-cells' }, cells),
    down,
  ]);
}

function face(data, days, lower) {
  const latest = obj(data.latest) || {};
  const ga4 = obj(latest.ga4);
  const gsc = obj(latest.gsc);
  const cf = obj(latest.cf);

  const state = {};
  for (const src of SOURCES) {
    const s = failed(data, src);
    state[src] = { down: s, dead: !!s && nullRun(days, src) >= DEAD_AFTER };
  }
  const one = (block, src, key) => {
    const m = metric(block, key);
    return state[src].down ? dot(key, null, lower, state[src].dead) : marks(key, m, lower, false);
  };

  const g = state.ga4;
  const leads = metric(ga4, 'leads');
  const carts = metric(ga4, 'carts');
  const ga4Cells = [
    cell('Sessions', fmtNum(metric(ga4, 'sessions')?.value), [one(ga4, 'ga4', 'sessions')], !!g.down),
    cell(
      'Leads · Carts',
      fmtNum(leads?.value) + ' · ' + fmtNum(carts?.value),
      [one(ga4, 'ga4', 'leads'), el('span', { cls: 'pulse-sep', text: '·' }), one(ga4, 'ga4', 'carts')],
      !!g.down
    ),
  ];

  const s = state.gsc;
  const gscCells = [
    cell('Organic clicks', fmtNum(metric(gsc, 'clicks')?.value), [one(gsc, 'gsc', 'clicks')], !!s.down),
    cell('Impressions', fmtNum(metric(gsc, 'impressions')?.value), [one(gsc, 'gsc', 'impressions')], !!s.down),
  ];

  // S4: the GSC chip explains itself only when the two dates actually differ.
  const lag = ga4 && gsc && typeof ga4.date === 'string' && ga4.date !== gsc.date;

  const grid = el('div', { cls: 'pulse-grid' }, [
    group('pulse-group-ga4', dateChip(ga4), ga4Cells, g.down ? statusLine('ga4', g.down) : null),
    group('pulse-group-gsc', dateChip(gsc, lag ? LAG_TIP : null), gscCells, s.down ? statusLine('gsc', s.down) : null),
  ]);

  // The one line under the four: CTR · Pos · 5xx, each with its own pair.
  const seg = (label, block, src, key, unit) =>
    el('span', { cls: 'pulse-seg' + (state[src].down ? ' pulse-seg-grey' : '') }, [
      el('span', {
        text: label + ' ' + (state[src].down ? '—' : fmtNum(metric(block, key)?.value) + (num(metric(block, key)?.value) === null ? '' : unit)),
      }),
      one(block, src, key),
    ]);
  const sub = el('div', { cls: 'pulse-sub' }, [
    seg('CTR', gsc, 'gsc', 'ctr', '%'),
    seg('Pos', gsc, 'gsc', 'position', ''),
    seg('5xx', cf, 'cf', 'err5xx_pct', '%'),
  ]);

  return [grid, sub, state.cf.down ? statusLine('cf', state.cf.down) : null];
}

// ----------------------------------------------------------------- the sheet

const SPARK_W = 300;
const SPARK_H = 54;
const PAD_X = 4;
const PAD_Y = 10;
const round = (n) => Math.round(n * 10) / 10;

const SPARKS = [
  ['ga4', 'sessions', 'Sessions'],
  ['gsc', 'clicks', 'Organic clicks'],
  ['gsc', 'impressions', 'Impressions'],
  ['gsc', 'position', 'Avg position · up is better'],
];

/** The series for one metric, oldest → newest, a gap (null) where the block is missing. */
function series(chrono, src, key) {
  return chrono.map((row) => num(metric(obj(row)?.[src], key)?.value));
}

/**
 * One 28-day sparkline, drawn by hand (rule 3 — no chart library).
 * The ONLY arithmetic on days[]: min/max of what is drawn, to pixels.
 * `invert` turns the Y axis over so a better position sits higher.
 */
function spark(vals, base, label, invert) {
  const have = vals.filter((v) => v !== null);
  if (!have.length) return null;
  const range = base === null ? have : have.concat([base]);
  let lo = Math.min(...range);
  let hi = Math.max(...range);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const n = vals.length;
  const xAt = (i) => (n === 1 ? SPARK_W / 2 : PAD_X + ((SPARK_W - PAD_X * 2) * i) / (n - 1));
  const frac = (v) => (invert ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo));
  const yAt = (v) => PAD_Y + frac(v) * (SPARK_H - PAD_Y * 2);

  let d = '';
  let pen = false;
  let last = null;
  vals.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += (pen ? 'L' : 'M') + round(xAt(i)) + ' ' + round(yAt(v)) + ' ';
    pen = true;
    last = i;
  });

  const kids = [svgEl('title', { text: label })];
  if (base !== null) {
    kids.push(
      svgEl('line', {
        cls: 'pulse-spark-base',
        attrs: { x1: PAD_X, x2: SPARK_W - PAD_X, y1: round(yAt(base)), y2: round(yAt(base)) },
      })
    );
  }
  kids.push(svgEl('path', { cls: 'pulse-spark-line', attrs: { d: d.trim() } }));
  const lx = xAt(last);
  const ly = yAt(vals[last]);
  kids.push(svgEl('circle', { cls: 'pulse-spark-now', attrs: { cx: round(lx), cy: round(ly), r: 2.6 } }));
  kids.push(
    svgEl('text', {
      cls: 'pulse-spark-label',
      attrs: { x: SPARK_W - PAD_X, y: round(ly < SPARK_H / 2 ? ly + 10 : ly - 5), 'text-anchor': 'end' },
      text: fmtNum(vals[last]),
    })
  );

  return el('div', { cls: 'pulse-spark-wrap' }, [
    el('div', { cls: 'pulse-spark-name', text: label }),
    svgEl(
      'svg',
      {
        cls: 'pulse-spark',
        attrs: { viewBox: '0 0 ' + SPARK_W + ' ' + SPARK_H, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
      },
      kids
    ),
  ]);
}

function section(key, title, kids) {
  const body = kids.filter(Boolean);
  if (!body.length) return null;
  return el('section', { cls: 'pulse-sec pulse-sec-' + key }, [el('h3', { cls: 'pulse-sec-head', text: title }), ...body]);
}

function sparksSection(data, chrono) {
  const latest = obj(data.latest) || {};
  return section(
    'sparks',
    '28 days',
    SPARKS.map(([src, key, label]) => {
      const base = num(metric(latest[src], key)?.baseline);
      return spark(series(chrono, src, key), base, label, key === 'position');
    })
  );
}

/** S5(b): 5xx as bars, drawn only when some day had any. */
function errSection(chrono) {
  const vals = series(chrono, 'cf', 'err5xx_pct');
  const hi = Math.max(0, ...vals.filter((v) => v !== null));
  if (!(hi > 0)) return null;
  const w = SPARK_W / vals.length;
  const bars = [svgEl('title', { text: '5xx % by day' })];
  vals.forEach((v, i) => {
    if (v === null || v <= 0) return;
    const h = Math.max(1, (v / hi) * (SPARK_H - 12));
    bars.push(
      svgEl('rect', {
        cls: 'pulse-err-bar',
        attrs: { x: round(i * w + 1), y: round(SPARK_H - h), width: round(Math.max(1, w - 2)), height: round(h) },
      })
    );
  });
  return section('err', '5xx', [
    svgEl('svg', { cls: 'pulse-err', attrs: { viewBox: '0 0 ' + SPARK_W + ' ' + SPARK_H, preserveAspectRatio: 'none', role: 'img', 'aria-label': '5xx % by day' } }, bars),
    el('div', { cls: 'pulse-foot', text: 'peak ' + fmtNum(hi) + '%' }),
  ]);
}

/** Position Δ vs the prior 7 days — the one subtraction (S5c). Negative = improved. */
function posChip(q) {
  const now = num(q.position);
  const prev = num(q.position_prev);
  if (now === null || prev === null) return null;
  const delta = Math.round((now - prev) * 10) / 10;
  if (Math.abs(delta) < 0.5) return null;
  return el('span', {
    cls: 'pulse-pos-chip',
    text: (delta < 0 ? '▲ ' : '▼ ') + Math.abs(delta).toFixed(1),
    attrs: { title: 'was ' + fmtNum(prev) },
  });
}

function queriesSection(data) {
  const rows = arr(data.queries_top10)
    .map(obj)
    .filter((q) => q && q.query)
    .map((q) =>
      el('div', { cls: 'pulse-row' }, [
        el('span', { cls: 'pulse-row-name', text: str(q.query) }),
        el('span', {
          cls: 'pulse-row-nums',
          text: fmtNum(q.clicks) + ' · ' + fmtNum(q.impressions) + ' · ' + fmtNum(q.position),
        }),
        posChip(q),
      ])
    );
  if (!rows.length) return null;
  return section('queries', 'Top queries · 7 days', [
    el('div', { cls: 'pulse-row pulse-row-head' }, [
      el('span', { cls: 'pulse-row-name', text: 'query' }),
      el('span', { cls: 'pulse-row-nums', text: 'clicks · impr · pos' }),
    ]),
    ...rows,
  ]);
}

function pagesSection(data) {
  const rows = arr(data.pages_top10)
    .map(obj)
    .filter((p) => p && p.path)
    .map((p) =>
      el('div', { cls: 'pulse-row' }, [
        el('span', { cls: 'pulse-row-name pulse-mono', text: str(p.path) }),
        el('span', { cls: 'pulse-row-nums', text: fmtNum(p.clicks) + ' · ' + fmtNum(p.impressions) }),
      ])
    );
  if (!rows.length) return null;
  return section('pages', 'Top pages · 7 days', [
    el('div', { cls: 'pulse-row pulse-row-head' }, [
      el('span', { cls: 'pulse-row-name', text: 'page' }),
      el('span', { cls: 'pulse-row-nums', text: 'clicks · impr' }),
    ]),
    ...rows,
  ]);
}

function channelsSection(data) {
  const ch = obj(data.channels_7d) || {};
  const parts = CHANNELS.map((k) => [k, num(ch[k])]).filter(([, v]) => v !== null && v > 0);
  if (!parts.length) return null;
  let total = 0;
  for (const [, v] of parts) total += v;
  const bar = el(
    'div',
    { cls: 'pulse-ch-bar', attrs: { 'aria-hidden': 'true' } },
    parts.map(([k, v]) => el('span', { cls: 'pulse-ch pulse-ch-' + k, attrs: { style: 'flex-grow: ' + v / total } }))
  );
  const legend = el(
    'div',
    { cls: 'pulse-ch-legend' },
    parts.map(([k, v]) =>
      el('span', { cls: 'pulse-ch-key' }, [el('span', { cls: 'pulse-ch-swatch pulse-ch-' + k }), k + ' ' + fmtNum(v)])
    )
  );
  return section('channels', 'Channels · 7 days', [bar, legend]);
}

/** S5(e) + S9: the last seven days' conversions, then every metric the contract does not name. */
function lastSevenSection(data, days) {
  const rows = days
    .slice(0, 7)
    .map(obj)
    .filter((r) => r && typeof r.date === 'string')
    .map((r) => {
      const ga4 = obj(r.ga4);
      return el('div', { cls: 'pulse-tr' }, [
        el('span', { cls: 'pulse-td pulse-td-date', text: day(r.date) }),
        el('span', { cls: 'pulse-td', text: ga4 ? fmtNum(metric(ga4, 'leads')?.value) : '—' }),
        el('span', { cls: 'pulse-td', text: ga4 ? fmtNum(metric(ga4, 'carts')?.value) : '—' }),
        el('span', { cls: 'pulse-td', text: ga4 ? fmtNum(metric(ga4, 'purchases')?.value) : '—' }),
      ]);
    });
  const table = rows.length
    ? el('div', { cls: 'pulse-table' }, [
        el('div', { cls: 'pulse-tr pulse-th' }, [
          el('span', { cls: 'pulse-td pulse-td-date', text: 'day' }),
          el('span', { cls: 'pulse-td', text: 'leads' }),
          el('span', { cls: 'pulse-td', text: 'carts' }),
          el('span', { cls: 'pulse-td', text: 'purchases' }),
        ]),
        ...rows,
      ])
    : null;

  // S9: an unknown metric surfaces under its own key, never dropped.
  const latest = obj(data.latest) || {};
  const extra = [];
  for (const src of SOURCES) {
    const block = obj(latest[src]);
    if (!block) continue;
    for (const [k, v] of Object.entries(block)) {
      const m = obj(v);
      if (!m || !('value' in m) || NAMED[src].includes(k)) continue;
      extra.push(
        el('div', { cls: 'pulse-row pulse-extra' }, [
          el('span', { cls: 'pulse-row-name pulse-mono', text: src + '.' + k }),
          el('span', { cls: 'pulse-row-nums', text: fmtNum(m.value) + (block.date ? ' · ' + day(str(block.date)) : '') }),
        ])
      );
    }
  }
  const also = extra.length ? el('div', { cls: 'pulse-also' }, [el('div', { cls: 'pulse-also-head', text: 'Also reported' }), ...extra]) : null;
  return section('last7', 'Last 7 days', [table, also]);
}

function tripwireLine(data) {
  const t = obj(data.tripwire);
  if (!t || t.tag_gone !== true) return null;
  return el('p', {
    cls: 'pulse-tripwire',
    text: 'GA4 saw no sessions while Cloudflare saw traffic' + (t.since ? ' · since ' + day(str(t.since)) : ''),
  });
}

function sheetBody(data, days) {
  return (body) => {
    const chrono = days.slice().reverse();
    const parts = [
      tripwireLine(data),
      sparksSection(data, chrono),
      errSection(chrono),
      queriesSection(data),
      pagesSection(data),
      channelsSection(data),
      lastSevenSection(data, days),
    ].filter(Boolean);
    if (!parts.length) body.appendChild(empty('Nothing to chart yet.'));
    for (const p of parts) body.appendChild(p);
    const links = [];
    LINKS.forEach(([label, href], i) => {
      if (i) links.push(' · ');
      links.push(extLink(href, label, 'pulse-link'));
    });
    body.appendChild(el('p', { cls: 'pulse-links' }, links));
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data) || {};
  const days = arr(data.days).filter((r) => obj(r));
  const latest = obj(data.latest) || {};
  const hasAny = SOURCES.some((s) => obj(latest[s]));

  if (data.status === 'empty' || (!days.length && !hasAny)) {
    root.appendChild(empty('No pulse yet — first run 6:15 AM.'));
    return;
  }

  const lower = lowerList(data);
  const wrap = el('div', { cls: 'pulse-face' });

  // Rule 8: stale renders the last data, under the shell's grey, with its date.
  if (data.status === 'stale' || (tile && tile.status === 'stale')) {
    const since = typeof data.stale_since === 'string' && data.stale_since ? data.stale_since : str(data.generated_at).slice(0, 10);
    wrap.appendChild(el('span', { cls: 'pulse-stale', text: 'stale since ' + (day(since) || 'unknown') }));
  }

  for (const n of face(data, days, lower)) if (n) wrap.appendChild(n);

  const openPanel = ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;
  if (openPanel) {
    const open = () => openPanel(TITLE, sheetBody(data, days));
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', 'Open the site pulse breakdown');
    wrap.addEventListener('click', open);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        open();
      }
    });
    wrap.classList.add('pulse-tappable');
  }

  root.appendChild(wrap);
}
