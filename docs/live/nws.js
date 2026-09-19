/**
 * NWS fetch + normalize — the weather tile's half of the LIVE band.
 *
 * The sibling of live/espn.js, and it exists for the same reason: the page
 * fetches its own live data so the engine never becomes the freshness
 * bottleneck (Weather spec, W2). The engine publishes CONFIGURATION — which
 * gridpoint, which station, which radar site, which glyphs — plus one offline
 * `fallback` copy. Everything on the face when the network is up comes from
 * here.
 *
 * RULE 4, amended 2026-09-19 (W3). Two new origins and only two:
 *   api.weather.gov    fetch — alerts, forecast, hourly, observations.
 *                      No key. NO CUSTOM HEADER: a header would make the
 *                      request non-simple and trigger a CORS preflight the NWS
 *                      is under no obligation to answer. (The engine's Python
 *                      client DOES need a User-Agent. The browser does not.
 *                      Do not "fix" this file by adding one.)
 *   radar.weather.gov  <img> only, never fetched. Which is why there is no map
 *                      library here and never needs to be: JS cannot read those
 *                      pixels, so the only honest thing to do with RIDGE's
 *                      pre-rendered loop is display it.
 *
 * Verified live from https://mlancourt.github.io on 2026-09-19. The four
 * things that bite, all of them observed rather than read in a doc:
 *
 *   1. `observations/latest` returns 200 and is still useless — an hour old,
 *      `textDescription: ""`, `icon: null`. Hence OBS_MAX_AGE_MS and W7: an
 *      observation that fails either test is not "now", and the hourly
 *      forecast takes over with a label that says so.
 *   2. Observations are METRIC (degC, km/h) while the forecast is already °F.
 *      One conversion helper each, used nowhere else.
 *   3. `hourly.periods[0]` is not reliably the current hour. Select by
 *      startTime <= now < endTime.
 *   4. The icon URL carries a dual form — `.../day/tsra,90/tsra,80` — and the
 *      second token is the night half. Only the first one is read.
 *
 * Nothing here renders. It returns facts in the same shapes the engine's
 * `fallback` uses, so the live path and the offline path meet the same tile
 * code (W11).
 */

import { safeUrl } from '../lib/dom.js';
import { ctDate, ctTime, ctToday, prettyDate } from '../lib/fmt.js';

const FETCH_TIMEOUT_MS = 12000;

/**
 * How old an observation may be before it stops being "now" (W7). 75 minutes,
 * because KUES reports hourly at :45 and a report that has not landed by the
 * next :45 is not late, it is missing.
 */
export const OBS_MAX_AGE_MS = 75 * 60 * 1000;

