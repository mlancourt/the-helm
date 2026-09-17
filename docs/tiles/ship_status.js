/**
 * ship_status — is the machinery running, and what has it spent?
 *
 * Every field here is the engine reporting on itself: when it last ran, whether
 * today's log got written, how far the drift audit has slipped, what the Worker
 * is holding, and the spend ledger behind `/ask`.
 *
 * Two rules do most of the work in this file:
 *
 *   6  money never moves from here. Every figure below is display-only. There
 *      is no top-up, no cap edit, no "reset today" button — the cap lives in a
 *      Worker secret and the ledger lives in the vault.
 *   9  the payload is the engine's to grow. Nothing here is required: a field
 *      the engine has not sent yet is skipped, not rendered as a zero or an
 *      "Invalid Date". A field it adds later shows up in the extras row rather
 *      than being silently dropped.
 *
 * `kill_switch` is a runbook line, not a control. It is printed so Matt can
 * read it off his phone and type it somewhere else — this page will never be
 * the thing that stops the engine.
 */

import { el, empty, pill, row } from '../lib/dom.js';
import { ago, ctTime, usdPrecise } from '../lib/fmt.js';

/** Fields this module renders itself. Anything else lands in "also reported". */
const KNOWN = new Set([
  'captains_log_today',
  'captains_log_file',
  'helm_last_run',
  'drift_audit_updated',
  'ask_today_usd',
  'ask_cap_usd',
  'pending_count',
  'worker_published_at',
  'spend',
  'kill_switch',
]);

const has = (v) => v !== null && v !== undefined && v !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A UTC instant as "4m ago · 11:29 AM CT", or the raw string if it is not one. */
function whenText(value) {
  const rel = ago(value);
  const clock = ctTime(value);
  if (rel && clock) return `${rel} · ${clock} CT`;
  // Not a parseable instant — the engine sends `helm_last_run` in its own
  // shape, so it is printed verbatim rather than guessed at (rule 7: never
  // hand a date-ish string to new Date() and hope).
  return String(value);
}

/** How stale is stale. Hours, from a UTC instant; null if it is not one. */
function hoursSince(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function freshnessTone(iso, warnHours, badHours) {
  const h = hoursSince(iso);
  if (h === null) return 'neutral';
  if (h >= badHours) return 'bad';
  if (h >= warnHours) return 'warn';
  return 'good';
}

/**
 * The cap meter. A bar is worth more than a number here: the useful question
 * is "how much of today is left", not "what is 0.0048 divided by 3".
 */
function capMeter(spent, cap) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'good';
  return el('div', { cls: 'ship-meter' }, [
    el('div', { cls: 'ship-meter-track' }, [
      // An arrived-at-zero bar still shows a sliver, so the meter never looks
      // broken on a quiet morning.
      el('div', {
        cls: `ship-meter-fill ship-meter-${tone}`,
        attrs: { style: `width:${Math.max(pct, 1.5).toFixed(2)}%` },
      }),
    ]),
    el('div', { cls: 'ship-meter-label' }, [
      el('span', { cls: 'ship-meter-spent', text: usdPrecise(spent) }),
      el('span', { cls: 'ship-meter-cap', text: ` of ${usdPrecise(cap)} today` }),
    ]),
  ]);
}

function serviceRows(byService) {
  if (!byService || typeof byService !== 'object') return [];
  return Object.entries(byService)
    .filter(([, v]) => isNum(v))
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => row(name, usdPrecise(v), 'ship-service'));
}

