/**
 * Tile registry: id -> {band, position, module, title}.
 *
 * This is the layout authority, and `position` is the whole of it: the board
 * is ONE flat grid in Matt's order (ruling, 2026-09-20). There are no band
 * headers and no grouping — `position` alone decides where a card lands.
 * Numbers step by 10 so a tile can be slotted in between two without a
 * renumber.
 *
 * `band` survives that ruling because it never described layout in the first
 * place: it says how often the engine refreshes a tile, and it is what keeps
 * the ASK tile off the board and out of module preloading. The LIVE fetch
 * clocks in live/band.js key off the snapshot payloads (tiles.bets_live,
 * tiles.today_games, tiles.weather), never off this field.
 *
 * Rule 9 — the page tolerates schema growth in both directions:
 *   - a snapshot tile with no entry here renders as a generic key/value card
 *   - an entry here missing from the snapshot renders as an empty grey card
 * Neither throws. Adding a tile to the engine never requires a page deploy.
 */

export const REGISTRY = {
  calendar: { band: 'DAILY', position: 10, module: './tiles/calendar.js', title: 'Calendar' },
  reminders: { band: 'DAILY', position: 20, module: './tiles/reminders.js', title: 'Reminders' },
  // The morning brief, straight under Reminders and above Dinner. Slotted in
  // at 25 without touching a single other number — which is what the tens
  // were for (ruling, 2026-09-20).
  captains_log: { band: 'DAILY', position: 25, module: './tiles/captains_log.js', title: "⚓ Captain's Log" },
  dinner: { band: 'DAILY', position: 30, module: './tiles/dinner.js', title: 'Dinner' },
  weather: { band: 'LIVE', position: 40, module: './tiles/weather.js', title: 'Weather' },
  newsstand: { band: 'HOURLY', position: 50, module: './tiles/newsstand.js', title: 'Newsstand' },
  entertainment: { band: 'DAILY', position: 60, module: './tiles/entertainment.js', title: 'Entertainment' },
  local_events: { band: 'DAILY', position: 70, module: './tiles/local_events.js', title: 'Lake Country' },
  today_games: { band: 'LIVE', position: 80, module: './tiles/today_games.js', title: "Today's Games" },
  bets_live: { band: 'LIVE', position: 90, module: './tiles/bets_live.js', title: 'Open Bets' },
  // The look-back to `bets_live`'s sweat, and directly under it.
  bets_ledger: { band: 'DAILY', position: 100, module: './tiles/bets_ledger.js', title: '📒 The Ledger' },
  cards: { band: 'HOURLY', position: 110, module: './tiles/cards.js', title: 'Cards' },
  purser_due: { band: 'DAILY', position: 120, module: './tiles/purser_due.js', title: 'Purser — Due' },
  wss_tape: { band: 'DAILY', position: 130, module: './tiles/wss_tape.js', title: 'Crew Tape' },
  ship_status: { band: 'DAILY', position: 140, module: './tiles/ship_status.js', title: 'Ship Status' },
  // Off-board: band ASK is what skips it, not the position.
  ask: { band: 'ASK', position: 999, module: './tiles/ask.js', title: 'Ask' },
};