const str = (v) => (v === null || v === undefined ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** A finite number, or null. Never 0 for a missing value — see lib/fmt.js. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------- units

/** Celsius -> Fahrenheit. The only place this conversion is allowed (W7). */
export function cToF(c) {
  const v = num(c);
  return v === null ? null : Math.round((v * 9) / 5 + 32);
}

/** km/h -> mph. Likewise. */
export function kphToMph(k) {
  const v = num(k);
  return v === null ? null : Math.round(v * 0.621371);
}

/**
 * A value + its wmoUnit code -> °F.
 *
 * The NWS tags every quantity with a unit, and the same field is degC in an
 * observation and degF in a forecast period. Reading the tag rather than
 * assuming is four lines and removes a whole class of "it was 16 degrees"
 * bugs.
 */
export function toF(value, unitCode) {
  const v = num(value);
  if (v === null) return null;
  return /degC/i.test(str(unitCode)) ? cToF(v) : Math.round(v);
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Degrees -> a compass point, or '' when there is no bearing to name. */
export function compass(deg) {
  const v = num(deg);
  if (v === null) return '';
  return COMPASS[Math.round((((v % 360) + 360) % 360) / 22.5) % 16];
}

// ------------------------------------------------------------------ glyphs

/**
 * An NWS icon URL -> its condition token (W9).
 *
 *   .../icons/land/day/tsra,90?size=medium        -> 'tsra'
 *   .../icons/land/day/tsra,90/tsra,80?size=...   -> 'tsra'   (dual form)
 *   .../icons/land/night/bkn                      -> 'bkn'
 *
 * The token is mapped through the payload's `glyphs` rather than rendering the
 * 50x50 PNG the URL points at — that PNG would be a third image origin for
 * nothing, and a glyph works offline.
 */
export function glyphToken(icon) {
  const s = str(icon).split('?')[0];
  if (!s) return '';
  const parts = s.split('/').filter(Boolean);
  const at = parts.findIndex((p) => p === 'day' || p === 'night');
  // The first segment after day/night. In the dual form the SECOND one is the
  // other half of the day, and reading it would put tonight's sky on today's
  // row.
  const seg = at !== -1 ? parts[at + 1] : '';
  const token = str(seg).split(',')[0].trim().toLowerCase();
  return /^[a-z_]+$/.test(token) ? token : '';
}

/**
 * token -> the emoji the vault picked, or '•'.
 *
 * An unknown token is not an error: the NWS adds tokens, and W9 says the
 * `shortForecast` text beside the dot carries the meaning until the vault maps
 * it. Nothing here invents a glyph.
 */
export function glyph(token, glyphs) {
  const g = obj(glyphs);
  const t = str(token);
  return (t && str(g[t])) || '•';
}

// ------------------------------------------------------------------ alerts

/**
 * Which of the three tiers an alert belongs to (W6).
 *
 * `warn_events[]` is the authority for the loud tier, because "Warning" in the
 * event name is not the same thing as "this changes what Matt does today" —
 * the vault decides which ones paint the board. Everything else that says
 * Watch is amber; everything remaining is a grey line.
 */
export function alertTier(event, warnEvents) {
  const name = str(event).trim();
  if (!name) return 'advisory';
  if (arr(warnEvents).some((w) => str(w).trim().toLowerCase() === name.toLowerCase())) return 'warn';
  return /\bwatch\b/i.test(name) ? 'watch' : 'advisory';
}

const TIER_RANK = { warn: 0, watch: 1, advisory: 2 };

/**
 * An /alerts/active GeoJSON document -> the tile's alert rows, muted entries
 * dropped and loudest first.
 *
 * RULE 10 is not enforced here — every string comes out raw and lands via
 * textContent in the tile. Government text is still untrusted content, and
 * these descriptions genuinely arrive with hard line breaks and a bare URL
 * inside them.
 */
export function normalizeAlerts(json, { warnEvents = [], mute = [] } = {}) {
  const muted = new Set(arr(mute).map((m) => str(m).trim().toLowerCase()));
  const out = [];

  for (const feature of arr(obj(json).features)) {
    const p = obj(obj(feature).properties);
    const event = str(p.event).trim();
    if (!event || muted.has(event.toLowerCase())) continue;

    out.push({
      id: str(p.id) || str(obj(feature)['@id']) || `${event}|${str(p.onset)}`,
      event,
      tier: alertTier(event, warnEvents),
      severity: str(p.severity),
      headline: str(p.headline),
      description: str(p.description),
      instruction: str(p.instruction),
      areaDesc: str(p.areaDesc),
      onset: str(p.onset) || str(p.effective) || '',
      // `ends` is null for a lot of alerts; `expires` always carries something.
      ends: str(p.ends) || str(p.expires) || '',
      url: safeUrl(p['@id'] || obj(feature)['@id'] || p.id) || '',
    });
  }

  // Stable inside a tier, so the NWS's own ordering survives.
  return out.sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3));
}

// --------------------------------------------------------------- forecast

/**
 * The 14 day/night periods -> seven rows, one per day (W8).
 *
 * Folding is the whole point: a phone does not want "Saturday" and "Saturday
 * Night" as two lines that repeat the same sky. After 6 PM the NWS has already
 * dropped today's daytime period, so the first group is tonight's night period
 * alone — and it renders with NO high, because inventing one out of the low
 * would be the tile making something up.
 *
 * RULE 7: `startTime` is a real instant with an offset, so `ctDate` may parse
 * it. The 'YYYY-MM-DD' that comes back is calendar text from there on and is
 * never handed to `new Date()` again.
 */
