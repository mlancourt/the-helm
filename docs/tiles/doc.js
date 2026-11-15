/**
 * doc — 🩺 Doc.
 *
 * Five Apple Watch stats scored one day against the day before — win, loss
 * or push — the record for the day, a week of records in the sheet, and one
 * paragraph Doc writes. Vault spec `Doc-Tile-Spec.md`, DT1–DT15. Read-only.
 *
 * THE FACE, top to bottom (Page rules):
 *   1. the day's label and its record `{w}-{l}-{p}`; when `day.fresh` is
 *      false, one faint `watch data through {through_label}` line under it —
 *      and nothing else changes: no grey, no tone, no pill;
 *   2. one row per `rows[]` entry, in payload order, on Site Pulse's row grid:
 *      the 7-day dot · label (the sleep row adds its faint `when_label`) ·
 *      `value_text` in the big-value style · `delta_text` · 🏆 on a best;
 *   3. Doc's paragraph when it has text, and his `problem` line when set.
 *
 * DT14 — THE ENGINE OWNS EVERY NUMBER AND EVERY TONE. This module prints
 * `value_text`, `delta_text`, `avg_text` and every label as sent. It does no
 * arithmetic, formats no number, compares no two readings and reads no
 * clock. `result` and `avg_result` reach a colour through ONE lookup,
 * `TONE`, and a value it does not know is no tone at all.
 *
 * TWO MARKS, TWO JOBS (DT2, DT8). The delta wears the day-against-the-day-
 * before tone; the dot wears the against-its-own-week tone, hollow while the
 * engine has no average. The value never wears a tone.
 *
 * DT10 — NO READING IS NEVER A LOSS. `value_text: null` prints `no reading`,
 * faint, and nothing in that row wears a tone. `result: null` beside a value
 * prints the value and no delta.
 *
 * DT11 / DT15 — the paragraph and `problem` are Doc's words and untrusted:
 * textContent only, through `el()`. `note: null` draws nothing.
 *
 * DT13 — display only: no buttons, no inputs, nothing filed. The face is one
 * role=button div (the Ledger's pattern, so long-press-to-Explain still
 * reaches the shell) that opens the sheet.
 *
 * DT7 — nothing on this tile can be broken, so it keeps no run of days.
 *
 * RULE 9: unknown keys are ignored, a missing array is an empty one, and a
 * hostile shape renders or vanishes — it never throws.
 */

import { el } from '../lib/dom.js';

const TITLE = '🩺 Doc';

/** The one place a result becomes a tone. Anything else is no tone. */
const TONE = { win: 'good', push: 'warn', loss: 'bad' };

const arr = (v) => (Array.isArray(v) ? v : []);
/** Text as sent, or '' — a number is not a label (DT14: the page formats nothing). */
const str = (v) => (typeof v === 'string' ? v : '');

