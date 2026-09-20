/**
 * cards — the trading-card desk. Two faces: 🎯 Watch · 🏷️ Shop.
 *
 * A menu tile in the `entertainment` mould: the board carries two buttons and
 * one faint line, and everything with a price on it lives in the sheet. A
 * shopping list is never urgent enough to earn board height, and a card that
 * listed every flag would be the tallest thing on the page within a week.
 *
 * THE DIVISION OF LABOUR. The engine does all of the judgement. It sets the
 * fair-market value, picks the gate, works out the all-in price, decides the
 * MAX bid, ages the book and marks a listing OVER BAND — and it sorts both
 * lists before publishing (flags by `pct_fmv` ascending, auctions by end
 * time). This module recomputes NONE of it. In particular:
 *
 *   - `all_in` is printed, never derived from `price + ship`. If the engine's
 *     arithmetic and this page's ever disagree, the engine is right, and a
 *     number invented here would be indistinguishable from a real one.
 *   - `max` is printed, never derived from `fmv * gate`. The MAX is Matt's
 *     bidding ceiling; it is not the page's business to have an opinion.
 *   - the order of every list is the order it arrived in.
 *
 * FRESH vs AGING (the badge). A flag's chip only counts when its comp book is
 * `fresh`. A 30-day-old book is a 30-day-old opinion about what a card is
 * worth, and "51% of FMV" resting on one is a guess wearing a number's
 * clothes — so an aging flag still renders, still shows its percentage, and
 * loses the green tick and the badge. Auctions never count toward the badge
 * either: a current bid is not a price, and it has hours left to move.
 *
 * RULE 7, SATISFIED RATHER THAN BENT (v1.6.0). An auction now arrives with
 * two end times and they do different jobs:
 *
 *   - `ends_ct` — '2026-09-20T19:48', Central WALL-CLOCK text with no offset.
 *     Printed exactly as it arrived and never parsed, because a browser
 *     handed that string has to guess a zone and guesses the phone's. That
 *     guess is the disqualifying bug rule 7 exists to forbid.
 *   - `ends_utc` — '2026-09-21T00:48:00.000Z', a real instant. ALL countdown
 *     arithmetic uses this one, and parsing it is exact in every timezone,
 *     because there is nothing left to guess. This is why the engine started
 *     publishing it.
 *
 * The maths lives in `msUntil`/`countdown` in lib/fmt.js, so no date is
 * parsed in this file at all — `new Date` does not appear below, which keeps
 * the source scan in the tests a straight yes/no.
 *
 * A row whose `ends_utc` is missing or unreadable — an older snapshot still
 * in the service worker's cache — falls back to the pre-v1.6.0 line: `ends`
 * plus the wall stamp, no countdown, no amber, no error.
 *
 * RULE 4, and the one thing worth flagging: the thumbnails are `<img>` tags
 * pointing at the listing host's own CDN, which is a third external origin
 * that the hard rules do not list. It is here because a card you cannot see is
 * a card you cannot judge, and because it was asked for explicitly — but it is
 * a deliberate exception, not an oversight. It is kept as narrow as possible:
 * http(s) only via `safeUrl`, `referrerpolicy="no-referrer"` so the URL of
 * Matt's homepage never reaches the host, `loading="lazy"` so nothing is
 * fetched until the sheet is actually open, and a plain grey box whenever
 * there is no usable image. The service worker never caches them.
 *
 * RULE 10: every title, seller, player and rung lands via textContent, the alt
 * text included, and every row's anchor goes through `safeUrl` — a row whose
 * URL is junk stays a row, it just stops being tappable.
 */

import { el, empty, genericCard, safeUrl } from '../lib/dom.js';
import { ctTime, usd, msUntil, countdown } from '../lib/fmt.js';

/**
 * How close to the hammer an auction has to be to turn amber.
 *
 * Two hours is the last window in which Matt can actually do something about
 * it — get to a desk, decide, and bid — which is the only thing a dot on a
 * homepage is good for.
 */