export function foldDays(periods, { limit = 7, today = ctToday() } = {}) {
  const groups = new Map(); // 'YYYY-MM-DD' -> row under construction

  for (const raw of arr(periods)) {
    const p = obj(raw);
    const date = ctDate(p.startTime);
    if (!date) continue;

    let row = groups.get(date);
    if (!row) {
      row = { date, label: '', glyph_token: '', hi_f: null, lo_f: null, pop: null, short: '', detail: '' };
      groups.set(date, row);
    }

    const temp = toF(p.temperature, p.temperatureUnit === 'C' ? 'degC' : 'degF');
    const pop = num(obj(p.probabilityOfPrecipitation).value);
    const day = p.isDaytime === true;

    if (day) row.hi_f = temp;
    else row.lo_f = temp;

    // The highest chance either half of the day carries — a 10% afternoon and
    // an 80% evening is an 80% day as far as a trailer hitch is concerned.
    if (pop !== null) row.pop = row.pop === null ? pop : Math.max(row.pop, pop);

    // The daytime half names the day. Only a night-only group speaks for itself.
    if (day || !row.short) {
      row.glyph_token = glyphToken(p.icon);
      row.short = str(p.shortForecast);
    }

    const detail = str(p.detailedForecast).trim();
    if (detail) row.detail = row.detail ? `${row.detail} ${detail}` : detail;
  }

  const rows = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
  for (const row of rows) {
    const nightOnly = row.hi_f === null;
    row.label =
      row.date === today ? (nightOnly ? 'Tonight' : 'Today') : prettyDate(row.date).split(' ')[0];
  }
  return rows;
}

/**
 * The hourly period covering `now`, or null.
 *
 * Verified 2026-09-19: `periods[0]` HAPPENED to be the current hour and is not
 * guaranteed to be. Selecting by the window is one line and cannot be wrong.
 */
export function hourlyNow(periods, now = Date.now()) {
  for (const raw of arr(periods)) {
    const p = obj(raw);
    const start = Date.parse(p.startTime);
    const end = Date.parse(p.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start <= now && now < end) return p;
  }
  return null;
}

/**
 * The now-line, and the label that says where it came from (W7).
 *
 * The rule, in one sentence: an observation is only "now" if it is fresher
 * than 75 minutes AND actually says something. Otherwise the hourly forecast
 * takes over and the line says `forecast` rather than quietly presenting an
 * hour-old metric reading with a blank sky as the current conditions.
 *
 * Returns the same shape the engine publishes in `fallback.now`.
 */
export function nowLine(obsJson, hourlyPeriod, now = Date.now()) {
  const o = obj(obj(obsJson).properties);
  const text = str(o.textDescription).trim();
  const stamp = Date.parse(o.timestamp);
  const fresh = Number.isFinite(stamp) && now - stamp <= OBS_MAX_AGE_MS && now - stamp > -OBS_MAX_AGE_MS;
  const tempF = toF(obj(o.temperature).value, obj(o.temperature).unitCode);

  if (fresh && text && tempF !== null) {
    const mph = kphToMph(obj(o.windSpeed).value);
    const dir = compass(obj(o.windDirection).value);
    return {
      source: 'obs',
      temp_f: tempF,
      short: text,
      glyph_token: glyphToken(o.icon),
      wind: mph === null ? '' : `${mph} mph${dir ? ` ${dir}` : ''}`,
      rh: num(obj(o.relativeHumidity).value) === null ? null : Math.round(num(obj(o.relativeHumidity).value)),
      dew_f: toF(obj(o.dewpoint).value, obj(o.dewpoint).unitCode),
      obs_time_ct: ctTime(o.timestamp) || null,
    };
  }

  const h = obj(hourlyPeriod);
  if (!Object.keys(h).length) return null;
  return {
    source: 'forecast',
    temp_f: toF(h.temperature, h.temperatureUnit === 'C' ? 'degC' : 'degF'),
    short: str(h.shortForecast),
    glyph_token: glyphToken(h.icon),
    wind: [str(h.windSpeed).trim(), str(h.windDirection).trim()].filter(Boolean).join(' '),
    rh: num(obj(h.relativeHumidity).value),
    dew_f: toF(obj(h.dewpoint).value, obj(h.dewpoint).unitCode),
    obs_time_ct: null,
  };
}

