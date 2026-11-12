/**
 * wss_ap — Vendor Bills.
 *
 * The vendor bills the WSS fleet engine created in QuickBooks, the invoices it
 * is holding and why, and anything that landed and was never billed. Vault
 * spec `AP-Bills-Tile-Spec.md`, AP1–AP12. Read-only.
 *
 * THE FACE (AP2–AP4) is rows, Site Pulse's rhythm:
 *   - the headline is the LAST DAY THE ENGINE BILLED ANYTHING before today
 *     (`last_day`), wearing its own date — never calendar-yesterday, so
 *     Friday's bills are still the headline on Monday morning;
 *   - `Today · {count} · {total}` when today has bills;
 *   - `{n} held` in the warn tone;
 *   - `{n} not billed` — the bad tone when any row is `stuck` (AP7: more than
 *     24 h since it landed, which is the bill pass's whole alarm), neutral
 *     and "waiting for the next run" otherwise.
 *   A zero stays quiet: `status: "empty"` is one faint line and nothing else,
 *   and the card does not grey for it (`greys()` is for error/stale only).
 *
 * THE SHEET (AP5), tap the face: Held → Not billed → one section per bill day
 * (newest first, as sent). A section with no rows is not drawn.
 *
 * AP9 — MONEY IS DISPLAY-ONLY AND THE PAGE DOES NO ARITHMETIC ON IT. Every
 * count and every total comes from the producer and is printed through the
 * same `usd()` the Purser uses. A total that is not a finite number prints
 * NOTHING — never "$0.00", never a dash that reads like a figure. The only
 * addition in this file is `{n} held` = the listed rows plus `held_older`,
 * which counts rows, not dollars.
 *
 * NOTHING HERE ACTS (rules 5 and 6): no buttons, no inputs, no proposals
 * filed. The one way out is a plain anchor to the bill in QuickBooks, vetted
 * by `safeUrl()`; anything that is not http(s) gets no anchor at all.
 *
 * RULE 7: every date on the tile is a `*_label` string the engine formatted
 * in Central. This module parses no date and reads no clock.
 *
 * RULE 10: vendor, invoice, `why`, `description` and `note` are untrusted and
 * land through `el()` as textContent. AP6 waives H9 here: names print as the
 * ledger has them.
 *
 * RULE 9 / AP12: an unknown key on a row is ignored, a missing array is an
 * empty one, and a hostile shape renders or vanishes — it never throws.
 */

import { el, extLink, safeUrl } from '../lib/dom.js';
import { usd } from '../lib/fmt.js';

const TITLE = '🧾 Vendor Bills';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** A plain object, or null. An array is not one. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
const rows = (v) => arr(v).filter((r) => obj(r));

