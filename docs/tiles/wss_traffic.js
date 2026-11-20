/**
 * wss_traffic — Site Pulse.
 *
 * The WSS website's search, a week at a time. Vault spec
 * `Site-Pulse-Scoreboard-Spec.md` (SB1–SB12), amending `Site-Pulse-Tile-Spec.md`
 * (S1–S15). The daily script builds the scoreboard (`weekly`), the engine
 * passes it through, the page lays it out.
 *
 * THE FACE IS THE WEEKLY SCOREBOARD (SB1–SB3). One group, `Search · 7 days to
 * Wed 11/18`, then six rows in the spec's order — Clicks · Clicks, net of
 * flagged · Mobile clicks · Mobile impressions · Organic sessions · Leads.
 * Each row: dot · label over `prev {P} · avg {4-week average}` (small, faint)
 * · this 7 days (the big value, one shared right edge) · a faint arrow. No
 * sparkline on the face. Under the rows, one faint line when GA4 is missing a
 * day of the window (SB8), then one footer line — the flagged count,
 * yesterday's sessions, 5xx and Cloudflare's date (SB9). "Yesterday" lives
 * there now.
 *
 * TWO INDICATORS PER ROW, AND THEY HAVE DIFFERENT JOBS (SB4, SB5, S3).
 *   - The TONE is this 7 days against the 4-week average: the script's
 *     `ratio`. `weekTone()` is the one function that chooses a scoreboard
 *     colour, it reads `ratio` alone, against one named constant pair
 *     (WEEK_GOOD / WEEK_WARN — weekly bands, tighter than S3's daily ones on
 *     purpose), and the dot and the value both wear what it returns. The
 *     colour never reads the previous-7 figure.
 *   - The ARROW is this 7 days against the previous 7: the script's change,
 *     printed as given, faint and never coloured; ▲ always means better
 *     (S15), a zero prints nothing (S14). `weekArrow()` is the only reader of
 *     that field in this file (a source scan holds it).
 *
 * THE PAGE COMPUTES NOTHING ON THE SCOREBOARD (SB12, S9/S10). W, P, the
 * average, the ratio and the change are the script's; a null is `—` beside a
 * hollow dot. The one date comparison — is the scoreboard more than six days
 * older than the run (SB11)? — goes through `daysBetween()` in lib/fmt.js, on
 * the two Central date strings. The sheet keeps its own arithmetic: the
 * sparkline geometry, the 5xx bar heights, the channel bar widths and one
 * subtraction — a query's position against its prior week.
 *
 * A FAILED SOURCE IS GREYED, DATED AND SAYS WHY (S6, held by SB11) — never a
 * blank, never a zero: its rows print `—` and under them
 * `GSC · last good Thu 10/30 · 403 permission`. Three or more of the newest
 * days with that block missing turns its dots black. No scoreboard at all,
 * or one more than six days old, is one line in place of the rows:
 * `Weekly scoreboard not available · last {window_end}` — and the footer
 * still prints (SB11).
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
import { shortDay, daysBetween } from '../lib/fmt.js';
import { sparkGeometry } from '../lib/spark.js';

const TITLE = '📈 Site Pulse';

/** Used only when the producer does not publish its own list (it does, today). */
const LOWER_DEFAULT = ['position', 'err5xx_pct'];

/** S11 (amended 11/03), kept by SB9: 5xx takes a tone in the footer only at or above this share of requests. */
const ERR_ROW_PCT = 0.5;

/** SB4: this 7 days ÷ the 4-week average. ≥ WEEK_GOOD good · ≥ WEEK_WARN warn · below, bad. */
const WEEK_GOOD = 0.95;
const WEEK_WARN = 0.8;

/** SB11: a scoreboard whose window ended more than this many days before the run is not shown. */
const WEEK_MAX_AGE = 6;

/** SB2: the face's six rows, in order, with the source each one reads (S6) and its label if the payload has none. */
const FACE_ROWS = [
  ['clicks', 'gsc', 'Clicks'],
  ['clicks_net', 'gsc', 'Clicks, net of flagged'],
  ['mobile_clicks', 'gsc', 'Mobile clicks'],
  ['mobile_impressions', 'gsc', 'Mobile impressions'],
  ['organic_sessions', 'ga4', 'Organic sessions'],
  ['leads', 'ga4', 'Leads'],
];

/** SB10: the sheet's table adds these three. The desktop rows wear no tone (rank-tracker impressions). */
const SHEET_ROWS = [
  ...FACE_ROWS,
  ['mobile_position', 'gsc', 'Mobile average position'],
  ['desktop_clicks', 'gsc', 'Desktop clicks'],
  ['desktop_impressions', 'gsc', 'Desktop impressions'],
];
const UNTONED = ['desktop_clicks', 'desktop_impressions'];

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

