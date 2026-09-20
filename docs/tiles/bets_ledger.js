/**
 * bets_ledger — The Ledger.
 *
 * The look-back. `bets_live` is the sweat: open slips, graded in the browser,
 * moving on a 45-second tick. This is the other half — settled tickets only,
 * computed once a run by the engine, published on the DAILY band. Vault spec
 * `Bets-Ledger-Tile-Spec.md`, rulings L1–L10.
 *
 * NOTHING HERE IS A LEAN, AND NOTHING HERE SETTLES ANYTHING. Every figure on
 * this tile is a settled fact the Bookie already wrote down. So the wording
 * rule that governs `bets_live` — "lean, not settlement" — is deliberately
 * ABSENT from this footer: repeating it here would describe the wrong tile.
 *
 * THE PAGE COMPUTES NOTHING (L1/L5/L10). Records, nets, ROI, win rates, the
 * streak, the curve, the leaderboard, the reconcile gap: all of them arrive
 * finished. This module lays them out. The one arithmetic in the file is the
 * sparkline's geometry — turning `u` values into pixels — and a bar width as
 * a fraction of the largest net, neither of which is a number Matt reads.
 *
 * COLOUR IS THE SIGN OF THE PRINTED NUMBER (L9, and it is the whole ruling).
 * `tone()` below is the ONLY thing in this file that chooses a colour, and it
 * chooses from `> 0` / `< 0` and nothing else. No drawdown shading, no pace,
 * no threshold, no amber: a bankroll that is down is red because the number
 * beside it has a minus on it, not because the tile has an opinion about how
 * far down it is. Scoreboard, not a leash — the Bookie's hard rule 3, and the
 * test suite holds it with a class scan, a source scan and a stylesheet scan.
 *
 * PASSES ARE A COUNT (L8). `🤚 14 passes this week` and not one word more. No
 * units, no "would have won", nowhere, ever.
 *
 * RULE 7: every date in this payload — `as_of`, `slate_day`, `since`, `d`,
 * `from`, `to` — is a Central 'YYYY-MM-DD' string, and every one of them is
 * printed verbatim as text. There is no `new Date` and no `Date.parse` in this
 * file, and a test asserts there never will be.
 *
 * RULE 10: labels, game names, class tags and sport emoji all land via
 * textContent, through `el()` / `svgEl()`.
 */

import { el, svgEl, empty } from '../lib/dom.js';
import { signedUnits } from '../lib/fmt.js';
import { streakChip } from '../lib/bets.js';

/** The slate's starting bankroll — the curve's own zero line (L2). */
const BASELINE = 100;

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A plain object, or null. An array is not one — hostile payloads send both. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** A finite number, or null. Never 0 for a missing field — these are units. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The one place a colour is chosen, and it is chosen from a sign.
 *
 * Positive is green, negative is red, zero and unknown are neither. There is
 * no third branch and there must never be one: the moment this function takes
 * an interest in HOW positive or HOW negative a number is, the tile has
 * started editorialising and L9 is gone.
 */
function tone(n) {
  const v = num(n);
  if (v === null) return 'flat';
  if (v > 0) return 'good';
  if (v < 0) return 'bad';
  return 'flat';
}

/** 105.24 -> '105.2'. One decimal, always — a bankroll is not a ticket. */
function fixed1(n) {
  const v = num(n);
  return v === null ? '—' : v.toFixed(1);
}

/** 105.24 -> '105.2u'. */
function bankrollText(n) {
  const v = num(n);
  return v === null ? '—' : `${v.toFixed(1)}u`;
}

/**
 * 9.4 -> 'ROI +9.4%'. Null -> '' — the caller omits the line entirely rather
 * than printing 'ROI —', which reads like a figure that failed.
 *
 * The minus is U+2212 to match `signedUnits`, for the same reason: beside a
 * '+' at 10px a hyphen reads as a dash rather than as a sign.
 */
