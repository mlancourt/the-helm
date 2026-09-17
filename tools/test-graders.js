#!/usr/bin/env node
/**
 * The Helm — grader unit tests. Node, zero deps.
 *
 *   node tools/test-graders.js
 *
 * Graders are pure functions, so every market is tested against fixture games
 * across pre / in / post / push.
 *
 * The fixtures in tools/fixtures/espn-real.json are REAL ESPN payloads
 * captured on 2026-09-17 (public sports data; no personal data anywhere near
 * this repo). Inventing fixtures would only prove the graders agree with my
 * guess about ESPN's shape — which is the exact thing that needs testing.
 * In-progress variants are derived from the real finals by rewinding the
 * clock, and every derivation is marked.
 *
 * Real numbers in play below:
 *   NFL  TB 27 @ CIN 33   (total 60; first half CIN 24, TB 10)
 *   MLB  SF 6 @ STL 5     (10 innings)
 *   SOC  BHA 5 @ COV 0    (a real shutout, for both-teams-to-score)
 */

const fs = require('node:fs');
const path = require('node:path');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'espn-real.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  const { normalizeEvent } = await import('../docs/live/espn.js');
  const G = await import('../docs/live/graders.js');
  const { gradeTicket } = G;

  const NFL = normalizeEvent(FIX.nfl_post_raw, 'football/nfl');
  const NFL_PRE = normalizeEvent(FIX.nfl_pre_raw, 'football/nfl');
  const MLB = normalizeEvent(FIX.mlb_post_raw, 'baseball/mlb');
  const SOC = normalizeEvent(FIX.soccer_post_shutout_raw, 'soccer/eng.1');
  const PLAYS = { scoringPlays: FIX.nfl_scoring_plays };

  /** Derive an in-progress game from a real final. */
  const live = (g, over = {}) => ({ ...g, state: 'in', completed: false, detail: 'Q3 4:12', ...over });
  const st = (t, g, x) => gradeTicket(t, g, x).state;
  const lb = (t, g, x) => gradeTicket(t, g, x).label;

  // ---------------------------------------------------------- normalizer
  console.log('normalizer (real payloads)');
  check('reads state from a completed game', NFL.state === 'post' && NFL.completed === true);
  check('coerces the STRING score to a number', NFL.home.score === 33 && typeof NFL.home.score === 'number');
  check('reads the away score', NFL.away.score === 27);
  check('maps linescore objects to numbers', JSON.stringify(NFL.home.linescores) === '[14,10,3,6]');
  check('a pre-game event has state pre', NFL_PRE.state === 'pre');
  check('absent linescores become [] not undefined', Array.isArray(NFL_PRE.home.linescores) && NFL_PRE.home.linescores.length === 0);
  check('soccer (no linescores key) still normalizes', SOC.state === 'post' && Array.isArray(SOC.home.linescores));
  check('extra-innings period is read', MLB.period === 10);
  check('normalizeEvent(null) returns null, does not throw', normalizeEvent(null) === null);
  check('normalizeEvent({}) returns null', normalizeEvent({}) === null);

  // ---------------------------------------------------------------- ml
  console.log('\nmoneyline');
  const mlHome = { id: 'a', market: 'ml', side: 'home' };
  const mlAway = { id: 'b', market: 'ml', side: 'away' };
  check('pre-game is PRE', st(mlHome, NFL_PRE) === 'pre');
  check('home winner is WIN', st(mlHome, NFL) === 'win');
  check('away loser is LOSS', st(mlAway, NFL) === 'lose');
  check('away winner is WIN (MLB, SF won 6-5)', st(mlAway, MLB) === 'win');
  check('in-progress leader is LEADING', lb(mlHome, live(NFL)) === 'LEADING');
  check('in-progress trailer is TRAILING', lb(mlAway, live(NFL)) === 'TRAILING');
  check('a tie mid-game is TIED, not leading', lb(mlHome, live(NFL, { home: { ...NFL.home, score: 27 } })) === 'TIED');
  check('a drawn final is PUSH', st(mlHome, { ...NFL, home: { ...NFL.home, score: 27 } }) === 'push');
  check('ml without a side is unsupported', st({ id: 'c', market: 'ml' }, NFL) === 'unsupported');

  // ------------------------------------------------------------ spread
  console.log('\nspread (CIN won by exactly 6)');
  const sp = (side, line) => ({ id: 's', market: 'spread', side, line });
  check('CIN -5.5 covers', st(sp('home', -5.5), NFL) === 'win');
  check('CIN -6.5 misses by a half point', st(sp('home', -6.5), NFL) === 'lose');
  check('CIN -6 lands exactly on the number: PUSH', st(sp('home', -6), NFL) === 'push');
  check('TB +6.5 wins', st(sp('away', 6.5), NFL) === 'win');
  check('TB +5.5 loses', st(sp('away', 5.5), NFL) === 'lose');
  check('TB +6 pushes', st(sp('away', 6), NFL) === 'push');
  check('in-progress cover reads COVERING', lb(sp('home', -5.5), live(NFL)) === 'COVERING');
  check('in-progress miss reads TRAILING', lb(sp('home', -6.5), live(NFL)) === 'TRAILING');
  check('in-progress exactly on the number', lb(sp('home', -6), live(NFL)) === 'ON THE NUMBER');
  check('pre-game spread is PRE', st(sp('home', -6), NFL_PRE) === 'pre');
  check('spread without a line is unsupported', st({ id: 's', market: 'spread', side: 'home' }, NFL) === 'unsupported');
  check('the why explains the margin', /covers by/.test(gradeTicket(sp('home', -5.5), NFL).why));

  // --------------------------------------------------------- spread_1h
  console.log('\nfirst-half spread (CIN 24, TB 10 at the half)');
  const h1 = (side, line) => ({ id: 'h', market: 'spread_1h', side, line });
  check('CIN -13.5 covers the half', st(h1('home', -13.5), NFL) === 'win');
  check('CIN -14.5 misses the half', st(h1('home', -14.5), NFL) === 'lose');
  check('CIN -14 pushes the half', st(h1('home', -14), NFL) === 'push');
  check('TB +13.5 loses the half', st(h1('away', 13.5), NFL) === 'lose');
  // Decided at period >= 3 even though the game is still running.
  const q3 = live(NFL, { period: 3 });
  const q2 = live(NFL, { period: 2, detail: 'Q2 0:41' });
  check('settles once Q3 starts, mid-game', st(h1('home', -13.5), q3) === 'win');
  check('still a lean during Q2', ['lead', 'trail', 'even'].includes(st(h1('home', -13.5), q2)));
  check('Q2 lean reads COVERING not WIN', lb(h1('home', -13.5), q2) === 'COVERING');
  check('a feed with no period scores is unsupported', st(h1('home', -1), { ...SOC, state: 'in' }) === 'unsupported');

  // ------------------------------------------------------------ totals
  console.log('\ntotals (TB 27 + CIN 33 = 60)');
  const tot = (market, line) => ({ id: 't', market, line });
  check('over 48.5 wins', st(tot('total_over', 48.5), NFL) === 'win');
  check('under 48.5 loses', st(tot('total_under', 48.5), NFL) === 'lose');
  check('over 60 pushes exactly', st(tot('total_over', 60), NFL) === 'push');
  check('under 60 pushes exactly', st(tot('total_under', 60), NFL) === 'push');
  check('over 63.5 loses', st(tot('total_over', 63.5), NFL) === 'lose');
  check('under 63.5 wins', st(tot('total_under', 63.5), NFL) === 'win');
  // Scores cannot go down, so a cleared number is one-way.
  check('over already past the number leads', lb(tot('total_over', 48.5), live(NFL)) === 'LEADING');
  check('under already past the number trails', lb(tot('total_under', 48.5), live(NFL)) === 'TRAILING');
  check('says it is already past the number', /already past/.test(gradeTicket(tot('total_under', 48.5), live(NFL)).why));
  check('over still short says how much it needs', /needs 5 more/.test(gradeTicket(tot('total_over', 65), live(NFL)).why));
  check('total without a line is unsupported', st({ id: 't', market: 'total_over' }, NFL) === 'unsupported');

  // -------------------------------------------------------- anytime TD
  console.log('\nanytime touchdown (real scoring plays)');
  const td = (player) => ({ id: 'td', market: 'anytime_td', player });
  check('the receiver who scored WINS (Gesicki)', st(td('M. Gesicki'), NFL, PLAYS) === 'win');
  check('a rushing scorer WINS (Chase Brown)', st(td('Chase Brown'), NFL, PLAYS) === 'win');
  check('a QB who ran it in WINS (Mayfield)', st(td('Baker Mayfield'), NFL, PLAYS) === 'win');
  check('an interception-return TD WINS (Trotter)', st(td('Josiah Trotter'), NFL, PLAYS) === 'win');
  // The SFOP case: a fumble-return TD whose type.abbreviation is NOT "TD".
  check('a fumble-return TD counts although its abbr is SFOP (Knight)', st(td('Demetrius Knight Jr.'), NFL, PLAYS) === 'win');
  check('the Jr. suffix does not become the surname', G.surname('Demetrius Knight Jr.') === 'knight');
  // The false-positive that a whole-text match would produce:
  check('the PASSER does not win on his receiver TD (Burrow)', st(td('Joe Burrow'), NFL, PLAYS) === 'lose');
  check('the KICKER named in TD text does not win (McPherson)', st(td('Evan McPherson'), NFL, PLAYS) === 'lose');
  check('a kicker with only field goals does not win (McLaughlin)', st(td('Chase McLaughlin'), NFL, PLAYS) === 'lose');
  check('a player who never scored LOSES', st(td('Nobody Atall'), NFL, PLAYS) === 'lose');
  check('mid-game scorer reads LEADING not WIN', lb(td('Chase Brown'), live(NFL), PLAYS) === 'LEADING');
  check('mid-game non-scorer reads TRAILING not LOSS', lb(td('Nobody Atall'), live(NFL), PLAYS) === 'TRAILING');
  check('pre-game is PRE', st(td('Chase Brown'), NFL_PRE, PLAYS) === 'pre');
  check('missing scoring plays waits rather than calling a loss', st(td('Chase Brown'), live(NFL), undefined) === 'pre');
  check('missing plays says it is waiting', /waiting on scoring plays/.test(gradeTicket(td('C. Brown'), live(NFL)).why));
  check('anytime_td without a player is unsupported', st({ id: 'x', market: 'anytime_td' }, NFL, PLAYS) === 'unsupported');

  console.log('\ntouchdown detection');
  const tds = G.touchdownPlays(FIX.nfl_scoring_plays);
  // Six: five abbreviated "TD", plus the fumble return abbreviated "SFOP".
  // The real game's 12 scoring plays are 6 touchdowns and 6 field goals, and
  // 33-27 only reconciles if the SFOP play is counted.
  check('finds all 6 touchdowns in the real game', tds.length === 6, `found ${tds.length}`);
  check('finds the 5 plays ESPN abbreviates TD', tds.filter((p) => p.type.abbreviation === 'TD').length === 5);
  check('plus the one it does not (SFOP)', tds.filter((p) => p.type.abbreviation !== 'TD').length === 1);
  check('field goals are not touchdowns', !tds.some((p) => /Field Goal/i.test(p.text)));
  check('the SFOP fumble return is included', tds.some((p) => /Fumble Return/i.test(p.text)));
  check('the 6 remaining scoring plays are all field goals',
    FIX.nfl_scoring_plays.length - tds.length === 6 &&
      FIX.nfl_scoring_plays.filter((p) => p.type.abbreviation === 'FG').length === 6);
  check('empty input is safe', G.touchdownPlays([]).length === 0);
  check('undefined input is safe', G.touchdownPlays(undefined).length === 0);

  console.log('\nscorer extraction');
  check('strips the passer', G.scorerText('Mike Gesicki 2 Yd pass from Joe Burrow (Evan McPherson Kick)').trim() === 'Mike Gesicki');
  check('strips the kicker', G.scorerText('Chase Brown 5 Yd Rush (Evan McPherson Kick)').trim() === 'Chase Brown');
  check('keeps a Jr. in the scorer', G.scorerText('Demetrius Knight Jr. 27 Yd Fumble Return (Evan McPherson Kick)').trim() === 'Demetrius Knight Jr.');
  check('falls back to text before the paren', G.scorerText('Some Player Safety (Team)').trim() === 'Some Player Safety');
  check('surname of "D. Vasquez"', G.surname('D. Vasquez') === 'vasquez');
  check('surname of a hyphenated first name', G.surname('Amon-Ra St. Brown') === 'brown');
  check('surname of empty is empty', G.surname('') === '');

  // -------------------------------------------------------------- btts
  console.log('\nboth teams to score');
  const btts = { id: 'bt', market: 'btts' };
  check('both scored: WIN (SF 6 - STL 5)', st(btts, MLB) === 'win');
  check('a real shutout: LOSS (BHA 5 - COV 0)', st(btts, SOC) === 'lose');
  check('mid-game with both on the board LEADS', lb(btts, live(MLB)) === 'LEADING');
  check('mid-game 0-0 TRAILS', lb(btts, live(MLB, { home: { ...MLB.home, score: 0 }, away: { ...MLB.away, score: 0 } })) === 'TRAILING');
  check('names who has yet to score', /yet to score/.test(gradeTicket(btts, live(SOC)).why));

  // ------------------------------------------------- soccer anytime goal
  console.log('\nanytime goal (feature-flagged)');
  check('the flag is OFF by default', G.ANYTIME_GOAL_ENABLED === false);
  const goalT = { id: 'g', market: 'anytime_goal', player: 'Kostoulas' };
  check('renders as unsupported while the flag is off', st(goalT, SOC, { keyEvents: FIX.soccer_key_events }) === 'unsupported');
  check('says "grading unsupported"', gradeTicket(goalT, SOC, {}).why === 'grading unsupported');
  // The parser itself is still exercised, so enabling it later is a one-line change.
  const goals = G.goalEvents(FIX.soccer_key_events);
  check('goal events parse out of keyEvents', goals.length > 0, `found ${goals.length}`);
  check('own goals are excluded', !goals.some((g) => /own goal/i.test(g.type?.text || '')));

  // -------------------------------------------------------- degradation
  console.log('\ndegradation');
  check('no matching ESPN event is PRE, not an error', st(mlHome, null) === 'pre');
  check('and says why', /no ESPN event matched/.test(gradeTicket(mlHome, null).why));
  check('a postponed game is DEAD', st(mlHome, { ...NFL, dead: true }) === 'dead');
  check('an unknown market is unsupported', st({ id: 'z', market: 'moon_landing' }, NFL) === 'unsupported');
  check('and names the market', /moon_landing/.test(gradeTicket({ id: 'z', market: 'moon_landing' }, NFL).why));
  check('a garbage ticket does not throw', st(null, NFL) === 'unsupported');
  check('every grade carries state, label and why', ['ml', 'spread', 'total_over', 'btts'].every((m) => {
    const g = gradeTicket({ id: 'q', market: m, side: 'home', line: 1 }, NFL, PLAYS);
    return g.state && g.label && typeof g.why === 'string' && g.why.length > 0;
  }));

  console.log('\npayout multiples');
  check('-110 profit multiple', Math.abs(G.payoutMultiple(-110) - 0.909) < 0.001);
  check('+135 profit multiple', Math.abs(G.payoutMultiple(135) - 1.35) < 0.0001);
  check('junk price is 0', G.payoutMultiple(null) === 0);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})();