/** 12345 -> '12,345'; 4120.75 -> '4,120.75'; 2.4 -> '2.4'; anything else -> '—'. Digits as given, never rounded here. */
function fmtNum(v) {
  const n = num(v);
  if (n === null) return '—';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 20 });
}

/** A 'YYYY-MM-DD' through shortDay, or '' when there is none. */
function day(ymd) {
  return typeof ymd === 'string' && ymd ? shortDay(ymd) : '';
}

function lowerList(data) {
  const list = arr(data.lower_is_better).filter((k) => typeof k === 'string');
  return list.length ? list : LOWER_DEFAULT;
}

/** A number with its unit, or '—' when it is not a number. */
function withUnit(v, unit) {
  return num(v) === null ? '—' : fmtNum(v) + unit;
}

// ------------------------------------------------------- the two indicators

/**
 * THE SCOREBOARD'S ONE COLOUR DECISION, and it reads `ratio` only (SB4).
 *
 * The script's ratio is already turned the right way for a lower-is-better
 * row (average ÷ this week), so one set of bands serves every row. A null
 * ratio is `none`, the hollow dot: no baseline, no colour (SB7).
 */
export function weekTone(ratio) {
  const r = num(ratio);
  if (r === null) return 'none';
  if (r >= WEEK_GOOD) return 'good';
  if (r >= WEEK_WARN) return 'warn';
  return 'bad';
}

/**
 * S3's daily bands, kept for ONE thing: the footer's 5xx at or above
 * ERR_ROW_PCT wears what S11's 5xx row wore (SB9). Higher-is-better ≥ 0.8
 * good · 0.6–0.8 warn · < 0.6 bad; lower-is-better turned over — ≤ 1.25 ·
 * ≤ 1.67 · above — because the engine's daily ratio stays value / baseline.
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

function dot(tone, tip) {
  const title =
    tip ||
    (tone === 'dead'
      ? 'no data ' + DEAD_AFTER + '+ days'
      : tone === 'none'
        ? 'no 4-week average'
        : 'vs the 4-week average');
  return el('span', { cls: 'pulse-dot pulse-dot-' + tone, attrs: { title, 'aria-label': title } });
}

/**
 * The arrow and its change — this 7 days against the previous 7, printed as
 * given, no colour (SB5). A zero prints nothing (S14).
 */
