/**
 * Formatting — and the one place date handling is allowed to get clever.
 *
 * RULE 7, the disqualifying bug: business dates in the snapshot are
 * 'YYYY-MM-DD' *Central* strings. `new Date("2026-09-17")` parses as UTC
 * midnight, which renders as Sep 16 for anyone in Central. So:
 *
 *   - Date-only strings are split on '-' and rebuilt with Date.UTC, then read
 *     back with getUTC* only. That is pure calendar arithmetic; no timezone
 *     ever touches it.
 *   - Full UTC ISO *instants* (the `updated_at` / `generated_at` fields) are
 *     safe to parse, because they carry a Z. Those are formatted for display
 *     through Intl with an explicit America/Chicago timeZone.
 *
 * Never add a function here that passes a date-only string to `new Date()`.
 */

const CT = 'America/Chicago';
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const CT_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: CT,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const CT_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: CT,
  hour: 'numeric',
  minute: '2-digit',
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's Central business date as 'YYYY-MM-DD'. */
export function ctToday() {
  return CT_YMD.format(new Date());
}

/** Calendar arithmetic on a date-only string. Returns a string. */
export function addDays(ymd, n) {
  if (!YMD_RE.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  const p = (v) => String(v).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** Whole days from `from` to `to`, both 'YYYY-MM-DD'. Negative = past. */
export function daysBetween(from, to) {
  if (!YMD_RE.test(from) || !YMD_RE.test(to)) return null;
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * 'YYYY-MM-DD' -> 'Thu Sep 17'. Built from the parts, never from a parsed
 * local date. Anything that is not a date-only string is returned verbatim,
 * because rule 7 says unknown date text is rendered as-is.
 */
export function prettyDate(ymd) {
  if (!YMD_RE.test(ymd)) return String(ymd ?? '');
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${MONTHS[m - 1]} ${d}`;
}

/** 'YYYY-MM-DD' -> 'Today' / 'Tomorrow' / 'Thu Sep 17', relative to Central. */
export function dayLabel(ymd, today = ctToday()) {
  const delta = daysBetween(today, ymd);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  return prettyDate(ymd);
}

/**
 * Days-until -> the chip a due thing wears: {text, tone}, or null when there
 * is no date to count from.
 *
 * Shared by `purser_due` (which computes days from a date) and `reminders`
 * (where the engine has already counted them in Central). One definition, so
 * a card due in three days and a reminder due in three days never disagree
 * about whether that is amber.
 */
export function dueLabel(days) {
  if (days === null || days === undefined || !Number.isFinite(Number(days))) return null;
  const n = Number(days);
  if (n < 0) return { text: `${Math.abs(n)}d overdue`, tone: 'bad' };
  if (n === 0) return { text: 'due today', tone: 'bad' };
  if (n === 1) return { text: 'due tomorrow', tone: 'warn' };
  if (n <= 5) return { text: `${n}d`, tone: 'warn' };
  return { text: `${n}d`, tone: 'neutral' };
}

/** 'HH:MM' 24h Central -> '3:25 PM'. Text in, text out — never parsed. */
export function ctClock(hhmm) {
  const m = String(hhmm ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  let h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return '';
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m[2]} ${suffix}`;
}

/** A UTC ISO *instant* -> Central clock time, e.g. '9:26 AM'. */
export function ctTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return CT_CLOCK.format(new Date(t));
}

/** A UTC ISO *instant* -> 'just now' / '4m ago' / '3h ago' / '2d ago'. */
export function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * A 'YYYY-MM-DD HH:MM' Central kick time -> '3:25 PM'. The time half is
 * already Central, so it is reformatted as text — not parsed as an instant.
 */
export function ctKick(kick) {
  const m = String(kick ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(kick ?? '');
  let h = Number(m[2]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m[3]} ${suffix}`;
}

/** The date half of a 'YYYY-MM-DD HH:MM' string, or '' if there isn't one. */
export function kickDate(kick) {
  const m = String(kick ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/**
 * Coerce to a finite number, or null.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so a plain Number.isFinite guard
 * would render a missing amount as a confident "$0.00". A missing number must
 * read as unknown, never as zero — this is money on the screen.
 */
function num(n) {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** 2 -> '2u', 1.5 -> '1.5u'. Display only — money never moves from here. */
export function units(n) {
  const v = num(n);
  if (v === null) return '—';
  return `${Number.isInteger(v) ? v : v.toFixed(1)}u`;
}

/** American odds: -110 stays, 135 becomes '+135'. */
export function odds(n) {
  const v = num(n);
  if (v === null) return '';
  return v > 0 ? `+${v}` : String(v);
}

/** Display-only dollars. */
export function usd(n) {
  const v = num(n);
  if (v === null) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Display-only dollars, down to the fraction of a cent.
 *
 * `usd()` is right for a credit-card bill and wrong for an API meter: one
 * `/ask` call costs about half a cent, and rounding it to $0.00 would tell
 * Matt his spend tile is broken. Below a cent this keeps four decimals, and
 * an amount too small even for that says so rather than rendering as zero.
 */
export function usdPrecise(n) {
  const v = num(n);
  if (v === null) return '—';
  if (v !== 0 && Math.abs(v) < 0.01) {
    const four = v.toFixed(4);
    if (Number(four) === 0) return v > 0 ? '< $0.0001' : '> -$0.0001';
    return `${v < 0 ? '-' : ''}$${Math.abs(Number(four)).toFixed(4)}`;
  }
  return usd(v);
}

/** A signed line: -3.5 stays, 3.5 becomes '+3.5'. */
export function line(n) {
  const v = num(n);
  if (v === null) return '';
  return v > 0 ? `+${v}` : String(v);
}