/** A count the payload carries: a non-negative integer, or null. */
function count(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Money as given, through the Purser's formatter — or '' for anything that is not a finite number. */
function money(v) {
  return typeof v === 'number' && Number.isFinite(v) ? usd(v) : '';
}

const bills = (n) => (n === 1 ? '1 bill' : `${n} bills`);

// ------------------------------------------------------------------ the face

/** `Thu 11/12 · 3 bills · $778.22` — the label and count small, the total in the big-value style. */
function headline(last) {
  const o = obj(last);
  const label = o ? str(o.label) : '';
  if (!label) return null;
  const n = count(o.count);
  const total = money(o.total);
  return el('div', { cls: 'ap-head' }, [
    el('span', { cls: 'ap-head-label', text: n === null ? label : `${label} · ${bills(n)}` }),
    total ? el('span', { cls: 'ap-head-total', text: total }) : null,
  ]);
}

/** One face row: dot · lead · rest. `mark` names the tone hook (held / stuck), or none. */
function line(key, mark, lead, rest, note) {
  return el('div', { cls: `ap-line ap-line-${key}` }, [
    el('span', { cls: `ap-dot${mark ? ` ap-dot-${mark}` : ''}`, attrs: { 'aria-hidden': 'true' } }),
    el('span', { cls: `ap-lead${mark ? ` ap-num-${mark}` : ''}`, text: lead }),
    el('span', { cls: 'ap-rest', text: rest }),
    note ? el('span', { cls: 'ap-line-note', text: note }) : null,
  ]);
}

function faceRows(data) {
  const out = [];
  const today = obj(data.today_so_far);
  const tn = today ? count(today.count) : null;
  if (tn !== null && tn > 0) {
    const total = money(today.total);
    out.push(line('today', null, 'Today', total ? `${tn} · ${total}` : String(tn)));
  }

  const held = rows(data.held).length + (count(data.held_older) || 0);
  if (held > 0) out.push(line('held', 'held', String(held), 'held'));

  const unbilled = rows(data.unbilled);
  if (unbilled.length) {
    const stuck = unbilled.some((u) => u.stuck === true);
    out.push(
      line('unbilled', stuck ? 'stuck' : null, String(unbilled.length), 'not billed', stuck ? null : 'waiting for the next run')
    );
  }
  return out;
}

// ----------------------------------------------------------------- the sheet

/** vendor · invoice … total, the first line of every sheet row. */
function mainLine(o) {
  const total = money(o.total);
  return el('div', { cls: 'ap-row-main' }, [
    el('span', { cls: 'ap-vendor', text: str(o.vendor) || '—' }),
    str(o.invoice) ? el('span', { cls: 'ap-inv', text: str(o.invoice) }) : null,
    total ? el('span', { cls: 'ap-amt', text: total }) : null,
  ]);
}

function section(key, head, kids) {
  return el('div', { cls: `ap-sec ap-sec-${key}` }, [el('h3', { cls: 'ap-sec-head', text: head }), ...kids]);
}

function heldSection(data) {
  const list = rows(data.held);
  const older = count(data.held_older) || 0;
  if (!list.length && !older) return null;
  const kids = list.map((h) =>
    el('div', { cls: 'ap-row ap-row-held' }, [
      el('span', { cls: 'ap-dot ap-dot-held', attrs: { 'aria-hidden': 'true' } }),
      el('div', { cls: 'ap-row-body' }, [
        mainLine(h),
        str(h.why) ? el('div', { cls: 'ap-why', text: str(h.why) }) : null,
        str(h.since_label) ? el('div', { cls: 'ap-faint', text: `since ${str(h.since_label)}` }) : null,
      ]),
    ])
  );
  if (older) kids.push(el('p', { cls: 'ap-faint ap-older', text: `${older} held more than 30 days` }));
  return section('held', 'Held', kids);
}

function unbilledSection(data) {
  const list = rows(data.unbilled);
  if (!list.length) return null;
  return section(
    'unbilled',
    'Not billed',
    list.map((u) => {
      const second = [str(u.why), str(u.landed_label) ? `landed ${str(u.landed_label)}` : ''].filter(Boolean).join(' · ');
      return el('div', { cls: 'ap-row ap-row-unbilled' }, [
        el('span', { cls: `ap-dot${u.stuck === true ? ' ap-dot-stuck' : ''}`, attrs: { 'aria-hidden': 'true' } }),
        el('div', { cls: 'ap-row-body' }, [mainLine(u), second ? el('div', { cls: 'ap-why', text: second }) : null]),
      ]);
    })
  );
}

function billRow(b) {
  const meta = [
    str(b.gl),
    str(b.description),
    str(b.inv_label) ? `inv ${str(b.inv_label)}` : '',
    str(b.due_label) ? `due ${str(b.due_label)}` : '',
  ].filter(Boolean);
  const href = safeUrl(b.qbo_url);
  const marks = [
    b.state === 'adopted' ? el('span', { cls: 'ap-chip', text: 'already in QuickBooks' }) : null,
    href ? extLink(href, 'QuickBooks', 'ap-link') : null,
  ].filter(Boolean);
  return el('div', { cls: 'ap-row ap-row-bill' }, [
    el('span', { cls: 'ap-dot', attrs: { 'aria-hidden': 'true' } }),
    el('div', { cls: 'ap-row-body' }, [
      mainLine(b),
      meta.length ? el('div', { cls: 'ap-meta', text: meta.join(' · ') }) : null,
      str(b.note) ? el('div', { cls: 'ap-faint', text: str(b.note) }) : null,
      marks.length ? el('div', { cls: 'ap-marks' }, marks) : null,
    ]),
  ]);
}

function daySection(day) {
  const label = str(day.label);
  const list = rows(day.bills);
  if (!label && !list.length) return null;
  const n = count(day.count);
  const head = [label, n === null ? '' : bills(n), money(day.total)].filter(Boolean).join(' · ');
  return section('day', head, list.map(billRow));
}

function sheetBody(data) {
  return (body) => {
    const parts = [heldSection(data), unbilledSection(data), ...rows(data.days).map(daySection)].filter(Boolean);
    for (const p of parts) body.appendChild(p);
  };
}

// ---------------------------------------------------------------------- tile

/** The shell's grey, for a tile that has gone wrong — and never for a quiet day (AP4). */
export function greys(tile) {
  return !!tile && (tile.status === 'error' || tile.status === 'stale');
}

export function render(root, tile, ctx) {
  // Rule 8: an error tile is the shell's — its pill, its error line, its grey.
  if (tile && tile.status === 'error') return;
  const data = obj(tile && tile.data) || {};

  if (data.status === 'empty') {
    root.appendChild(el('p', { cls: 'ap-quiet', text: 'Nothing to review.' }));
    return;
  }

  const face = el('div', { cls: 'ap-face' });
  const head = headline(data.last_day);
  if (head) face.appendChild(head);
  const lines = faceRows(data);
  if (lines.length) face.appendChild(el('div', { cls: 'ap-lines' }, lines));

  const openPanel = ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;
  if (openPanel) {
    // A role=button div, not a <button>: a button would swallow the shell's
    // long-press-to-Explain, which every tile owes (the Ledger's pattern).
    const open = () => openPanel(TITLE, sheetBody(data));
    face.setAttribute('role', 'button');
    face.setAttribute('tabindex', '0');
    face.setAttribute('aria-label', 'Open the vendor bills breakdown');
    face.addEventListener('click', open);
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        open();
      }
    });
    face.classList.add('ap-tappable');
  }

  root.appendChild(face);
}