const SOON_MS = 2 * 3600000;

/**
 * The two cadences, and the line between them.
 *
 * Inside an hour the minutes are the story and a stale figure is a wrong one,
 * so the sheet beats every second. Outside it, a lot closing on Thursday
 * gains nothing from 3,600 repaints an hour on a phone — it beats every
 * thirty. One interval serves the whole sheet either way; it is re-armed only
 * when the cadence itself has to change, so there is never more than one.
 */
const HOUR_MS = 3600000;
const FAST_MS = 1000;
const SLOW_MS = 30000;

/** A plain object, or {} — the payload is untrusted in shape as well as text. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A finite number, or null. Never 0 for a missing field — this is money. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 0.51 -> '51%', and nothing at all for a percentage that did not arrive. */
function pct(v) {
  const n = num(v);
  return n === null ? '' : `${Math.round(n * 100)}%`;
}

/** 1204 -> '1,204'. A feedback score, so it is a count and not a currency. */
function count(v) {
  const n = num(v);
  return n === null ? '' : n.toLocaleString('en-US');
}

// ------------------------------------------------------------------ planning

/**
 * One listing, cleaned up. Both lists share a shape, so they share this.
 *
 * Nothing is computed here beyond formatting: `pct_fmv`, `all_in`, `max` and
 * `gate` come out the other side as the engine sent them.
 */
function planItem(raw) {
  const i = obj(raw);
  return {
    id: str(i.item_id).trim(),
    title: str(i.title).trim(),
    player: str(i.player).trim(),
    rung: str(i.rung).trim(),
    tag: str(i.tag).trim(),
    lane: str(i.lane).trim(),
    type: str(i.type).trim().toUpperCase(),
    price: num(i.price),
    ship: num(i.ship),
    allIn: num(i.all_in),
    fmv: num(i.fmv),
    pctFmv: num(i.pct_fmv),
    max: num(i.max),
    gate: num(i.gate),
    bookAge: num(i.book_age_days),
    bookState: str(i.book_state).trim().toLowerCase(),
    endsCt: str(i.ends_ct).trim(),
    // The instant. `ends_ct` is its wall-clock twin and stays text forever.
    endsUtc: str(i.ends_utc).trim(),
    seller: str(i.seller).trim(),
    sellerFb: num(i.seller_fb),
    listed: str(i.listed).trim(),
    url: str(i.url),
    image: str(i.image),
    // The engine's own band call — a string when it applies, null when it
    // does not. Printed, never judged.
    band: str(i.band).trim(),
    isNew: i.new === true,
  };
}

/** A target with no comp book behind it yet. */
function planUnbooked(raw) {
  const u = obj(raw);
  const player = str(u.player).trim();
  const rung = str(u.rung).trim();
  if (!player && !rung) return null;
  return {
    player,
    rung,
    bookAge: num(u.book_age_days),
    cheapest: num(u.cheapest_all_in),
    url: str(u.url),
  };
}

/**
 * Is this auction inside the alarm window? Counted from `ends_utc` only.
 *
 * A lot already past counts as soon, not as quiet: the engine drops a closed
 * row on its next pass, and going silent in the gap would drop the alarm at
 * the exact moment it mattered most. The ROW itself greys out at zero — that
 * is the row telling the truth about itself — but the dot on the board stays
 * up until the row is gone. A pre-v1.6 payload with no instant raises
 * nothing: there is no honest way to count from a string with no offset.
 */
function endingSoon(item) {
  const ms = msUntil(item.endsUtc);
  return ms !== null && ms <= SOON_MS;
}

/** classList.toggle with a force flag, which not every shim implements. */
function setClass(node, cls, on) {
  if (on) node.classList.add(cls);
  else node.classList.remove(cls);
}

// ---------------------------------------------------------------------- bits

/** The dot between two parts of a line. Decoration, so it is hidden from AT. */
function sep() {
  return el('span', { cls: 'cards-sep', attrs: { 'aria-hidden': 'true' }, text: '·' });
}

