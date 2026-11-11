/**
 * The lean (B25–B34, vault spec `Bets-Live-Lean-Spec.md`): the chance a
 * single ticket wins from here, off the score, the clock and the ticket's own
 * logged price — nothing else. No possession, no field position, no team
 * strength, no ESPN win probability, no second source. It is a model, not a
 * market; the tile's footer still says "lean, not settlement."
 *
 *   leanProb(ticket, grade, game) -> {p, push} | null
 *
 * ONE HOME (B34). Nothing else on the page computes a probability. The graders
 * stay the only source of state and margin, and this module reads them; it
 * never decides a pill. `p0` arrives from the engine as a probability (B26) —
 * the page still does no odds math, and nothing here reads `price`.
 *
 * THREE SHAPES (B27):
 *   bell curve  football, basketball — the grader's signed margin drifts
 *               toward its whole-game expectation, spread by σ·√r
 *   Poisson     soccer, baseball, hockey — each side's remaining scores are
 *               Poisson(λ·r); λ is solved once at kickoff so p = p0 there
 *   decay       anytime TD (and anytime goal, while its flag is on in the
 *               graders): p = 1 − (1 − p0)^r until he scores
 *
 * LOCKS WIN (B31). A grader WIN is 1 and a LOSS or DEAD is 0 — the model is
 * not asked. While a game is `in`, the time left is floored at 2% so overtime
 * and stoppage never divide by zero.
 *
 * Pure: no DOM, no fetch, no clock. It never throws — anything it cannot
 * price is `null`, and the tile falls back to today's behaviour for it.
 */

import { gameProgress, sportOf } from './graders.js';

// ------------------------------------------------------- tuning constants
//
// The only two tables in the model. Starting values, tuned by eye against
// real nights; changing one is a one-line edit.

/** Bell-curve σ per league: the side margin, the game total, one team's total. */
export const SIGMA = {
  'football/nfl': { side: 13.5, total: 13.5, team: 9.5 },
  'football/college-football': { side: 16, total: 17, team: 12 },
  'basketball/nba': { side: 12, total: 18, team: 12.5 },
  'basketball/wnba': { side: 11, total: 16, team: 11 },
  'basketball/mens-college-basketball': { side: 11, total: 15, team: 10.5 },
};

/** Poisson: a full game's scoring, both sides together, per sport. */
export const G = {
  soccer: 2.7,
  baseball: 8.8,
  hockey: 6.1,
};

// ------------------------------------------------------- the spec's fixed

/** Time left never falls below this while the game is `in` (B31). */
const R_FLOOR = 0.02;
/** z0 is taken off p0 clamped to this band, so a 1% price is not ±∞. */
const P0_LO = 0.02;
const P0_HI = 0.98;
/** How far the Poisson grid runs per side. */
const GRID_CAP = { soccer: 12, hockey: 12, baseball: 25 };
/** The kickoff solve: bisection steps. */
const SOLVE_STEPS = 40;

const BELL_MARKETS = new Set(['spread', 'spread_1h', 'ml', 'total_over', 'total_under', 'team_total_over', 'team_total_under']);
const POISSON_MARKETS = new Set(['ml', 'spread', 'dc', 'total_over', 'total_under', 'draw', 'team_total_over', 'team_total_under']);
const DECAY_SPORT = { anytime_td: 'football', anytime_goal: 'soccer' };

// ------------------------------------------------------------- normal

