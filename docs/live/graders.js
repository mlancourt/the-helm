/**
 * Bet graders. Pure functions: (ticket, game, extras) -> {state, label, why}.
 *
 * WORDING RULE (non-negotiable): these produce a LEAN, never a settlement. A
 * different system settles bets. Even a WIN here is the scoreboard's opinion,
 * not the book's, and the tile's footer says so.
 *
 * EARLY LOCKS (B3, Matt 2026-09-18). A pill stops moving the moment the maths
 * is final — not when ESPN calls the game. Matt's words: "show the bets as
 * winning when technically winning and lost as soon as they are lost". So:
 *
 *   total_over    win   the moment the total clears the line
 *   total_under   lose  the moment the total clears the line
 *   spread_1h     decided at halftime, or once the third period starts
 *   anytime_td    win   on the scoring play; LOSS only at the final whistle
 *   anytime_goal  same (still behind its flag)
 *   btts          win   as soon as both sides are on the board; LOSS at post
 *   ml / spread   LEADING / TRAILING to the whistle — a lead is not a result
 *
 * Every lock above is one-way BY ARITHMETIC: a score cannot go down, so a
 * locked state cannot regress on the next pass. That is the property the tests
 * pin ("a locked win stays win"), and the reason ml and full-game spreads are
 * deliberately NOT locked — a two-score lead is not final maths, it is a lead.
 * (ESPN does occasionally correct a score downward; if that ever unlocks a
 * pill, the grade is right and the earlier one was wrong.)
 *
 * States: pre | lead | trail | even | win | lose | push | dead | unsupported
 *
 * MARGIN (B11, v1.24.0). Every result also carries `margin`: how far the
 * ticket is on the right side of its number, signed, positive = good for the
 * ticket. It is the same arithmetic the `why` already prints, published as a
 * number so the tile can draw it — never a second opinion, and never read by
 * the state logic above:
 *
 *   spread / spread_1h   pick − opp + line   (1H on the first-half sums)
 *   ml                   pick − opp
 *   total_over           total − line
 *   total_under          line − total
 *
 * `null` wherever a distance has no meaning: the binary markets (anytime TD,
 * anytime goal, both teams to score — a player has scored or has not), a
 * game not yet started (0–0 against a −3.5 is not "3.5 short"), no game,
 * dead, unsupported.
 *
 * No fetching, no DOM, no clock. Everything is decided from the arguments, so
 * every market can be unit-tested against fixture games.
 */

/*
 * There is no payout helper here any more (B4). The Bookie logs the price and
 * publishes `ticket.to_win_u` with it; the page renders that number and does
 * no odds arithmetic of its own, so the board and the Bet-Log cannot disagree
 * about what a ticket returns.
 */

const r = (state, label, why, margin = null) => ({ state, label, why, margin });

/**
 * Soccer anytime-goal grading.
 *
 * VERIFIED 2026-09-17 against a completed eng.1 summary: soccer carries NO
 * scoringPlays. Goals live in keyEvents[] where scoringPlay === true and
 * type.text is "Goal - <kind>". Two reasons this is still off by default:
 *
 *   1. The brief requires verification against a LIVE summary; only a
 *      completed one has been checked.
 *   2. Real spelling drift was observed between a goal's `text` and its
 *      `shortText` ("Charalampos" vs "Charalambos"), so surname matching here
 *      is less safe than it looks, and own goals must not count for the
 *      scorer. Grading someone's bet on a transliteration is not acceptable.
 *
 * Flip this to true only after watching one live match grade correctly.
 */
export const ANYTIME_GOAL_ENABLED = false;

// ------------------------------------------------------------------- names

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

/** "D. Vasquez" -> "vasquez"; "Demetrius Knight Jr." -> "knight". */
export function surname(fullName) {
  const parts = String(fullName || '')
    .replace(/[.,]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => !NAME_SUFFIX.test(p));
  if (!parts.length) return '';
  return parts[parts.length - 1].toLowerCase();
}