const newMark = () => el('span', { cls: 'cards-new-mark', text: 'new' });

const chip = (text, tone = 'neutral') => el('span', { cls: `cards-chip cards-chip-${tone}`, text });

/**
 * The 40px listing photo — or a grey box in its place.
 *
 * See the rule-4 note in the header. The box is not decoration: a row that
 * shrinks when the photo is missing makes the list jump as images arrive, and
 * on one bar of LTE that is most of the time you are looking at it.
 */
function thumb(item) {
  const safe = safeUrl(item.image);
  if (!safe) return el('div', { cls: 'cards-thumb cards-thumb-none', attrs: { 'aria-hidden': 'true' } });
  return el('img', {
    cls: 'cards-thumb',
    attrs: {
      src: safe,
      // Untrusted text, set as an attribute rather than parsed as markup.
      alt: item.title || 'listing photo',
      width: '40',
      height: '40',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    },
  });
}

/**
 * `$129 + $4.99 ship → $133.99`, with the all-in bold.
 *
 * The all-in is the only number that decides anything, so it is the only one
 * with weight on it. An auction leads with `bid`, because a current bid is not
 * a price and should not read like one.
 */
function priceLine(item, { auction = false } = {}) {
  const parts = [];
  const price = usd(item.price);
  parts.push(el('span', { cls: 'cards-price', text: auction ? `bid ${price}` : price }));
  if (item.ship !== null) parts.push(el('span', { cls: 'cards-ship', text: `+ ${usd(item.ship)} ship` }));
  parts.push(el('span', { cls: 'cards-arrow', attrs: { 'aria-hidden': 'true' }, text: '→' }));
  parts.push(el('span', { cls: 'cards-allin', text: usd(item.allIn) }));
  return el('div', { cls: 'cards-money' }, parts);
}

/**
 * `✓ 51% of FMV $260`, green — or the same line, muted, when the number is
 * standing on an old book or on an auction that has not finished moving.
 *
 * The tick is the whole signal: it means "the engine's gate, on a book it
 * still trusts". Take either half away and the percentage is still worth
 * showing, just not worth trusting at a glance.
 */
function fmvChip(item, { auction = false } = {}) {
  const aging = item.bookState === 'aging';
  const under = !auction && !aging && item.pctFmv !== null && item.gate !== null && item.pctFmv <= item.gate;
  const p = pct(item.pctFmv);
  const text = p ? `${p} of FMV ${usd(item.fmv)}` : `FMV ${usd(item.fmv)}`;
  return el('span', { cls: `cards-fmv ${under ? 'cards-fmv-good' : 'cards-fmv-muted'}` }, [
    under ? el('span', { cls: 'cards-check', attrs: { 'aria-hidden': 'true' }, text: '✓' }) : null,
    el('span', { text }),
  ]);
}

/** `seller · 1,204 fb`, or nothing when there is no seller to name. */
function sellerLine(item) {
  if (!item.seller) return null;
  const fb = count(item.sellerFb);
  return el('div', { cls: 'cards-seller' }, [
    el('span', { text: item.seller }),
    fb ? sep() : null,
    fb ? el('span', { text: `${fb} fb` }) : null,
  ]);
}

/**
 * The end-time line: a live countdown, with the wall stamp behind it.
 *
 *     ⏱ 1h 42m        ends 2026-09-20T19:48
 *
 * The countdown is the number Matt reads; the stamp is the one he can trust
 * without arithmetic, and it is `ends_ct` printed character for character
 * (rule 7 — it is never reformatted, not even to drop the date).
 *
 * Pushes a clock entry onto `clocks` when there is a real instant to count
 * from, so the sheet's single interval can repaint it. Returns null when the
 * listing carries no end time at all.
 */
