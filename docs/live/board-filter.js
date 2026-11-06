/**
 * The board filter (Today's Games spec v1.4, C2/C4/C5) — pure, no fetch, no DOM.
 *
 * College is 50+ FBS games on a Saturday and 72 Division I games on a winter
 * night; Matt follows the Top 25 and two conferences per sport. The config
 * (`today-games.json`, per league) owns the rule; this file carries it out.
 *
 *   boardFilter(games, filter, ticketIds)
 *
 * keeps a game when EITHER side is ranked at or above `filter.top`, OR EITHER
 * side's conference id is in `filter.conferences`, OR the Bookie holds a
 * ticket on it (C5 — a ticket always makes the board). A league with no
 * filter, or one this page cannot read, keeps everything (rule 9: the page
 * never throws on config, and an unreadable rule must not empty a slate).
 *
 * It runs in the band, once, where the board is assembled — so the button
 * count, the sheet and the cadence all see the same games — and again on the
 * Tomorrow sheet after its own date filter. The TICKET path (bets_live) never
 * goes through here: a ticket names a game by id, and a filter there could
 * only break one.
 *
 * `ticketedGames` lives here too (moved from tiles/today_games.js in v1.4) so
 * the band and the tile share one definition of "a game the Bookie holds".
 */

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * The ESPN event ids the Bookie currently holds a ticket on, with the ticket
 * labels per id (T1): `Map<id, string[]>`. Read off the snapshot's `bets_live`
 * payload — a single names one game, a parlay names each of its `games[]`.
 * An empty map when the tile or its tickets are absent. No fetch, no grade.
 */
export function ticketedGames(snapshot) {
  const out = new Map();
  const tickets = obj(obj(obj(obj(snapshot).tiles).bets_live).data).tickets;
  for (const raw of Array.isArray(tickets) ? tickets : []) {
    const t = obj(raw);
    const label = str(t.label) || str(t.game) || 'ticket';
    const ids = [];
    if (Array.isArray(t.games) && t.games.length) {
      for (const g of t.games) ids.push(str(obj(g).espn_event_id));
    } else {
      ids.push(str(t.espn_event_id));
    }
    for (const id of ids) {
      if (!id) continue;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(label);
    }
  }
  return out;
}

/** The set of ticketed event ids — the keys of ticketedGames(). */
export function ticketIds(snapshot) {
  return new Set(ticketedGames(snapshot).keys());
}

/**
 * The games kept. Never throws on input shape; returns a new array.
 */
export function boardFilter(games, filter, ticketIdSet) {
  const list = Array.isArray(games) ? games.filter(Boolean) : [];
  const f = obj(filter);
  const top = typeof f.top === 'number' && Number.isFinite(f.top) ? f.top : null;
  const confs = Array.isArray(f.conferences) ? new Set(f.conferences.map((c) => str(c))) : null;
  if (top === null && !confs) return [...list];

  const held = ticketIdSet instanceof Set ? ticketIdSet : new Set();
  const ranked = (side) => {
    const r = obj(side).rank;
    return top !== null && typeof r === 'number' && Number.isFinite(r) && r <= top;
  };
  const inConf = (side) => {
    if (!confs) return false;
    const c = str(obj(side).conf);
    return c !== '' && confs.has(c);
  };

  return list.filter((g) => {
    const game = obj(g);
    if (held.has(str(game.id))) return true;
    return ranked(game.home) || ranked(game.away) || inConf(game.home) || inConf(game.away);
  });
}