/**
 * The player who actually SCORED, from a scoring play's text.
 *
 * This is the difference between a right and a wrong grade. ESPN writes a
 * passing touchdown as:
 *
 *   "Mike Gesicki 2 Yd pass from Joe Burrow (Evan McPherson Kick)"
 *
 * Gesicki scored. Burrow threw it and McPherson kicked the extra point, and
 * both of their surnames are in that string. Matching the whole text — the
 * obvious implementation — grades a "Joe Burrow anytime TD" ticket as a WIN
 * for a touchdown he did not score, and would do the same for the kicker.
 *
 * The scorer is always the name before the yardage, so the credited region is
 * the text up to "<n> Yd". If that pattern is missing, fall back to the text
 * before the first parenthesis, which still excludes the kicker.
 */
export function scorerText(playText) {
  const text = String(playText || '');
  const m = text.match(/^(.+?)\s+\d+\s*Yd\b/i);
  if (m) return m[1];
  const paren = text.indexOf('(');
  return paren > 0 ? text.slice(0, paren) : text;
}

/**
 * Lowercase, fold accents, drop punctuation that varies, collapse spaces.
 * Hyphens stay. Accents fold because the slip and the feed disagree about
 * them ("Ibanez" on the slip, "Ibáñez" in the play text) — and an accented
 * letter would otherwise read as a word boundary to hasWord() below.
 */
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word-boundary containment, so "Brown" does not hit "Browne". */
function hasWord(hay, word) {
  if (!word) return false;
  return new RegExp(`(^|[^a-z])${escapeRe(word)}([^a-z]|$)`, 'i').test(hay);
}

/**
 * Does this scoring play credit THIS player?
 *
 * A surname alone is not enough, and that is not hypothetical. Checking two
 * real NFL rosters turned up three players sharing the surname Brown in a
 * single fixture — a receiver, a cornerback and an offensive tackle across the
 * two teams. Surname-only matching would credit a player-scores-a-touchdown
 * ticket to whichever Brown happened to reach the end zone, including on a
 * defensive return. First initials do not rescue it either: two of those three
 * given names begin with the same letter.
 *
 * So the surname has to match AND the given name has to be consistent:
 *   - the whole name appearing in the credited text is an outright match
 *   - otherwise the surname must match and the first name must either be equal
 *     or be an initial of it ("D. Vasquez" matching "Devin Vasquez")
 *   - a ticket carrying only a surname falls back to the surname, which is the
 *     most that can be known from it
 */
function nameHits(playText, player) {
  const want = surname(player);
  if (!want) return false;

  const hay = norm(scorerText(playText));
  const full = norm(player);

  // The whole name is present — unambiguous.
  if (full && full.includes(' ') && hay.includes(full)) return true;

  if (!hasWord(hay, want)) return false;

  const tokens = norm(player).split(' ').filter(Boolean);
  // Only a surname was given; the surname match is all there is to go on.
  if (tokens.length < 2) return true;

  const first = tokens[0];
  const hayFirst = hay.split(' ').filter(Boolean)[0] || '';
  if (!hayFirst) return false;

  // "D." / "D" is an initial: match on the letter.
  if (first.length === 1) return hayFirst.startsWith(first);

  return hayFirst === first;
}

// ------------------------------------------------------------ scoring plays

/**
 * Which scoring plays are touchdowns.
 *
 * `type.abbreviation === 'TD'` is NOT sufficient. Verified on real data: a
 * defensive score arrives as abbreviation "SFOP" ("Sack Opp Fumble Recovery",
 * text "Demetrius Knight Jr. 27 Yd Fumble Return"), which is a touchdown that
 * a strict abbreviation filter would miss — turning a winning ticket into a
 * LOSS. So a play counts as a touchdown if the abbreviation says TD, or the
 * type text says Touchdown, or the scoring team's score jumped by 6 or more,
 * which is structurally what a touchdown is.
 */
