/**
 * wss_gm — 📈 WSS.
 *
 * The scorecard for the business: five graded numbers on the face, the rest
 * behind a tap, and the general manager's newest note. A script in the vault
 * computes every number once a day (`kpi.json`); the engine's `wss_gm()`
 * turns them into finished text; this module prints that text. Vault spec
 * `WSS-GM-Tile-Spec.md`, K1–K14. Read-only.
 *
 * THE FACE, top to bottom (Page rules):
 *   1. `as_of_label` and `vs plan {plan_year}` — or `vs last year` when the
 *      engine sent no plan year;
 *   2. one row per `rows[]` entry, in payload order, on Site Pulse's row grid:
 *      label · `value_text` in the big-value style, then `basis_text` faint ·
 *      `vs_text` wearing the tone off `result`;
 *   3. the note when there is one: its `label` and `kind` faint, its text.
 *
 * THE SHEET (tap the face): every `more[]` line, the `unmapped_text` line,
 * then the note again in full.
 *
 * K11 — THE ENGINE OWNS EVERY NUMBER AND EVERY TONE. `value_text`,
 * `basis_text`, `vs_text`, every `more[]` line and every label print as sent.
 * No arithmetic, no number formatting, no clock. `result` reaches a class
 * through ONE lookup, `TONE`; anything it does not know is no tone. The tone
 * sits on `vs_text` and nowhere else — the value is always the text colour.
 *
 * K13 — stale is the shell's: its amber pill, its reason line, its grey. The
 * last numbers still print here, unchanged.
 *
 * K14 — the note, `unmapped_text` and every label are untrusted strings:
 * textContent only, through `el()`. `note: null` draws nothing.
 *
 * Display only: no buttons, inputs or events (rules 5 and 6). The face is one
 * role=button div (the Ledger's pattern, so long-press-to-Explain still
 * reaches the shell) that opens the sheet.
 *
 * RULE 9: unknown keys are ignored, a missing array is an empty one, and a
 * hostile shape renders or vanishes — it never throws.
 */

import { el } from '../lib/dom.js';

const TITLE = '📈 WSS';

/** The one place a result becomes a tone. Anything else is no tone. */
const TONE = { good: 'good', warn: 'warn', bad: 'bad' };

const arr = (v) => (Array.isArray(v) ? v : []);
/** Text as sent, or '' — a number is not text (K11: the page formats nothing). */
const str = (v) => (typeof v === 'string' ? v : '');

/** A plain object, or null. An array is not one. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function tone(result) {
  return typeof result === 'string' && Object.prototype.hasOwnProperty.call(TONE, result) ? TONE[result] : null;
}

// ------------------------------------------------------------------ the head

/** `vs plan 2027` off the engine's plan year, or `vs last year`. The year is printed, never computed. */
function basisWord(data) {
  const y = data.plan_year;
  return typeof y === 'number' && Number.isInteger(y) ? `vs plan ${y}` : 'vs last year';
}

function head(data) {
  const asOf = str(data.as_of_label);
  return el('div', { cls: 'gm-head' }, [
    asOf ? el('span', { cls: 'gm-asof', text: asOf }) : null,
    el('span', { cls: 'gm-basis-word', text: basisWord(data) }),
  ]);
}

// ------------------------------------------------------------------ the rows

/** One row: label · value over basis · vs. Only `vs_text` wears a tone. */
function scoreRow(r) {
  const id = str(r.id);
  const label = str(r.label) || id;
  const value = str(r.value_text);
  const basis = str(r.basis_text);
  const vs = str(r.vs_text);
  const t = vs ? tone(r.result) : null;
  return el('div', { cls: `gm-line${id ? ` gm-line-${id}` : ''}` }, [
    el('span', { cls: 'gm-label', text: label }),
    el('span', { cls: 'gm-value', text: value }),
    el('span', { cls: 'gm-basis', text: basis }),
    el('span', { cls: 'gm-vs-cell' }, [vs ? el('span', { cls: `gm-vs${t ? ` gm-vs-${t}` : ''}`, text: vs }) : null]),
  ]);
}

function rowsOf(data) {
  return arr(data.rows).filter((r) => obj(r));
}

// ------------------------------------------------------------------ the note

/** The note's head (`label · kind`, faint) and its text — or nothing at all. */
function noteParts(data, full) {
  const n = obj(data.note);
  if (!n) return [];
  const text = str(n.text);
  const meta = [str(n.label), str(n.kind)].filter(Boolean).join(' · ');
  if (!text && !meta) return [];
  return [
    meta ? el('p', { cls: 'gm-note-meta', text: meta }) : null,
    text ? el('p', { cls: full ? 'gm-note gm-note-full' : 'gm-note', text }) : null,
  ].filter(Boolean);
}

// ----------------------------------------------------------------- the sheet

function sheetBody(data) {
  return (body) => {
    const lines = arr(data.more)
      .map((m) => (obj(m) ? str(m.text) : str(m)))
      .filter(Boolean)
      .map((t) => el('div', { cls: 'gm-more' }, [el('span', { text: t })]));
    if (lines.length) body.appendChild(el('div', { cls: 'gm-sec gm-sec-more' }, lines));
    const un = str(data.unmapped_text);
    if (un) body.appendChild(el('div', { cls: 'gm-sec gm-sec-unmapped' }, [el('p', { cls: 'gm-unmapped', text: un })]));
    const note = noteParts(data, true);
    if (note.length) body.appendChild(el('div', { cls: 'gm-sec gm-sec-note' }, note));
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  // Rule 8: an error tile is the shell's — its pill, its error line, its grey.
  if (tile && tile.status === 'error') return;
  const data = obj(tile && tile.data);
  if (!data || (tile && tile.status === 'empty')) {
    root.appendChild(el('p', { cls: 'gm-quiet', text: 'No numbers yet.' }));
    return;
  }

  const face = el('div', { cls: 'gm-face' }, [
    head(data),
    el('div', { cls: 'gm-lines' }, rowsOf(data).map(scoreRow)),
    ...noteParts(data, false),
  ]);

  const openPanel = ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;
  if (openPanel) {
    const open = () => openPanel(TITLE, sheetBody(data));
    face.setAttribute('role', 'button');
    face.setAttribute('tabindex', '0');
    face.setAttribute('aria-label', 'Open the rest of the WSS scorecard');
    face.addEventListener('click', open);
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        open();
      }
    });
    face.classList.add('gm-tappable');
  }

  root.appendChild(face);
}
