/**
 * Tile registry: id -> {band, position, module, title}.
 *
 * This is the layout authority. A snapshot tile also carries its own `band`,
 * but that describes how often the engine refreshes it; where it lands on the
 * page is decided here.
 *
 * Rule 9 — the page tolerates schema growth in both directions:
 *   - a snapshot tile with no entry here renders as a generic key/value card
 *   - an entry here missing from the snapshot renders as an empty grey card
 * Neither throws. Adding a tile to the engine never requires a page deploy.
 */

export const REGISTRY = {
  bets_live: { band: 'LIVE', position: 10, module: './tiles/bets_live.js', title: 'Open Bets' },
  today_games: { band: 'LIVE', position: 20, module: './tiles/today_games.js', title: "Today's Games" },
  newsstand: { band: 'HOURLY', position: 30, module: './tiles/newsstand.js', title: 'Newsstand' },
  entertainment: { band: 'DAILY', position: 35, module: './tiles/entertainment.js', title: 'Entertainment' },
  radar: { band: 'DAILY', position: 40, module: './tiles/radar.js', title: 'Radar' },
  calendar: { band: 'DAILY', position: 50, module: './tiles/calendar.js', title: 'Calendar' },
  local_events: { band: 'DAILY', position: 52, module: './tiles/local_events.js', title: 'Lake Country' },
  reminders: { band: 'DAILY', position: 55, module: './tiles/reminders.js', title: 'Reminders' },
  dinner: { band: 'DAILY', position: 60, module: './tiles/dinner.js', title: 'Dinner' },
  purser_due: { band: 'DAILY', position: 70, module: './tiles/purser_due.js', title: 'Purser — Due' },
  ship_status: { band: 'DAILY', position: 80, module: './tiles/ship_status.js', title: 'Ship Status' },
  ask: { band: 'ASK', position: 99, module: './tiles/ask.js', title: 'Ask' },
};

/** Render order. Unknown bands sort after these, alphabetically. */
export const BAND_ORDER = ['LIVE', 'HOURLY', 'DAILY', 'WEEKLY', 'ASK'];

export const BAND_LABEL = {
  LIVE: 'Live',
  HOURLY: 'Hourly',
  DAILY: 'Today',
  WEEKLY: 'This week',
  ASK: 'Ask',
};