export function touchdownPlays(scoringPlays) {
  const plays = Array.isArray(scoringPlays) ? scoringPlays : [];
  const out = [];
  let prevHome = 0;
  let prevAway = 0;
  for (const p of plays) {
    const home = Number(p?.homeScore) || 0;
    const away = Number(p?.awayScore) || 0;
    const delta = Math.max(home - prevHome, away - prevAway);
    prevHome = home;
    prevAway = away;

    const abbr = String(p?.type?.abbreviation || '');
    const typeText = String(p?.type?.text || '');
    if (abbr === 'TD' || /touchdown/i.test(typeText) || delta >= 6) out.push(p);
  }
  return out;
}

/** Soccer goals from keyEvents. Own goals are excluded — they credit nobody. */
export function goalEvents(keyEvents) {
  const evts = Array.isArray(keyEvents) ? keyEvents : [];
  return evts.filter((e) => {
    if (e?.scoringPlay !== true) return false;
    const t = String(e?.type?.text || '');
    return /goal/i.test(t) && !/own goal/i.test(t);
  });
}

// ----------------------------------------------------------------- helpers

function sides(ticket, game) {
  const pick = ticket.side === 'home' ? game.home : game.away;
  const opp = ticket.side === 'home' ? game.away : game.home;
  return { pick, opp };
}

/**
 * Is the game at half time?
 *
 * The 1H spread is decided the moment the half ends, and the third period
 * starting is the signal that survives every sport — but between the two there
 * is a gap ESPN spends on the interval, still `period: 2`, and a bet whose
 * maths is finished must not read as a lean for fifteen minutes. ESPN says so
 * twice (`STATUS_HALFTIME`, and "Halftime" in the detail line) and neither is
 * guaranteed, so both are checked.
 */
function atHalftime(game) {
  return /halftime|half time/i.test(`${game.statusName || ''} ${game.detail || ''}`);
}

/** First-half total for one side. Soccer has no linescores, so this is []. */
function firstHalf(side) {
  const ls = Array.isArray(side.linescores) ? side.linescores : [];
  return (Number(ls[0]) || 0) + (Number(ls[1]) || 0);
}

const fmtLine = (n) => (Number(n) > 0 ? `+${n}` : String(n));

// ----------------------------------------------------------------- markets

function gradeMl(ticket, game) {
  if (ticket.side !== 'home' && ticket.side !== 'away') {
    return r('unsupported', 'N/A', 'moneyline needs side home or away');
  }
  const { pick, opp } = sides(ticket, game);
  const margin = pick.score - opp.score;
  const score = `${pick.abbr} ${pick.score}–${opp.score} ${opp.abbr}`;

  if (game.state === 'post') {
    if (margin > 0) return r('win', 'WIN', `${score} final`, margin);
    if (margin < 0) return r('lose', 'LOSS', `${score} final`, margin);
    return r('push', 'PUSH', `${score} final — drawn`, margin);
  }
  if (margin > 0) return r('lead', 'LEADING', `${score}, ${game.detail || 'live'}`, margin);
  if (margin < 0) return r('trail', 'TRAILING', `${score}, ${game.detail || 'live'}`, margin);
  return r('even', 'TIED', `${score}, ${game.detail || 'live'}`, margin);
}

function gradeSpread(ticket, game, { half = false } = {}) {
  if (ticket.side !== 'home' && ticket.side !== 'away') {
    return r('unsupported', 'N/A', 'spread needs side home or away');
  }
  const line = Number(ticket.line);
  if (!Number.isFinite(line)) return r('unsupported', 'N/A', 'spread needs a line');

  const { pick, opp } = sides(ticket, game);

  let pickScore = pick.score;
  let oppScore = opp.score;
  let decided = game.state === 'post';
  let scope = 'final';

  if (half) {
    // Soccer and anything else with no linescores cannot be graded by half.
    if (!pick.linescores.length && game.state !== 'pre') {
      return r('unsupported', 'N/A', 'no period scores in this feed');
    }
    pickScore = firstHalf(pick);
    oppScore = firstHalf(opp);
    // B3: the first half is over at halftime — not when the third period's
    // clock starts, and certainly not at the final whistle.
    decided = game.period >= 3 || atHalftime(game) || game.state === 'post';
    scope = 'first half';
  }

  const margin = pickScore - oppScore + line;
  const score = `${pick.abbr} ${pickScore}–${oppScore} ${opp.abbr}`;
  const at = `${pick.abbr} ${fmtLine(line)}`;

  if (decided) {
    if (margin > 0) return r('win', 'WIN', `${score} ${scope}, ${at} covers by ${Math.abs(margin)}`, margin);
    if (margin < 0) return r('lose', 'LOSS', `${score} ${scope}, ${at} misses by ${Math.abs(margin)}`, margin);
    return r('push', 'PUSH', `${score} ${scope}, lands exactly on ${fmtLine(line)}`, margin);
  }
  if (margin > 0) return r('lead', 'COVERING', `${score}, ${at} by ${Math.abs(margin)}`, margin);
  if (margin < 0) return r('trail', 'TRAILING', `${score}, ${at} short by ${Math.abs(margin)}`, margin);
  return r('even', 'ON THE NUMBER', `${score}, exactly on ${fmtLine(line)}`, margin);
}

