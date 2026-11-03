/**
 * wss_traffic — Site Pulse.
 *
 * The WSS website's previous day, as a glance. Vault spec
 * `Site-Pulse-Tile-Spec.md`, rulings S1–S14. The engine reads the daily
 * script's `traffic-pulse.json` into this payload; the page lays it out.
 *
 * THE FACE IS ROWS (S11–S14, v1.2). Two dated groups — GA4, then Search
 * Console — of one line per metric: dot · label · value · 28-day sparkline ·
 * arrow, every row the same five columns so the values share one right edge.
 * CTR, 5xx and Cloudflare's date ride one muted footer; 5xx earns a row only
 * on a day it is above zero. Leads and carts at 0 · 0 are one quiet row.
 *
 * TWO INDICATORS PER NUMBER, AND THEY HAVE DIFFERENT JOBS (S3, S12).
 *   - The ARROW is day-over-day, printed as given: movement, not meaning, so
 *     it carries no colour at all, sits last and faint, and a zero prints
 *     nothing. It is built in exactly one function, `arrow()`, and that
 *     function is the only place in this file that reads the day-over-day
 *     field (a source scan holds it).
 *   - The TONE is the engine's `ratio` — yesterday against the same-weekday
 *     baseline. `dotTone()` is the one function that chooses a colour, it
 *     chooses from `ratio` alone, and `toneOf()` is its one caller: the dot,
 *     the value and the sparkline's last point all wear what it returns.
 *     Against the day prior every Monday is green and every Saturday red;
 *     against the same weekday a red means something.
 *
 * EACH BLOCK WEARS ITS OWN DATE (S4). GA4 and Cloudflare are yesterday;
 * Search Console lags 2–3 days. Each group head prints its block's own
 * `date` through `shortDay()`, plus `lags 2–3 days` when the two differ, and
 * nothing here relabels, averages or interpolates across the lag — a Thursday that reads as Thursday is the truth.
 *
 * THE PAGE COMPUTES NO BASELINE (S10). No middle value, no ratio, no average: a null
 * ratio is a hollow dot with "no baseline yet". The arithmetic in this file is
 * the sparkline geometry (min/max to pixels, one function for face and
 * sheet), the 5xx bar heights, the channel bar widths and one subtraction — a query's position against its prior week.
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

/**
 * The row's tone — the dot's class AND the value's colour (S12). One call to
 * dotTone, off `ratio` alone; a dead source is `dead` whatever its ratio.
 */
function toneOf(key, m, lower, dead) {
  return dead ? 'dead' : dotTone(key, m ? m.ratio : null, lower.includes(key));
}

function dot(tone, m, tip) {
  const title =
    tip ||
    (tone === 'dead'
      ? 'no data ' + DEAD_AFTER + '+ days'
      : tone === 'none'
        ? 'no baseline yet'
        : 'usual for this weekday: ' + fmtNum(m && m.baseline));
  return el('span', { cls: 'pulse-dot pulse-dot-' + tone, attrs: { title, 'aria-label': title } });
}

/**
 * The arrow and its delta — day-over-day, printed as given, no colour (S3).
 * A zero delta prints nothing (S14): `– 0` is not news.
 */
function arrow(m) {
  // The ONLY reader of `dod` in this module: the dot and the value never see it.
  const d = num(m ? m.dod : null);
  if (d === null || d === 0) return null;
  const text = d > 0 ? '▲ ' + String(d) : '▼ ' + String(-d);
  return el('span', { cls: 'pulse-arrow', text, attrs: { title: 'vs the day before' } });
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

// --------------------------------------------------------------- sparklines

const round = (n) => Math.round(n * 10) / 10;

/** The series for one metric, oldest → newest, a gap (null) where the block is missing. */
function series(chrono, src, key) {
  return chrono.map((row) => num(metric(obj(row)?.[src], key)?.value));
}

/**
 * The one sparkline geometry, shared by the face and the sheet (S13).
 * The ONLY arithmetic on days[]: min/max of what is drawn, to pixels.
 * `invert` turns the Y axis over so a better position sits higher; a null
 * lifts the pen. Returns null when there is nothing to draw.
 */
function sparkGeometry(vals, box, base, invert) {
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
  const xAt = (i) => (n === 1 ? box.w / 2 : box.px + ((box.w - box.px * 2) * i) / (n - 1));
  const frac = (v) => (invert ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo));
  const yAt = (v) => box.py + frac(v) * (box.h - box.py * 2);

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
  return { d: d.trim(), last, x: xAt(last), y: yAt(vals[last]), yAt };
}

// ------------------------------------------------------------------ the face

const FACE = { w: 96, h: 22, px: 3, py: 3 };

/** The row's 28 days: a faint line, the last point in the row's tone. < 2 points → nothing. */
function faceSpark(vals, tone, invert) {
  if (vals.filter((v) => v !== null).length < 2) return null;
  const g = sparkGeometry(vals, FACE, null, invert);
  return svgEl('svg', { cls: 'pulse-face-spark', attrs: { viewBox: '0 0 ' + FACE.w + ' ' + FACE.h, 'aria-hidden': 'true' } }, [
    svgEl('path', { cls: 'pulse-face-line', attrs: { d: g.d } }),
    svgEl('circle', { cls: 'pulse-face-now pulse-spark-now-' + tone, attrs: { cx: round(g.x), cy: round(g.y), r: 2.6 } }),
  ]);
}

/** One row: dot · label · value · sparkline · arrow — every row the same five columns. */
function line(key, label, valueText, tone, dotNode, sparkNode, arrowNode) {
  return el('div', { cls: 'pulse-line pulse-line-' + key }, [
    dotNode,
    el('span', { cls: 'pulse-label', text: label }),
    el('span', { cls: 'pulse-value pulse-value-' + tone, text: valueText }),
    el('span', { cls: 'pulse-spark-cell' }, [sparkNode]),
    el('span', { cls: 'pulse-arrow-cell' }, [arrowNode]),
  ]);
}

