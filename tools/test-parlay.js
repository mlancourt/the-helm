#!/usr/bin/env node
/**
 * The Helm — bets_live v1.2: parlays on their own card + the situation line
 * (vault spec `Bets-Live-Tile-Spec.md`, rulings B16–B21). Node, zero deps, on
 * the shared DOM shim.
 *
 *   node tools/test-parlay.js
 *
 * Under test:
 *   B16/B18  the fetch plan names every parlay game on its own kick date, and
 *            a summary is fetched only for the ones that have started
 *   B18      each leg graded off the box score by KEY — never by index — with
 *            the player found by full name, then a unique surname, accents
 *            folded; a player missing from a started box score has 0
 *   B18      the lock table per leg (over locks early, under busts early and
 *            wins only at post, ATD on the play)
 *   B19      the ticket is the STRICT AND of its legs, six states incl. ALIVE,
 *            and lean-now still reconciles with the rows on a mixed board
 *   B17/B20  own card, slip order, per-leg readouts and bars, no units on legs
 *   B21      the situation line renders and hides field by field
 *   rule 6   payout_x is printed, never computed; no odds math anywhere
 *   rule 9   a parlay with no legs/games renders, never throws
 *   rule 10  no innerHTML
 */

const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./dom-shim.js');
const { slate, PARLAY_EVT } = require('./mock-espn.js');

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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const countOf = (node, cls) => node.querySelectorAll('.' + cls).length;
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// A real-schema box score, keys deliberately NOT in ESPN's live order.
const block = (name, keys, rows) => ({
  name,
  keys,
  athletes: rows.map(([id, displayName, byKey]) => ({ athlete: { id, displayName }, stats: keys.map((k) => String(byKey[k] ?? '0')) })),
});
const RUSH = ['rushingYards', 'longRushing', 'rushingAttempts', 'rushingTouchdowns', 'yardsPerRushAttempt'];
const PASS = ['passingTouchdowns', 'completions/passingAttempts', 'interceptions', 'passingYards'];
const REC = ['longReception', 'receivingTargets', 'receivingYards', 'receptions'];

function box(teams) {
  return { scoringPlays: [], players: teams.map(([abbr, stats]) => ({ team: { abbreviation: abbr }, statistics: stats })) };
}

const game = (id, state, over = {}) => ({
  id,
  league: 'football/nfl',
  state,
  dead: false,
  detail: state === 'in' ? 'Q3 4:12' : state === 'post' ? 'Final' : '',
  period: state === 'in' ? 3 : state === 'post' ? 4 : 0,
  clock: state === 'in' ? '4:12' : '0:00',
  home: { abbr: 'CAR', score: 10 },
  away: { abbr: 'DET', score: 14 },
  ...over,
});