function gradeTotal(ticket, game, over) {
  const line = Number(ticket.line);
  if (!Number.isFinite(line)) return r('unsupported', 'N/A', 'total needs a line');

  const total = game.home.score + game.away.score;
  const word = over ? 'over' : 'under';
  const margin = over ? total - line : line - total;

  if (game.state === 'post') {
    if (total === line) return r('push', 'PUSH', `${total} total, lands on ${line}`, margin);
    const won = over ? total > line : total < line;
    return won
      ? r('win', 'WIN', `${total} total, ${word} ${line}`, margin)
      : r('lose', 'LOSS', `${total} total, ${word} ${line} missed`, margin);
  }

  // B3, the lock: a score cannot go down, so the moment the total clears the
  // number the over has cashed and the under has busted. Waiting for the
  // whistle to say so would be the tile pretending not to know.
  if (total > line) {
    return over
      ? r('win', 'WIN', `${total} total, already past ${line}`, margin)
      : r('lose', 'LOSS', `${total} total, already past ${line}`, margin);
  }
  // Level with the number: alive for the over (one more point does it) and
  // heading for a push on the under. "needs 0 more" reads as a bug, so it is
  // said in words instead.
  if (total === line) {
    return over
      ? r('trail', 'TRAILING', `${total} total, level with ${line}`, margin)
      : r('lead', 'LEADING', `${total} total, level with ${line}`, margin);
  }
  const need = (line - total).toFixed(1).replace(/\.0$/, '');
  return over
    ? r('trail', 'TRAILING', `${total} total, needs ${need} more`, margin)
    : r('lead', 'LEADING', `${total} total, ${need} of room left`, margin);
}

function gradeAnytimeTd(ticket, game, extras) {
  if (!ticket.player) return r('unsupported', 'N/A', 'anytime TD needs a player');
  if (game.state === 'pre') return r('pre', 'PRE', 'not started');

  const plays = extras?.scoringPlays;
  if (!Array.isArray(plays)) return r('pre', 'PRE', 'waiting on scoring plays');

  const tds = touchdownPlays(plays);
  const hit = tds.find((p) => nameHits(p.text, ticket.player));

  // B3: he scored. Nothing that happens later takes it back, so the pill
  // stops moving here rather than at the whistle.
  if (hit) {
    const q = hit.period?.number ? `Q${hit.period.number}` : 'in play';
    return r('win', 'WIN', `scored ${q}`);
  }
  if (game.state === 'post') return r('lose', 'LOSS', `no touchdown in ${tds.length} scoring plays`);
  return r('trail', 'TRAILING', `no TD yet, ${game.detail || 'live'}`);
}