export function render(el_, tile) {
  const d = tile.data;
  if (!d || typeof d !== 'object' || !Object.keys(d).length) {
    el_.appendChild(empty('No status reported.'));
    return;
  }

  // ---- the engine ------------------------------------------------------
  const engine = el('div', { cls: 'ship-block' });

  if (has(d.helm_last_run)) {
    // The engine stamps this in its own format and it runs long. Stacked, so a
    // 40-character run id never squeezes its own label onto two lines.
    engine.appendChild(
      el('div', { cls: 'ship-stack' }, [
        el('span', { cls: 'row-label', text: 'engine last run' }),
        el('span', { cls: 'ship-stack-value', text: whenText(d.helm_last_run) }),
      ])
    );
  }

  if (typeof d.captains_log_today === 'boolean') {
    const logRow = el('div', { cls: 'row ship-row' }, [
      el('span', { cls: 'row-label', text: "captain's log" }),
      el('span', { cls: 'row-value ship-value' }, [
        d.captains_log_today ? pill('written today', 'good') : pill('not yet today', 'warn'),
        has(d.captains_log_file) ? el('span', { cls: 'ship-file', text: String(d.captains_log_file) }) : null,
      ]),
    ]);
    engine.appendChild(logRow);
  }

  if (has(d.drift_audit_updated)) {
    // A drift audit is a daily job: a day old is fine, two days is a nudge,
    // three is a problem worth seeing from across the room.
    engine.appendChild(
      el('div', { cls: 'row ship-row' }, [
        el('span', { cls: 'row-label', text: 'drift audit' }),
        el('span', { cls: 'row-value ship-value' }, [
          pill(ago(d.drift_audit_updated) || 'unknown', freshnessTone(d.drift_audit_updated, 48, 72)),
        ]),
      ])
    );
  }

  if (engine.childNodes.length) el_.appendChild(engine);

  // ---- the worker ------------------------------------------------------
  const worker = el('div', { cls: 'ship-block' });

  if (has(d.worker_published_at)) {
    worker.appendChild(
      el('div', { cls: 'row ship-row' }, [
        el('span', { cls: 'row-label', text: 'snapshot published' }),
        el('span', { cls: 'row-value ship-value' }, [
          pill(ago(d.worker_published_at) || 'unknown', freshnessTone(d.worker_published_at, 3, 12)),
          el('span', { cls: 'ship-file', text: `${ctTime(d.worker_published_at)} CT` }),
        ]),
      ])
    );
  }

  if (isNum(d.pending_count)) {
    worker.appendChild(
      el('div', { cls: 'row ship-row' }, [
        el('span', { cls: 'row-label', text: 'pending writes' }),
        el('span', { cls: 'row-value ship-value' }, [
          d.pending_count > 0
            ? pill(`${d.pending_count} awaiting the engine`, 'pending')
            : el('span', { cls: 'ship-quiet', text: 'none — the engine is current' }),
        ]),
      ])
    );
  }

  if (worker.childNodes.length) el_.appendChild(worker);

  // ---- spend -----------------------------------------------------------
  const spend = d.spend && typeof d.spend === 'object' ? d.spend : {};
  // The tile carries the day's numbers twice over; prefer the ledger's own.
  const today = isNum(spend.today_usd) ? spend.today_usd : d.ask_today_usd;
  const cap = isNum(spend.ask_cap_usd) ? spend.ask_cap_usd : d.ask_cap_usd;

  if (isNum(today) && isNum(cap)) {
    el_.appendChild(el('h4', { cls: 'ship-heading', text: 'Spend' }));
    el_.appendChild(capMeter(today, cap));
  }

  const totals = el('div', { cls: 'ship-block' });
  if (isNum(spend.month_to_date_usd)) totals.appendChild(row('month to date', usdPrecise(spend.month_to_date_usd)));
  if (isNum(spend.all_time_usd)) totals.appendChild(row('all time', usdPrecise(spend.all_time_usd)));
  if (totals.childNodes.length) el_.appendChild(totals);

  const byToday = serviceRows(spend.today_by_service);
  if (byToday.length) {
    el_.appendChild(el('h4', { cls: 'ship-heading', text: 'Today by service' }));
    el_.appendChild(el('div', { cls: 'ship-block', }, byToday));
  }

  const byAll = serviceRows(spend.all_time_by_service);
  if (byAll.length) {
    el_.appendChild(el('h4', { cls: 'ship-heading', text: 'All time by service' }));
    el_.appendChild(el('div', { cls: 'ship-block' }, byAll));
  }

  // ---- anything the engine added since this module was written ---------
  const extras = Object.keys(d).filter((k) => !KNOWN.has(k));
  if (extras.length) {
    el_.appendChild(el('h4', { cls: 'ship-heading', text: 'Also reported' }));
    el_.appendChild(
      el(
        'div',
        { cls: 'ship-block' },
        extras.map((k) =>
          row(k, typeof d[k] === 'object' && d[k] !== null ? JSON.stringify(d[k]) : String(d[k]))
        )
      )
    );
  }

  // ---- provenance and the kill switch ----------------------------------
  if (has(d.kill_switch)) {
    el_.appendChild(
      el('div', { cls: 'ship-kill' }, [
        el('span', { cls: 'ship-kill-label', text: 'kill switch' }),
        // Printed to be read and typed elsewhere. This page does not run it.
        el('code', { cls: 'ship-kill-cmd', text: String(d.kill_switch) }),
      ])
    );
  }

  const notes = [];
  if (has(spend.basis)) notes.push(String(spend.basis));
  if (has(spend.ledger)) notes.push(`ledger: ${spend.ledger}`);
  notes.push('Display only. Nothing here moves money or stops the engine.');
  el_.appendChild(el('p', { cls: 'tile-foot', text: notes.join(' · ') }));
}