/** A plain object, or null. An array is not one. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function tone(result) {
  return typeof result === 'string' && Object.prototype.hasOwnProperty.call(TONE, result) ? TONE[result] : null;
}

/** A count the engine sent: a non-negative integer, or null. */
function count(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/** `{w}-{l}-{p}` as sent, or '' when any of the three is not a count. */
function record(r) {
  const o = obj(r);
  if (!o) return '';
  const parts = [count(o.w), count(o.l), count(o.p)];
  return parts.every((n) => n !== null) ? parts.join('-') : '';
}

// ------------------------------------------------------------------ the rows

/**
 * One row on Site Pulse's grid: dot · label · value · delta · 🏆.
 * A row whose `when_label` is not the card's day (sleep: `Sat night`) shows
 * it beside the label, faint. `withAvg` (the sheet) writes `avg_text` out.
 */
function statRow(r, dayLabel, withAvg) {
  const id = str(r.id);
  const label = str(r.label) || id;
  const value = str(r.value_text);
  const reading = value !== '';

  // The dot: off avg_result, hollow without one — and hollow, untoned, on a row with no reading (DT10).
  const dotTone = reading ? tone(r.avg_result) : null;
  const avg = reading ? str(r.avg_text) : '';
  const dot = el('span', {
    cls: `doc-dot doc-dot-${dotTone || 'none'}`,
    attrs: avg ? { title: avg, 'aria-label': avg } : { 'aria-hidden': 'true' },
  });

  // The delta: only beside a value, and only when the engine scored it.
  const delta = reading && r.result !== null && r.result !== undefined ? str(r.delta_text) : '';
  const deltaTone = delta ? tone(r.result) : null;

  const when = str(r.when_label) !== dayLabel ? str(r.when_label) : '';
  const labelCell = el('span', { cls: 'doc-label-cell' }, [
    el('span', { cls: 'doc-label', text: label }),
    when ? el('span', { cls: 'doc-when', text: when }) : null,
    withAvg && avg ? el('span', { cls: 'doc-avg', text: avg }) : null,
  ]);

  return el('div', { cls: `doc-line${id ? ` doc-line-${id}` : ''}${reading ? '' : ' doc-line-none'}` }, [
    dot,
    labelCell,
    el('span', { cls: reading ? 'doc-value' : 'doc-value doc-noread', text: reading ? value : 'no reading' }),
    el('span', { cls: 'doc-delta-cell' }, [
      delta ? el('span', { cls: `doc-delta${deltaTone ? ` doc-delta-${deltaTone}` : ''}`, text: delta }) : null,
    ]),
    el('span', { cls: 'doc-best-cell' }, [
      reading && r.best === true ? el('span', { cls: 'doc-best', text: '🏆', attrs: { 'aria-label': 'best' } }) : null,
    ]),
  ]);
}

/** The card's day label, as sent — what a row's `when_label` is checked against. */
function dayOf(data) {
  const day = obj(data.day);
  return day ? str(day.label) : '';
}

function rowsOf(data) {
  return arr(data.rows).filter((r) => obj(r));
}

// ------------------------------------------------------------------ the note

function noteParts(data) {
  const n = obj(data.note);
  if (!n) return [];
  const text = str(n.text);
  const problem = str(n.problem);
  return [
    text ? el('p', { cls: 'doc-note', text }) : null,
    problem ? el('p', { cls: 'doc-problem', text: problem }) : null,
  ].filter(Boolean);
}

// ------------------------------------------------------------------ the face

function head(data) {
  const day = obj(data.day);
  const label = day ? str(day.label) : '';
  const rec = record(data.record);
  if (!label && !rec) return null;
  return el('div', { cls: 'doc-head' }, [
    label ? el('span', { cls: 'doc-day', text: label }) : null,
    rec ? el('span', { cls: 'doc-record', text: rec }) : null,
  ]);
}

/** `watch data through …` — only when the day is not yesterday, and it changes nothing else. */
function throughLine(data) {
  const day = obj(data.day);
  const through = str(data.through_label);
  if (!day || day.fresh !== false || !through) return null;
  return el('p', { cls: 'doc-through', text: `watch data through ${through}` });
}

// ----------------------------------------------------------------- the sheet

function weekSection(data) {
  const wk = obj(data.week);
  if (!wk) return null;
  const rec = record(wk);
  const lines = arr(wk.days)
    .filter((d) => obj(d) && str(d.label))
    .map((d) =>
      el('div', { cls: 'doc-week-day' }, [
        el('span', { cls: 'doc-week-label', text: str(d.label) }),
        el('span', { cls: 'doc-week-record', text: record(d) }),
      ])
    );
  if (!rec && !lines.length) return null;
  return el('div', { cls: 'doc-sec doc-sec-week' }, [
    el('h3', { cls: 'doc-sec-head', text: rec ? `Last 7 days · ${rec}` : 'Last 7 days' }),
    ...lines,
  ]);
}

function sheetBody(data) {
  return (body) => {
    const week = weekSection(data);
    if (week) body.appendChild(week);
    const rows = rowsOf(data);
    if (rows.length) body.appendChild(el('div', { cls: 'doc-sec doc-sec-rows' }, [el('div', { cls: 'doc-lines' }, rows.map((r) => statRow(r, dayOf(data), true)))]));
    const note = noteParts(data);
    if (note.length) body.appendChild(el('div', { cls: 'doc-sec doc-sec-note' }, note));
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  // Rule 8: an error tile is the shell's — its pill, its error line, its grey.
  if (tile && tile.status === 'error') return;
  const data = obj(tile && tile.data);
  if (!data || (tile && tile.status === 'empty')) {
    root.appendChild(el('p', { cls: 'doc-quiet', text: 'No watch data yet.' }));
    return;
  }

  const face = el('div', { cls: 'doc-face' }, [
    head(data),
    throughLine(data),
    el('div', { cls: 'doc-lines' }, rowsOf(data).map((r) => statRow(r, dayOf(data), false))),
    ...noteParts(data),
  ]);

  const openPanel = ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;
  if (openPanel) {
    const open = () => openPanel(TITLE, sheetBody(data));
    face.setAttribute('role', 'button');
    face.setAttribute('tabindex', '0');
    face.setAttribute('aria-label', 'Open the week from Doc');
    face.addEventListener('click', open);
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        open();
      }
    });
    face.classList.add('doc-tappable');
  }

  root.appendChild(face);
}