function gradeAnytimeGoal(ticket, game, extras) {
  // Feature-flagged: see ANYTIME_GOAL_ENABLED above for exactly why.
  if (!ANYTIME_GOAL_ENABLED) return r('unsupported', 'N/A', 'grading unsupported');
  if (!ticket.player) return r('unsupported', 'N/A', 'anytime goal needs a player');
  if (game.state === 'pre') return r('pre', 'PRE', 'not started');

  const goals = goalEvents(extras?.keyEvents);
  const hit = goals.find((g) => nameHits(g.shortText || g.text, ticket.player));
  // B3, as for the touchdown: a goal is not taken back.
  if (hit) {
    const when = hit.clock?.displayValue ? `${hit.clock.displayValue}` : 'in play';
    return r('win', 'WIN', `scored ${when}`);
  }
  if (game.state === 'post') return r('lose', 'LOSS', 'no goal');
  return r('trail', 'TRAILING', `no goal yet, ${game.detail || 'live'}`);
}

function gradeBtts(ticket, game) {
  const h = game.home.score;
  const a = game.away.score;
  const both = h > 0 && a > 0;
  const score = `${game.away.abbr} ${a}–${h} ${game.home.abbr}`;

  if (game.state === 'post') {
    return both ? r('win', 'WIN', `${score} final`) : r('lose', 'LOSS', `${score} final`);
  }
  // B3: both sides have scored and neither can un-score. Locked.
  if (both) return r('win', 'WIN', `${score}, both on the board`);
  const yet = h > 0 ? game.away.abbr : a > 0 ? game.home.abbr : 'neither side';
  return r('trail', 'TRAILING', `${score}, ${yet} yet to score`);
}

// ------------------------------------------------------------------ router

export const MARKETS = {
  ml: gradeMl,
  spread: (t, g) => gradeSpread(t, g, { half: false }),
  spread_1h: (t, g) => gradeSpread(t, g, { half: true }),
  total_over: (t, g) => gradeTotal(t, g, true),
  total_under: (t, g) => gradeTotal(t, g, false),
  anytime_td: gradeAnytimeTd,
  anytime_goal: gradeAnytimeGoal,
  btts: gradeBtts,
};

/** Which markets need a summary fetch (and only once the game is live). */
export const NEEDS_SUMMARY = new Set(['anytime_td', 'anytime_goal']);

/**
 * Grade one ticket. Never throws: an unknown market or a malformed game
 * degrades to an honest "unsupported" rather than taking the tile down.
 */
export function gradeTicket(ticket, game, extras) {
  if (!ticket || typeof ticket !== 'object') return r('unsupported', 'N/A', 'bad ticket');
  if (!game) return r('pre', 'PRE', 'no ESPN event matched this ticket');
  if (game.dead) return r('dead', 'DEAD', game.detail || 'game postponed or cancelled');

  const fn = MARKETS[ticket.market];
  if (!fn) return r('unsupported', 'N/A', `no grader for "${ticket.market}"`);

  if (game.state === 'pre' && ticket.market !== 'anytime_td' && ticket.market !== 'anytime_goal') {
    // ESPN's shortDetail is Eastern ("8:15 PM EDT"); the game header already shows the Central kick. Never leak a foreign zone.
    return r('pre', 'PRE', 'not started');
  }

  try {
    return fn(ticket, game, extras);
  } catch (e) {
    return r('unsupported', 'N/A', `grading failed: ${e.message}`);
  }
}

// ---------------------------------------------------------- game progress

/**
 * Regulation shape per timed league: [periods, seconds per period] (B13).
 *
 * Football is one shape at every level, and hockey is too, so those key on
 * the slug's SPORT segment. Basketball is not — the pro game is four twelves
 * and the college game two twenties — so it keys on the whole slug, and a
 * basketball league not listed here answers null rather than a guess.
 */
const TIMED_SPORT = {
  football: [4, 15 * 60],
  hockey: [3, 20 * 60],
};
const TIMED_LEAGUE = {
  'basketball/nba': [4, 12 * 60],
  'basketball/wnba': [4, 10 * 60],
  'basketball/mens-college-basketball': [2, 20 * 60],
};

/** `football/nfl` -> `football`. */
export function sportOf(league) {
  return String(league || '').split('/')[0].toLowerCase();
}

/**
 * ESPN's displayClock as seconds left in the period: "8:12" -> 492, and the
 * sub-minute spelling basketball uses ("34.5") -> 34.5. Anything else is null.
 */