function endsLine(item, clocks) {
  const ms = msUntil(item.endsUtc);

  // No instant, or one this browser cannot read: the pre-v1.6.0 line, intact.
  // A legacy payload must lose the countdown, not the row.
  if (ms === null) {
    if (!item.endsCt) return null;
    return { node: el('div', { cls: 'cards-ends' }, [el('span', { text: `ends ${item.endsCt}` })]), entry: null };
  }

  const value = el('span', { cls: 'cards-countdown-value', text: countdown(ms) });
  const node = el('div', { cls: 'cards-ends' }, [
    el('span', { cls: 'cards-countdown' }, [
      el('span', { cls: 'cards-clock-glyph', attrs: { 'aria-hidden': 'true' }, text: '⏱' }),
      value,
    ]),
    item.endsCt ? el('span', { cls: 'cards-ends-at', text: `ends ${item.endsCt}` }) : null,
  ]);

  // `ms` is kept so the row can be greyed at build time without a second
  // subtraction — two reads of the clock a microsecond apart could in
  // principle disagree about whether a lot has closed.
  const entry = { endsUtc: item.endsUtc, value, node, row: null, ms };
  if (clocks) clocks.push(entry);
  return { node, entry };
}

/**
 * Repaint one row from a remaining-milliseconds figure the caller worked out.
 *
 * The subtraction is the caller's so that every row in a beat is painted
 * against ONE reading of the clock — twenty rows each calling `Date.now()`
 * could straddle a second boundary and disagree with each other.
 */
function paintClock(c, ms) {
  if (ms === null) return null;
  c.value.textContent = countdown(ms);
  const ended = ms <= 0;
  // Amber is "you can still do something about this". At zero the row stops
  // being amber and goes grey — it has not gone wrong, it is over — and it
  // stays exactly where it is until the engine's next pass removes it. A row
  // vanishing under Matt's thumb mid-scroll would be the worse bug.
  setClass(c.node, 'cards-ends-soon', !ended && ms <= SOON_MS);
  setClass(c.node, 'cards-ends-done', ended);
  if (c.row) setClass(c.row, 'cards-row-ended', ended);
  return ms;
}

/**
 * Start the sheet's clock. Returns a teardown, or null if nothing ticks.
 *
 * ONE interval for the whole sheet, never one per row: twenty auctions must
 * not mean twenty timers, and every row wants the same `Date.now()` anyway —
 * two rows drawn a millisecond apart must not disagree about what now is.
 *
 * The cadence is chosen from the soonest live row and re-armed only when it
 * actually changes, so a sheet whose lots are all days out beats twice a
 * minute and quietly speeds up as the first one comes inside the hour. At
 * every instant exactly one timer exists.
 *
 * A phone that slept through the afternoon comes back with a countdown an
 * hour stale, and up to thirty seconds would pass before the next beat fixed
 * it — so the return to visibility repaints immediately rather than waiting.
 */
function startClock(clocks) {
  if (!clocks.length) return null;

  let timer = null;
  let every = 0;

  const beat = () => {
    const now = Date.now();
    let fast = false;
    for (const c of clocks) {
      const ms = paintClock(c, msUntil(c.endsUtc, now));
      if (ms !== null && ms > 0 && ms <= HOUR_MS) fast = true;
    }
    const want = fast ? FAST_MS : SLOW_MS;
    if (want !== every) {
      if (timer !== null) clearInterval(timer);
      every = want;
      timer = setInterval(beat, every);
    }
  };

  beat();

  const listens = typeof document.addEventListener === 'function';
  const wake = () => {
    if (!document.hidden) beat();
  };
  if (listens) document.addEventListener('visibilitychange', wake);

  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    every = 0;
    if (listens && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', wake);
    }
  };
}

/**
 * One listing. The whole row is the link — or is not a link at all, if the
 * URL is junk (rule 10).
 */
