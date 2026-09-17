/**
 * Bet graders. Pure functions: (ticket, game, extras) -> {state, label, why}.
 *
 * WORDING RULE (non-negotiable): these produce a LEAN, never a settlement. A
 * different system settles bets. While a game is in progress a ticket is only
 * ever LEADING / TRAILING / COVERING — WIN and LOSS appear once ESPN calls the
 * game final, and even then this is the scoreboard's opinion, not the book's.
 *
 * States: pre | lead | trail | even | win | lose | push | dead | unsupported
 *
 * No fetching, no DOM, no clock. Everything is decided from the arguments, so
 * every market can be unit-tested against fixture games.
 */

/** American odds -> profit multiple, used by the tile for lean units. */
export function payoutMultiple(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p === 0) return 0;
  return p > 0 ? p / 100 : 100 / Math.abs(p);
}

const r = (state, label, why) => ({ state, label, why });

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

/** Lowercase, drop punctuation that varies, collapse spaces. Hyphens stay. */
function norm(s) {
  return String(s || '')
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
    if (margin > 0) return r('win', 'WIN', `${score} final`);
    if (margin < 0) return r('lose', 'LOSS', `${score} final`);
    return r('push', 'PUSH', `${score} final — drawn`);
  }
  if (margin > 0) return r('lead', 'LEADING', `${score}, ${game.detail || 'live'}`);
  if (margin < 0) return r('trail', 'TRAILING', `${score}, ${game.detail || 'live'}`);
  return r('even', 'TIED', `${score}, ${game.detail || 'live'}`);
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
    // Per the brief: the first half is settled once the third period starts.
    decided = game.period >= 3 || game.state === 'post';
    scope = 'first half';
  }

  const margin = pickScore - oppScore + line;
  const score = `${pick.abbr} ${pickScore}–${oppScore} ${opp.abbr}`;
  const at = `${pick.abbr} ${fmtLine(line)}`;

  if (decided) {
    if (margin > 0) return r('win', 'WIN', `${score} ${scope}, ${at} covers by ${Math.abs(margin)}`);
    if (margin < 0) return r('lose', 'LOSS', `${score} ${scope}, ${at} misses by ${Math.abs(margin)}`);
    return r('push', 'PUSH', `${score} ${scope}, lands exactly on ${fmtLine(line)}`);
  }
  if (margin > 0) return r('lead', 'COVERING', `${score}, ${at} by ${Math.abs(margin)}`);
  if (margin < 0) return r('trail', 'TRAILING', `${score}, ${at} short by ${Math.abs(margin)}`);
  return r('even', 'ON THE NUMBER', `${score}, exactly on ${fmtLine(line)}`);
}

function gradeTotal(ticket, game, over) {
  const line = Number(ticket.line);
  if (!Number.isFinite(line)) return r('unsupported', 'N/A', 'total needs a line');

  const total = game.home.score + game.away.score;
  const word = over ? 'over' : 'under';

  if (game.state === 'post') {
    if (total === line) return r('push', 'PUSH', `${total} total, lands on ${line}`);
    const won = over ? total > line : total < line;
    return won
      ? r('win', 'WIN', `${total} total, ${word} ${line}`)
      : r('lose', 'LOSS', `${total} total, ${word} ${line} missed`);
  }

  // Scores never go down, so once the total clears the number the over can no
  // longer lose and the under can no longer win. Said plainly, still a lean.
  if (total > line) {
    return over
      ? r('lead', 'LEADING', `${total} total, already past ${line}`)
      : r('trail', 'TRAILING', `${total} total, already past ${line}`);
  }
  const need = (line - total).toFixed(1).replace(/\.0$/, '');
  return over
    ? r('trail', 'TRAILING', `${total} total, needs ${need} more`)
    : r('lead', 'LEADING', `${total} total, ${need} of room left`);
}

function gradeAnytimeTd(ticket, game, extras) {
  if (!ticket.player) return r('unsupported', 'N/A', 'anytime TD needs a player');
  if (game.state === 'pre') return r('pre', 'PRE', 'not started');

  const plays = extras?.scoringPlays;
  if (!Array.isArray(plays)) return r('pre', 'PRE', 'waiting on scoring plays');

  const tds = touchdownPlays(plays);
  const hit = tds.find((p) => nameHits(p.text, ticket.player));

  if (hit) {
    const q = hit.period?.number ? `Q${hit.period.number}` : 'in play';
    return game.state === 'post'
      ? r('win', 'WIN', `scored ${q}`)
      : r('lead', 'LEADING', `scored ${q} — needs the whistle`);
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
  if (hit) {
    const when = hit.clock?.displayValue ? `${hit.clock.displayValue}` : 'in play';
    return game.state === 'post' ? r('win', 'WIN', `scored ${when}`) : r('lead', 'LEADING', `scored ${when}`);
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
  if (both) return r('lead', 'LEADING', `${score}, both on the board`);
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
    return r('pre', 'PRE', game.detail || 'not started');
  }

  try {
    return fn(ticket, game, extras);
  } catch (e) {
    return r('unsupported', 'N/A', `grading failed: ${e.message}`);
  }
}