function clockSecs(clock) {
  const s = String(clock || '').trim();
  let m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]);
  return null;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * How much of the game has been played, 0..1, or null when it cannot be
 * known (B13). Pure: no clock, no DOM, no fetch — everything comes off the
 * normalised game, and the league off the game or the caller.
 *
 *   pre -> 0 · post -> 1
 *   timed   (period − 1 + (1 − clockSecs / periodLen)) / periods;
 *           overtime (any period past regulation) -> 1
 *   baseball  inning / 9, capped (half-innings ignored)
 *   soccer    clock minutes / 90, capped — ESPN's soccer clock counts UP
 *             ("67'", "90'+3'")
 *
 * This is decoration's input, never a grade's: nothing in the graders above
 * reads it, and a null leaves the bar's track full rather than inventing time.
 */
export function gameProgress(game, league = game && game.league) {
  if (!game || typeof game !== 'object') return null;
  if (game.state === 'pre') return 0;
  if (game.state === 'post') return 1;
  if (game.state !== 'in') return null;

  const slug = String(league || '').toLowerCase();
  const sport = sportOf(slug);
  const period = Number(game.period) || 0;

  if (sport === 'baseball') return period > 0 ? clamp01(period / 9) : null;

  if (sport === 'soccer') {
    const m = String(game.clock || '').match(/^\s*(\d+)/);
    return m ? clamp01(Number(m[1]) / 90) : null;
  }

  const shape = TIMED_LEAGUE[slug] || TIMED_SPORT[sport];
  if (!shape || period < 1) return null;
  const [periods, len] = shape;
  if (period > periods) return 1;
  const left = clockSecs(game.clock);
  if (left === null) return null;
  return clamp01((period - 1 + (1 - Math.min(left, len) / len)) / periods);
}

// ------------------------------------------------------------------ parlays

/*
 * PARLAYS (B16–B19, v1.28.0). A parlay is one ticket with N legs across 1..N
 * games. The engine publishes `market: "parlay"`, `legs[]` and `games[]`; the
 * page grades each leg on its own and then ANDs them — strictly. It does no
 * odds math here either: `to_win_u` / `payout_x` are the engine's, and
 * nothing below so much as reads them.
 *
 * Every leg names a player, never a game, so the player is FOUND: across the
 * parlay's started games' box scores, full name first, then a surname token
 * that is unique across those games. A stat column is located by its KEY in
 * that block's `keys` array — verified 10/4 that the arrays are stable and
 * the positions are not — and never by index.
 */

/** Stat legs: market -> [box-score block, key, unit word for the readout]. */
export const LEG_STAT = {
  player_rush_yds: ['rushing', 'rushingYards', 'yds'],
  player_pass_yds: ['passing', 'passingYards', 'yds'],
  player_rec_yds: ['receiving', 'receivingYards', 'yds'],
  player_rec: ['receiving', 'receptions', 'rec'],
};

const PLAYER_BLOCKS = ['passing', 'rushing', 'receiving'];

/**
 * A name as comparable tokens: lowercase, accents and punctuation gone,
 * generational suffixes dropped. "Amon-Ra St. Brown" -> ['amonra', 'st',
 * 'brown']; "José Ramírez Jr." -> ['jose', 'ramirez'].
 */
export function nameTokens(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => !NAME_SUFFIX.test(p));
}

/**
 * Every athlete in a summary's box score: `[{name, team, blocks: {block:
 * {keys, stats}}}]`. One entry per athlete — a back who also catches passes
 * appears once, with both blocks.
 */
function boxAthletes(summary) {
  const out = new Map();
  for (const team of Array.isArray(summary?.players) ? summary.players : []) {
    const abbr = String(team?.team?.abbreviation || '');
    for (const block of Array.isArray(team?.statistics) ? team.statistics : []) {
      const bname = String(block?.name || '');
      if (!PLAYER_BLOCKS.includes(bname)) continue;
      const keys = Array.isArray(block.keys) ? block.keys : [];
      for (const a of Array.isArray(block.athletes) ? block.athletes : []) {
        const name = String(a?.athlete?.displayName || '');
        if (!name) continue;
        const id = String(a?.athlete?.id || `${abbr}:${name}`);
        if (!out.has(id)) out.set(id, { id, name, team: abbr, blocks: {} });
        out.get(id).blocks[bname] = { keys, stats: Array.isArray(a.stats) ? a.stats : [] };
      }
    }
  }
  return [...out.values()];
}