/**
 * What the face prints beside the now-line: `KUES · 6:45 AM` or `forecast`.
 *
 * One function because the two callers — the face and the sheet — must never
 * disagree about which feed is on screen.
 */
export function sourceLabel(now, station) {
  const n = obj(now);
  if (n.source === 'forecast' || !n.source) return 'forecast';
  const id = str(obj(station).id) || str(n.source);
  const at = str(n.obs_time_ct);
  return at ? `${id} · ${at}` : id;
}

// ------------------------------------------------------------------- radar

/**
 * A url resolved against the page, or '' when there is no resolving it.
 *
 * Off the browser (the tests, node) there is no document to resolve against,
 * so a relative url simply has no answer and comes back empty rather than
 * guessing an origin.
 */
function resolveUrl(u) {
  const raw = str(u);
  if (!raw) return '';
  const base = typeof location !== 'undefined' && location && location.href ? location.href : undefined;
  try {
    return new URL(raw, base).href;
  } catch {
    return '';
  }
}

/**
 * The RIDGE loop URL with its cache-buster (W10).
 *
 * The origin ships `cache-control: max-age=72`, so a bare URL would sit in the
 * HTTP cache past the point where the loop has moved on. `?t=<epoch minute>`
 * is the cheapest thing that is guaranteed to change.
 *
 * `stepMin` exists because the face passes the radar's OWN cadence
 * (`behind_min`, 4 minutes): the image is a ~1 MB GIF and the product genuinely
 * only refreshes every few minutes, so busting it once a minute would buy a
 * fifth of the data for none of the information. The default is 1 — a plain
 * epoch minute — and only the tile knows better.
 */
export function radarSrc(loop, now = Date.now(), stepMin = 1) {
  // Resolved against the document, then vetted — exactly what an <img src>
  // would do with it anyway. The engine publishes an absolute NWS url; the
  // MOCK publishes './mock/radar-placeholder.svg', because the mock path must
  // reach no origin at all. Resolving first is what lets both work through one
  // code path, and the http(s) check after it is unchanged: a 'javascript:'
  // loop still comes back refused, base or no base.
  const safe = safeUrl(resolveUrl(loop));
  if (!safe) return '';
  const step = Math.max(1, Math.floor(num(stepMin) || 1));
  const minute = Math.floor(now / 60000);
  const bucket = Math.floor(minute / step) * step;
  return `${safe}${safe.includes('?') ? '&' : '?'}t=${bucket}`;
}

// ------------------------------------------------------------------- fetch

/**
 * GET + parse, with a timeout and NO headers.
 *
 * `credentials: 'omit'` because there is nothing to send and sending nothing
 * keeps the request simple; `cache: 'no-store'` because a forecast served out
 * of the HTTP cache is the exact failure this band exists to prevent.
 */
async function getJson(url) {
  const safe = safeUrl(url);
  if (!safe) throw new Error('nws: refusing a non-http url');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(safe, { signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`nws http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Active alerts for the configured POINT — never the zone or county (W5). */
export async function fetchAlerts(url, cfg) {
  return normalizeAlerts(await getJson(url), cfg);
}

/** The seven-day strip, already folded. */
export async function fetchForecast(url, opts) {
  const json = await getJson(url);
  return foldDays(obj(obj(json).properties).periods, opts);
}

/** Raw hourly periods — the now-line's fallback source. */
export async function fetchHourly(url) {
  const json = await getJson(url);
  return arr(obj(obj(json).properties).periods);
}

/** The nearest ASOS's latest observation, raw. `nowLine` decides if it counts. */
export async function fetchObservation(url) {
  return getJson(url);
}