function listingRow(item, { auction = false, clocks = null } = {}) {
  const chips = [];
  if (item.type === 'OBO') chips.push(chip('OBO', 'obo'));
  if (item.band) chips.push(chip(item.band, 'band'));
  if (item.max !== null) chips.push(chip(`MAX ${usd(item.max)}`, 'max'));

  const ends = auction ? endsLine(item, clocks) : null;

  const kids = [
    thumb(item),
    el('div', { cls: 'cards-main' }, [
      el('div', { cls: 'cards-title-line' }, [
        el('span', { cls: 'cards-title', text: item.title || '(untitled listing)' }),
        item.isNew ? newMark() : null,
      ]),
      item.player || item.rung
        ? el('div', { cls: 'cards-who' }, [
            item.player ? el('span', { text: item.player }) : null,
            item.player && item.rung ? sep() : null,
            item.rung ? el('span', { cls: 'cards-rung', text: item.rung }) : null,
          ])
        : null,
      priceLine(item, { auction }),
      el('div', { cls: 'cards-marks' }, [
        fmvChip(item, { auction }),
        // Why the tick is missing, said out loud rather than left to be
        // noticed. The number is the engine's; the caveat is the payload's.
        item.bookState === 'aging' && item.bookAge !== null
          ? el('span', { cls: 'cards-bookage', text: `book ${item.bookAge}d old` })
          : null,
        ...chips,
      ]),
      ends ? ends.node : null,
      sellerLine(item),
    ]),
  ];

  const safe = safeUrl(item.url);
  const row = safe
    ? el(
        'a',
        { cls: 'cards-row cards-row-link', attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' } },
        kids
      )
    : el('div', { cls: 'cards-row' }, kids);

  // The clock greys the whole row at zero, not just its own line, so it needs
  // a handle on the row — which only exists once the kids are built. The
  // first paint happens here, for the same reason.
  if (ends && ends.entry) {
    ends.entry.row = row;
    paintClock(ends.entry, ends.entry.ms);
  }
  return row;
}

/** `Kestrel Vance · rung 2 — book 41d old · cheapest $118`, muted. */
function unbookedRow(u) {
  const parts = [];
  const lead = () => (parts.length ? sep() : null);

  if (u.player) parts.push(el('span', { cls: 'cards-nb-player', text: u.player }));
  if (u.rung) parts.push(el('span', {}, [lead(), el('span', { text: u.rung })]));
  if (u.bookAge !== null) parts.push(el('span', {}, [lead(), el('span', { text: `book ${u.bookAge}d old` })]));
  if (u.cheapest !== null) parts.push(el('span', {}, [lead(), el('span', { text: `cheapest ${usd(u.cheapest)}` })]));

  const safe = safeUrl(u.url);
  if (!safe) return el('div', { cls: 'cards-nb-row' }, parts);
  return el(
    'a',
    { cls: 'cards-nb-row cards-row-link', attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' } },
    parts
  );
}

/** A section heading, printed only when the section has something under it. */
const sectionHead = (text) => el('h4', { cls: 'cards-head', text });

/**
 * The small ⚠︎ a stale tile wears, or null.
 *
 * `stale` here means the listing pull half-answered — some of the search calls
 * came back, some did not. What DID arrive is still real, and a flag Matt can
 * act on is worth more than a blank card, so the rows render and the mark
 * carries the reason (rule 8).
 */
function staleMark(tile, watch) {
  if (str(tile && tile.status) !== 'stale') return null;
  const reason =
    str(tile.error).trim() ||
    arr(watch.errors).filter(Boolean).map(String).join(' · ') ||
    'the listing pull did not finish';
  return el('p', { cls: 'tile-foot cards-stale' }, [
    el('span', {
      cls: 'cards-warn',
      text: '⚠︎',
      attrs: { title: reason, 'aria-label': `feed trouble: ${reason}` },
    }),
  ]);
}

// --------------------------------------------------------------------- sheet

/**
 * The "No book" list, folded shut.
 *
 * These are targets the engine has no comp book for — a to-do for the vault,
 * not a buy. They belong in the sheet so nothing goes missing, and they belong
 * folded so they never come between Matt and a flag.
 */
function unbookedSection(unbooked) {
  const rows = el('div', { cls: 'cards-nb hidden' }, unbooked.map(unbookedRow));
  const toggle = el('button', {
    cls: 'cards-fold',
    text: `No book (${unbooked.length})`,
    attrs: { type: 'button', 'aria-expanded': 'false' },
    on: {
      click: (e) => {
        e.stopPropagation();
        const open = rows.classList.toggle('hidden') === false;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      },
    },
  });
  return [toggle, rows];
}

/**
 * The Watch sheet: errors, flags, auctions, no-book, one footer.
 *
 * The builder returns the clock's teardown. The shell holds it and calls it
 * when the sheet closes or another one opens — a countdown left running
 * behind a closed sheet would tick against detached nodes forever.
 */
function watchBody(watch, data, tile) {
  const flags = arr(watch.flags).map(planItem);
  const auctions = arr(watch.auctions).map(planItem);
  const unbooked = arr(watch.unbooked).map(planUnbooked).filter(Boolean);
  const errors = arr(watch.errors).filter(Boolean).map(String);

  return (body) => {
    const clocks = [];
    // What the engine could not reach, said once and quietly, at the top —
    // because everything below it may be an incomplete picture.
    if (errors.length) {
      body.appendChild(el('p', { cls: 'cards-errors', text: `feed trouble: ${errors.join(' · ')}` }));
    }
    const warn = staleMark(tile, watch);
    if (warn) body.appendChild(warn);

    body.appendChild(sectionHead('Flags'));
    if (!flags.length) {
      body.appendChild(empty('Nothing under the gate right now.'));
    } else {
      // Order is the engine's, untouched — it sorted by pct_fmv ascending.
      body.appendChild(el('div', { cls: 'cards-list' }, flags.map((f) => listingRow(f))));
    }

    // No auctions is not an empty state worth a sentence: there is simply no
    // section. A heading over "none" would read as a feed that broke.
    if (auctions.length) {
      body.appendChild(sectionHead('Auctions'));
      body.appendChild(
        el('div', { cls: 'cards-list' }, auctions.map((a) => listingRow(a, { auction: true, clocks })))
      );
    }

    if (unbooked.length) for (const node of unbookedSection(unbooked)) body.appendChild(node);

    // Said once, at the bottom: the vault's own wording plus eBay's required
    // credit. Both are printed verbatim.
    const foot = [str(data.footer).trim(), 'eBay data via Browse API'].filter(Boolean).join(' · ');
    body.appendChild(el('p', { cls: 'cards-foot', text: foot }));

    return startClock(clocks);
  };
}

/**
 * A face the engine lights up later — `shop` the day it arrives.
 *
 * Rule 9: the sheet shows what came rather than nothing, and a page deploy
 * makes it pretty once there is a spec to make it pretty against.
 */
function genericFaceBody(face) {
  return (body) => {
    const entries = Object.entries(obj(face)).filter(([, v]) => v !== null && v !== undefined);
    if (!entries.length) {
      body.appendChild(empty('Nothing here yet.'));
      return;
    }
    const list = el('div', { cls: 'generic' });
    for (const [k, v] of entries) {
      list.appendChild(
        el('div', { cls: 'row' }, [
          el('span', { cls: 'row-label', text: k }),
          el('span', { cls: 'row-value', text: typeof v === 'object' ? JSON.stringify(v) : String(v) }),
        ])
      );
    }
    body.appendChild(list);
  };
}

// ---------------------------------------------------------------------- tile

/** A button for a face that does not exist yet: visible, inert, wearing "soon". */
function soonButton(face) {
  return el('button', { cls: 'cards-btn cards-btn-soon', attrs: { type: 'button', disabled: 'disabled' } }, [
    el('span', { cls: 'cards-emoji', attrs: { 'aria-hidden': 'true' }, text: face.emoji }),
    el('span', { cls: 'cards-btn-label', text: face.label }),
    el('span', { cls: 'cards-soon', text: 'soon' }),
  ]);
}

function liveButton(face, { chipNode = null, dot = false, open = null }) {
  return el(
    'button',
    {
      cls: `cards-btn cards-btn-${face.tone}`,
      attrs: { type: 'button' },
      on: {
        click: (e) => {
          // Don't let the tap ride up into the card's Explain handler.
          e.stopPropagation();
          // No sheet to open (the test harness, an older shell): inert rather
          // than broken.
          if (typeof open === 'function') open();
        },
      },
    },
    [
      el('span', { cls: 'cards-emoji', attrs: { 'aria-hidden': 'true' }, text: face.emoji }),
      el('span', { cls: 'cards-btn-label', text: face.label }),
      dot ? el('span', { cls: 'cards-dot', attrs: { 'aria-label': 'an auction ends within two hours' } }) : null,
      chipNode,
    ]
  );
}

const WATCH_FACE = { key: 'watch', emoji: '🎯', label: 'Watch', tone: 'hunt' };
const SHOP_FACE = { key: 'shop', emoji: '🏷️', label: 'Shop', tone: 'shop' };

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data);

  // Rule 9: the pull failed outright and there is no shape to lay out. The
  // generic card prints what IS there instead of this module inventing a desk.
  if (str(tile && tile.status) === 'error') {
    genericCard(root, tile || {});
    return;
  }

  const openPanel =
    ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;

  const hasWatch = data.watch && typeof data.watch === 'object' && !Array.isArray(data.watch);
  const watch = obj(data.watch);
  const buttons = [];

  if (!hasWatch) {
    buttons.push(soonButton(WATCH_FACE));
  } else {
    const flags = arr(watch.flags).map(planItem);
    // The badge counts flags standing on a book the engine still trusts, and
    // nothing else. Nothing under the gate means NO chip — not a zero. The
    // tile is quiet by default.
    const fresh = flags.filter((f) => f.bookState === 'fresh');
    const anyNew = fresh.some((f) => f.isNew);

    const soon = arr(watch.auctions).map(planItem).some(endingSoon);

    const chipNode = fresh.length
      ? el('span', { cls: 'cards-count' }, [
          el('span', { text: String(fresh.length) }),
          anyNew ? el('span', { cls: 'cards-count-new', text: 'new' }) : null,
        ])
      : null;

    buttons.push(
      liveButton(WATCH_FACE, {
        chipNode,
        dot: soon,
        open: openPanel ? () => openPanel('🎯 Watch', watchBody(watch, data, tile)) : null,
      })
    );
  }

  // `shop: null` is the payload saying the face is coming, not that it is
  // empty — so it is a button either way, greyed until the day it answers.
  const hasShop = data.shop && typeof data.shop === 'object' && !Array.isArray(data.shop);
  buttons.push(
    hasShop
      ? liveButton(SHOP_FACE, {
          open: openPanel ? () => openPanel('🏷️ Shop', genericFaceBody(data.shop)) : null,
        })
      : soonButton(SHOP_FACE)
  );

  root.appendChild(el('div', { cls: 'cards-menu', attrs: { role: 'group', 'aria-label': 'Cards' } }, buttons));

  // The faint line under the menu: the shape of the hunt, in the engine's own
  // counts. Every part is omitted rather than guessed at, so a payload that
  // half-arrived says less instead of saying something wrong.
  const bits = [];
  const targets = num(watch.targets);
  if (targets !== null) bits.push(`${targets} targets`);
  const freshBooks = num(watch.fresh);
  if (freshBooks !== null) bits.push(`${freshBooks} fresh books`);
  const feed = ctTime(watch.updated_at);
  if (feed) bits.push(`feed ${feed}`);
  if (bits.length) root.appendChild(el('p', { cls: 'tile-foot', text: bits.join(' · ') }));

  const warn = staleMark(tile, watch);
  if (warn) root.appendChild(warn);
}