/** Φ — the standard normal CDF, off erf (Abramowitz–Stegun 7.1.26, |ε| < 1.5e-7). */
function phi(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Φ⁻¹ — Acklam's rational approximation (|ε| < 1.2e-9 relative). */
function phiInv(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** A finite number, or null. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ----------------------------------------------------------- bell curve

/** The ticket's margin at 0–0: spread → line; ml → 0; over → −line; under → +line. */
function marginAtKick(market, line) {
  if (market === 'spread' || market === 'spread_1h') return line;
  if (market === 'ml') return 0;
  if (market === 'total_over' || market === 'team_total_over') return -line;
  return line; // total_under, team_total_under
}

function sigmaFor(table, market) {
  if (market === 'total_over' || market === 'total_under') return table.total;
  if (market === 'team_total_over' || market === 'team_total_under') return table.team;
  return table.side;
}

/**
 * p = Φ( (m + (σ·z0 − m_kick)·r) / (σ·√r) ). The term σ·z0 − m_kick is the
 * whole game's expected movement of the margin, chosen so that p = p0 at
 * kickoff — no closing line needed.
 */
function bell(ticket, grade, game, progress, p0, table) {
  const market = ticket.market;
  const m = num(grade && grade.margin);
  if (m === null) return null;
  const line = market === 'ml' ? 0 : num(ticket.line);
  if (line === null) return null;

  let sigma = sigmaFor(table, market);
  let r = 1 - progress;
  if (market === 'spread_1h') {
    sigma *= Math.SQRT1_2;
    // The grader's halftime lock decides it from there.
    r = clamp(1 - 2 * progress, R_FLOOR, 1);
  }
  if (game.state === 'in') r = Math.max(r, R_FLOOR);
  if (!(r > 0)) return null;

  const z0 = phiInv(clamp(p0, P0_LO, P0_HI));
  const z = (m + (sigma * z0 - marginAtKick(market, line)) * r) / (sigma * Math.sqrt(r));
  return { p: clamp(phi(z), 0, 1), push: 0 };
}

// --------------------------------------------------------------- Poisson

/** Poisson pmf 0..cap, renormalised so the truncated tail is not lost mass. */
function pmf(lambda, cap) {
  const out = new Array(cap + 1);
  let term = Math.exp(-lambda);
  let sum = 0;
  for (let k = 0; k <= cap; k++) {
    if (k > 0) term *= lambda / k;
    out[k] = term;
    sum += term;
  }
  return sum > 0 ? out.map((x) => x / sum) : out;
}

/**
 * Who wins on a final (pick a, opponent b): 'win' | 'push' | 'lose', or
 * 'half' — baseball and hockey moneylines level after regulation go on to
 * extras / overtime, and half of that mass counts as a win.
 */
function outcome(market, sport, line, a, b) {
  switch (market) {
    case 'ml':
      if (a > b) return 'win';
      if (a === b) return sport === 'soccer' ? 'lose' : 'half';
      return 'lose';
    case 'spread': {
      const x = a - b + line;
      return x > 0 ? 'win' : x === 0 ? 'push' : 'lose';
    }
    case 'total_over':
      return a + b > line ? 'win' : a + b === line ? 'push' : 'lose';
    case 'total_under':
      return a + b < line ? 'win' : a + b === line ? 'push' : 'lose';
    case 'team_total_over':
      return a > line ? 'win' : a === line ? 'push' : 'lose';
    case 'team_total_under':
      return a < line ? 'win' : a === line ? 'push' : 'lose';
    case 'draw':
      return a === b ? 'win' : 'lose';
    case 'dc':
      return a >= b ? 'win' : 'lose';
    default:
      return 'lose';
  }
}

/** Sum the (pick adds i, opponent adds j) grid: `{p, push}`. */
function grid(market, sport, line, a0, b0, lp, lo, cap) {
  const pa = pmf(Math.max(lp, 0), cap);
  const pb = market === 'team_total_over' || market === 'team_total_under' ? [1] : pmf(Math.max(lo, 0), cap);
  let p = 0;
  let push = 0;
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pb.length; j++) {
      const w = pa[i] * pb[j];
      const o = outcome(market, sport, line, a0 + i, b0 + j);
      if (o === 'win') p += w;
      else if (o === 'push') push += w;
      else if (o === 'half') p += w / 2;
    }
  }
  return { p: clamp(p, 0, 1), push: clamp(push, 0, 1) };
}