function roiText(n) {
  const v = num(n);
  if (v === null) return '';
  if (v === 0) return 'ROI 0.0%';
  return `ROI ${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
}

/** 47 -> '47%', null -> ''. */
function pctText(n) {
  const v = num(n);
  return v === null ? '' : `${Math.round(v)}%`;
}

/** A `{d, u}` curve point, or null. */
function point(raw) {
  const o = obj(raw);
  if (!o) return null;
  const u = num(o.u);
  if (u === null) return null;
  return { d: str(o.d), u };
}

// ------------------------------------------------------------------ the face

/**
 * The header's right-hand side: the Bookie's bankroll and the streak chip.
 *
 * B9 carried over from `bets_live`: the bankroll is a plain number. No colour
 * on it, ever — it is the score, not a verdict.
 */
function headLine(data) {
  return el('div', { cls: 'ledger-head' }, [
    el('span', { cls: 'ledger-bankroll', text: bankrollText(data.bankroll_u) }),
    streakChip(data.streak),
  ]);
}

/**
 * The sparkline (L2) — full width, ~56px, drawn by hand.
 *
 * No chart library and no external anything (hard rules 3 and 4): it is a
 * path, a dotted rule, four circles and four labels. That is cheaper than any
 * dependency and it is the only drawing on the board, so it does not want a
 * framework behind it.
 *
 * WHY THE LAST LABEL IS NOT THE LAST POINT. The curve is the sum of the
 * settled rows; `bankroll_u` is the Bookie's ledger line. When the two
 * disagree the Bookie wins (L10) — so the dot sits where the rows put it and
 * the label says what the Bookie says. The gap between them is shown in full
 * in the sheet footer, and closing it is the Bookie's job, never the page's.
 *
 * `preserveAspectRatio="none"` plus a non-scaling stroke: the box stretches
 * to the card's width while the line stays one pixel, which is what a
 * sparkline is for.
 */
const SPARK_W = 360;
const SPARK_H = 56;
const SPARK_PAD_X = 7;
const SPARK_TOP = 12;
const SPARK_BOT = 12;

function sparkline(data, curve) {
  const pts = curve.map(point).filter(Boolean);
  // Two points is the minimum that can be a line. One is a dot with no story
  // and zero is nothing at all — both hide the whole figure (rule 9).
  if (pts.length < 2) return null;

  const hwm = point(data.hwm);
  const lwm = point(data.lwm);

  // The range has to hold the curve, the 100u rule and both marks, or a mark
  // ends up drawn outside its own box.
  const vals = pts.map((p) => p.u).concat([BASELINE]);
  if (hwm) vals.push(hwm.u);
  if (lwm) vals.push(lwm.u);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max(0.4, (hi - lo) * 0.1);
  lo -= pad;
  hi += pad;
  const span = hi - lo || 1;

  const plotW = SPARK_W - SPARK_PAD_X * 2;
  const plotH = SPARK_H - SPARK_TOP - SPARK_BOT;
  const bottom = SPARK_H - SPARK_BOT;
  const xAt = (i) => SPARK_PAD_X + (plotW * i) / (pts.length - 1);
  const yAt = (u) => SPARK_TOP + ((hi - u) / span) * plotH;
  const round = (n) => Math.round(n * 10) / 10;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${round(xAt(i))} ${round(yAt(p.u))}`).join(' ');
  const fill = `${line} L${round(xAt(pts.length - 1))} ${bottom} L${round(xAt(0))} ${bottom} Z`;

  const last = pts[pts.length - 1];

  /** Where a mark sits: its own x if the engine named a day we plot, else its value's. */
  function markX(mark) {
    const i = pts.findIndex((p) => p.d && mark.d && p.d === mark.d);
    if (i !== -1) return xAt(i);
    let best = 0;
    for (let k = 1; k < pts.length; k++) {
      if (Math.abs(pts[k].u - mark.u) < Math.abs(pts[best].u - mark.u)) best = k;
    }
    return xAt(best);
  }

  /** A label that stays inside the box however close to an edge its dot is. */
  function label(x, y, text, above) {
    const anchor = x < 34 ? 'start' : x > SPARK_W - 34 ? 'end' : 'middle';
    const ax = anchor === 'start' ? SPARK_PAD_X : anchor === 'end' ? SPARK_W - SPARK_PAD_X : x;
    const ay = above ? Math.max(9, y - 5) : Math.min(SPARK_H - 3, y + 10);
    return svgEl('text', {
      cls: 'ledger-spark-label',
      attrs: { x: round(ax), y: round(ay), 'text-anchor': anchor },
      text,
    });
  }

  const kids = [
    svgEl('title', {
      text: `since ${str(data.slate_day)}: ${str(obj(data.windows)?.slate?.record) || '—'} · ${signedUnits(obj(data.windows)?.slate?.net_u)}`,
    }),
    svgEl('path', { cls: 'ledger-spark-fill', attrs: { d: fill } }),
    svgEl('line', {
      cls: 'ledger-spark-base',
      attrs: {
        x1: SPARK_PAD_X,
        x2: SPARK_W - SPARK_PAD_X,
        y1: round(yAt(BASELINE)),
        y2: round(yAt(BASELINE)),
      },
    }),
    svgEl('path', { cls: 'ledger-spark-line', attrs: { d: line } }),
  ];

  if (hwm) {
    const x = markX(hwm);
    const y = yAt(hwm.u);
    kids.push(svgEl('circle', { cls: 'ledger-spark-mark', attrs: { cx: round(x), cy: round(y), r: 2.4 } }));
    kids.push(label(x, y, `⬆ ${fixed1(hwm.u)}`, true));
  }
  if (lwm) {
    const x = markX(lwm);
    const y = yAt(lwm.u);
    kids.push(svgEl('circle', { cls: 'ledger-spark-mark', attrs: { cx: round(x), cy: round(y), r: 2.4 } }));
    kids.push(label(x, y, `⬇ ${fixed1(lwm.u)}`, false));
  }

  const lastX = xAt(pts.length - 1);
  const lastY = yAt(last.u);
  kids.push(svgEl('circle', { cls: 'ledger-spark-now', attrs: { cx: round(lastX), cy: round(lastY), r: 3 } }));
  kids.push(label(lastX, lastY, fixed1(data.bankroll_u), true));

  return svgEl(
    'svg',
    {
      // The sign of net-since-slate, by way of the one colour function in
      // the file. Not a threshold: on this chart 100u IS zero.
      cls: `ledger-spark ledger-spark-${tone(last.u - BASELINE)}`,
      attrs: {
        viewBox: `0 0 ${SPARK_W} ${SPARK_H}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': `bankroll since ${str(data.slate_day)}`,
      },
    },
    kids
  );
}

/** One window cell: record large, net coloured by its own sign, ROI small. */
function windowCell(label, rec) {
  const o = obj(rec);
  if (!o) return null;
  const roi = roiText(o.roi_pct);
  return el('div', { cls: 'ledger-win' }, [
    el('span', { cls: 'ledger-win-label', text: label }),
    el('span', { cls: 'ledger-win-record', text: str(o.record) || '—' }),
    el('span', { cls: `ledger-win-net ledger-${tone(o.net_u)}`, text: signedUnits(o.net_u) }),
    // No ROI when nothing was staked — 'ROI —' reads like a broken figure.
    roi ? el('span', { cls: 'ledger-win-roi', text: roi }) : null,
  ]);
}

/** 7d · 30d · slate, in that order, skipping any the engine did not send. */
function windowsStrip(windows) {
  const w = obj(windows);
  if (!w) return null;
  const cells = [
    windowCell('7d', w['7d']),
    windowCell('30d', w['30d']),
    windowCell('slate', w.slate),
  ].filter(Boolean);
  if (!cells.length) return null;
  return el('div', { cls: 'ledger-windows' }, cells);
}

/**
 * `🤚 14 passes this week` (L8).
 *
 * A COUNT, AND NOTHING ELSE. No units, no "would have won 3.2u", no verdict
 * on whether passing was right. That is a Bookie hard rule and the tile
 * inherits it verbatim — the source scan in the test suite is what keeps a
 * well-meaning future edit from adding the interesting half.
 */
function passesChip(passes) {
  const p = obj(passes);
  const n = p ? num(p['7d']) : null;
  if (n === null) return null;
  return el('span', { cls: 'ledger-chip', text: `🤚 ${n} ${n === 1 ? 'pass' : 'passes'} this week` });
}

/** `66 tickets since 2026-08-20` — the date printed verbatim (rule 7). */
function rowsChip(data) {
  const n = num(data.rows);
  if (n === null) return null;
  const since = str(data.slate_day);
  const noun = n === 1 ? 'ticket' : 'tickets';
  return el('span', { cls: 'ledger-chip', text: since ? `${n} ${noun} since ${since}` : `${n} ${noun}` });
}

// ----------------------------------------------------------------- the sheet

function section(title, kids) {
  const body = kids.filter(Boolean);
  if (!body.length) return null;
  return el('div', { cls: 'ledger-sec' }, [el('h3', { cls: 'ledger-sec-head', text: title }), ...body]);
}

/**
 * By sport (L4) — the Packers-fan-with-a-soccer-problem chart.
 *
 * The bar is a proportion of the biggest |net| on the board, drawn either side
 * of a centre rule. It is a shape, not a figure: the number is printed beside
 * it, and the bar's only job is to make which sport is eating the bankroll
 * legible at arm's length.
 */
function sportRow(raw, max) {
  const o = obj(raw);
  if (!o) return null;
  const net = num(o.net_u);
  const width = max > 0 && net !== null ? Math.min(50, (Math.abs(net) / max) * 50) : 0;
  return el('div', { cls: 'ledger-sport' }, [
    el('div', { cls: 'ledger-sport-head' }, [
      el('span', { cls: 'ledger-sport-emoji', text: str(o.s) || '•' }),
      el('span', { cls: 'ledger-sport-rec', text: str(o.record) || '—' }),
      el('span', { cls: `ledger-sport-net ledger-${tone(net)}`, text: signedUnits(net) }),
    ]),
    el('div', { cls: 'ledger-bar' }, [
      el('span', { cls: 'ledger-bar-rule' }),
      // Which side of the centre rule the bar grows from is the same
      // decision as its colour — the sign — so it is made once, here, and
      // the stylesheet reads it off the tone class.
      el('span', {
        cls: `ledger-bar-fill ledger-fill-${tone(net)}`,
        attrs: { style: `width:${width.toFixed(1)}%` },
      }),
    ]),
  ]);
}

function sportSection(bySport) {
  const rows = arr(bySport).map(obj).filter(Boolean);
  if (!rows.length) return null;
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(num(r.net_u) ?? 0)), 0);
  return section(
    'By sport',
    rows.map((r) => sportRow(r, max))
  );
}

/**
 * The angle leaderboard (L5) — display only.
 *
 * The Bookie's Angle Book is the ruling class record; this is the same rows
 * counted a second way so they can be looked at. 🏆 and 💀 mark the ends of
 * the published order and nothing else — the page does not decide which angle
 * is best, it reads which one the engine put first.
 */
function classRow(raw, mark) {
  const o = obj(raw);
  if (!o) return null;
  const roi = roiText(o.roi_pct);
  return el('div', { cls: 'ledger-class' }, [
    el('span', { cls: 'ledger-class-mark', attrs: { 'aria-hidden': 'true' }, text: mark }),
    el('span', { cls: 'ledger-tag', text: str(o.tag) || '—' }),
    el('span', { cls: 'ledger-class-rec', text: str(o.record) || '—' }),
    el('span', { cls: `ledger-class-net ledger-${tone(o.net_u)}`, text: signedUnits(o.net_u) }),
    el('span', { cls: 'ledger-class-roi', text: roi }),
  ]);
}

/** The classes under the floor, summed into one muted line. */
function otherRow(other) {
  const o = obj(other);
  if (!o) return null;
  const n = num(o.classes);
  const label = n === null ? 'other' : `other (${n} ${n === 1 ? 'class' : 'classes'})`;
  return el('div', { cls: 'ledger-class ledger-class-other' }, [
    el('span', { cls: 'ledger-class-mark', attrs: { 'aria-hidden': 'true' }, text: '' }),
    el('span', { cls: 'ledger-tag', text: label }),
    el('span', { cls: 'ledger-class-rec', text: str(o.record) || '—' }),
    el('span', { cls: `ledger-class-net ledger-${tone(o.net_u)}`, text: signedUnits(o.net_u) }),
    el('span', { cls: 'ledger-class-roi', text: '' }),
  ]);
}

function classSection(data) {
  const rows = arr(data.by_class).map(obj).filter(Boolean);
  // L5's section hides whole when the engine found no class above the floor.
  // `class_other` alone is not a leaderboard, so it does not carry one.
  if (!rows.length) return null;
  const last = rows.length - 1;
  // One row is both the best and the worst angle, which is not a ranking.
  const marks = rows.length > 1;
  return section('Angles', [
    ...rows.map((r, i) => classRow(r, marks ? (i === 0 ? '🏆' : i === last ? '💀' : '') : '')),
    otherRow(data.class_other),
  ]);
}

/** Dogs vs favorites (L6). */
function priceCell(emoji, label, rec) {
  const o = obj(rec);
  if (!o) return null;
  const pct = pctText(o.win_pct);
  return el('div', { cls: 'ledger-price-cell' }, [
    el('span', { cls: 'ledger-price-emoji', attrs: { 'aria-hidden': 'true' }, text: emoji }),
    el('span', { cls: 'ledger-price-label', text: label }),
    el('span', { cls: 'ledger-price-rec', text: str(o.record) || '—' }),
    el('span', { cls: `ledger-price-net ledger-${tone(o.net_u)}`, text: signedUnits(o.net_u) }),
    el('span', { cls: 'ledger-price-pct', text: pct }),
  ]);
}

function priceSection(price) {
  const p = obj(price);
  if (!p) return null;
  const cells = [priceCell('🐕', 'dog', p.dog), priceCell('🏦', 'favorite', p.fav)].filter(Boolean);
  if (!cells.length) return null;
  // A pick'em is a footnote, not a third of the row — and it appears only
  // when there actually were any.
  const even = obj(p.even);
  let evenCell = null;
  if (even && (num(even.n) ?? 0) > 0) {
    evenCell = priceCell('⚖️', 'even', even);
    if (evenCell) evenCell.classList.add('ledger-price-even');
  }
  return section('Dogs vs favorites', [el('div', { cls: 'ledger-price' }, [...cells, evenCell])]);
}

/**
 * The receipts (L7) — six rows, each skipped outright when the engine has
 * nothing to put in it. A "best day: —" is a worse receipt than no receipt.
 */
function receiptRow(emoji, label, detail, figure) {
  if (!detail && !figure) return null;
  return el('div', { cls: 'ledger-receipt' }, [
    el('span', { cls: 'ledger-receipt-emoji', attrs: { 'aria-hidden': 'true' }, text: emoji }),
    el('div', { cls: 'ledger-receipt-main' }, [
      el('span', { cls: 'ledger-receipt-label', text: label }),
      el('span', { cls: 'ledger-receipt-detail', text: detail }),
    ]),
    figure,
  ]);
}

function ticketReceipt(emoji, label, raw) {
  const o = obj(raw);
  if (!o) return null;
  const head = [str(o.s), str(o.label)].filter(Boolean).join(' ');
  const detail = [str(o.game), str(o.d)].filter(Boolean).join('  ·  ');
  const u = num(o.u);
  return receiptRow(
    emoji,
    head || label,
    detail,
    u === null ? null : el('span', { cls: `ledger-receipt-net ledger-${tone(u)}`, text: signedUnits(u) })
  );
}

function dayReceipt(emoji, label, raw) {
  const o = obj(raw);
  if (!o) return null;
  const n = num(o.n);
  const detail = [str(o.d), str(o.record), n === null ? '' : `${n} ${n === 1 ? 'ticket' : 'tickets'}`]
    .filter(Boolean)
    .join('  ·  ');
  const net = num(o.net_u);
  return receiptRow(
    emoji,
    label,
    detail,
    net === null ? null : el('span', { cls: `ledger-receipt-net ledger-${tone(net)}`, text: signedUnits(net) })
  );
}

/**
 * `🔥 longest run — W6 · 2026-09-09 → 2026-09-13`.
 *
 * No units on a streak row: the engine publishes a length and two dates, and
 * a figure invented to fill the column would be the page doing arithmetic.
 * A one-day streak collapses to a single date rather than printing it twice.
 */
function streakReceipt(emoji, label, letter, raw) {
  const o = obj(raw);
  if (!o) return null;
  const n = num(o.n);
  if (n === null) return null;
  const from = str(o.from);
  const to = str(o.to);
  const span = from && to && from !== to ? `${from} → ${to}` : from || to;
  return receiptRow(emoji, label, [`${letter}${n}`, span].filter(Boolean).join('  ·  '), null);
}

function receiptsSection(receipts) {
  const r = obj(receipts);
  if (!r) return null;
  return section('Receipts', [
    ticketReceipt('💰', 'biggest cash', r.best_ticket),
    ticketReceipt('🩸', 'worst beat', r.worst_ticket),
    dayReceipt('📈', 'best day', r.best_day),
    dayReceipt('📉', 'worst day', r.worst_day),
    streakReceipt('🔥', 'longest run', 'W', r.longest_w),
    streakReceipt('🧊', 'longest skid', 'L', r.longest_l),
  ]);
}

/**
 * The sheet footer (L10).
 *
 * The reconcile half appears only when the rows and the Bookie's ledger line
 * actually disagree. A `gap_u` of zero means they agree, and printing two
 * identical records side by side would invite Matt to hunt for a difference
 * that is not there.
 */
function sheetFoot(data) {
  const bits = ['settled rows only'];
  const voids = num(data.voids);
  if (voids !== null) bits.push(`voids ${voids}`);

  const rec = obj(data.reconcile);
  const gap = rec ? num(rec.gap_u) : null;
  if (rec && gap !== null && gap !== 0) {
    bits.push(`rows ${str(rec.rows_record) || '—'} ${signedUnits(rec.rows_net_u)}`);
    bits.push(`Bookie ledger ${str(rec.ledger_record) || '—'} ${signedUnits(rec.ledger_net_u)}`);
  }
  return el('p', { cls: 'tile-foot', text: bits.join('  ·  ') });
}

/** The whole sheet, as a builder the shell calls with a body to fill. */
function sheetBody(data) {
  return (body) => {
    const parts = [
      sportSection(data.by_sport),
      classSection(data),
      priceSection(data.price),
      receiptsSection(data.receipts),
    ].filter(Boolean);
    if (!parts.length) body.appendChild(empty('Nothing settled yet.'));
    for (const p of parts) body.appendChild(p);
    body.appendChild(sheetFoot(data));
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data) || {};
  const openPanel =
    ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;

  const face = el('div', { cls: 'ledger-face' });

  face.appendChild(headLine(data));

  const spark = sparkline(data, arr(data.curve));
  if (spark) face.appendChild(spark);

  const strip = windowsStrip(data.windows);
  if (strip) face.appendChild(strip);

  const chips = [passesChip(data.passes), rowsChip(data)].filter(Boolean);
  if (chips.length) face.appendChild(el('div', { cls: 'ledger-chips' }, chips));

  // Nothing to lay out at all — a thin log, or a payload from a schema this
  // module has not met. The card says so instead of drawing an empty frame.
  if (!face.childNodes.length || (!spark && !strip && !chips.length)) {
    face.appendChild(empty('Nothing settled since the slate.'));
  }

  // The whole face is the tap target, not a button: a <button> here would
  // swallow the shell's long-press-to-Explain, which every tile owes.
  if (openPanel) {
    const open = () => openPanel('📒 The Ledger', sheetBody(data));
    face.setAttribute('role', 'button');
    face.setAttribute('tabindex', '0');
    face.setAttribute('aria-label', 'Open the ledger breakdown');
    face.addEventListener('click', open);
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        open();
      }
    });
    face.classList.add('ledger-tappable');
  }

  root.appendChild(face);
}
