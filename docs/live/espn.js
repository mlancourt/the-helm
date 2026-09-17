/**
 * ESPN fetch + normalize.
 *
 * The page calls site.api.espn.com DIRECTLY from the browser — it is CORS-open
 * and needs no key. Together with the Worker this is the only external origin
 * the page ever touches (rule 4).
 *
 * Everything here was verified against real payloads on 2026-09-17. The three
 * things that bite:
 *
 *   1. `score` is a STRING ("5", not 5). Concatenating two of them silently
 *      produces "53" for a total, and "10" < "9" is true. Always Number().
 *   2. `linescores` entries are objects {value, displayValue, period} — not
 *      bare numbers — and the key is absent entirely pre-game and for soccer.
 *   3. `scoringPlays` does not exist on a pre-game summary. Default to [].
 *   4. How-to-watch is told twice and neither telling is complete:
 *      `broadcasts[].names` has the names and a lower-case market, and
 *      `geoBroadcasts[]` has the same names with a title-case market and a
 *      type. Both keys are absent for a lot of games. See broadcastsOf().
 *
 * Nothing in this file interprets a bet. It returns facts; graders.js judges.
 */

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const FETCH_TIMEOUT_MS = 12000;

/**
 * A 'YYYY-MM-DD' Central business date -> 'YYYYMMDD' for ESPN's `dates=`.
 *
 * RULE 7, the disqualifying bug. `date_ct` arrives from the snapshot as a
 * Central calendar date, and `new Date('2026-09-17')` parses as UTC midnight —
 * which is the 16th in Central. So the conversion is two dashes removed from a
 * string and nothing else: no Date, no zone, no arithmetic. Anything that is
 * not a date-only string returns '' so the caller can fall back to today
 * rather than querying ESPN for garbage.
 */
export function compactCtDate(dateCt) {
  const s = String(dateCt ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, '') : '';
}

