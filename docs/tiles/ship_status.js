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
import { ago, ctTime, ctWeekday, usdPrecise } from '../lib/fmt.js';
import { APP_VERSION } from '../config.js';

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
  'plan',
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

/**
 * The plan meters — Matt's Claude subscription, not the engine's API bill.
 *
 * The two live one under the other on purpose and must never be added
 * together: `spend` above is dollars the engine pays per call; `plan` here is
 * the percentage of a weekly subscription allowance already used. Same tile,
 * two different currencies, so they get two different headings and the plan
 * section says whose meter it is in its own title.
 *
 * THE RULING: tone comes off `severity` and nothing else. The server owns the
 * thresholds — it knows which limit is scoped, what the allowance is, and how
 * near the edge counts as near — and the page re-deriving that from `percent`
 * would be a second opinion that drifts the day the server moves its line.
 * Same shape as `purser_due`'s tone and `cards`' days_listed: a number here is
 * a fact and a colour on it would be a judgement, so the judgement is only
 * ever the one that arrived in the payload. `percent` is printed and used for
 * a bar width; it is never compared to anything.
 */
const PLAN_TONE = { normal: 'good', warning: 'warn' };

/** severity -> tone. An unknown severity is `bad`: a limit the page cannot
 * read is not quietly a good one. */
function planTone(severity) {
  return PLAN_TONE[severity] || 'bad';
}

/** 0-100 for a CSS width. The ONLY place percent meets a number. */
function barWidth(percent) {
  const v = Number(percent);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** One limit: its label, its own figure, and the bar. */
function planRow(limit) {
  const tone = planTone(limit.severity);
  return el('div', { cls: 'ship-plan-row' }, [
    el('div', { cls: 'ship-plan-head' }, [
      el('span', { cls: 'ship-plan-label', text: String(limit.label ?? limit.kind ?? '') }),
      isNum(limit.percent)
        ? el('span', { cls: `ship-plan-pct ship-plan-${tone}`, text: `${limit.percent}%` })
        : null,
    ]),
    // The cap meter's own track and fill, reused verbatim — one idea of what
    // a meter looks like on this tile, not two.
    el('div', { cls: 'ship-meter-track' }, [
      el('div', {
        cls: `ship-meter-fill ship-meter-${tone}`,
        attrs: { style: `width:${barWidth(limit.percent).toFixed(2)}%` },
      }),
    ]),
  ]);
}

/**
 * The one line under the bars.
 *
 * Fresh, it says when the week turns over. Stale, it says how old the numbers
 * are and why they stopped — a cached percentage without its age would be a
 * live reading as far as the eye is concerned, and that is the one thing this
 * section must not do.
 */
function planNote(plan, limits) {
  if (plan.state === 'ok') {
    const at = limits.length ? limits[0].resets_at : null;
    if (!has(at)) return '';
    const day = ctWeekday(at);
    const clock = ctTime(at);
    // Not an instant this page can read — printed verbatim rather than guessed
    // at (rule 7), the same way `whenText` handles the engine's own stamp.
    if (!day || !clock) return `resets ${at}`;
    return `resets ${day} ${clock} CT`;
  }
  const note = has(plan.note) ? String(plan.note) : '';
  const age = ago(plan.fetched_at);
  if (!age) return note;
  return note ? `as of ${age} · ${note}` : `as of ${age}`;
}

/**
 * The whole section, or null when the engine has not sent one.
 *
 * Absent means absent: an older snapshot predates this field entirely, and
 * rule 9 says a module renders nothing for what it was not given rather than
 * a heading over a hole.
 */
function planSection(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const limits = Array.isArray(plan.limits)
    ? plan.limits.filter((l) => l && typeof l === 'object')
    : [];
  // Cached numbers still show — greyed, and with their age on the line below.
  // A stale meter is worth more than a blank one, as long as it never passes
  // for live.
  const stale = plan.state !== 'ok';
  const section = el('div', { cls: stale ? 'ship-plan ship-plan-stale' : 'ship-plan' });

  const title = has(plan.plan) ? `Claude · ${plan.plan}` : 'Claude';
  section.appendChild(el('h4', { cls: 'ship-heading', text: title }));

  for (const limit of limits) section.appendChild(planRow(limit));

  const note = planNote(plan, limits);
  if (note) section.appendChild(el('p', { cls: 'ship-plan-note', text: note }));

  return section;
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

  // ---- the plan ---------------------------------------------------------
  //
  // Under the spend meter, and after the spend figures rather than between
  // them: "month to date" and "all time" are dollars the engine paid, and
  // sliding a "Claude · max" heading above them would make two of the most
  // readable numbers on the tile look like they belonged to the subscription.
  const plan = planSection(d.plan);
  if (plan) el_.appendChild(plan);

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
  // The page's own build, in full. The header chip shows major.minor from the
  // same constant, so "what is my phone running" has one answer, not two.
  notes.push(`page ${APP_VERSION}`);
  el_.appendChild(el('p', { cls: 'tile-foot', text: notes.join(' · ') }));
}
