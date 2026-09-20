/**
 * cards — the trading-card desk. Three faces: 🎯 Watch · 🏷️ Shop · 🎖️ PC.
 *
 * A menu tile in the `entertainment` mould: the board carries the buttons and
 * a faint line per live face, and everything with a price on it lives in the
 * sheet. A shopping list is never urgent enough to earn board height, and a
 * card that listed every flag would be the tallest thing on the page within a
 * week.
 *
 * THE THREE FACES ASK THREE DIFFERENT QUESTIONS, AND MUST NOT LOOK ALIKE.
 * Watch: is this cheap enough. PC: does this exist. Shop: what is up, and
 * what has left. Only Watch has a gate, so only Watch has green, a ✓, a
 * percentage and a MAX — see the Shop section's own header for what that face
 * deliberately does not do.
 *
 *   Watch asks "is this under 65% of book?" — a gate, with an answer the
 *   engine computed: a percentage, a MAX bid, and a green tick when it
 *   clears. Everything in that sheet is about a number being low enough.
 *
 *   PC asks "does this exist?" — the personal-collection bookend net. A
 *   bookend is one of one by definition, so there is no matched-grade tape
 *   behind it, no FMV, no percentage and no gate. Price is Matt's to judge.
 *
 * So the PC sheet carries NO green, no ✓, no `% of FMV`, no `MAX $` and no
 * gate language anywhere. Its badges are the SERIAL and the GRADE. The parts
 * the two sheets genuinely share are the thumbnail, the title clamp, the
 * price line, the seller line and the countdown — and nothing else. Reusing
 * `listingRow` here would be the bug, not the shortcut.
 *
 * Amber means ONE thing per screen. On Watch it means "ending inside two
 * hours". On PC it means "one of one" — so the PC sheet's auction rows never
 * go amber at all, and the 1/1 badge has its own token rather than borrowing
 * the warn colour. Two meanings for one colour on one screen is how somebody
 * buys the wrong card.
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
 * RULE 7, SATISFIED RATHER THAN BENT. An auction arrives with two end times
 * and they do very different jobs:
 *
 *   - `ends_utc` — '2026-09-21T00:48:00.000Z', a real instant. THE SOURCE OF
 *     TRUTH for both the countdown and the clock time on the screen (Matt,
 *     2026-09-20). Parsing it is exact in every timezone because it carries
 *     its offset; there is nothing left to guess. It is displayed through
 *     `ctTime`, which pins America/Chicago explicitly — this is a Central
 *     board, and a device in another zone must not shift it.
 *   - `ends_ct` — '2026-09-20T19:48', Central WALL-CLOCK text with no offset.
 *     NOT a display field. It is the pre-v1.6 fallback and nothing else: the
 *     only row that prints it is one whose `ends_utc` is missing, and it is
 *     printed raw. It is never handed to Date, Date.parse or msUntil, because
 *     a browser given a string with no offset has to guess a zone and guesses
 *     the device's — the disqualifying bug rule 7 exists to forbid.
 *
 * The maths lives in `msUntil`/`countdown` in lib/fmt.js, so no date is
 * parsed in this file at all — `new Date` does not appear below, which keeps
 * the source scan in the tests a straight yes/no. `msUntil` is the
 * enforcement point: it refuses any string without an offset, so `ends_ct`
 * arriving there by mistake yields no countdown rather than a wrong one.
 *
 * A row whose `ends_utc` is missing or unreadable — an older snapshot still
 * in the service worker's cache — falls back to the pre-v1.6 line: `ends`
 * plus the raw wall stamp, no countdown, no amber, no error.
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
 *
 * `unknownShip` is the PC net's case: eBay does not always say what postage
 * costs, and when it does not there is no all-in to print. The line says
 * `+ ship?` and STOPS — no arrow pointing at nothing, and certainly no total
 * this page invented out of a missing number. Watch never passes it, because
 * every flag the comp engine clears has a shipping figure behind it.
 */