(async () => {
  const G = await import('../docs/live/graders.js');
  const { normalizeEvent } = await import('../docs/live/espn.js');
  const band = await import('../docs/live/band.js');
  const bets = await import('../docs/tiles/bets_live.js');
  const { gradeLeg, parlayState, gradeParlay, nameTokens } = G;

  // ------------------------------------------------------------ names
  console.log('\nB18 — finding the player');
  check('accents fold', nameTokens('Tomás Ibáñez').join(' ') === 'tomas ibanez');
  check('suffixes drop', nameTokens('Kenneth Walker III').join(' ') === 'kenneth walker');
  check('punctuation drops', nameTokens("Amon-Ra St. Brown").join(' ') === 'amonra st brown');

  const live = (summary, st = 'in', over = {}) => [{ game: game('g1', st, over), summary }];
  const RB = (yds, name = 'Jahmyr Gibbs') => box([['DET', [block('rushing', RUSH, [['1', name, { rushingYards: yds, rushingAttempts: 9 }]])]]]);

  const rushOver = { label: 'Gibbs O69.5 rush yds', market: 'player_rush_yds', player: 'Jahmyr Gibbs', side: 'over', line: 69.5 };
  let g = gradeLeg(rushOver, live(RB(47)));
  check('stat read by KEY in a reordered keys array (47, not the attempts beside it)', g.stat === 47, String(g.stat));
  check('found-game abbr is the box score team', g.gameAbbr === 'DET', g.gameAbbr);
  check('gameId names the leg\'s own game', g.gameId === 'g1');
  check('margin over = stat − line', g.margin === 47 - 69.5, String(g.margin));

  const accented = gradeLeg({ ...rushOver, player: 'Jose Ramirez' }, live(RB(80, 'José Ramírez Jr.')));
  check('accented box-score name matches a plain slip name', accented.state === 'win' && accented.stat === 80, JSON.stringify(accented));

  const surnameOnly = gradeLeg({ ...rushOver, player: 'Gibbs' }, live(RB(72)));
  check('surname-only leg matches a unique surname', surnameOnly.state === 'win' && surnameOnly.stat === 72);

  const twoBrowns = box([
    ['DET', [block('receiving', REC, [['1', 'Amon-Ra St. Brown', { receptions: 6 }]])]],
    ['CAR', [block('receiving', REC, [['2', 'Chase Brown', { receptions: 1 }]])]],
  ]);
  const ambig = gradeLeg({ label: 'Brown O2.5 rec', market: 'player_rec', player: 'Brown', side: 'over', line: 2.5 }, live(twoBrowns));
  check('a surname shared by two athletes is no match (stat 0, not a guess)', ambig.stat === 0 && ambig.gameAbbr === '', JSON.stringify(ambig));
  const fullBeats = gradeLeg({ label: 'x', market: 'player_rec', player: 'Chase Brown', side: 'over', line: 2.5 }, live(twoBrowns));
  check('full name wins over the shared surname', fullBeats.stat === 1 && fullBeats.gameAbbr === 'CAR');

  const missing = gradeLeg({ label: 'Bell U30.5 rec yds', market: 'player_rec_yds', player: 'Marcus Bell', side: 'under', line: 30.5 }, live(RB(10)));
  check('a player missing from a started box score has stat 0', missing.stat === 0 && missing.state === 'lead', JSON.stringify(missing));
  const missingOver = gradeLeg({ ...rushOver, player: 'Nobody Here' }, live(RB(10)));
  check('…so an over on him trails', missingOver.state === 'trail' && missingOver.stat === 0);
  const missingPost = gradeLeg({ ...rushOver, player: 'Nobody Here' }, live(RB(10), 'post'));
  check('…and loses at post', missingPost.state === 'lose');

  // ------------------------------------------------------------ the lock table
  console.log('\nB18 — the lock table, per leg');
  check('over: trailing while in and under the line', gradeLeg(rushOver, live(RB(47))).state === 'trail');
  check('over: WIN the moment the stat clears the line, mid-game', gradeLeg(rushOver, live(RB(70))).state === 'win');
  check('over: still WIN at the next pass and at the whistle', gradeLeg(rushOver, live(RB(84))).state === 'win' && gradeLeg(rushOver, live(RB(84), 'post')).state === 'win');
  check('over: LOSS at post when short', gradeLeg(rushOver, live(RB(69), 'post')).state === 'lose');
  check('over: level is not over — 69.5 needs 70', gradeLeg({ ...rushOver, line: 70 }, live(RB(70))).state === 'trail');

  const rushUnder = { ...rushOver, side: 'under', label: 'Gibbs U69.5' };
  check('under: LEADING while in and at/under the line', gradeLeg(rushUnder, live(RB(40))).state === 'lead');
  check('under: LOSS the moment it clears, mid-game (early loss)', gradeLeg(rushUnder, live(RB(70))).state === 'lose');
  check('under: never WIN while in', gradeLeg(rushUnder, live(RB(0))).state !== 'win');
  check('under: WIN only at post', gradeLeg(rushUnder, live(RB(40), 'post')).state === 'win');
  check('under margin = line − stat', gradeLeg(rushUnder, live(RB(40))).margin === 29.5);

  const passOver = { label: 'O199.5 pass yds', market: 'player_pass_yds', player: 'Jared Goff', side: 'over', line: 199.5 };
  const QB = box([['DET', [block('passing', PASS, [['3', 'Jared Goff', { passingYards: 212, 'completions/passingAttempts': '17/24' }]])]]]);
  check('pass yds read by key', gradeLeg(passOver, live(QB)).stat === 212 && gradeLeg(passOver, live(QB)).state === 'win');
  const WR = box([['DET', [block('receiving', REC, [['4', 'Sam LaPorta', { receptions: 2, receivingYards: 38 }]])]]]);
  const recLeg = gradeLeg({ label: 'O2.5 rec', market: 'player_rec', player: 'Sam LaPorta', side: 'over', line: 2.5 }, live(WR));
  check('receptions read by key', recLeg.stat === 2 && recLeg.state === 'trail');
  check('rec yds read by key', gradeLeg({ label: 'x', market: 'player_rec_yds', player: 'Sam LaPorta', side: 'over', line: 30.5 }, live(WR)).stat === 38);

  const atd = { label: 'Gibbs ATD', market: 'anytime_td', player: 'Gibbs', side: null, line: null };
  const tdBox = (scored, st = 'in') => {
    const b = RB(30);
    if (scored) b.scoringPlays = [{ type: { abbreviation: 'TD', text: 'Rushing Touchdown' }, text: 'Jahmyr Gibbs 4 Yd Run (Jake Bates Kick)', period: { number: 2 }, homeScore: 0, awayScore: 7 }];
    return live(b, st);
  };
  check('ATD: WIN on the play, mid-game', gradeLeg(atd, tdBox(true)).state === 'win');
  check('ATD: TRAILING in play with no TD', gradeLeg(atd, tdBox(false)).state === 'trail');
  check('ATD: LOSS only at post', gradeLeg(atd, tdBox(false, 'post')).state === 'lose');
  check('ATD margin is null (binary)', gradeLeg(atd, tdBox(true)).margin === null);
  const thrower = tdBox(false);
  thrower[0].summary.scoringPlays = [{ type: { abbreviation: 'TD' }, text: 'Sam LaPorta 9 Yd pass from Jahmyr Gibbs (Jake Bates Kick)', homeScore: 0, awayScore: 7 }];
  check('ATD: throwing the TD is not scoring it', gradeLeg(atd, thrower).state === 'trail');

  check('every candidate game pre -> pre', gradeLeg(rushOver, [{ game: game('g1', 'pre'), summary: undefined }]).state === 'pre');
  check('pre leg margin is null', gradeLeg(rushOver, [{ game: game('g1', 'pre') }]).margin === null);
  check('market null -> unsupported', gradeLeg({ label: 'Gibbs 2+ longest', market: null, player: 'Gibbs' }, live(RB(1))).state === 'unsupported');
  check('…with "grading unsupported"', gradeLeg({ market: null, player: 'Gibbs' }, live(RB(1))).why === 'grading unsupported');
  const multi = [
    { game: game('g1', 'in'), summary: RB(30, 'Someone Else') },
    { game: game('g2', 'pre'), summary: undefined },
  ];
  check('not in a started box score while a game is still to come -> pre', gradeLeg(rushOver, multi).state === 'pre');
  check('found across games: the leg uses the game it was found in', gradeLeg(rushOver, [{ game: game('g0', 'post'), summary: box([]) }, { game: game('g9', 'in'), summary: RB(12) }]).gameId === 'g9');
  check('a started game with no summary yet is not read as 0', gradeLeg(rushOver, [{ game: game('g1', 'in'), summary: undefined }]).state === 'pre');

  // ------------------------------------------------------------ the strict AND
  console.log('\nB19 — the ticket is the strict AND of its legs');
  const S = (...states) => states.map((state) => ({ state }));
  const IN = [{ game: game('a', 'in') }];
  const MIXG = [{ game: game('a', 'in') }, { game: game('b', 'pre') }];
  const PRE = [{ game: game('a', 'pre') }, { game: game('b', 'pre') }];
  check('any leg LOSS -> dead', parlayState(S('win', 'lose', 'lead'), IN) === 'dead');
  check('every leg WIN -> win', parlayState(S('win', 'win', 'win'), IN) === 'win');
  check('every leg LEADING or WIN -> lead', parlayState(S('win', 'lead', 'lead'), IN) === 'lead');
  check('any leg TRAILING, none lost -> trail', parlayState(S('win', 'trail', 'lead'), IN) === 'trail');
  check('trailing beats a game still to come', parlayState(S('trail', 'pre'), MIXG) === 'trail');
  check('nothing lost, a game still pre -> ALIVE', parlayState(S('win', 'pre', 'pre'), MIXG) === 'alive');
  check('one leg leading, one still pre -> ALIVE, not lead', parlayState(S('lead', 'pre'), MIXG) === 'alive');
  check('all games pre -> pre', parlayState(S('pre', 'pre'), PRE) === 'pre');
  check('an ungradable leg is never green: win + unsupported -> pre', parlayState(S('win', 'unsupported'), IN) === 'pre');
  check('…but a lost leg is still dead', parlayState(S('lose', 'unsupported'), IN) === 'dead');

  const noLegs = gradeParlay({ market: 'parlay', label: 'x' }, []);
  check('a parlay with no legs grades unsupported, does not throw', noLegs.state === 'unsupported' && Array.isArray(noLegs.legs));
  const gp = gradeParlay({ market: 'parlay', legs: [rushOver, atd] }, tdBox(true));
  check('gradeParlay carries the legs, the won count and n', gp.legs.length === 2 && gp.won === 1 && gp.n === 2 && gp.state === 'trail', JSON.stringify(gp));
  check('gradeParlay margin is null (the legs are the picture)', gp.margin === null);

  // ------------------------------------------------------------ the mock slate, end to end
  console.log('\nB16/B18 — the mock slate end to end');
  const SL = slate('2026-10-04', '2026-10-05', '2026-10-06');
  const evs = new Map(SL.leagues['football/nfl'].map((e) => [String(e.id), normalizeEvent(e, 'football/nfl')]));
  const sumOf = (id) => {
    const s = SL.summaries[id];
    return s ? { scoringPlays: s.scoringPlays || [], players: s.boxscore?.players || [] } : undefined;
  };
  const MOCK = JSON.parse(read('docs', 'mock', 'helm-data.json'));
  const mockParlays = MOCK.tiles.bets_live.data.tickets.filter((t) => t.market === 'parlay');
  check('the mock carries two parlays', mockParlays.length === 2);
  const slots = (t) => t.games.map((m) => ({ game: evs.get(String(m.espn_event_id)) || null, summary: sumOf(m.espn_event_id) }));
  const [p3, sgp] = mockParlays;
  const p3g = gradeParlay(p3, slots(p3));
  check('3-game parlay games are in / post / pre', p3.games.map((m) => evs.get(m.espn_event_id).state).join() === 'in,post,pre');
  check('rush leg off reordered keys: 47 yds, trailing', p3g.legs[0].stat === 47 && p3g.legs[0].state === 'trail', JSON.stringify(p3g.legs[0]));
  check('accented ATD in the final game: WIN, found in CVD', p3g.legs[1].state === 'win' && p3g.legs[1].gameAbbr === 'CVD', JSON.stringify(p3g.legs[1]));
  check('surname-only leg whose game has not kicked: pre', p3g.legs[2].state === 'pre');
  check('ticket: trail (a leg behind, none lost)', p3g.state === 'trail');
  const sg = gradeParlay(sgp, slots(sgp));
  check('SGP: pass yds over cashed mid-game', sg.legs[0].state === 'win' && sg.legs[0].stat === 212);
  check('SGP: receptions 2 of 2.5, trailing', sg.legs[1].state === 'trail' && sg.legs[1].stat === 2);
  check('SGP: the missing player\'s under leads at 0', sg.legs[2].state === 'lead' && sg.legs[2].stat === 0);
  check('SGP ticket: trail', sg.state === 'trail');

  // ------------------------------------------------------------ the band
  console.log('\nB16/B18 — the fetch plan and the summaries');
  const snap = (tickets) => ({ tiles: { bets_live: { data: { tickets } } } });
  const req = band.requirements(snap([
    {
      id: 'p',
      market: 'parlay',
      league: 'football/nfl',
      espn_event_id: '1',
      kick_ct: '2026-10-04 3:25 PM',
      games: [
        { league: 'football/nfl', espn_event_id: '1', kick_ct: '2026-10-04 3:25 PM' },
        { league: 'football/college-football', espn_event_id: '2', kick_ct: '2026-10-03 11:00 AM' },
        { league: 'football/nfl', espn_event_id: '3', kick_ct: '2026-10-04 7:20 PM' },
      ],
    },
    { id: 's', market: 'ml', league: 'football/nfl', espn_event_id: '4', kick_ct: '2026-10-04 12:00 PM' },
  ]));
  const keys = req.plan.map((p) => `${p.league}|${p.date}`).sort();
  check('every parlay game is in the plan, each on its own kick date, coalesced', keys.join(' ') === 'football/college-football|20261003 football/nfl|20261004', keys.join(' '));
  check('an older parlay with no games adds nothing and throws nothing', band.requirements(snap([{ id: 'x', market: 'parlay' }])).plan.length === 0);

  const summaryCalls = [];
  const lb = band.createLiveBand(() => {}, {
    fetchScoreboard: async (league, date) => (league === 'football/nfl' ? [...evs.values()] : []),
    fetchSummary: async (league, id) => {
      summaryCalls.push(id);
      return sumOf(id) || { scoringPlays: [], keyEvents: [], players: [] };
    },
  });
  const res = await lb.runOnce(snap([p3, sgp]));
  const st = lb.getState();
  check('summaries fetched for the started parlay games only', summaryCalls.sort().join() === [PARLAY_EVT.live, PARLAY_EVT.post].sort().join(), summaryCalls.join());
  check('…once each, though two parlays share the live game', summaryCalls.length === 2);
  check('the band grades a parlay with its legs', st.grades.get(p3.id)?.legs?.length === 3 && st.grades.get(sgp.id)?.state === 'trail');
  check('a live parlay game keeps the band on the live clock', res.anyLive === true);

  // ------------------------------------------------------------ the normalizer
  console.log('\nB21 — situation through the normalizer');
  const liveEv = normalizeEvent(SL.leagues['football/nfl'][0], 'football/nfl');
  check('possession team id resolves to its abbr', liveEv.situation && liveEv.situation.possession === 'HRK', JSON.stringify(liveEv.situation));
  check('down & distance carried', liveEv.situation.downDistanceText === '2nd & 7 at FDI 14');
  check('red zone carried', liveEv.situation.isRedZone === true);
  check('last play trimmed of ESPN\'s leading space', liveEv.situation.lastPlay.startsWith('(Shotgun)'));
  check('no situation key -> null', normalizeEvent(SL.leagues['football/nfl'][1], 'football/nfl').situation === null);
  const mlbRaw = JSON.parse(JSON.stringify(SL.leagues['baseball/mlb'][0]));
  mlbRaw.competitions[0].situation = { outs: 1, onFirst: true, onSecond: false, onThird: true, balls: 2 };
  const mlbEv = normalizeEvent(mlbRaw, 'baseball/mlb');
  check('baseball outs and bases carried', mlbEv.situation.outs === 1 && mlbEv.situation.onFirst === true && mlbEv.situation.onSecond === false && mlbEv.situation.onThird === true);
  check('absent baseball fields are null, not false', normalizeEvent(SL.leagues['baseball/mlb'][1], 'baseball/mlb').situation === null && normalizeEvent({ id: '1', competitions: [{ competitors: [], situation: { outs: 2 } }] }).situation.onFirst === null);

  // ------------------------------------------------------------ situation line
  console.log('\nB21 — the situation line');
  const { situationLines } = bets;
  const fb = (sit, over = {}) => ({ ...game('f', 'in'), situation: { possession: 'DET', downDistanceText: '2nd & 7 at CAR 31', isRedZone: false, lastPlay: 'J.Gibbs left end for 4 yards.', outs: null, onFirst: null, onSecond: null, onThird: null, ...sit }, ...over });
  let lines = situationLines(fb({}));
  check('football: `{abbr} ball · {down & distance}`', lines[0] === 'DET ball · 2nd & 7 at CAR 31', lines[0]);
  check('football: last play beneath', lines[1] === 'J.Gibbs left end for 4 yards.');
  check('🔴 RZ only when isRedZone', situationLines(fb({ isRedZone: true }))[0] === 'DET ball · 2nd & 7 at CAR 31 · 🔴 RZ' && !/RZ/.test(lines[0]));
  check('missing possession hides its segment', situationLines(fb({ possession: null }))[0] === '2nd & 7 at CAR 31');
  check('missing down & distance hides its segment', situationLines(fb({ downDistanceText: '' }))[0] === 'DET ball');
  const long = 'x'.repeat(69) + ' yyyyyyyyyy';
  const cut = situationLines(fb({ lastPlay: long }))[1];
  check('last play truncated to 70 chars with …', cut.endsWith('…') && cut.length <= 71, `${cut.length} ${cut}`);
  check('a 70-char play is not truncated', situationLines(fb({ lastPlay: 'z'.repeat(70) }))[1] === 'z'.repeat(70));
  check('no last play -> one line', situationLines(fb({ lastPlay: '' })).length === 1);
  check('no situation -> no line', situationLines({ ...game('f', 'in'), situation: null }).length === 0);
  check('only while in: pre -> nothing', situationLines(fb({}, { state: 'pre' })).length === 0);
  check('only while in: post -> nothing', situationLines(fb({}, { state: 'post' })).length === 0);
  const bb = (sit, detail = 'Top 5th') => ({ ...game('b', 'in'), league: 'baseball/mlb', detail, period: 5, situation: { possession: null, downDistanceText: '', isRedZone: false, lastPlay: 'ignored', outs: 1, onFirst: true, onSecond: false, onThird: true, ...sit } });
  check('baseball: `T5 · 1 out · 1st, 3rd`', situationLines(bb({}))[0] === 'T5 · 1 out · 1st, 3rd', situationLines(bb({}))[0]);
  check('baseball: bottom of the inning is B', situationLines(bb({}, 'Bot 7th'))[0].startsWith('B5'));
  check('baseball: bases empty adds nothing', situationLines(bb({ onFirst: false, onThird: false }))[0] === 'T5 · 1 out');
  check('baseball: missing outs hides the segment', situationLines(bb({ outs: null }))[0] === 'T5 · 1st, 3rd');
  check('baseball: one line only (no last play)', situationLines(bb({})).length === 1);
  check('baseball: Mid inning drops the half, keeps the rest', situationLines(bb({}, 'Mid 5th'))[0] === '1 out · 1st, 3rd');
  check('other sports: nothing', situationLines({ ...fb({}), league: 'basketball/nba' }).length === 0);

  // The page labels a kick by its day relative to TODAY ('Yesterday 3:05 PM'), so a
  // fixture pinned to a calendar date goes stale the morning after it was written.
  // Central today, computed here — test code, not page code (rule 7 is the page's).
  const PTODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const tile = (tickets) => ({ band: 'DAILY', status: 'ok', updated_at: `${PTODAY}T16:00:00Z`, error: null, data: { net_u: 0, open_u: 3, record: '1-1', tickets } });
  const single = (over = {}) => ({ id: 's1', league: 'football/nfl', espn_event_id: 'ev-s', game: 'Lions @ Panthers', kick_ct: `${PTODAY} 12:00 PM`, market: 'ml', side: 'away', line: null, label: 'DET ML', stake_u: 1, price: -150, class: 'core', sport: '🏈', to_win_u: 0.67, ...over });
  const liveCtx = (grades, games) => ({ id: 'bets_live', actions: {}, live: { grades: new Map(grades), games: new Map(games), fetched_at: null, error: null } });

  const sRoot = new El('div');
  bets.render(sRoot, tile([single()]), liveCtx([['s1', { state: 'lead', label: 'LEADING', why: 'w', margin: 4 }]], [['ev-s', fb({ isRedZone: true })]]));
  check('a live 🏈 single card renders the situation line', sRoot.querySelector('.game-situation')?.textContent === 'DET ball · 2nd & 7 at CAR 31 · 🔴 RZ');
  check('…and the last play', sRoot.querySelector('.game-lastplay')?.textContent === 'J.Gibbs left end for 4 yards.');
  const sPre = new El('div');
  bets.render(sPre, tile([single()]), liveCtx([['s1', { state: 'pre', label: 'PRE', why: '' }]], [['ev-s', fb({}, { state: 'pre' })]]));
  check('a pre card has no situation line', countOf(sPre, 'game-situation') === 0 && countOf(sPre, 'game-lastplay') === 0);
  const sHostile = new El('div');
  bets.render(sHostile, tile([single()]), liveCtx([['s1', { state: 'lead', label: 'LEADING', why: '' }]], [['ev-s', fb({ lastPlay: '<img src=x onerror=alert(1)>' })]]));
  check('ESPN text lands as text (rule 10)', sHostile.querySelector('.game-lastplay').textContent === '<img src=x onerror=alert(1)>' && countOf(sHostile, 'img') === 0);

  // ------------------------------------------------------------ the parlay card
  console.log('\nB17/B20 — the parlay card');
  const PG = [
    { game: 'Lions @ Panthers', league: 'football/nfl', espn_event_id: 'pg1', home: 'CAR', away: 'DET', kick_ct: `${PTODAY} 7:20 PM` },
    { game: 'Broncos @ 49ers', league: 'football/nfl', espn_event_id: 'pg2', home: 'SF', away: 'DEN', kick_ct: `${PTODAY} 3:25 PM` },
    { game: 'Chiefs @ Raiders', league: 'football/nfl', espn_event_id: 'pg3', home: 'LV', away: 'KC', kick_ct: `${PTODAY} 3:05 PM` },
  ];
  const LEGS = [
    { label: 'Gibbs ATD', market: 'anytime_td', player: 'Gibbs', side: null, line: null },
    { label: 'Javonte Williams O69.5 rush yds', market: 'player_rush_yds', player: 'Javonte Williams', side: 'over', line: 69.5 },
    { label: 'Mahomes O249.5 pass yds', market: 'player_pass_yds', player: 'Patrick Mahomes', side: 'over', line: 249.5 },
  ];
  const parlay = (over = {}) => ({
    id: 'pl-1', market: 'parlay', game: '3-leg parlay · 3.18x', label: 'Gibbs ATD + Williams O69.5 + Mahomes O249.5',
    stake_u: 0.25, price: '3.18x', payout_x: 3.18, to_win_u: 0.55, sport: '🏈', class: 'flier', kick_ct: `${PTODAY} 3:05 PM`,
    league: 'football/nfl', espn_event_id: 'pg1', home: 'CAR', away: 'DET', legs: LEGS, games: PG, ...over,
  });
  const LEG_GRADES = [
    { state: 'win', label: 'WIN', why: 'scored Q2', margin: null, stat: 1, gameId: 'pg1', gameAbbr: 'DET' },
    { state: 'trail', label: 'TRAILING', why: '47 yds, needs 22.5 more', margin: -22.5, stat: 47, gameId: 'pg2', gameAbbr: 'DEN' },
    { state: 'pre', label: 'PRE', why: 'not started', margin: null, stat: null, gameId: null, gameAbbr: '' },
  ];
  const pGames = [
    ['pg1', game('pg1', 'post', { home: { abbr: 'CAR', score: 10 }, away: { abbr: 'DET', score: 24 } })],
    ['pg2', game('pg2', 'in', { period: 2, clock: '0:00' })],
    ['pg3', game('pg3', 'pre')],
    ['pg1-single', game('pg1', 'post')],
  ];
  const pRoot = new El('div');
  bets.render(pRoot, tile([single({ id: 's-same', espn_event_id: 'pg1' }), parlay()]), liveCtx(
    [
      ['pl-1', { state: 'trail', label: 'TRAILING', why: '1/3 legs', margin: null, legs: LEG_GRADES, won: 1, n: 3 }],
      ['s-same', { state: 'win', label: 'WIN', why: 'final' }],
    ],
    pGames
  ));
  const cards = pRoot.querySelectorAll('.game');
  check('a parlay is its own card, never merged into the game card it shares an id with', cards.length === 2 && countOf(pRoot, 'game-parlay') === 1);
  const pc = pRoot.querySelector('.game-parlay');
  check('in-play parlay sorts above a decided single', cards[0] === pc);
  check('header: 🎟️ + the engine\'s label', pc.querySelector('.game-title').textContent === '🎟️3-leg parlay · 3.18x');
  check('right: `{stake_u}u @ {price}`', pc.querySelector('.parlay-stake').textContent === '0.25u @ 3.18x', pc.querySelector('.parlay-stake').textContent);
  check('chip: `{won}/{n} legs ✓`', pc.querySelector('.parlay-legs-chip').textContent === '1/3 legs ✓');
  const chips = pc.querySelectorAll('.parlay-game');
  check('one chip per game, AWAY@HOME, in payload order', chips.map((c) => c.childNodes[1].textContent).join(' ') === 'DET@CAR DEN@SF KC@LV');
  check('state dots: post / in / pre', chips.map((c) => c.querySelector('.parlay-dot').className.replace('parlay-dot parlay-dot-', '')).join() === 'post,in,pre');
  check('kick time on the pre chip only (verbatim Central)', !chips[0].querySelector('.parlay-kick') && !chips[1].querySelector('.parlay-kick') && chips[2].querySelector('.parlay-kick').textContent === '3:05 PM', chips[2].querySelector('.parlay-kick')?.textContent);
  const legRows = pc.querySelectorAll('.parlay-leg');
  check('one row per leg, slip order', legRows.length === 3 && legRows.map((r) => r.querySelector('.ticket-label').childNodes[0].textContent).join('|') === LEGS.map((l) => l.label).join('|'));
  check('found-game abbr, muted', legRows[0].querySelector('.parlay-abbr').textContent === 'DET' && !legRows[2].querySelector('.parlay-abbr'));
  check('readouts: TD ✓ / 47 yds / —', legRows.map((r) => r.querySelector('.parlay-stat').textContent).join('|') === 'TD ✓|47 yds|—');
  check('leg pills follow the leg', legRows.map((r) => r.querySelector('.pill').textContent).join() === 'WIN,TRAILING,PRE');
  check('legs print no units', legRows.every((r) => countOf(r, 'ticket-units') === 0));
  check('every leg has its own cover bar', legRows.every((r) => countOf(r, 'cover-bar') === 1));
  check('ATD leg bar: binary, full green', legRows[0].querySelector('.cover-bar').className.includes('cover-good') && legRows[0].querySelector('.cover-fill-full'));
  check('rush leg bar: left red, 22.5 of ±40 -> 28.1% of the row', legRows[1].querySelector('.cover-fill-left')?.getAttribute('style') === 'width:28.1%', legRows[1].querySelector('.cover-fill')?.getAttribute('style'));
  check('rush leg track drains with ITS game (halftime of pg2 -> 50%)', legRows[1].querySelector('.cover-track').getAttribute('style') === 'width:50.0%');
  check('pre leg bar: notch only, muted', legRows[2].querySelector('.cover-bar').className.includes('cover-muted') && !legRows[2].querySelector('.cover-fill'));
  const foot = pc.querySelector('.parlay-foot');
  check('the footer row carries the ticket pill', foot.querySelector('.pill').textContent === 'TRAILING');
  check('…and the ticket\'s units figure (trail = 0.00u grey)', foot.querySelector('.ticket-units').textContent === '0.00u' && foot.querySelector('.ticket-units').className.includes('ticket-units-flat'));
  check('payout_x printed as the engine sent it', foot.querySelector('.ticket-why').textContent === 'pays 3.18x');
  check('the card has exactly one units figure', countOf(pc, 'ticket-units') === 1);

  const coverBar = bets.coverBar;
  const leg = (market, margin, state = margin > 0 ? 'lead' : 'trail') => coverBar({ market, league: 'football/nfl' }, { state, margin }, game('x', 'in'));
  check('scale ±40 rush yds', leg('player_rush_yds', 20).fill === 0.25);
  check('scale ±100 pass yds', leg('player_pass_yds', -50).fill === 0.25);
  check('scale ±50 rec yds', leg('player_rec_yds', 25).fill === 0.25);
  check('scale ±3 receptions', leg('player_rec', -1.5).fill === 0.25);
  check('a locked leg win is the whole half', leg('player_rec', 0.5, 'win').fill === 0.5);

  // ------------------------------------------------------------ six states, one sum
  console.log('\nB19/B5 — lean-now reconciles across singles + parlays in all six states');
  const six = [
    ['pre', '0.25u', 0],
    ['alive', '0.00u', 0],
    ['lead', '+0.55u', 0.55],
    ['trail', '0.00u', 0],
    ['win', '+0.55u', 0.55],
    ['dead', '−0.25u', -0.25],
  ];
  const mixTickets = [
    single({ id: 'x-lead', espn_event_id: 'xs1' }),
    single({ id: 'x-lose', espn_event_id: 'xs2', stake_u: 0.5, to_win_u: 0.4 }),
    ...six.map(([state]) => parlay({ id: `pp-${state}` })),
  ];
  const mixGrades = [
    ['x-lead', { state: 'lead', label: 'LEADING', why: '' }],
    ['x-lose', { state: 'lose', label: 'LOSS', why: '' }],
    ...six.map(([state]) => [`pp-${state}`, { state, label: state.toUpperCase(), why: '', legs: [], won: 0, n: 3 }]),
  ];
  const mixRoot = new El('div');
  bets.render(mixRoot, tile(mixTickets), liveCtx(mixGrades, [['xs1', game('xs1', 'in')], ['xs2', game('xs2', 'post')], ...pGames]));
  const footBy = new Map(mixRoot.querySelectorAll('.parlay-foot').map((f) => [f.querySelector('.pill').textContent, f.querySelector('.ticket-units').textContent]));
  for (const [state, text] of six) {
    const label = state === 'alive' ? 'ALIVE' : state.toUpperCase();
    check(`parlay ${state}: row prints ${text}`, footBy.get(label) === text, footBy.get(label));
  }
  const contribution = (text) => {
    const m = String(text).match(/^([+−])(\d+(?:\.\d+)?)u$/);
    return m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
  };
  const printed = mixRoot.querySelectorAll('.ticket-units').map((n) => n.textContent);
  const sum = printed.reduce((a, t) => a + contribution(t), 0);
  const leanNow = mixRoot.querySelectorAll('.stat').find((s) => s.querySelector('.stat-label').textContent === 'lean now').querySelector('.stat-value').textContent;
  check('eight rows print a figure (2 singles + 6 parlays)', printed.length === 8, printed.join(' '));
  check(`lean-now (${leanNow}) is the signed sum of the printed rows (${sum.toFixed(2)})`, contribution(leanNow).toFixed(2) === sum.toFixed(2));
  check('…and that sum is +0.67 +(−0.50) +0.55 +0.55 −0.25 = +1.02', leanNow === '+1.02u', leanNow);
  check('ticketUnits: parlay alive is 0.00u flat', bets.ticketUnits(parlay(), { state: 'alive' }).text === '0.00u' && bets.ticketUnits(parlay(), { state: 'alive' }).value === 0);
  check('ticketUnits: a SINGLE trailing still leans −stake (unchanged)', bets.ticketUnits(single(), { state: 'trail' }).text === '−1.00u');
  check('ALIVE wears its own pill class', mixRoot.querySelectorAll('.pill').some((p) => p.textContent === 'ALIVE' && p.className.includes('pill-alive')));
  const CSS = read('docs', 'style.css');
  check('the stylesheet defines .pill-alive', /\.pill-alive\s*\{[^}]*var\(--warn\)/.test(CSS));
  check('…above the cover-bar block (its token scan stays strict)', CSS.indexOf('.pill-alive') < CSS.indexOf('/* B11–B13'));

  // closed: a parlay counts only when ALL its games are final
  const closedOf = (root) => root.querySelectorAll('.stat').find((s) => s.querySelector('.stat-label').textContent === 'closed').querySelector('.stat-value').textContent;
  const cRoot = new El('div');
  bets.render(cRoot, tile([parlay({ id: 'c1' })]), liveCtx([['c1', { state: 'dead', label: 'DEAD', why: '', legs: [] }]], pGames));
  check('a dead parlay with games still to play is not "closed"', closedOf(cRoot) === '0.00u', closedOf(cRoot));
  const allPost = PG.map((m) => [m.espn_event_id, game(m.espn_event_id, 'post')]);
  const cRoot2 = new El('div');
  bets.render(cRoot2, tile([parlay({ id: 'c2' })]), liveCtx([['c2', { state: 'dead', label: 'DEAD', why: '', legs: [] }]], allPost));
  check('…and is once every game is final', closedOf(cRoot2) === '−0.25u', closedOf(cRoot2));

  // ------------------------------------------------------------ the pulse
  console.log('\nB8 — ALIVE is neutral in the pulse table');
  const pulse = (a, b, id) => {
    const r1 = new El('div');
    bets.render(r1, tile([parlay({ id })]), liveCtx([[id, { state: a, label: a, why: '', legs: [] }]], pGames));
    const r2 = new El('div');
    bets.render(r2, tile([parlay({ id })]), liveCtx([[id, { state: b, label: b, why: '', legs: [] }]], pGames));
    return r2.querySelector('.parlay-foot').className;
  };
  check('pre -> alive does not pulse', !/flip-/.test(pulse('pre', 'alive', 'fl-1')));
  check('alive -> lead pulses up', /flip-up/.test(pulse('alive', 'lead', 'fl-2')));
  check('alive -> dead pulses down', /flip-down/.test(pulse('alive', 'dead', 'fl-3')));

  // ------------------------------------------------------------ rule 9
  console.log('\nrule 9 — an older snapshot\'s parlay');
  const old = new El('div');
  let threw = null;
  try {
    bets.render(old, tile([parlay({ id: 'old', legs: undefined, games: undefined })]), { id: 'bets_live', actions: {} });
  } catch (e) {
    threw = e;
  }
  check('no legs, no games, no band: renders without throwing', threw === null, threw && threw.message);
  check('…with the label', old.querySelector('.parlay-leg').querySelector('.ticket-label').textContent === parlay().label);
  check('…and "grading unsupported"', old.querySelector('.parlay-leg').querySelector('.ticket-why').textContent === 'grading unsupported');
  const old2 = new El('div');
  bets.render(old2, tile([parlay({ id: 'old2', legs: 'nope', games: [null, 4] })]), liveCtx([['old2', gradeParlay({ legs: 'nope' }, [])]], []));
  check('hostile legs/games shapes render too', countOf(old2, 'game-parlay') === 1 && countOf(old2, 'parlay-game') === 0);
  const unbanded = new El('div');
  bets.render(unbanded, tile([parlay({ id: 'nb' })]), { id: 'bets_live', actions: {} });
  check('no band: leg rows say "not graded yet", footer shows the plain stake', unbanded.querySelectorAll('.parlay-leg').every((r) => r.querySelector('.ticket-why').textContent === 'not graded yet') && unbanded.querySelector('.parlay-foot').querySelector('.ticket-units').textContent === '0.25u');

  // ------------------------------------------------------------ source scans
  console.log('\nrules 6, 7, 10 — source scans');
  const TILE = read('docs', 'tiles', 'bets_live.js');
  const GR = read('docs', 'live', 'graders.js');
  const BAND = read('docs', 'live', 'band.js');
  const ESPN = read('docs', 'live', 'espn.js');
  check('payout_x is never computed with on the tile', !/payout_x\s*[-+*/]|[-+*/]\s*(?:num\()?\s*ticket\.payout_x/.test(stripComments(TILE)));
  check('the tile computes no payout from stake (no stake × anything)', !/stake\w*\s*\*|\*\s*stake/.test(stripComments(TILE)));
  check('the graders never read payout_x or to_win_u', !/payout_x|to_win_u/.test(stripComments(GR)));
  check('the band never reads payout_x or to_win_u', !/payout_x|to_win_u/.test(stripComments(BAND)));
  check('no innerHTML in the tile, graders, band or espn', ![TILE, GR, BAND, ESPN].some((s) => /innerHTML/.test(s)));
  check('no new Date( on a kick string in the tile', !/new Date\(/.test(stripComments(TILE)));
  check('the footer wording stands', /This is a lean, not a settlement\./.test(TILE));
  // The one legitimate "settled" is the form strip's label for the Bookie's own rows.
  check('no live grade is ever called settled', !/\bsettled\b/i.test(stripComments(TILE).replace('last settled tickets, newest first', '')));

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFAILED:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