/** Today's Central date as ESPN wants it: YYYYMMDD, no dashes. */
export function ctDateCompact(now = new Date()) {
  // en-CA gives YYYY-MM-DD; the Central zone is explicit, so this is correct
  // regardless of where the phone thinks it is.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .replace(/-/g, '');
}

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`espn http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** linescores -> a plain array of numbers, [] when the key is missing. */
function linescoreValues(competitor) {
  const raw = competitor?.linescores;
  if (!Array.isArray(raw)) return []; // null pre-game, undefined for soccer
  return raw.map((l) => Number(l?.value) || 0);
}

function sideOf(competitors, homeAway) {
  const c = (competitors || []).find((x) => x?.homeAway === homeAway) || null;
  if (!c) return { abbr: '', short: '', name: '', score: 0, linescores: [], winner: false };
  return {
    abbr: c.team?.abbreviation || '',
    // `shortDisplayName` is the matchup name today_games prints — "Brewers",
    // not "Milwaukee Brewers" and not "MIL". It falls back UP to the full name
    // and then DOWN to the abbreviation, because a blank side of a matchup is
    // the one thing that must not happen.
    short: c.team?.shortDisplayName || c.team?.displayName || c.team?.abbreviation || '',
    name: c.team?.displayName || c.team?.shortDisplayName || '',
    // Number(), because ESPN sends scores as strings.
    score: Number(c.score) || 0,
    linescores: linescoreValues(c),
    winner: c.winner === true,
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * 'national' / 'National' / 'Away' -> 'National' | 'Home' | 'Away' | ''.
 *
 * ESPN spells the same fact two ways in two places: `broadcasts[].market` is
 * lower case ("national", "away") and `geoBroadcasts[].market.type` is title
 * case ("National", "Away"). One canonical form, title case, because that is
 * what the spec's rule is written in.
 */
function broadcastMarket(raw) {
  const m = String(raw ?? '').trim().toLowerCase();
  if (m === 'national') return 'National';
  if (m === 'home') return 'Home';
  if (m === 'away') return 'Away';
  return '';
}

/**
 * How to watch, as far as ESPN knows: `[{name, type, market}]`, deduped by
 * name, national entries first.
 *
 * Two sources, merged because neither is complete. `broadcasts[]` carries the
 * names and which market they serve but no type; `geoBroadcasts[]` carries the
 * type ("TV", "STREAMING" — the casing is not consistent, so nothing decides
 * anything on it) and the same names again. A name that appears in both keeps
 * one entry and gains whichever fields the second mention filled in.
 *
 * `market` is the field that decides "regional — not yours" upstream, so it is
 * never guessed: an entry ESPN gave no market for gets '' and is treated as a
 * plain unmapped name.
 */
function broadcastsOf(comp) {
  const out = [];
  const seen = new Map(); // lower-cased name -> the entry already in `out`

  const push = (rawName, type, market) => {
    const name = String(rawName ?? '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const prev = seen.get(key);
    if (prev) {
      if (!prev.type && type) prev.type = type;
      if (!prev.market && market) prev.market = market;
      return;
    }
    const entry = { name, type: type || '', market: market || '' };
    seen.set(key, entry);
    out.push(entry);
  };

  for (const b of arr(comp?.broadcasts)) {
    const market = broadcastMarket(b?.market);
    for (const n of arr(b?.names)) push(n, '', market);
  }
  for (const g of arr(comp?.geoBroadcasts)) {
    push(g?.media?.shortName, String(g?.type?.shortName || ''), broadcastMarket(g?.market?.type));
  }

  // National first, then the market-specific feeds, then anything unlabelled.
  // Array#sort is stable, so ESPN's own order survives inside each group.
  const rank = (m) => (m === 'National' ? 0 : m ? 1 : 2);
  return out.sort((a, b) => rank(a.market) - rank(b.market));
}

/**
 * One ESPN event -> the flat shape the rest of the page speaks.
 * Returns null for anything unrecognisable rather than throwing.
 *
 * `startDate` is the spec's `start`: the UTC ISO instant from `event.date`. It
 * predates the spec under this name and is not duplicated — one field, one
 * name. It carries a Z, so it is the one kind of date in this codebase that is
 * safe to parse (see lib/fmt.js).
 */
export function normalizeEvent(event, league = '') {
  if (!event || !event.id) return null;
  const comp = Array.isArray(event.competitions) ? event.competitions[0] : null;
  if (!comp) return null;

  const status = comp.status || event.status || {};
  const type = status.type || {};
  const state = type.state === 'in' || type.state === 'post' ? type.state : 'pre';

  // A postponed or cancelled game is not "pre" — nothing is coming. Graders
  // turn this into DEAD rather than leaving a ticket pending forever.
  const name = String(type.name || '');
  const dead = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|FORFEIT/i.test(name);

  return {
    id: String(event.id),
    league,
    name: event.name || '',
    shortName: event.shortName || '',
    startDate: event.date || comp.date || null,
    state,
    dead,
    completed: type.completed === true,
    statusName: name,
    detail: type.detail || type.shortDetail || '',
    shortDetail: type.shortDetail || '',
    period: Number(status.period) || 0,
    clock: status.displayClock || '',
    venue: comp.venue?.fullName || '',
    broadcasts: broadcastsOf(comp),
    home: sideOf(comp.competitors, 'home'),
    away: sideOf(comp.competitors, 'away'),
  };
}

/**
 * In-flight scoreboard requests, keyed by league+date.
 *
 * `bets_live` and `today_games` both want MLB's slate, and the band asks for
 * both in the same Promise.all. Without this they would be two identical HTTP
 * calls on every 45-second tick; with it, the second caller awaits the first
 * one's promise and the tick makes one call per league (G5).
 *
 * It holds PROMISES, not results, and every entry is dropped the moment its
 * request settles. That is deliberate: a result cache with a TTL would hand
 * Matt a score that is up to a TTL old after he taps refresh, and a stale
 * score is the one thing this band exists to prevent.
 */
const inFlight = new Map();

/**
 * Scoreboard for one league on one Central date.
 *
 * ALWAYS passes `dates=` — the default view is not "today" and will happily
 * return a different slate.
 */
export function fetchScoreboard(league, dateCompact = ctDateCompact()) {
  const key = `${league}|${dateCompact}`;
  const hit = inFlight.get(key);
  if (hit) return hit;

  const url = `${ESPN_BASE}/${league}/scoreboard?dates=${dateCompact}&limit=100`;
  const p = getJson(url)
    .then((json) => {
      const events = Array.isArray(json?.events) ? json.events : [];
      return events.map((e) => normalizeEvent(e, league)).filter(Boolean);
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

/**
 * Summary for one event — the only place scoring plays live.
 *
 * Call this ONLY when the game is in|post and a ticket actually needs it: it
 * is a much heavier document than the scoreboard.
 *
 * Returns {scoringPlays, keyEvents} with both defaulted to [], because the
 * keys are simply absent pre-game (verified) and soccer has no scoringPlays
 * at all — it carries goals in keyEvents.
 */
export async function fetchSummary(league, eventId) {
  const url = `${ESPN_BASE}/${league}/summary?event=${encodeURIComponent(eventId)}`;
  const json = await getJson(url);
  return {
    scoringPlays: Array.isArray(json?.scoringPlays) ? json.scoringPlays : [],
    keyEvents: Array.isArray(json?.keyEvents) ? json.keyEvents : [],
  };
}

/** A compact scoreline for headers: "MIL 3 – 2 PIT". */
export function scoreLine(game) {
  if (!game) return '';
  return `${game.away.abbr} ${game.away.score} – ${game.home.score} ${game.home.abbr}`;
}
