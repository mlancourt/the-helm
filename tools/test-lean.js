#!/usr/bin/env node
/**
 * The Helm — the lean (vault spec `Bets-Live-Lean-Spec.md`, B25–B34). Node,
 * zero deps.
 *
 *   node tools/test-lean.js
 *
 * Part one is `docs/live/lean.js` alone: the spec's "Worked numbers" table to
 * ±0.01, p = p0 at kickoff for every market in every shape, monotone in the
 * margin, the 2% floor in overtime and stoppage, locks, and every input that
 * must come back null. Part two is the tile: expected units on the rows and
 * in the header (reconciled off the DOM), locks reading exactly as before,
 * the percentage, the bar, the sweat line, and a parlay card untouched.
 *
 * Every team, ticket and game here is invented.
 */

const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./dom-shim.js');

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
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const near = (a, b, tol = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tol;

(async () => {
  const L = await import('../docs/live/lean.js');
  const { leanProb, expectedUnits, kickoffLambdas, SIGMA, G } = L;
  const GR = await import('../docs/live/graders.js');
  const { gradeTicket } = GR;

  // A live game: `league`, scores, and the clock the league reads.
  const game = (league, home, away, over = {}) => ({
    id: 'ev-1', league, state: 'in', dead: false, detail: 'live',
    home: { abbr: 'HOM', score: home, linescores: [] },
    away: { abbr: 'AWY', score: away, linescores: [] },
    ...over,
  });
  /** The chance, graded the way the band grades it — real grader, real margin. */
  const pOf = (t, g) => {
    const x = leanProb(t, gradeTicket(t, g), g);
    return x ? x.p : null;
  };
  const tk = (over) => ({ id: `t-${Math.random().toString(36).slice(2)}`, side: 'home', line: null, ...over });

  // ------------------------------------------------------ worked numbers
  console.log('the spec\'s worked numbers (±0.01)');
  const nba = tk({ league: 'basketball/nba', market: 'spread', line: -4.5, p0: 0.524 });
  check('NBA −4.5, p0 .524, up 6 at the half → .686', near(pOf(nba, game('basketball/nba', 56, 50, { period: 2, clock: '0:00' })), 0.686), String(pOf(nba, game('basketball/nba', 56, 50, { period: 2, clock: '0:00' }))));
  check('…and .524 at the tip', near(pOf(nba, game('basketball/nba', 0, 0, { period: 1, clock: '12:00' })), 0.524));
  const nfl3 = tk({ league: 'football/nfl', market: 'spread', line: 3, p0: 0.5 });
  check('NFL +3, p0 .50, down 4, 5:00 left in Q4 → .374', near(pOf(nfl3, game('football/nfl', 17, 21, { period: 4, clock: '5:00' })), 0.374));
  const nflMl = tk({ league: 'football/nfl', market: 'ml', p0: 0.4 });
  check('NFL ML, p0 .40, up 3 at the half → .554', near(pOf(nflMl, game('football/nfl', 10, 7, { period: 2, clock: '0:00' })), 0.554));
  const nflOv = tk({ league: 'football/nfl', market: 'total_over', side: null, line: 44.5, p0: 0.5 });
  check('NFL over 44.5, p0 .50, 30 points at the half → .792', near(pOf(nflOv, game('football/nfl', 17, 13, { period: 2, clock: '0:00' })), 0.792));

  const socMl = tk({ id: 'soc-ml', league: 'soccer/eng.1', market: 'ml', p0: 0.43 });
  const lam = kickoffLambdas(socMl, 'soccer', 0.43);
  check('soccer ML p0 .43 solves λ 1.48 / 1.22', near(lam.pick, 1.48) && near(lam.opp, 1.22), JSON.stringify(lam));
  const soc = (h, a, clock) => game('soccer/eng.1', h, a, { clock });
  for (const [h, a, c, want] of [[1, 0, "20'", 0.699], [1, 0, "80'", 0.891], [0, 1, "60'", 0.062], [0, 0, "75'", 0.182]]) {
    check(`soccer ML ${h}–${a} at ${c} → ${want}`, near(pOf(socMl, soc(h, a, c)), want), String(pOf(socMl, soc(h, a, c))));
  }
  const socU = tk({ id: 'soc-u', league: 'soccer/eng.1', market: 'total_under', side: null, line: 2.5, p0: 0.55 });
  const lamU = kickoffLambdas(socU, 'soccer', 0.55);
  check('soccer under 2.5 p0 .55 solves G 2.48', near(lamU.pick + lamU.opp, 2.48), String(lamU.pick + lamU.opp));
  for (const [h, a, c, want] of [[0, 0, "30'", 0.77], [1, 0, "30'", 0.509], [1, 1, "60'", 0.438], [2, 0, "85'", 0.871]]) {
    check(`soccer under 2.5, ${h + a} goals at ${c} → ${want}`, near(pOf(socU, soc(h, a, c)), want), String(pOf(socU, soc(h, a, c))));
  }
  const mlb = tk({ id: 'mlb-ml', league: 'baseball/mlb', market: 'ml', p0: 0.58 });
  const lamB = kickoffLambdas(mlb, 'baseball', 0.58);
  check('MLB ML p0 .58 solves λ 4.70 / 4.10', near(lamB.pick, 4.7) && near(lamB.opp, 4.1), JSON.stringify(lamB));
  const bb = (h, a, inning) => game('baseball/mlb', h, a, { period: inning });
  for (const [h, a, i, want] of [[2, 0, 3, 0.84], [2, 3, 7, 0.265], [4, 4, 9, 0.506]]) {
    check(`MLB ML ${h}–${a} in the ${i} → ${want}`, near(pOf(mlb, bb(h, a, i)), want), String(pOf(mlb, bb(h, a, i))));
  }
  const td = tk({ league: 'football/nfl', market: 'anytime_td', side: null, player: 'D. Vasquez', p0: 0.4 });
  const tdHalf = leanProb(td, { state: 'trail', margin: null }, game('football/nfl', 7, 3, { period: 2, clock: '0:00' }));
  check('anytime TD, p0 .40, half gone, no score → .225', near(tdHalf && tdHalf.p, 0.225), JSON.stringify(tdHalf));

  // ---------------------------------------------------- p = p0 at kickoff
  console.log('\np = p0 at kickoff, every market, every shape');
  const KICK = {
    'football/nfl': { period: 1, clock: '15:00' },
    'football/college-football': { period: 1, clock: '15:00' },
    'basketball/nba': { period: 1, clock: '12:00' },
    'basketball/wnba': { period: 1, clock: '10:00' },
    'basketball/mens-college-basketball': { period: 1, clock: '20:00' },
    'soccer/usa.1': { clock: "0'" },
    'baseball/mlb': { period: 0.0001 },
    'hockey/nhl': { period: 1, clock: '20:00' },
  };
  // Baseball's progress is inning/9 off `period`; a vanishing period is the
  // first pitch. Every other league has a real kickoff clock.
  const BELL = ['spread', 'spread_1h', 'ml', 'total_over', 'total_under', 'team_total_over', 'team_total_under'];
  const POIS = ['ml', 'spread', 'dc', 'total_over', 'total_under', 'draw', 'team_total_over', 'team_total_under'];
  const lineFor = (m, sport) => {
    if (m === 'ml' || m === 'draw' || m === 'dc') return null;
    if (m.startsWith('spread')) return sport === 'soccer' || sport === 'hockey' || sport === 'baseball' ? -1.5 : -3.5;
    if (m.startsWith('team_total')) return { soccer: 1.5, hockey: 2.5, baseball: 4.5 }[sport] ?? 23.5;
    return { soccer: 2.5, hockey: 5.5, baseball: 8.5 }[sport] ?? 45.5;
  };
  for (const [league, clock] of Object.entries(KICK)) {
    const sport = league.split('/')[0];
    const markets = SIGMA[league] ? BELL : POIS;
    for (const market of markets) {
      for (const p0 of [0.35, 0.52, 0.7]) {
        const t = tk({ id: `k-${league}-${market}-${p0}`, league, market, side: market.startsWith('total') || market === 'draw' ? null : 'home', line: lineFor(market, sport), p0 });
        // A started game carries a 0 in its first period's linescore.
        const g = game(league, 0, 0, { ...clock, home: { abbr: 'HOM', score: 0, linescores: [0] }, away: { abbr: 'AWY', score: 0, linescores: [0] } });
        const got = pOf(t, g);
        check(`${league} ${market} p0 ${p0} → p0 at kickoff`, near(got, p0, 0.005), String(got));
      }
    }
  }
  const tdKick = leanProb(td, { state: 'trail' }, game('football/nfl', 0, 0, KICK['football/nfl']));
  check('decay: anytime TD is p0 at kickoff', near(tdKick && tdKick.p, 0.4, 1e-9));

  // ------------------------------------------------- monotone in the margin
  console.log('\np rises with the margin, every shape');
  const mono = (vals) => vals.every((v, i) => i === 0 || v >= vals[i - 1] - 1e-12) && vals[vals.length - 1] > vals[0];
  const nflSp = tk({ league: 'football/nfl', market: 'spread', line: -3.5, p0: 0.52 });
  const nflSeries = [-21, -14, -7, -3, 0, 3, 7, 14, 21].map((d) => pOf(nflSp, game('football/nfl', 20 + d, 20, { period: 3, clock: '7:30' })));
  check('bell: NFL spread, down 21 → up 21', mono(nflSeries), nflSeries.map((x) => x.toFixed(3)).join(' '));
  const ovSeries = [10, 20, 30, 40, 44].map((tot) => pOf(nflOv, game('football/nfl', tot, 0, { period: 3, clock: '7:30' })));
  check('bell: NFL over, total 10 → 44', mono(ovSeries), ovSeries.map((x) => x.toFixed(3)).join(' '));
  const socSeries = [[0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0]].map(([h, a]) => pOf(socMl, soc(h, a, "55'")));
  check('Poisson: soccer ML, 0–3 → 3–0', mono(socSeries), socSeries.map((x) => x.toFixed(3)).join(' '));
  const mlbRl = tk({ id: 'mlb-rl', league: 'baseball/mlb', market: 'spread', line: -1.5, p0: 0.45 });
  const rlSeries = [[1, 5], [3, 4], [4, 4], [5, 4], [6, 4], [8, 4]].map(([h, a]) => pOf(mlbRl, bb(h, a, 6)));
  check('Poisson: MLB run line, 1–5 → 8–4', mono(rlSeries), rlSeries.map((x) => x.toFixed(3)).join(' '));
  const nhlTt = tk({ id: 'nhl-tt', league: 'hockey/nhl', market: 'team_total_over', line: 3.5, p0: 0.4 });
  const ttSeries = [0, 1, 2, 3].map((n) => pOf(nhlTt, game('hockey/nhl', n, 1, { period: 2, clock: '10:00' })));
  check('Poisson: NHL team total over 3.5, 0 → 3 goals', mono(ttSeries), ttSeries.map((x) => x.toFixed(3)).join(' '));
  const tdSeries = [0, 0.25, 0.5, 0.75, 0.97].map((prog) => leanProb(td, { state: 'trail' }, game('football/nfl', 0, 0, { period: Math.floor(prog * 4) + 1, clock: `${Math.round(15 * (1 - ((prog * 4) % 1)))}:00` })).p);
  check('decay: the TD lean only falls as time runs without a score', tdSeries.every((v, i) => i === 0 || v <= tdSeries[i - 1] + 1e-12) && tdSeries[0] > tdSeries[tdSeries.length - 1], tdSeries.map((x) => x.toFixed(3)).join(' '));

  // -------------------------------------------------------- the 2% floor
  console.log('\nthe r floor (B31): overtime and stoppage never divide by zero');
  const otTie = pOf(nflMl, game('football/nfl', 20, 20, { period: 5, clock: '8:00' }));
  check('NFL overtime, level: finite and near a coin flip', Number.isFinite(otTie) && otTie > 0.3 && otTie < 0.7, String(otTie));
  const otUp = pOf(nflMl, game('football/nfl', 23, 20, { period: 5, clock: '8:00' }));
  check('NFL overtime, up 3: finite and high', Number.isFinite(otUp) && otUp > 0.9 && otUp < 1, String(otUp));
  const nbaOt = pOf(nba, game('basketball/nba', 110, 108, { period: 5, clock: '2:00' }));
  check('NBA overtime: finite', Number.isFinite(nbaOt) && nbaOt > 0 && nbaOt < 1, String(nbaOt));
  const stoppage = pOf(socMl, soc(0, 0, "90'+4'"));
  check('soccer stoppage, level: finite and small (a draw loses the ML)', Number.isFinite(stoppage) && stoppage > 0 && stoppage < 0.05, String(stoppage));
  const stoppage2 = pOf(socMl, soc(1, 0, "90'+4'"));
  check('soccer stoppage, ahead: finite and near certain', Number.isFinite(stoppage2) && stoppage2 > 0.95 && stoppage2 < 1, String(stoppage2));
  const extras = pOf(mlb, bb(5, 5, 11));
  check('MLB extras, level: finite, about a coin flip', Number.isFinite(extras) && near(extras, 0.5, 0.05), String(extras));
  const tdOt = leanProb(td, { state: 'trail' }, game('football/nfl', 20, 20, { period: 5, clock: '5:00' }));
  check('decay in overtime: finite, above zero', tdOt && tdOt.p > 0 && tdOt.p < 0.4, JSON.stringify(tdOt));
  const h1 = tk({ league: 'football/nfl', market: 'spread_1h', line: -3.5, p0: 0.5 });
  const h1g = game('football/nfl', 10, 3, { period: 2, clock: '0:01', home: { abbr: 'HOM', score: 10, linescores: [7, 3] }, away: { abbr: 'AWY', score: 3, linescores: [3, 0] } });
  const h1p = pOf(h1, h1g);
  check('1H spread at the last second of the half: finite (r clamps at 0.02)', Number.isFinite(h1p) && h1p > 0.9, String(h1p));

  // ------------------------------------------------------------- locks
  console.log('\nlocks win (B31)');
  const any = tk({ league: 'football/nfl', market: 'spread', line: -3.5, p0: 0.52 });
  const g0 = game('football/nfl', 0, 0, { period: 3, clock: '1:00' });
  check('win → {p: 1, push: 0}', JSON.stringify(leanProb(any, { state: 'win' }, g0)) === '{"p":1,"push":0}');
  check('lose → {p: 0, push: 0}', JSON.stringify(leanProb(any, { state: 'lose' }, g0)) === '{"p":0,"push":0}');
  check('dead → {p: 0, push: 0}', JSON.stringify(leanProb(any, { state: 'dead' }, { ...g0, dead: true })) === '{"p":0,"push":0}');
  check('a locked push is all push', JSON.stringify(leanProb(any, { state: 'push' }, { ...g0, state: 'post' })) === '{"p":0,"push":1}');
  check('a lock needs no clock: win with an unreadable clock is still 1', leanProb(any, { state: 'win' }, { ...g0, clock: 'Halftime' }).p === 1);
  check('pre → null', leanProb(any, { state: 'pre' }, { ...g0, state: 'pre' }) === null);

  // -------------------------------------------------------------- nulls
  console.log('\nwhat the lean will not price is null, never a throw');
  const live = { state: 'lead', margin: 3 };
  check('no ticket', leanProb(null, live, g0) === null && leanProb(undefined, live, g0) === null && leanProb('x', live, g0) === null);
  check('a parlay', leanProb({ ...any, market: 'parlay' }, live, g0) === null);
  check('BTTS', leanProb({ ...any, market: 'btts' }, live, g0) === null);
  check('a null market', leanProb({ ...any, market: null }, live, g0) === null);
  check('a stat prop', leanProb({ ...any, market: 'player_rush_yds' }, live, g0) === null);
  check('a league not in the tables', leanProb({ ...any, league: 'basketball/fiba' }, live, { ...g0, league: 'basketball/fiba' }) === null && leanProb({ ...any, league: 'cricket/ipl' }, live, g0) === null);
  check('a bell market on a Poisson sport it does not price (1H in soccer)', leanProb({ ...socMl, market: 'spread_1h', line: -0.5 }, live, soc(1, 0, "30'")) === null);
  check('draw/dc in football are not priced', leanProb({ ...any, market: 'draw' }, live, g0) === null && leanProb({ ...any, market: 'dc' }, live, g0) === null);
  check('p0 missing', leanProb({ ...any, p0: undefined }, live, g0) === null && leanProb({ ...any, p0: null }, live, g0) === null && leanProb({ ...any, p0: '' }, live, g0) === null);
  check('p0 out of range (a percent sent as 52.4, 0, 1)', [52.4, 0, 1, -0.2, 'abc'].every((p0) => leanProb({ ...any, p0 }, live, g0) === null));
  check('…and a lock on a ticket with no p0 is still null (the old ladder takes it)', leanProb({ ...any, p0: null }, { state: 'win' }, g0) === null);
  check('no grade', leanProb(any, null, g0) === null && leanProb(any, undefined, g0) === null);
  check('an unsupported grade', leanProb(any, { state: 'unsupported' }, g0) === null);
  check('no game', leanProb(any, live, null) === null);
  check('a null gameProgress (unreadable clock)', leanProb(any, live, { ...g0, clock: 'Halftime' }) === null);
  check('a null margin on a bell market', leanProb(any, { state: 'lead', margin: null }, g0) === null);
  check('a Poisson side market with no side', leanProb({ ...socMl, side: null }, { state: 'even' }, soc(0, 0, "30'")) === null);
  check('a team total with side null (engine could not tie it)', leanProb({ ...nhlTt, side: null }, { state: 'trail' }, game('hockey/nhl', 1, 1, { period: 2, clock: '10:00' })) === null);
  check('a game missing its scores', leanProb(socMl, { state: 'even' }, { ...soc(0, 0, "30'"), home: {} }) === null);
  check('a hostile ticket never throws', (() => {
    try {
      const evil = { get market() { throw new Error('boom'); } };
      return leanProb(evil, live, g0) === null;
    } catch {
      return false;
    }
  })());
  check('the kickoff solve is cached per ticket id, re-solved when p0 moves', (() => {
    const t = tk({ id: 'cache-1', league: 'soccer/usa.1', market: 'ml', p0: 0.5 });
    const a = kickoffLambdas(t, 'soccer', 0.5);
    const b = kickoffLambdas(t, 'soccer', 0.5);
    const c = kickoffLambdas({ ...t, p0: 0.6 }, 'soccer', 0.6);
    return a === b && c !== a && c.pick > a.pick;
  })());

  // ----------------------------------------------------- expected units
  console.log('\nexpectedUnits (B28)');
  check('a lock is exact: p = 1 → +to_win_u', expectedUnits({ p: 1, push: 0 }, 0.62, 0.5) === 0.62);
  check('p = 0 → −stake_u', expectedUnits({ p: 0, push: 0 }, 0.62, 0.5) === -0.5);
  check('a locked push → 0', expectedUnits({ p: 0, push: 1 }, 0.62, 0.5) === 0);
  check('p × to_win − (1 − p − push) × stake, to the cent', expectedUnits({ p: 0.6, push: 0.1 }, 0.91, 1) === 0.25);
  check('a fair ticket at its own price is worth about nothing', Math.abs(expectedUnits({ p: 110 / 210, push: 0 }, 0.91, 1)) <= 0.01);
  check('missing figures → null', expectedUnits(null, 1, 1) === null && expectedUnits({ p: 0.5, push: 0 }, null, 1) === null && expectedUnits({ p: 0.5, push: 0 }, 1, null) === null);
  check('never −0', Object.is(expectedUnits({ p: 0.5, push: 0 }, 1, 1), 0));

  // ------------------------------------------------------------ source
  console.log('\nlean.js — one home (B34), no clock, no odds math');
  const LSRC = read('docs', 'live', 'lean.js');
  const LCODE = stripComments(LSRC);
  check('no DOM, no fetch, no clock', !/document\.|fetch\(|Date\.now|new Date|localStorage|setTimeout|setInterval/.test(LCODE));
  check('reads no price, no payout and no to_win_u off a ticket', !/\.price\b|payout_x|to_win_u/.test(LCODE));
  check('the σ and G tables sit at the top of the file', LSRC.indexOf('export const SIGMA') < LSRC.indexOf('function phi') && LSRC.indexOf('export const G ') < LSRC.indexOf('function phi'));
  check('σ table is the spec\'s', JSON.stringify(SIGMA['football/nfl']) === '{"side":13.5,"total":13.5,"team":9.5}' && SIGMA['basketball/mens-college-basketball'].team === 10.5);
  check('G table is the spec\'s', G.soccer === 2.7 && G.baseball === 8.8 && G.hockey === 6.1);
  check('the graders do not import the lean', !/lean\.js/.test(stripComments(read('docs', 'live', 'graders.js'))));
  check('the band does not import the lean', !/lean\.js/.test(stripComments(read('docs', 'live', 'band.js'))));
  check('nothing else in the page computes a chance (no other Φ / Poisson)', ['docs/tiles/bets_live.js', 'docs/live/graders.js', 'docs/live/band.js'].every((f) => !/Math\.exp|erf|phiInv|pmf\(/.test(stripComments(read(...f.split('/'))))));

  // =================================================== part two: the tile
  console.log('\nbets_live — expected units on the board (B28–B30)');
  const bets = await import('../docs/tiles/bets_live.js');
  const PTODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const betsTile = (tickets) => ({ band: 'DAILY', status: 'ok', updated_at: `${PTODAY}T16:00:00Z`, error: null, data: { net_u: 0, open_u: 3, record: '1-1', tickets } });
  const statValue = (root, label) => root.querySelectorAll('.stat').find((s) => s.querySelector('.stat-label').textContent === label).querySelector('.stat-value').textContent;
  const unitsCells = (root) => root.querySelectorAll('.ticket-units').map((n) => n.textContent);
  const contribution = (text) => {
    const m = String(text).match(/^([+−])(\d+(?:\.\d+)?)u$/);
    return m ? (m[1] === '+' ? 1 : -1) * Number(m[2]) : 0;
  };
  const countOf = (root, cls) => root.querySelectorAll(`.${cls}`).length;
  /** The DOM as a string: tag, attributes, classes, text — what "byte-identical" compares. */
  const ser = (n) => {
    if (!n) return '';
    if (!n.tagName) return JSON.stringify(n.textContent);
    const attrs = Object.entries(n.attrs || {}).sort().map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    const kids = n.childNodes.length ? n.childNodes.map(ser).join('') : JSON.stringify(n._text || '');
    return `<${n.tagName} ${attrs} cls=${JSON.stringify(n.classList.value)}>${kids}</${n.tagName}>`;
  };
  const tkt = (over = {}) => ({
    id: 'b-1', league: 'football/nfl', espn_event_id: 'ev-live', game: 'Kestrels at Ironsides', kick_ct: `${PTODAY} 15:25`,
    market: 'spread', side: 'away', line: -3.5, player: null, label: 'Kestrels -3.5', stake_u: 1, price: -110, class: 'core', sport: '🏈', to_win_u: 0.91, ...over,
  });
  const nflLive = (over = {}) => ({ id: 'ev-live', league: 'football/nfl', state: 'in', dead: false, detail: 'Q3 7:30', period: 3, clock: '7:30', home: { abbr: 'FIS', score: 17, linescores: [7, 7, 3] }, away: { abbr: 'HKS', score: 21, linescores: [7, 7, 7] }, ...over });
  const nflPost = () => nflLive({ id: 'ev-post', state: 'post', detail: 'Final', period: 4, clock: '0:00' });
  const nflPre = () => nflLive({ id: 'ev-pre', state: 'pre', detail: '', home: { abbr: 'FIS', score: 0, linescores: [] }, away: { abbr: 'HKS', score: 0, linescores: [] } });
  const socLive = () => ({ id: 'ev-soc', league: 'soccer/usa.1', state: 'in', dead: false, detail: "62'", period: 2, clock: "62'", home: { abbr: 'RVB', score: 1, linescores: [] }, away: { abbr: 'CHS', score: 1, linescores: [] } });
  const GAMES = new Map([['ev-live', nflLive()], ['ev-post', nflPost()], ['ev-pre', nflPre()], ['ev-soc', socLive()]]);
  const gradeAll = (tickets) => new Map(tickets.map((t) => [t.id, t.market === 'parlay' ? { state: 'alive', label: 'ALIVE', why: '0/1 legs', legs: [], won: 0, n: 1 } : gradeTicket(t, GAMES.get(t.espn_event_id))]));
  const ctxFor = (tickets, fetched_at = '2026-11-11T20:00:00.000Z') => ({ id: 'bets_live', actions: {}, live: { grades: gradeAll(tickets), games: GAMES, fetched_at, error: null } });

  const MIXED = [
    tkt({ id: 'x-lead', p0: 0.5238 }),                                       // HKS −3.5 up 4: covering
    tkt({ id: 'x-trail', side: 'home', line: 3.5, p0: 0.5238, label: 'Ironsides +3.5' }), // short by 0.5
    tkt({ id: 'x-tt', market: 'team_total_over', side: 'home', line: 20.5, p0: 0.5349, to_win_u: 0.87, label: 'FIS TT o20.5' }),
    tkt({ id: 'x-noprice', p0: null }),                                      // no p0: the B4 ladder
    tkt({ id: 'x-pre', espn_event_id: 'ev-pre', p0: 0.55 }),
    tkt({ id: 'x-win', espn_event_id: 'ev-post', p0: 0.5238, to_win_u: 1.82, stake_u: 2 }),
    tkt({ id: 'x-lose', espn_event_id: 'ev-post', side: 'home', line: 2.5, p0: 0.5, to_win_u: 0.42, stake_u: 0.75 }),
    tkt({ id: 'x-draw', league: 'soccer/usa.1', espn_event_id: 'ev-soc', market: 'draw', side: null, line: null, p0: 0.2941, stake_u: 0.5, to_win_u: 1.2, sport: '⚽', label: 'Draw' }),
    tkt({ id: 'x-dc', league: 'soccer/usa.1', espn_event_id: 'ev-soc', market: 'dc', side: 'home', line: null, p0: 0.6, stake_u: 1, to_win_u: 0.67, sport: '⚽', label: 'CHS No' }),
    tkt({ id: 'x-btts', league: 'soccer/usa.1', espn_event_id: 'ev-soc', market: 'btts', side: null, line: null, p0: 0.55, stake_u: 0.5, to_win_u: 0.42, sport: '⚽', label: 'BTTS' }),
    tkt({ id: 'x-nowin', p0: 0.5238, to_win_u: null }),
  ];
  const root = new El('div');
  bets.render(root, betsTile(MIXED), ctxFor(MIXED));
  const cells = unitsCells(root);
  check('every ticket prints a units figure', cells.length === MIXED.length, cells.join(' | '));
  const summed = cells.reduce((n, t) => n + contribution(t), 0);
  const lean = statValue(root, 'lean now');
  check('the header is the sum of the printed rows (B28, off the DOM)', lean === (Math.abs(summed) < 0.005 ? '0.00u' : `${summed > 0 ? '+' : '−'}${Math.abs(summed).toFixed(2)}u`), `${lean} vs ${summed}`);
  const rowOf = (id) => root.querySelectorAll('.ticket').find((r) => r.querySelector('.ticket-label').textContent === MIXED.find((t) => t.id === id).label && r.querySelector('.ticket-units')) || null;
  const rows = new Map(root.querySelectorAll('.ticket').map((r, i) => [i, r]));
  // Board order is by card; find each row by its units cell in snapshot order within card.
  const ev = (id) => {
    const t = MIXED.find((x) => x.id === id);
    return expectedUnits(leanProb(t, gradeAll([t]).get(id), GAMES.get(t.espn_event_id)), t.to_win_u, t.stake_u);
  };
  check('a covering ticket prints its expected value, not the whole to_win', cells.includes(`+${ev('x-lead').toFixed(2)}u`) && ev('x-lead') < 0.91 && ev('x-lead') > 0, String(ev('x-lead')));
  check('a ticket short of its number prints a negative EV smaller than the stake', ev('x-trail') < 0 && ev('x-trail') > -1 && cells.includes(`−${Math.abs(ev('x-trail')).toFixed(2)}u`), String(ev('x-trail')));
  check('a team total is priced too', Number.isFinite(ev('x-tt')) && cells.includes(`${ev('x-tt') > 0 ? '+' : '−'}${Math.abs(ev('x-tt')).toFixed(2)}u`));
  check('a level soccer draw ticket leans its way', ev('x-draw') > 0, String(ev('x-draw')));
  check('a level double chance leans its way', ev('x-dc') > 0, String(ev('x-dc')));
  check('closed is still the finished games only, exactly as before', statValue(root, 'closed') === '+1.07u', statValue(root, 'closed'));

  // Locks and the unpriced read exactly as they did before the lean.
  const one = (t, games = GAMES) => {
    const r = new El('div');
    bets.render(r, betsTile([t]), { id: 'bets_live', actions: {}, live: { grades: gradeAll([t]), games, fetched_at: null, error: null } });
    return r;
  };
  check('a locked WIN reads +to_win_u exactly', unitsCells(one(tkt({ id: 'l-w', espn_event_id: 'ev-post', p0: 0.4, to_win_u: 1.82, stake_u: 2 })))[0] === '+1.82u');
  check('a locked LOSS reads −stake_u exactly', unitsCells(one(tkt({ id: 'l-l', espn_event_id: 'ev-post', side: 'home', line: 2.5, p0: 0.7, to_win_u: 0.42, stake_u: 0.75 })))[0] === '−0.75u');
  check('a locked total over mid-game is +to_win_u, not an EV', unitsCells(one(tkt({ id: 'l-o', market: 'total_over', side: null, line: 30.5, p0: 0.5, to_win_u: 0.95 })))[0] === '+0.95u');
  check('PRE stays the grey stake', (() => { const r = one(tkt({ id: 'l-p', espn_event_id: 'ev-pre', p0: 0.5 })); return unitsCells(r)[0] === '1.00u' && countOf(r, 'ticket-units-idle') === 1; })());
  check('no p0: a covering ticket is the whole +to_win_u, as before (B4)', unitsCells(one(tkt({ id: 'l-n', p0: null })))[0] === '+0.91u');
  check('no p0: a trailing ticket is the whole −stake_u, as before', unitsCells(one(tkt({ id: 'l-n2', side: 'home', line: 3.5, p0: null })))[0] === '−1.00u');
  check('no to_win_u: the plain stake, priced or not', unitsCells(one(tkt({ id: 'l-nw', p0: 0.52, to_win_u: null })))[0] === '1.00u');
  check('BTTS with a p0 keeps its ladder (not priced)', unitsCells(one(tkt({ id: 'l-bt', league: 'soccer/usa.1', espn_event_id: 'ev-soc', market: 'btts', side: null, line: null, p0: 0.55, to_win_u: 0.42 })))[0] === '+0.42u');

  // -- the percentage (B29) --------------------------------------------------
  console.log('\nbets_live — the percentage beside the pill (B29)');
  const pctOf = (r) => { const n = r.querySelector('.ticket-pct'); return n ? n.textContent : null; };
  const leadRow = one(tkt({ id: 'pc-1', p0: 0.5238 }));
  const wantPct = `${Math.round(leanProb(tkt({ id: 'pc-1', p0: 0.5238 }), gradeTicket(tkt({ p0: 0.5238 }), nflLive()), nflLive()).p * 100)}%`;
  check('a live priced ticket prints a whole percent', pctOf(leadRow) === wantPct && /^\d{1,3}%$/.test(pctOf(leadRow)), pctOf(leadRow));
  check('beside the pill, in one row', leadRow.querySelector('.ticket-odds') && leadRow.querySelector('.ticket-odds').childNodes.length === 2 && leadRow.querySelector('.ticket-odds').childNodes[1].classList.contains('pill'));
  check('pre-game: no percentage', pctOf(one(tkt({ id: 'pc-2', espn_event_id: 'ev-pre', p0: 0.5 }))) === null);
  check('a locked result: no percentage', pctOf(one(tkt({ id: 'pc-3', espn_event_id: 'ev-post', p0: 0.5 }))) === null && pctOf(one(tkt({ id: 'pc-4', market: 'total_over', side: null, line: 30.5, p0: 0.5 }))) === null);
  check('no p0: no percentage, and the pill sits where it always did', (() => { const r = one(tkt({ id: 'pc-5', p0: null })); return pctOf(r) === null && countOf(r, 'ticket-odds') === 0 && r.querySelector('.ticket-side').childNodes[0].classList.contains('pill'); })());
  check('the pill still says the score: LEADING can sit beside a number under 50%', (() => {
    // Up 1 with a −7 line on the ml market: LEADING, but a long-shot price.
    const t = tkt({ id: 'pc-6', market: 'ml', line: null, p0: 0.2 });
    const r = one(t, new Map([['ev-live', nflLive({ period: 1, clock: '10:00', home: { abbr: 'FIS', score: 0, linescores: [0] }, away: { abbr: 'HKS', score: 1, linescores: [1] } })]]));
    return /LEADING/.test(r.querySelector('.pill').textContent) && Number(pctOf(r).replace('%', '')) < 50 && countOf(r, 'cover-bad') === 1;
  })());

  // -- the bar (B29) ---------------------------------------------------------
  console.log('\nbets_live — the bar draws the chance (B29)');
  const { coverBar } = bets;
  const g = nflLive();
  const barFor = (t) => coverBar(t, gradeTicket(t, g), g);
  const pFor = (t) => leanProb(t, gradeTicket(t, g), g).p;
  const up = tkt({ id: 'cb-up', p0: 0.5238 });
  check('p > 0.5: right, good, |p − 0.5|', (() => { const b = barFor(up); return b.side === 'right' && b.tone === 'good' && Math.abs(b.fill - (pFor(up) - 0.5)) < 1e-12; })(), JSON.stringify(barFor(up)));
  const down = tkt({ id: 'cb-dn', side: 'home', line: 3.5, p0: 0.5238 });
  check('p < 0.5: left, bad, |p − 0.5|', (() => { const b = barFor(down); return b.side === 'left' && b.tone === 'bad' && Math.abs(b.fill - (0.5 - pFor(down))) < 1e-12; })(), JSON.stringify(barFor(down)));
  check('the track still drains with the game (B13)', Math.abs(barFor(up).track - (1 - GR.gameProgress(g))) < 1e-12);
  check('a locked win keeps the whole half', (() => { const t = tkt({ id: 'cb-w', market: 'total_over', side: null, line: 30.5, p0: 0.5 }); const b = barFor(t); return b.side === 'right' && b.fill === 0.5 && b.tone === 'good'; })());
  check('a priced anytime TD trailing draws its chance, not the binary full bar', (() => {
    const t = tkt({ id: 'cb-td', market: 'anytime_td', side: null, line: null, player: 'D. Vasquez', p0: 0.4 });
    const b = coverBar(t, { state: 'trail', margin: null }, g);
    return b.side === 'left' && b.tone === 'bad' && b.fill > 0 && b.fill < 0.5;
  })());
  check('an unpriced anytime TD keeps the binary full bar (B12)', coverBar(tkt({ market: 'anytime_td', p0: null }), { state: 'trail' }, g).side === 'full');
  check('parlay stat legs keep MARKET_SCALE', coverBar({ market: 'player_rush_yds', league: 'football/nfl' }, { state: 'lead', margin: 20 }, g).fill === 0.25);

  // -- the sweat line (B30) --------------------------------------------------
  console.log('\nbets_live — the sweat line (B30)');
  const sw = tkt({ id: 'sw-1', p0: 0.5238 });
  const pass1 = new El('div');
  bets.render(pass1, betsTile([sw]), ctxFor([sw], '2026-11-11T20:00:00.000Z'));
  check('one point is not a line', countOf(pass1, 'bets-sweat') === 0);
  const again = new El('div');
  bets.render(again, betsTile([sw]), ctxFor([sw], '2026-11-11T20:00:00.000Z'));
  check('a re-render on the same grade pass adds no point', countOf(again, 'bets-sweat') === 0);
  const pass2 = new El('div');
  bets.render(pass2, betsTile([sw]), ctxFor([sw], '2026-11-11T20:00:20.000Z'));
  const svg = pass2.querySelector('.bets-sweat');
  check('two passes draw it', !!svg && String(svg.tagName).toLowerCase() === 'svg', svg && svg.tagName);
  check('aria-hidden, no text', svg && svg.getAttribute('aria-hidden') === 'true' && svg.textContent === '');
  const mid = svg && svg.querySelector('.bets-sweat-mid');
  check('a dotted 50% line at the middle of a fixed 0–1 scale', !!mid && Number(mid.getAttribute('y1')) === 8 && Number(mid.getAttribute('y2')) === 8, mid && mid.getAttribute('y1'));
  check('one faint path', svg && countOf(svg, 'bets-sweat-line') === 1);
  check('the last point wears the bar\'s tone', svg && countOf(svg, 'bets-sweat-now-good') === 1);
  // 400 passes: capped.
  for (let i = 0; i < 420; i++) {
    bets.render(new El('div'), betsTile([sw]), ctxFor([sw], `2026-11-11T21:${String(Math.floor(i / 3)).padStart(2, '0')}:${String((i % 3) * 20).padStart(2, '0')}.000Z`));
  }
  const capped = new El('div');
  bets.render(capped, betsTile([sw]), ctxFor([sw], '2026-11-11T23:59:40.000Z'));
  const dPath = capped.querySelector('.bets-sweat-line').getAttribute('d');
  check('capped at 400 points (gaps lift the pen, never add points)', (dPath.match(/[ML]/g) || []).length <= 400, String((dPath.match(/[ML]/g) || []).length));
  // A sleep: a 10-minute hole lifts the pen.
  const sl = tkt({ id: 'sw-2', p0: 0.5238 });
  for (const ts of ['2026-11-11T20:00:00.000Z', '2026-11-11T20:00:20.000Z', '2026-11-11T20:10:20.000Z', '2026-11-11T20:10:40.000Z']) bets.render(new El('div'), betsTile([sw, sl]), ctxFor([sw, sl], ts));
  const slept = new El('div');
  bets.render(slept, betsTile([sl]), ctxFor([sl], '2026-11-11T20:11:00.000Z'));
  const dSlept = slept.querySelector('.bets-sweat-line').getAttribute('d');
  check('a gap where the page slept: the pen lifts once', (dSlept.match(/M/g) || []).length === 2, dSlept);
  // sw-1 left the board on that render: forgotten.
  const back = new El('div');
  bets.render(back, betsTile([sw]), ctxFor([sw], '2026-11-11T20:12:00.000Z'));
  check('a ticket that left the board is forgotten', countOf(back, 'bets-sweat') === 0);
  check('pre-game draws no sweat line and records nothing', (() => {
    const t = tkt({ id: 'sw-pre', espn_event_id: 'ev-pre', p0: 0.5 });
    for (const ts of ['2026-11-11T20:00:00.000Z', '2026-11-11T20:00:20.000Z', '2026-11-11T20:00:40.000Z']) bets.render(new El('div'), betsTile([t]), ctxFor([t], ts));
    const r = new El('div');
    bets.render(r, betsTile([t]), ctxFor([t], '2026-11-11T20:01:00.000Z'));
    return countOf(r, 'bets-sweat') === 0;
  })());
  check('an unpriced ticket draws none', (() => {
    const t = tkt({ id: 'sw-np', p0: null });
    for (const ts of ['2026-11-11T20:00:00.000Z', '2026-11-11T20:00:20.000Z', '2026-11-11T20:00:40.000Z']) bets.render(new El('div'), betsTile([t]), ctxFor([t], ts));
    const r = new El('div');
    bets.render(r, betsTile([t]), ctxFor([t], '2026-11-11T20:01:00.000Z'));
    return countOf(r, 'bets-sweat') === 0;
  })());
  const BSRC = stripComments(read('docs', 'tiles', 'bets_live.js'));
  check('nothing is written to storage', !/localStorage|sessionStorage|indexedDB/.test(BSRC));
  check('drawn through svgEl and the shared sparkGeometry', /import \{ sparkGeometry \} from '\.\.\/lib\/spark\.js'/.test(BSRC) && /sparkGeometry\(vals, SWEAT, 0\.5, false, SWEAT_SPAN\)/.test(BSRC) && /svgEl\('svg'/.test(BSRC));

  // -- parlays untouched -----------------------------------------------------
  console.log('\nbets_live — a parlay card is exactly what it was');
  const PG = [{ game: 'Kestrels at Ironsides', league: 'football/nfl', espn_event_id: 'ev-live', home: 'FIS', away: 'HKS', kick_ct: `${PTODAY} 3:25 PM` }];
  const parlay = { id: 'pl-1', market: 'parlay', game: '2-leg parlay · 3.18x', label: 'A + B', stake_u: 0.25, price: '3.18x', payout_x: 3.18, to_win_u: 0.55, sport: '🏈', class: 'flier', kick_ct: `${PTODAY} 3:25 PM`, league: 'football/nfl', espn_event_id: 'ev-live', legs: [{ label: 'A ATD', market: 'anytime_td', player: 'A Person', side: null, line: null }, { label: 'B O60.5', market: 'player_rush_yds', player: 'B Person', side: 'over', line: 60.5 }], games: PG };
  const parlayCard = (r) => r.querySelector('.game-parlay');
  const pAlone = new El('div');
  bets.render(pAlone, betsTile([parlay]), ctxFor([parlay], '2026-11-11T20:30:00.000Z'));
  const withP0 = new El('div');
  const parlayP0 = { ...parlay, p0: 0.3 };
  bets.render(withP0, betsTile([parlayP0, tkt({ id: 'pl-side', p0: 0.52 })]), ctxFor([parlayP0, tkt({ id: 'pl-side', p0: 0.52 })], '2026-11-11T20:30:20.000Z'));
  check('a parlay card is byte-identical beside priced singles, and with a stray p0', ser(parlayCard(pAlone)) === ser(parlayCard(withP0)));
  check('it carries no percentage, no sweat line', countOf(parlayCard(withP0), 'ticket-pct') === 0 && countOf(parlayCard(withP0), 'bets-sweat') === 0);
  check('ALIVE still reads 0.00u (B19)', parlayCard(withP0).querySelector('.parlay-foot').querySelector('.ticket-units').textContent === '0.00u');

  // -- the scans that must still hold ---------------------------------------
  console.log('\nthe odds-math scans still hold, strict');
  const TILE_RAW = read('docs', 'tiles', 'bets_live.js');
  check('the tile does no odds math (test-graders\' scan, verbatim)', !/payoutMultiple|price\s*[/*]|\/\s*100/.test(TILE_RAW.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('the tile multiplies no stake (test-parlay\'s scan, verbatim)', !/stake\w*\s*\*|\*\s*stake/.test(stripComments(TILE_RAW)));
  check('the tile never reads price for anything but printing it', (BSRC.match(/\.price\b/g) || []).length === (stripComments(read('docs', 'tiles', 'bets_live.js')).match(/odds\(ticket\.price\)|str\(ticket\.price\)/g) || []).length);

  // The last live render left the B14 stamp's interval running; its teardown ends it.
  bets.render(new El('div'), betsTile([]), { id: 'bets_live', actions: {} })();

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})();
