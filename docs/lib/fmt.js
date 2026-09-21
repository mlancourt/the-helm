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

/**
 * A UTC ISO *instant* -> the Central business date it fell on, 'YYYY-MM-DD'.
 *
 * The bridge between the two kinds of time in this codebase: it lets an
 * instant (a `lastOpened` stamp, an `updated_at`) be compared against a
 * date-only business string without either one being parsed wrong. Rule 7
 * holds — the date-only side is never handed to `new Date()`; the instant
 * side is, because it carries a Z.
 */
export function ctDate(iso) {
  // A date-only string PARSES — as UTC midnight — and would come back out a
  // day earlier for anyone in Central. That is rule 7's exact trap, so this
  // refuses one outright rather than quietly answering yesterday.
  if (YMD_RE.test(iso)) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return CT_YMD.format(new Date(t));
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
 * `reminders` wears this, and so does anything else whose urgency genuinely
 * rises as the date closes. One definition, so two such tiles never disagree
 * about whether three days out is amber.
 *
 * `purser_due` used to share it and no longer does — see `daysOutText` below
 * for why a bill's days count is deliberately colourless.
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

/**
 * 'YYYY-MM-DD' -> '9/24'. Month and day, no year, no weekday.
 *
 * `prettyDate` is the same string in a wider column — 'Thu Sep 24' — and it is
 * right where a date is the row's subject. On the Purser's rows the date is a
 * detail beside a chip and an amount, so it wants to be three characters wide
 * and nothing more.
 *
 * Built from the parts like everything else here (rule 7): the string is split
 * on '-' and the numbers are printed. Nothing is parsed, so nothing can come
 * back a day early. Anything that is not a date-only string is returned
 * verbatim, because rule 7 says unknown date text is rendered as-is.
 */
export function shortDate(ymd) {
  if (!YMD_RE.test(ymd)) return String(ymd ?? '');
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}`;
}

/**
 * A days-out integer -> 'today' / 'tomorrow' / 'in 9 days'. TEXT ONLY.
 *
 * DELIBERATELY NOT `dueLabel`, and the difference is the whole point.
 * `dueLabel` returns `{text, tone}` — its job is to decide that three days out
 * is amber — and that is exactly what the Purser's tile is forbidden to do:
 * on The Due Stack colour carries what a line asks OF MATT (manual or
 * autopay), never how soon it asks. A days count there is information; a
 * colour on it would be an opinion. So this returns a bare string, there is no
 * tone to reach for, and a future edit cannot accidentally paint one.
 *
 * `reminders` and the card rows keep `dueLabel` unchanged — those tiles DO
 * escalate by proximity, and they should keep saying so.
 *
 * The count comes from the engine, computed in Central. Nothing here counts
 * days, parses a date, or reads a clock.
 */
export function daysOutText(days) {
  if (days === null || days === undefined || days === '' || !Number.isFinite(Number(days))) return '';
  const n = Math.trunc(Number(days));
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  // A date already behind us is stated, not flagged. It means the engine's
  // window and the statement ledger disagree, which is worth reading — but it
  // is still a fact about a date, so it gets the same plain voice.
  if (n < 0) return `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} ago`;
  return `in ${n} days`;
}

/**
 * The same chip, in entertainment's voice: 'airs today' / 'tomorrow' / 'in 6d'.
 *
 * Tone for tone identical to `dueLabel` — today red, the next few days amber,
 * the rest neutral — because a thing three days out should look the same
 * urgency wherever it appears on the board. Only the WORDS differ: "due" is a
 * bill's word, and an episode is not owed. `dueLabel` is left exactly as it
 * was, because Purser and Reminders are talking about obligations and should
 * keep saying so.
 *
 * A date already past is still flagged rather than shrugged off: for a `next`
 * episode it means the schedule the engine is holding has gone stale, and that
 * is worth seeing.
 */
export function airLabel(days) {
  if (days === null || days === undefined || !Number.isFinite(Number(days))) return null;
  const n = Number(days);
  if (n < 0) return { text: `aired ${Math.abs(n)}d ago`, tone: 'bad' };
  if (n === 0) return { text: 'airs today', tone: 'bad' };
  if (n === 1) return { text: 'tomorrow', tone: 'warn' };
  if (n <= 5) return { text: `in ${n}d`, tone: 'warn' };
  return { text: `in ${n}d`, tone: 'neutral' };
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

/**
 * 0.62 -> '0.62u'. Two decimals, always.
 *
 * `units()` rounds to one — right for a bankroll, wrong for a ticket. The
 * Bookie's `to_win_u` is a two-decimal number off a logged price (0.5u at +125
 * is 0.62u), and rounding that to "0.6u" on the board would quietly disagree
 * with the Bet-Log Matt is reading it against. A push must read `0.00u` and
 * not `0u`, for the same reason: it is a figure, not an absence.
 */
export function exactUnits(n) {
  const v = num(n);
  if (v === null) return '—';
  return `${v.toFixed(2)}u`;
}

/**
 * The same figure, signed: '+0.62u' / '\u22120.50u' / '0.00u'.
 *
 * The minus is U+2212, not a hyphen — beside a '+' at 11px a hyphen reads as a
 * dash rather than a sign. Zero carries no sign at all: a push has no
 * direction, and "+0.00u" would imply one.
 */
export function signedUnits(n) {
  const v = num(n);
  if (v === null) return '—';
  if (v === 0) return '0.00u';
  return `${v > 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(2)}u`;
}

/**
 * A Central kick string -> a sortable number. Never rendered.
 *
 * Kick times arrive in two spellings — the engine writes '2026-09-18 6:05 PM'
 * and the mock writes '2026-09-18 15:25' — and sorting either one as TEXT puts
 * 6:05 PM before 7:30 AM. So the parts are read out with a regex and counted
 * on a flat calendar with Date.UTC, which is arithmetic and not a timezone
 * conversion: nothing here is handed `new Date(string)` (rule 7). A string
 * that is not a kick time sorts last rather than sorting randomly.
 */
export function kickKey(kick) {
  const m = String(kick ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*([AaPp])?/);
  if (!m) return Infinity;
  let h = Number(m[4]);
  const half = m[6];
  if (half) {
    const pm = /p/i.test(half);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || Number(m[5]) > 59) return Infinity;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, Number(m[5]));
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

/**
 * Milliseconds from now until a UTC ISO *instant*. Negative = already past,
 * null = it is not an instant this page can read.
 *
 * RULE 7, SATISFIED RATHER THAN BENT. The rule forbids parsing a date-only or
 * wall-clock string because such a string carries no offset, so the browser
 * has to guess a zone and guesses the phone's. `ends_utc` carries the offset,
 * so there is nothing left to guess: `Date.parse` on it is exact in every
 * timezone, which is precisely why the engine started publishing it. The
 * wall-clock twin (`ends_ct`) is still text and is still printed verbatim —
 * it must never reach this function.
 *
 * `now` is injectable so a countdown can be tested against a fixed clock.
 */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

export function msUntil(iso, now = Date.now()) {
  // The guard, and the whole reason this is safe. `Date.parse` is perfectly
  // happy to read '2026-09-20T19:48' — it reads it as LOCAL time, silently,
  // and is wrong by five hours on Matt's phone and by fourteen on a plane.
  // So a string that carries no offset never gets parsed here at all: it
  // comes back null, and the caller falls back to printing the wall stamp.
  // Hand this function `ends_ct` by mistake and you get no countdown, which
  // is the correct answer — never a confidently wrong one.
  if (!INSTANT_RE.test(String(iso ?? ''))) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return t - Number(now);
}

const MINUTE_MS = 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/**
 * Milliseconds remaining -> the countdown an auction row wears.
 *
 *   > 24h     '2d 4h'
 *   1h–24h    '3h 07m'
 *   15m–1h    '42m'
 *   < 15m     '12m 30s'
 *   <= 0      'ended'
 *
 * The seconds appear in exactly one window, and that is the whole design: a
 * ticking second on a lot that closes on Thursday is noise, and a lot closing
 * in nine minutes is the only moment on this page where a second is a fact
 * Matt can act on. Everything above it floors — a countdown that rounded up
 * would say '1h 00m' with fifty-nine minutes left.
 *
 * `ended` rather than a negative number, and never a blank: a row that has
 * run out has not gone missing, it has finished, and it stays on the board
 * until the engine's next pass takes it away.
 */
export function countdown(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return 'ended';
  if (v > DAY_MS) {
    const d = Math.floor(v / DAY_MS);
    return `${d}d ${Math.floor((v - d * DAY_MS) / HOUR_MS)}h`;
  }
  if (v >= HOUR_MS) {
    const h = Math.floor(v / HOUR_MS);
    const m = Math.floor((v - h * HOUR_MS) / MINUTE_MS);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  const m = Math.floor(v / MINUTE_MS);
  if (v >= 15 * MINUTE_MS) return `${m}m`;
  const s = Math.floor((v - m * MINUTE_MS) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * A UTC ISO *instant* -> the tiny age chip a headline wears:
 * 'now' / '12m' / '3h' / 'yesterday' / 'Tue' / '9/12'.
 *
 * `ago()` is the same idea in the footer's voice — "4m ago", a sentence
 * fragment. That is right under a tile and wrong beside a headline, where the
 * chip sits in a metadata row next to a source name and has to stay two or
 * three characters wide. So: a number while the story is hours old, a day name
 * while it is still in the week, and a bare date once it is older than that.
 *
 * Rule 7 holds on both halves. `published_at` is an instant carrying a Z, so
 * parsing it is safe; the day-level rungs come from `ctDate()`, which converts
 * the instant to a Central business date *string*, and from calendar
 * arithmetic on those strings. No date-only value is ever handed to
 * `new Date()`.
 *
 * `now` is injectable so the rungs can be tested against a fixed clock.
 * Anything unparseable returns '' — the caller renders no chip rather than a
 * broken one.
 */
export function ageChip(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';

  // A stamp in the future is clock skew between the engine and the phone, not
  // a story from tomorrow. It reads as brand new, which is what it is.
  const secs = Math.round((now - t) / 1000);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;

  const then = ctDate(iso);
  const here = ctDate(new Date(now).toISOString());
  const delta = daysBetween(then, here);
  if (delta === null) return '';
  // Past 24h the calendar takes over. `<= 1` rather than `=== 1` because the
  // hour Central wall time shifts can put a 24-hour-old story on the same
  // nominal delta; either way it is yesterday's paper.
  if (delta <= 1) return 'yesterday';
  if (delta < 7) {
    const [y, m, d] = then.split('-').map(Number);
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }
  const [, m, d] = then.split('-').map(Number);
  return `${m}/${d}`;
}