/**
 * Find a leg's player across the parlay's games. `slots` are the games that
 * have a box score to look in. Full name first; then a surname token that
 * matches exactly ONE athlete across every slot — two Browns is no answer.
 */
function findPlayer(player, slots) {
  const want = nameTokens(player);
  if (!want.length) return null;
  const pool = [];
  for (const slot of slots) for (const a of boxAthletes(slot.summary)) pool.push({ slot, a, toks: nameTokens(a.name) });

  const full = want.join(' ');
  const exact = pool.filter((p) => p.toks.join(' ') === full);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const sur = want[want.length - 1];
  const bySurname = pool.filter((p) => p.toks.length && p.toks[p.toks.length - 1] === sur);
  return bySurname.length === 1 ? bySurname[0] : null;
}

/** One stat off an athlete, by KEY. Missing block or key -> 0 (none recorded). */
function statOf(athlete, block, key) {
  const b = athlete && athlete.blocks[block];
  if (!b) return 0;
  const i = b.keys.indexOf(key);
  if (i < 0) return 0;
  const n = Number(String(b.stats[i] ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const legOut = (state, label, why, extra = {}) => ({
  state,
  label,
  why,
  margin: null,
  stat: null,
  gameId: null,
  gameAbbr: '',
  ...extra,
});

/**
 * Grade one leg. `games` is the parlay's games, each `{game, summary}` —
 * `game` the normalised scoreboard event (null when ESPN did not match it),
 * `summary` the `{scoringPlays, players}` the band fetched once it started.
 *
 * Returns `{state, label, why, margin, stat, gameId, gameAbbr}`. `stat` is the
 * number the readout prints; `gameId` names the leg's OWN game, so its cover
 * bar drains with that game's clock (B20) and nobody else's.
 */
export function gradeLeg(leg, games) {
  if (!leg || typeof leg !== 'object') return legOut('unsupported', 'N/A', 'grading unsupported');
  const market = leg.market;
  const spec = LEG_STAT[market];
  if (!spec && market !== 'anytime_td') return legOut('unsupported', 'N/A', 'grading unsupported');
  if (!leg.player) return legOut('unsupported', 'N/A', 'leg names no player');

  const list = (Array.isArray(games) ? games : []).filter((g) => g && g.game && !g.game.dead);
  const started = list.filter((g) => g.game.state === 'in' || g.game.state === 'post');
  if (!started.length) return legOut('pre', 'PRE', 'not started');

  const withBox = started.filter((g) => g.summary);
  const hit = findPlayer(leg.player, withBox);

  // Where is he? Found — that game. Not found — the only started game when
  // there is just one; otherwise, if a game is still to come he is most
  // likely in it, and the leg has not started.
  let slot = hit ? hit.slot : null;
  if (!slot) {
    const unstarted = list.length > started.length || list.length < (Array.isArray(games) ? games.length : 0);
    if (unstarted) return legOut('pre', 'PRE', 'not in a started box score yet');
    if (withBox.length < started.length) return legOut('pre', 'PRE', 'waiting on box score');
    slot = started.length === 1 ? started[0] : started.find((g) => g.game.state === 'in') || started[0];
  }
  const game = slot.game;
  const gameId = String(game.id || '');
  const gameAbbr = hit ? hit.a.team : '';

  if (market === 'anytime_td') {
    // The TD grader, as for a single, against the game that carries him.
    // Graded on the box score's own spelling of him when he was found there:
    // the feed spells him the same way in its scoring plays.
    const g = gradeAnytimeTd({ player: hit ? hit.a.name : leg.player }, game, slot.summary);
    return legOut(g.state, g.label, g.why, { gameId, gameAbbr, stat: g.state === 'win' ? 1 : 0 });
  }

  const [block, key, unit] = spec;
  const line = Number(leg.line);
  if (!Number.isFinite(line)) return legOut('unsupported', 'N/A', 'leg needs a line', { gameId, gameAbbr });
  const side = leg.side === 'under' ? 'under' : leg.side === 'over' ? 'over' : null;
  if (!side) return legOut('unsupported', 'N/A', 'leg needs over or under', { gameId, gameAbbr });

  // A player absent from a started box score has recorded none of it (B18).
  const stat = hit ? statOf(hit.a, block, key) : 0;
  const margin = side === 'over' ? stat - line : line - stat;
  const base = { gameId, gameAbbr, stat, margin };
  const read = `${stat} ${unit}`;

  if (side === 'over') {
    // B3 per leg: a stat cannot go down, so past the line is cashed.
    if (stat > line) return legOut('win', 'WIN', `${read}, past ${line}`, base);
    if (game.state === 'post') return legOut('lose', 'LOSS', `${read} final, short of ${line}`, base);
    return legOut('trail', 'TRAILING', `${read}, needs ${+(line - stat).toFixed(1)} more`, base);
  }
  // Under: busted the moment it clears; won only at the whistle.
  if (stat > line) return legOut('lose', 'LOSS', `${read}, past ${line}`, base);
  if (game.state === 'post') return legOut('win', 'WIN', `${read} final, under ${line}`, base);
  return legOut('lead', 'LEADING', `${read}, ${+(line - stat).toFixed(1)} of room`, base);
}

/**
 * The parlay's ticket state — the AND of its legs, strictly (B19):
 *
 *   any leg LOSS                      dead
 *   every leg WIN                     win
 *   every leg LEADING or WIN          lead
 *   any leg TRAILING (none lost)      trail
 *   an ungradable leg                 pre   (never green on a leg we cannot read)
 *   a game started, none lost         alive
 *   nothing started                   pre
 *
 * One leg leading out of three is not a lean on the payout: it is a ticket
 * that has not been tested yet, and the board says ALIVE rather than green.
 */
export function parlayState(legGrades, games) {
  const states = (Array.isArray(legGrades) ? legGrades : []).map((g) => (g && g.state) || 'pre');
  const anyStarted = (Array.isArray(games) ? games : []).some(
    (g) => g && g.game && !g.game.dead && (g.game.state === 'in' || g.game.state === 'post')
  );
  if (!states.length) return anyStarted ? 'alive' : 'pre';
  if (states.includes('lose')) return 'dead';
  if (states.every((s) => s === 'win')) return 'win';
  if (states.every((s) => s === 'win' || s === 'lead')) return 'lead';
  if (states.includes('trail')) return 'trail';
  if (states.includes('unsupported')) return 'pre';
  return anyStarted ? 'alive' : 'pre';
}

const PARLAY_LABEL = { pre: 'PRE', alive: 'ALIVE', lead: 'LEADING', trail: 'TRAILING', win: 'WIN', dead: 'DEAD' };

/**
 * Grade a parlay ticket: `{state, label, why, margin: null, legs, won, n}`.
 * `games` is aligned with `ticket.games`. An older snapshot's parlay with no
 * `legs` grades as unsupported rather than throwing (rule 9).
 */
export function gradeParlay(ticket, games) {
  const legs = Array.isArray(ticket && ticket.legs) ? ticket.legs : null;
  if (!legs || !legs.length) {
    return { state: 'unsupported', label: 'N/A', why: 'grading unsupported', margin: null, legs: [], won: 0, n: 0 };
  }
  let legGrades;
  try {
    legGrades = legs.map((leg) => gradeLeg(leg, games));
  } catch (e) {
    legGrades = legs.map(() => legOut('unsupported', 'N/A', `grading failed: ${e.message}`));
  }
  const state = parlayState(legGrades, games);
  const won = legGrades.filter((g) => g.state === 'win').length;
  return {
    state,
    label: PARLAY_LABEL[state],
    why: `${won}/${legs.length} legs`,
    margin: null,
    legs: legGrades,
    won,
    n: legs.length,
  };
}