/** Bisection: the x in [lo, hi] where f(x) = target, f monotone either way. */
function solve(f, target, lo, hi) {
  const rising = f(hi) >= f(lo);
  for (let k = 0; k < SOLVE_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target === rising) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * ticket id -> the kickoff solve, with the inputs it was solved from. Solved
 * once per ticket (B27); a ticket whose p0, line or market changes under the
 * same id is solved again rather than priced off a stale λ. Module memory.
 */
const solveCache = new Map();

/** λ for the pick and the opponent, so the model's kickoff chance is p0. */
export function kickoffLambdas(ticket, sport, p0) {
  const market = ticket.market;
  const line = market === 'ml' || market === 'draw' || market === 'dc' ? 0 : num(ticket.line);
  if (line === null) return null;
  const g = G[sport];
  const cap = GRID_CAP[sport];
  const key = `${market}|${sport}|${line}|${p0}`;
  const id = String(ticket.id ?? '');
  const hit = id ? solveCache.get(id) : null;
  if (hit && hit.key === key) return hit.lambdas;

  const at = (lp, lo) => grid(market, sport, line, 0, 0, lp, lo, cap).p;
  let lambdas;
  if (market === 'ml' || market === 'spread' || market === 'dc') {
    const s = solve((x) => at((g + x) / 2, (g - x) / 2), p0, -g * 0.98, g * 0.98);
    lambdas = { pick: (g + s) / 2, opp: (g - s) / 2 };
  } else if (market === 'team_total_over' || market === 'team_total_under') {
    const lp = solve((x) => at(x, 0), p0, 0.01, g * 3);
    lambdas = { pick: lp, opp: 0 };
  } else {
    // total_* and draw: the two sides even, solve the game's scoring.
    const gg = solve((x) => at(x / 2, x / 2), p0, 0.01, g * 3);
    lambdas = { pick: gg / 2, opp: gg / 2 };
  }
  if (id) solveCache.set(id, { key, lambdas });
  return lambdas;
}

function poisson(ticket, game, progress, p0, sport) {
  const market = ticket.market;
  const totals = market === 'total_over' || market === 'total_under' || market === 'draw';
  const side = ticket.side === 'home' || ticket.side === 'away' ? ticket.side : null;
  if (!side && !totals) return null;

  const lambdas = kickoffLambdas(ticket, sport, p0);
  if (!lambdas) return null;
  const line = market === 'ml' || market === 'draw' || market === 'dc' ? 0 : num(ticket.line);

  const pick = side === 'away' ? game.away : game.home;
  const opp = side === 'away' ? game.home : game.away;
  const a0 = num(pick && pick.score);
  const b0 = num(opp && opp.score);
  if (a0 === null || b0 === null) return null;

  let r = 1 - progress;
  if (game.state === 'in') r = Math.max(r, R_FLOOR);
  if (!(r >= 0)) return null;
  return grid(market, sport, line, a0, b0, lambdas.pick * r, lambdas.opp * r, GRID_CAP[sport]);
}

// ------------------------------------------------------------------ decay

function decay(game, progress, p0) {
  let r = 1 - progress;
  if (game.state === 'in') r = Math.max(r, R_FLOOR);
  return { p: clamp(1 - Math.pow(1 - p0, r), 0, 1), push: 0 };
}

// ------------------------------------------------------- expected units

/**
 * What a priced ticket is worth right now, in units (B28):
 * `p × to_win_u − (1 − p − push) × stake_u`, rounded to the cent so the row
 * prints exactly the number the header adds. `toWin` and `stake` are the
 * engine's figures, passed in — this module reads no price and no payout.
 * A lock is exact: p = 1 is +to_win_u, p = 0 is −stake_u.
 */
export function expectedUnits(lean, toWin, stake) {
  const p = num(lean && lean.p);
  const push = num(lean && lean.push) || 0;
  const w = num(toWin);
  const s = num(stake);
  if (p === null || w === null || s === null) return null;
  const v = Number((p * w - (1 - p - push) * s).toFixed(2));
  return v === 0 ? 0 : v;
}

// ------------------------------------------------------------------ entry

/** Which shape prices this ticket, or null when none does. */
function shapeOf(ticket) {
  const market = ticket.market;
  const league = String(ticket.league || '').toLowerCase();
  const sport = sportOf(league);
  if (DECAY_SPORT[market]) return DECAY_SPORT[market] === sport ? { kind: 'decay', sport } : null;
  if (SIGMA[league] && BELL_MARKETS.has(market)) return { kind: 'bell', sport, table: SIGMA[league] };
  if (G[sport] && POISSON_MARKETS.has(market)) return { kind: 'poisson', sport };
  return null;
}

/**
 * The lean on one single ticket: `{p, push}` — p the chance it wins from
 * here, push the chance it lands on the number — or `null` when it cannot be
 * priced: a parlay, BTTS, a null or unknown market, a league not in the
 * tables, a missing or out-of-range p0, a pre-game or ungraded ticket, an
 * unknowable clock.
 */
export function leanProb(ticket, grade, game) {
  try {
    if (!ticket || typeof ticket !== 'object' || ticket.market === 'parlay') return null;
    const p0 = num(ticket.p0);
    if (p0 === null || !(p0 > 0 && p0 < 1)) return null;
    const shape = shapeOf(ticket);
    if (!shape) return null;

    const state = grade && grade.state;
    // B31: a lock is a lock. The model is not asked.
    if (state === 'win') return { p: 1, push: 0 };
    if (state === 'lose' || state === 'dead') return { p: 0, push: 0 };
    if (state === 'push') return { p: 0, push: 1 };
    if (state !== 'lead' && state !== 'trail' && state !== 'even') return null;
    if (!game || typeof game !== 'object' || game.dead || game.state !== 'in') return null;

    const progress = gameProgress(game, ticket.league || game.league);
    if (progress === null) return null;

    if (shape.kind === 'decay') return decay(game, progress, p0);
    if (shape.kind === 'bell') return bell(ticket, grade, game, progress, p0, shape.table);
    return poisson(ticket, game, progress, p0, shape.sport);
  } catch {
    return null;
  }
}