/** A number with its unit, or '—' when it is not a number. */
function withUnit(v, unit) {
  return num(v) === null ? '—' : fmtNum(v) + unit;
}

function face(data, days, lower) {
  const latest = obj(data.latest) || {};
  const ga4 = obj(latest.ga4);
  const gsc = obj(latest.gsc);
  const cf = obj(latest.cf);
  const blocks = { ga4, gsc, cf };
  const chrono = days.slice().reverse();

  const state = {};
  for (const src of SOURCES) {
    const s = failed(data, src);
    state[src] = { down: s, dead: !!s && nullRun(days, src) >= DEAD_AFTER };
  }

  // S6: a down source greys in place — '—', its dot hollow or black, no line, no arrow.
  const row = (src, key, label, unit) => {
    const st = state[src];
    const m = st.down ? null : metric(blocks[src], key);
    const tone = toneOf(key, m, lower, st.dead);
    return line(
      key,
      label,
      st.down ? '—' : withUnit(m?.value, unit),
      tone,
      dot(tone, m),
      st.down ? null : faceSpark(series(chrono, src, key), tone, key === 'position'),
      st.down ? null : arrow(m)
    );
  };

  const ga4Rows = [row('ga4', 'sessions', 'Sessions', '')];
  // S14: zero is quiet — both at 0 is one row with nothing to watch.
  const leads = num(metric(ga4, 'leads')?.value);
  const carts = num(metric(ga4, 'carts')?.value);
  if (!state.ga4.down && leads === 0 && carts === 0) {
    ga4Rows.push(line('leads-carts', 'Leads · Carts', '0 · 0', 'none', dot('none', null, 'none on this day'), null, null));
  } else {
    ga4Rows.push(row('ga4', 'leads', 'Leads', ''), row('ga4', 'carts', 'Carts', ''));
  }
  // S11: 5xx earns a row only on a day it is above zero.
  const err = num(metric(cf, 'err5xx_pct')?.value);
  if (!state.cf.down && err !== null && err > 0) ga4Rows.push(row('cf', 'err5xx_pct', '5xx', '%'));

  const gscRows = [
    row('gsc', 'clicks', 'Organic clicks', ''),
    row('gsc', 'impressions', 'Impressions', ''),
    row('gsc', 'position', 'Avg position', ''),
  ];

  // S4: the GSC head explains itself only when the two dates actually differ.
  const lag = ga4 && gsc && typeof ga4.date === 'string' && ga4.date !== gsc.date;

  const group = (src, name, rows, note) =>
    el('div', { cls: 'pulse-group pulse-group-' + src + (state[src].down ? ' pulse-group-grey' : '') }, [
      el('div', { cls: 'pulse-group-head' }, [
        el('span', { cls: 'pulse-group-name', text: name }),
        blocks[src] && typeof blocks[src].date === 'string'
          ? el('span', { cls: 'pulse-date', text: day(blocks[src].date) + (note ? ' · lags 2–3 days' : ''), attrs: { title: note } })
          : null,
      ]),
      el('div', { cls: 'pulse-lines' }, rows),
      state[src].down ? statusLine(src, state[src].down) : null,
    ]);

  // The footer: CTR · 5xx · Cloudflare's own date.
  const foot = [
    'CTR ' + (state.gsc.down ? '—' : withUnit(metric(gsc, 'ctr')?.value, '%')),
    '5xx ' + (state.cf.down ? '—' : withUnit(err, '%')),
  ];
  if (cf && typeof cf.date === 'string') foot.push('CF ' + day(cf.date));

  return [
    group('ga4', 'GA4', ga4Rows, null),
    group('gsc', 'Search Console', gscRows, lag ? LAG_TIP : null),
    el('p', { cls: 'pulse-footline', text: foot.join(' · ') }),
    state.cf.down ? statusLine('cf', state.cf.down) : null,
  ];
}

// ----------------------------------------------------------------- the sheet

const SPARK_W = 300;
const SPARK_H = 54;
const PAD_X = 4;
const SHEET = { w: SPARK_W, h: SPARK_H, px: PAD_X, py: 10 };

const SPARKS = [
  ['ga4', 'sessions', 'Sessions'],
  ['gsc', 'clicks', 'Organic clicks'],
  ['gsc', 'impressions', 'Impressions'],
  ['gsc', 'position', 'Avg position · up is better'],
];

/** One sheet sparkline, drawn by hand (rule 3 — no chart library), off the shared geometry. */
function spark(vals, base, label, invert) {
  const g = sparkGeometry(vals, SHEET, base, invert);
  if (!g) return null;

  const kids = [svgEl('title', { text: label })];
  if (base !== null) {
    kids.push(
      svgEl('line', {
        cls: 'pulse-spark-base',
        attrs: { x1: PAD_X, x2: SPARK_W - PAD_X, y1: round(g.yAt(base)), y2: round(g.yAt(base)) },
      })
    );
  }
  kids.push(svgEl('path', { cls: 'pulse-spark-line', attrs: { d: g.d } }));
  kids.push(svgEl('circle', { cls: 'pulse-spark-now', attrs: { cx: round(g.x), cy: round(g.y), r: 2.6 } }));
  kids.push(
    svgEl('text', {
      cls: 'pulse-spark-label',
      attrs: { x: SPARK_W - PAD_X, y: round(g.y < SPARK_H / 2 ? g.y + 10 : g.y - 5), 'text-anchor': 'end' },
      text: fmtNum(vals[g.last]),
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
