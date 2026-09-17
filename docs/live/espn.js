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
 *
 * Nothing in this file interprets a bet. It returns facts; graders.js judges.
 */

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const FETCH_TIMEOUT_MS = 12000;

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
  if (!c) return { abbr: '', name: '', score: 0, linescores: [], winner: false };
  return {
    abbr: c.team?.abbreviation || '',
    name: c.team?.displayName || c.team?.shortDisplayName || '',
    // Number(), because ESPN sends scores as strings.
    score: Number(c.score) || 0,
    linescores: linescoreValues(c),
    winner: c.winner === true,
  };
}

/**
 * One ESPN event -> the flat shape the rest of the page speaks.
 * Returns null for anything unrecognisable rather than throwing.
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
    home: sideOf(comp.competitors, 'home'),
    away: sideOf(comp.competitors, 'away'),
  };
}

/**
 * Scoreboard for one league on one Central date.
 *
 * ALWAYS passes `dates=` — the default view is not "today" and will happily
 * return a different slate.
 */
export async function fetchScoreboard(league, dateCompact = ctDateCompact()) {
  const url = `${ESPN_BASE}/${league}/scoreboard?dates=${dateCompact}&limit=60`;
  const json = await getJson(url);
  const events = Array.isArray(json?.events) ? json.events : [];
  return events.map((e) => normalizeEvent(e, league)).filter(Boolean);
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