function priceLine(item, { auction = false, unknownShip = false } = {}) {
  const parts = [];
  const price = usd(item.price);
  parts.push(el('span', { cls: 'cards-price', text: auction ? `bid ${price}` : price }));
  if (item.ship !== null) {
    parts.push(el('span', { cls: 'cards-ship', text: `+ ${usd(item.ship)} ship` }));
  } else if (unknownShip) {
    parts.push(el('span', { cls: 'cards-ship', text: '+ ship?' }));
    return el('div', { cls: 'cards-money' }, parts);
  }
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
 * The end-time line: a live countdown, with the wall-clock time behind it.
 *
 *     ⏱ 1h 42m        ends 7:48 PM
 *
 * BOTH halves come from `ends_utc` (Matt, 2026-09-20, overturning v1.6.0's
 * first cut). The countdown is the number he reads at a glance; the clock
 * time is the one he can trust without arithmetic, and it is formatted by
 * `ctTime`, which pins America/Chicago explicitly. That pin is the whole
 * point: this is a Central-time board, and opening it on a laptop in Denver
 * must not quietly shift every auction by an hour.
 *
 * `ends_ct` is NOT a display field. It is the pre-v1.6 fallback below and
 * nothing else — the one place it reaches the DOM, printed raw and unparsed.
 *
 * Pushes a clock entry onto `clocks` when there is a real instant to count
 * from, so the sheet's single interval can repaint it. Returns null when the
 * listing carries no end time at all.
 *
 * `amber: false` keeps the last two hours from turning warn-coloured. The PC
 * sheet passes it, because amber is spoken for there — see the header.
 */
function endsLine(item, clocks, { amber = true } = {}) {
  const ms = msUntil(item.endsUtc);

  // No instant, or one this browser cannot read: the pre-v1.6.0 line, intact.
  // A legacy payload must lose the countdown, not the row. The raw stamp is
  // all there is to show, so it is shown — as text, never parsed.
  if (ms === null) {
    if (!item.endsCt) return null;
    return { node: el('div', { cls: 'cards-ends' }, [el('span', { text: `ends ${item.endsCt}` })]), entry: null };
  }

  const value = el('span', { cls: 'cards-countdown-value', text: countdown(ms) });
  const clock = ctTime(item.endsUtc);
  const node = el('div', { cls: 'cards-ends' }, [
    el('span', { cls: 'cards-countdown' }, [
      el('span', { cls: 'cards-clock-glyph', attrs: { 'aria-hidden': 'true' }, text: '⏱' }),
      value,
    ]),
    clock ? el('span', { cls: 'cards-ends-at', text: `ends ${clock}` }) : null,
  ]);

  // `ms` is kept so the row can be greyed at build time without a second
  // subtraction — two reads of the clock a microsecond apart could in
  // principle disagree about whether a lot has closed.
  const entry = { endsUtc: item.endsUtc, value, node, row: null, ms, amber };
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
  // `amber` is off on the PC sheet, where amber already means "one of one".
  setClass(c.node, 'cards-ends-soon', c.amber !== false && !ended && ms <= SOON_MS);
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

// ------------------------------------------------------------------- the PC net

/**
 * One PC find. A listing, plus the two things that make it a bookend.
 *
 * `serial` is the engine's own display string and is printed verbatim — the
 * page does not build "10/10" out of `num` and `den`, it is handed it. The
 * ints ride along for anyone who needs to count, and nothing here does.
 *
 * `grade` is always a string from the engine, which only emits graded cards.
 * It is treated as possibly-null anyway: a row with no grade still renders,
 * it just loses the chip. Raw cards are out of scope by ruling, so there is
 * deliberately no "ungraded" affordance to fall into.
 */
function planFind(raw) {
  const f = obj(raw);
  const item = planItem(f);
  item.serial = str(f.serial).trim();
  item.num = num(f.num);
  item.den = num(f.den);
  item.oneOfOne = f.one_of_one === true;
  item.grade = str(f.grade).trim();
  return item;
}

/**
 * The serial badge — the visual anchor of a PC row, and deliberately nothing
 * like anything in the Watch sheet.
 *
 * Violet, because this is a collection and not a deal: green in the Watch
 * sheet means "the engine's gate cleared", and a bookend has no gate to
 * clear. A one-of-one wears the same badge in gold, reading its own serial,
 * which for a 1/1 is "1/1" — one badge, not two saying the same thing. The
 * gold is its own token and NOT the auction amber: on this sheet amber means
 * one of one, and nothing else is allowed to say it.
 */
function serialBadge(find) {
  const text = find.serial || (find.num !== null && find.den !== null ? `${find.num}/${find.den}` : '');
  if (!text) return null;
  return el('span', { cls: `pc-serial${find.oneOfOne ? ' pc-one' : ''}` }, [
    el('span', { cls: 'pc-badge-glyph', attrs: { 'aria-hidden': 'true' }, text: find.oneOfOne ? '★' : '⬥' }),
    el('span', { text }),
  ]);
}

/** `◆ PSA 10`, secondary to the serial. Verbatim, and absent when absent. */
function gradeChip(find) {
  if (!find.grade) return null;
  return el('span', { cls: 'pc-grade' }, [
    el('span', { cls: 'pc-badge-glyph', attrs: { 'aria-hidden': 'true' }, text: '◆' }),
    el('span', { text: find.grade }),
  ]);
}

/** `cardvault · 2,410 fb · listed 2026-09-19`, with the new mark at the end. */
function pcFootLine(find) {
  const bits = [];
  if (find.seller) bits.push(el('span', { text: find.seller }));
  const fb = count(find.sellerFb);
  if (fb) {
    if (bits.length) bits.push(sep());
    bits.push(el('span', { text: `${fb} fb` }));
  }
  // A business date, printed as text — rule 7. It is never parsed, here or
  // anywhere: `listed` is a Central YYYY-MM-DD and that is what it stays.
  if (find.listed) {
    if (bits.length) bits.push(sep());
    bits.push(el('span', { text: `listed ${find.listed}` }));
  }
  if (!bits.length && !find.isNew) return null;
  return el('div', { cls: 'pc-foot-line' }, [
    el('span', { cls: 'pc-who-line' }, bits),
    find.isNew ? newMark() : null,
  ]);
}

/**
 * One PC find, laid out. NOT `listingRow` with a flag set — see the header.
 *
 * The shape is serial-and-grade first, money second, because the question
 * this sheet answers is "does it exist, and in what grade". On Watch the
 * money leads, because there the question is whether the number is low
 * enough. Same components, opposite emphasis, and that is the point.
 */
function pcRow(find, clocks) {
  const auction = find.type === 'AUCTION';
  const ends = auction ? endsLine(find, clocks, { amber: false }) : null;

  const marks = [serialBadge(find), gradeChip(find)].filter(Boolean);
  if (find.type === 'OBO') marks.push(chip('OBO', 'obo'));

  const kids = [
    thumb(find),
    el('div', { cls: 'cards-main' }, [
      el('div', { cls: 'cards-title-line' }, [
        el('span', { cls: 'cards-title', text: find.title || '(untitled listing)' }),
      ]),
      find.player ? el('div', { cls: 'cards-who', text: find.player }) : null,
      // Badges and money share a line where there is room for both, and wrap
      // to two on a phone. The serial is the anchor, so it leads.
      el('div', { cls: 'pc-line' }, [
        marks.length ? el('div', { cls: 'pc-marks' }, marks) : null,
        priceLine(find, { auction, unknownShip: true }),
      ]),
      ends ? ends.node : null,
      pcFootLine(find),
    ]),
  ];

  const safe = safeUrl(find.url);
  const row = safe
    ? el(
        'a',
        { cls: 'pc-row cards-row-link', attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' } },
        kids
      )
    : el('div', { cls: 'pc-row' }, kids);

  if (ends && ends.entry) {
    ends.entry.row = row;
    paintClock(ends.entry, ends.entry.ms);
  }
  return row;
}

/**
 * The PC sheet: what the net caught, bookends first.
 *
 * `finds` arrives ordered — bookends, then one-of-ones — and the order INSIDE
 * each class is the engine's. This partitions on `one_of_one` rather than
 * trusting the boundary to be where it looks, and re-sorts neither half.
 *
 * Returns the clock's teardown, exactly as the Watch sheet does: an auction
 * in here counts down on the same machinery, minus the amber.
 */
function pcBody(pc, data, tile) {
  const finds = arr(pc.finds).map(planFind);
  const bookends = finds.filter((f) => !f.oneOfOne);
  const ones = finds.filter((f) => f.oneOfOne);
  const errors = arr(pc.errors).filter(Boolean).map(String);
  const counts = obj(pc.counts);
  const shown = num(counts.shown);
  const found = num(pc.total_found);

  return (body) => {
    const clocks = [];

    if (errors.length) {
      body.appendChild(el('p', { cls: 'cards-errors', text: `feed trouble: ${errors.join(' · ')}` }));
    }
    const warn = staleMark(tile, pc);
    if (warn) body.appendChild(warn);

    // The caps are deliberate — per class and per seller — so the gap between
    // what was found and what is listed is said out loud rather than left to
    // look like a short night. When they match there is nothing to say.
    if (shown !== null && found !== null && found > shown) {
      body.appendChild(el('p', { cls: 'pc-showing', text: `Showing ${shown} of ${found}` }));
    }

    if (!finds.length) {
      body.appendChild(empty('Nothing graded and numbered 1/N or N/N on the board right now.'));
    } else {
      // Bookends are the target; one-of-ones are the bonus class. That order
      // is the engine's and it is the order they are read in.
      if (bookends.length) {
        body.appendChild(sectionHead(`Bookends (${bookends.length})`));
        body.appendChild(el('div', { cls: 'pc-list' }, bookends.map((f) => pcRow(f, clocks))));
      }
      if (ones.length) {
        body.appendChild(sectionHead(`One of ones (${ones.length})`));
        body.appendChild(el('div', { cls: 'pc-list' }, ones.map((f) => pcRow(f, clocks))));
      }
    }

    const foot = [str(data.pc_footer).trim(), 'eBay data via Browse API'].filter(Boolean).join(' · ');
    body.appendChild(el('p', { cls: 'cards-foot', text: foot }));

    return startClock(clocks);
  };
}

// --------------------------------------------------------------------- shop

/**
 * 🏷️ Shop — Matt's OWN eBay storefront. What is up, and what has dropped off.
 *
 * WHAT THIS FACE IS NOT. It is not a gate and it is not a collection. There is
 * no FMV, no percentage, no ✓, no MAX — Watch's whole vocabulary is absent,
 * because nothing here is being judged against a comp book. And unlike PC
 * there is no serial and no grade either: these are Matt's listings, not
 * finds. The only things a row carries are the photo, the title, the asking
 * price, what kind of listing it is, and how long it has been up.
 *
 * NOR does it show watchers or pending best offers. Both need user OAuth and
 * the legacy Trading API, and eBay's own app already pushes them to his phone
 * the moment they happen — so they are out of scope by ruling, and there is
 * deliberately no stub here promising them later.
 *
 * THE AGE IS A NUMBER, NOT A VERDICT. `days_listed` renders plain and grey at
 * every value. No red, no amber, no "stale" badge, no reordering that implies
 * judgement, no "45 days and no offers" line. Matt owns this board and has a
 * standing ruling against the tile narrating his own shop back at him: the
 * number is information, and a colour would be an opinion. If this ever needs
 * changing it is his call, not a styling decision.
 *
 * SOLD OR ENDED — THE PAGE CANNOT TELL. eBay's public Browse API shows what is
 * active; a listing that has left the board either sold or expired and nothing
 * in the data says which. So the section is headed `No longer active` and NOT
 * "Sold", and a muted line says the ambiguity out loud. Those rows are also
 * not tappable: the listing is gone and the URL 404s, so a link there would be
 * a promise the page cannot keep.
 *
 * ORDER IS THE ENGINE'S. `listings` arrives newest-listed first and is
 * rendered in that order — see the division-of-labour note in the header.
 */

/** One of Matt's listings, cleaned up. Nothing is computed, only formatted. */
function planShopItem(raw) {
  const i = obj(raw);
  return {
    id: str(i.item_id).trim(),
    title: str(i.title).trim(),
    price: num(i.price),
    type: str(i.type).trim().toUpperCase(),
    // Best Offer, as the engine found it. A boolean, treated as one: anything
    // that is not literally true is not an invitation to make an offer.
    offers: i.offers === true,
    // A Central business date and a plain count. Both are printed, never
    // parsed and never compared — rule 7, and the age ruling above.
    listed: str(i.listed).trim(),
    days: num(i.days_listed),
    url: str(i.url),
    image: str(i.image),
  };
}

/** A listing that has left the board. Less of everything, on purpose. */
function planGone(raw) {
  const g = obj(raw);
  return {
    id: str(g.item_id).trim(),
    title: str(g.title).trim(),
    price: num(g.price),
    listed: str(g.listed).trim(),
    since: str(g.gone_since).trim(),
  };
}

/**
 * One live listing.
 *
 *     [thumb]  2024 Cosmic Chrome Jackson Chourio Planetary Pursuit
 *              $179.00 · OBO · 45 days
 *
 * The chip says what kind of listing it is and nothing else. An auction says
 * AUCTION; a fixed price that takes offers says OBO; a plain Buy It Now says
 * nothing at all, because "BIN" on a row with a single price is a word that
 * earns no space. AUCTION wins where both could apply — an auction's format
 * is the more consequential fact about it.
 *
 * The chip is deliberately the neutral tone. A coloured one would rank these
 * listings against each other, and they are not in a race.
 */
function shopRow(item) {
  const line = [el('span', { cls: 'shop-price', text: usd(item.price) })];

  const mark = item.type === 'AUCTION' ? chip('AUCTION') : item.offers ? chip('OBO', 'obo') : null;
  if (mark) {
    line.push(sep());
    line.push(mark);
  }

  // Grey at three days and grey at three hundred. See the age ruling above:
  // there is no branch here on purpose, and adding one would be the bug.
  // A listing with no age at all simply loses the clause — never "null days".
  if (item.days !== null) {
    line.push(sep());
    line.push(el('span', { cls: 'shop-days', text: `${item.days} day${item.days === 1 ? '' : 's'}` }));
  }

  const kids = [
    thumb(item),
    el('div', { cls: 'cards-main' }, [
      el('div', { cls: 'cards-title-line' }, [
        el('span', { cls: 'cards-title', text: item.title || '(untitled listing)' }),
      ]),
      el('div', { cls: 'shop-line' }, line),
    ]),
  ];

  const safe = safeUrl(item.url);
  if (!safe) return el('div', { cls: 'shop-row' }, kids);
  return el(
    'a',
    { cls: 'shop-row cards-row-link', attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' } },
    kids
  );
}

/**
 * One listing that has gone. Muted, and a plain div rather than a link.
 *
 * `gone_since` is a Central `YYYY-MM-DD` and is printed exactly as it arrived
 * (rule 7). The price is the last thing Matt was asking, which is worth
 * knowing whether it sold or expired — and is the only figure here, because
 * there is no sale price in this data and inventing one would be worse than
 * silence.
 */
function goneRow(g) {
  const tail = [];
  if (g.price !== null) tail.push(el('span', { text: usd(g.price) }));
  if (g.since) {
    if (tail.length) tail.push(sep());
    tail.push(el('span', { text: `since ${g.since}` }));
  }
  return el('div', { cls: 'shop-gone-row' }, [
    el('span', { cls: 'shop-gone-title', text: g.title || '(untitled listing)' }),
    tail.length ? el('span', { cls: 'shop-gone-line' }, tail) : null,
  ]);
}

/**
 * The Shop sheet: errors, what is listed, what has dropped off, one footer.
 *
 * Nothing in here ticks, so — unlike Watch and PC — the builder hands back no
 * teardown. A storefront is a slow-moving thing and a countdown on it would
 * be the tile inventing urgency it has no evidence for.
 */
function shopBody(shop, data, tile) {
  const listings = arr(shop.listings).map(planShopItem);
  const gone = arr(shop.gone).map(planGone);
  const errors = arr(shop.errors).filter(Boolean).map(String);

  return (body) => {
    // What the sweep could not reach, said once and quietly, at the top —
    // because everything below it may be an incomplete picture.
    if (errors.length) {
      body.appendChild(el('p', { cls: 'cards-errors', text: `feed trouble: ${errors.join(' · ')}` }));
    }
    const warn = staleMark(tile, shop);
    if (warn) body.appendChild(warn);

    body.appendChild(sectionHead(`Listed (${listings.length})`));
    if (!listings.length) {
      body.appendChild(empty('Nothing listed right now.'));
    } else {
      // Newest-listed first, as delivered. No re-sort — an order chosen here
      // would be this page having an opinion about which listing matters.
      body.appendChild(el('div', { cls: 'shop-list' }, listings.map(shopRow)));
    }

    // Nothing has dropped off: no heading, no empty state. A header over
    // "none" would read as a section that broke rather than a quiet week.
    if (gone.length) {
      body.appendChild(sectionHead('No longer active'));
      body.appendChild(
        el('p', { cls: 'shop-note', text: "Sold or ended — eBay's public data can't tell them apart." })
      );
      body.appendChild(el('div', { cls: 'shop-gone' }, gone.map(goneRow)));
    }

    const foot = [str(data.shop_footer).trim(), 'eBay data via Browse API'].filter(Boolean).join(' · ');
    body.appendChild(el('p', { cls: 'cards-foot', text: foot }));
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
const PC_FACE = { key: 'pc', emoji: '🎖️', label: 'PC', tone: 'pc' };

/** Is this payload a face the engine has actually lit up? */
const isFace = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

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

  // 🏷️ Shop — Matt's own storefront. `shop: null` is the engine degraded, not
  // an empty shop, so the button stays put and greys to "soon" exactly as it
  // did before the face shipped rather than vanishing off the menu.
  //
  // Its chip is `active`, the engine's own count of what is up — a plain
  // number with no decision in it, which is the whole point of this face. And
  // no dot: nothing in a storefront is ending in two hours.
  const hasShop = isFace(data.shop);
  const shop = obj(data.shop);
  const shopActive = num(shop.active);
  if (!hasShop) {
    buttons.push(soonButton(SHOP_FACE));
  } else {
    buttons.push(
      liveButton(SHOP_FACE, {
        chipNode:
          shopActive === null
            ? null
            : el('span', { cls: 'cards-count cards-count-shop', text: String(shopActive) }),
        open: openPanel ? () => openPanel('🏷️ Shop', shopBody(shop, data, tile)) : null,
      })
    );
  }

  // 🎖️ PC — the bookend net. Its chip counts arrivals and nothing else:
  // there is no gate here to have cleared, so a count of finds would be a
  // number with no decision in it. Zero new means no chip; the button stays
  // tappable, because "nothing new tonight" is worth being able to confirm.
  const hasPc = isFace(data.pc);
  const pc = obj(data.pc);
  if (!hasPc) {
    buttons.push(soonButton(PC_FACE));
  } else {
    const fresh = arr(pc.finds).filter((f) => obj(f).new === true).length;
    buttons.push(
      liveButton(PC_FACE, {
        chipNode: fresh
          ? el('span', { cls: 'cards-count cards-count-pc' }, [
              el('span', { text: String(fresh) }),
              el('span', { cls: 'cards-count-new', text: 'new' }),
            ])
          : null,
        open: openPanel ? () => openPanel('🎖️ PC', pcBody(pc, data, tile)) : null,
      })
    );
  }

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

  // The shop's own line, in the menu's order. `{n} listed`, and what has left
  // the board only when something has — "0 dropped off" would be the tile
  // reporting on a week in which nothing happened.
  if (hasShop) {
    const shopBits = [];
    if (shopActive !== null) shopBits.push(`${shopActive} listed`);
    const dropped = arr(shop.gone).length;
    if (dropped) shopBits.push(`${dropped} dropped off`);
    if (shopBits.length) root.appendChild(el('p', { cls: 'tile-foot', text: shopBits.join(' · ') }));
  }

  // The PC net's own line, under Watch's. The two faces count different
  // things and neither number belongs in the other's sentence.
  if (hasPc) {
    const c = obj(pc.counts);
    const pcBits = [];
    const bookends = num(c.bookend);
    if (bookends !== null) pcBits.push(`${bookends} bookends`);
    const oneOfOnes = num(c.one_of_one);
    if (oneOfOnes !== null) pcBits.push(`${oneOfOnes} 1/1s`);
    if (pcBits.length) root.appendChild(el('p', { cls: 'tile-foot', text: pcBits.join(' · ') }));
  }

  const warn = staleMark(tile, watch);
  if (warn) root.appendChild(warn);
}