function weekArrow(row) {
  // The ONLY reader of `delta` in this module: the dot and the value never see it.
  const d = num(row ? row.delta : null);
  if (d === null || d === 0) return null;
  // ▲ always means better (S15): on a lower-is-better row the glyph turns over.
  const lower = !!(row && row.lower_is_better === true);
  const up = lower ? d < 0 : d > 0;
  const text = (up ? '▲ ' : '▼ ') + fmtNum(Math.abs(d));
  const title = lower ? 'vs the previous 7 days · lower is better, ▲ = improved' : 'vs the previous 7 days';
  return el('span', { cls: 'pulse-arrow', text, attrs: { title } });
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

function sourceStates(data, days) {
  const state = {};
  for (const src of SOURCES) {
    const s = failed(data, src);
    state[src] = { down: s, dead: !!s && nullRun(days, src) >= DEAD_AFTER };
  }
  return state;
}

// --------------------------------------------------------- the weekly block

/**
 * The scoreboard when it can be shown, else null (SB11): no `weekly` object,
 * no readable window end, or a window that ended more than WEEK_MAX_AGE days
 * before the run. Without a `run_today` there is nothing to judge age by, and
 * the page has no clock of its own — the block is shown as dated.
 */
function liveWeekly(data) {
  const w = obj(data.weekly);
  if (!w) return null;
  const end = obj(w.window)?.end;
  if (typeof end !== 'string' || !end) return null;
  const age = typeof data.run_today === 'string' ? daysBetween(end, data.run_today) : null;
  if (age !== null && age > WEEK_MAX_AGE) return null;
  return w;
}

/** The weekly rows by key; a row that is not an object is not there. */
function rowsByKey(w) {
  const by = {};
  for (const r of arr(w && w.rows)) {
    const o = obj(r);
    if (o && typeof o.key === 'string' && !(o.key in by)) by[o.key] = o;
  }
  return by;
}

/** SB11: `Weekly scoreboard not available · last Wed 11/18` (or `last never`). */
function notAvailable(data) {
  const end = obj(obj(data.weekly)?.window)?.end;
  const last = typeof end === 'string' && end ? day(end) : 'never';
  return el('p', { cls: 'pulse-weekly-na', text: 'Weekly scoreboard not available · last ' + last });
}

// ------------------------------------------------------------------ the face

/** One row: dot · (label over prev · avg) · this 7 days · arrow. */
function scoreLine(key, label, row, tone, dotNode, grey) {
  const sub = grey
    ? null
    : el('span', { cls: 'pulse-sub7', text: 'prev ' + fmtNum(row ? row.p : null) + ' · avg ' + fmtNum(row ? row.avg : null) });
  return el('div', { cls: 'pulse-line pulse-line-' + key + (grey ? ' pulse-line-grey' : '') }, [
    dotNode,
    el('span', { cls: 'pulse-name' }, [el('span', { cls: 'pulse-label', text: label }), sub]),
    el('span', { cls: 'pulse-value pulse-value-' + tone, text: grey ? '—' : fmtNum(row ? row.w : null) }),
    el('span', { cls: 'pulse-arrow-cell' }, [grey ? null : weekArrow(row)]),
  ]);
}

/** The rows for `spec` off one weekly block: S6 greys a down source in place, SB11 `—` + hollow for a missing row. */
function scoreRows(spec, w, state, toned) {
  const by = rowsByKey(w);
  return spec.map(([key, src, fallback]) => {
    const row = by[key] || null;
    const label = row && typeof row.label === 'string' && row.label ? row.label : fallback;
    const st = state[src];
    if (st.down) {
      const tone = st.dead ? 'dead' : 'none';
      return scoreLine(key, label, null, tone, dot(tone), true);
    }
    if (!toned(key)) return scoreLine(key, label, row, 'plain', el('span', { cls: 'pulse-dot pulse-dot-blank', attrs: { 'aria-hidden': 'true' } }), false);
    const tone = weekTone(row ? row.ratio : null);
    return scoreLine(key, label, row, tone, dot(tone), false);
  });
}

/** SB8: `GA4 missing 1 day in this window`. */
function gapLine(w) {
  const n = num(w && w.ga4_gap_days);
  if (n === null || n <= 0) return null;
  return el('p', { cls: 'pulse-gap', text: 'GA4 missing ' + fmtNum(n) + (n === 1 ? ' day' : ' days') + ' in this window' });
}

/** SB9: `{n} search(es) flagged · Yesterday Wed 11/19: 87 sessions · 5xx 0% · CF Wed 11/19`. */
function footer(data, w, state, lower) {
  const latest = obj(data.latest) || {};
  const ga4 = obj(latest.ga4);
  const cf = obj(latest.cf);
  const kids = [];
  const add = (node) => {
    if (kids.length) kids.push(' · ');
    kids.push(node);
  };

  const n = w && Array.isArray(w.flagged) ? w.flagged.length : 0;
  if (n > 0) add(n + (n === 1 ? ' search flagged' : ' searches flagged'));

  if (!state.ga4.down && ga4 && typeof ga4.date === 'string') {
    add('Yesterday ' + day(ga4.date) + ': ' + fmtNum(metric(ga4, 'sessions')?.value) + ' sessions');
  } else {
    add('Yesterday: — sessions');
  }

  // S11's threshold, kept: at or above ERR_ROW_PCT the 5xx part wears the tone S11's 5xx row wore.
  const em = state.cf.down ? null : metric(cf, 'err5xx_pct');
  const err = num(em?.value);
  const hot = err !== null && err >= ERR_ROW_PCT ? dotTone('err5xx_pct', em.ratio, lower.includes('err5xx_pct')) : 'none';
  add(el('span', { cls: 'pulse-foot-5xx' + (hot === 'none' ? '' : ' pulse-value-' + hot), text: '5xx ' + (state.cf.down ? '—' : withUnit(err, '%')) }));

  if (!state.cf.down && cf && typeof cf.date === 'string') add('CF ' + day(cf.date));
  return el('p', { cls: 'pulse-footline' }, kids);
}

function face(data, days, lower) {
  const state = sourceStates(data, days);
  const w = liveWeekly(data);
  const parts = [];

  if (w) {
    const end = obj(w.window).end;
    parts.push(
      el('div', { cls: 'pulse-group pulse-group-weekly' }, [
        el('div', { cls: 'pulse-group-head' }, [
          el('span', { cls: 'pulse-group-name', text: 'Search' }),
          el('span', { cls: 'pulse-date', text: '7 days to ' + day(end) }),
        ]),
        el('div', { cls: 'pulse-lines' }, scoreRows(FACE_ROWS, w, state, () => true)),
        gapLine(w),
        state.gsc.down ? statusLine('gsc', state.gsc.down) : null,
        state.ga4.down ? statusLine('ga4', state.ga4.down) : null,
      ])
    );
  } else {
    parts.push(notAvailable(data));
    if (state.gsc.down) parts.push(statusLine('gsc', state.gsc.down));
    if (state.ga4.down) parts.push(statusLine('ga4', state.ga4.down));
  }

  parts.push(footer(data, w, state, lower));
  if (state.cf.down) parts.push(statusLine('cf', state.cf.down));
  return parts;
}

// ----------------------------------------------------------------- the sheet

const SPARK_W = 300;
const SPARK_H = 54;
const PAD_X = 4;
const SHEET = { w: SPARK_W, h: SPARK_H, px: PAD_X, py: 10 };

const round = (n) => Math.round(n * 10) / 10;

/** The series for one metric, oldest → newest, a gap (null) where the block is missing. */
function series(chrono, src, key) {
  return chrono.map((row) => num(metric(obj(row)?.[src], key)?.value));
}

const SPARKS = [
  ['ga4', 'sessions', 'Sessions'],
  ['gsc', 'clicks', 'Organic clicks'],
  ['gsc', 'impressions', 'Impressions'],
  ['gsc', 'position', 'Avg position · up is better'],
];

/** One sheet sparkline, drawn by hand (rule 3 — no chart library), off the shared geometry in lib/spark.js. */
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

/** 'Thu 11/12–Wed 11/18', or '' when either end is missing. */
function span(win) {
  const o = obj(win);
  return o && typeof o.start === 'string' && typeof o.end === 'string' ? day(o.start) + '–' + day(o.end) : '';
}

/** SB10: the whole scoreboard as a table, its windows, and the desktop caveat. */
function scoreboardSection(data, days) {
  const w = liveWeekly(data);
  if (!w) return section('scoreboard', 'Scoreboard · 7 days', [notAvailable(data)]);
  const state = sourceStates(data, days);
  const windows = [
    span(w.window) ? 'this 7 ' + span(w.window) : '',
    span(w.prev_window) ? 'prev ' + span(w.prev_window) : '',
    span(w.avg_window) ? 'avg ' + span(w.avg_window) + ' ÷ 4' : '',
  ].filter(Boolean);
  return section('scoreboard', 'Scoreboard · 7 days', [
    windows.length ? el('p', { cls: 'pulse-windows', text: windows.join(' · ') }) : null,
    el('div', { cls: 'pulse-lines' }, scoreRows(SHEET_ROWS, w, state, (k) => !UNTONED.includes(k))),
    gapLine(w),
    el('p', { cls: 'pulse-foot', text: 'Desktop impressions include rank-tracker traffic' }),
  ]);
}

/** One week of a flagged search: '58 · 160 · 36.2%', or '—' when it has no row that week. */
function weekNums(o) {
  const s = obj(o);
  if (!s) return '—';
  return fmtNum(s.clicks) + ' · ' + fmtNum(s.impressions) + ' · ' + withUnit(s.ctr, '%');
}

/** SB10: the flagged searches with clicks, impressions and CTR for both weeks. */
function flaggedSection(data) {
  const w = liveWeekly(data);
  if (!w) return null;
  if (!Array.isArray(w.flagged)) {
    return section('flagged', 'Flagged searches', [el('p', { cls: 'pulse-foot', text: 'not available' })]);
  }
  const rows = w.flagged
    .map(obj)
    .filter((f) => f && f.query)
    .map((f) =>
      el('div', { cls: 'pulse-flag' }, [
        el('div', { cls: 'pulse-row' }, [
          el('span', { cls: 'pulse-row-name', text: str(f.query) }),
          el('span', { cls: 'pulse-row-nums', text: weekNums(f.w) }),
        ]),
        el('div', { cls: 'pulse-row pulse-flag-before' }, [
          el('span', { cls: 'pulse-row-name', text: 'prev 7' }),
          el('span', { cls: 'pulse-row-nums', text: weekNums(f.p) }),
        ]),
      ])
    );
  if (!rows.length) return section('flagged', 'Flagged searches', [el('p', { cls: 'pulse-foot', text: 'None flagged.' })]);
  return section('flagged', 'Flagged searches', [
    el('div', { cls: 'pulse-row pulse-row-head' }, [
      el('span', { cls: 'pulse-row-name', text: 'search' }),
      el('span', { cls: 'pulse-row-nums', text: 'clicks · impr · ctr' }),
    ]),
    ...rows,
  ]);
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
  const change = Math.round((now - prev) * 10) / 10;
  if (Math.abs(change) < 0.5) return null;
  return el('span', {
    cls: 'pulse-pos-chip',
    text: (change < 0 ? '▲ ' : '▼ ') + Math.abs(change).toFixed(1),
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
      scoreboardSection(data, days),
      flaggedSection(data),
      sparksSection(data, chrono),
      errSection(chrono),
      queriesSection(data),
      pagesSection(data),
      channelsSection(data),
      lastSevenSection(data, days),
    ].filter(Boolean);
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
  const hasAny = SOURCES.some((s) => obj(latest[s])) || !!obj(data.weekly);

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
