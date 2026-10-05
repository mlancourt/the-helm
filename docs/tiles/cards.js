/**
 * PAYLOAD KEYS vs PAGE LABELS — READ THIS BEFORE "FIXING" THE MISMATCH.
 * `data.pc` feeds the face labelled 🎯 Watching. `data.shop` feeds the face
 * labelled 🏷️ Selling (🎖️ PC until v1.34.0 — the name now belongs to the
 * keeper set, not the storefront). `data.watch` is ignored entirely. The payload keys are the
 * engine's contract and do not change; only the page's labels did (Matt,
 * 2026-09-30). The CSS classes follow the payload keys (`pc-*`, `shop-*`).
 */

/**
 * cards — the trading-card desk. Two faces: 🎯 Watching · 🏷️ Selling.
 *
 * A menu tile in the `entertainment` mould: the board carries the buttons and
 * a faint line per live face, and everything with a price on it lives in the
 * sheet. A shopping list is never urgent enough to earn board height.
 *
 * The buy-side hunt against the FMV book (the old 🎯 Watch face) is RETIRED
 * (Matt, 2026-09-30). The engine publishes `watch: null` and will keep doing
 * so; a cached snapshot that still carries a populated `watch` renders the
 * identical two buttons, because this module never reads the key.
 *
 * THE TWO FACES ASK TWO DIFFERENT QUESTIONS, AND NEITHER IS A GATE.
 *
 *   Watching (`data.pc`) asks "does this exist?" — the first-off-the-press
 *   net. There is no matched-grade tape behind a first-of-run card, so there
 *   is no FMV, no percentage and no MAX. Price is Matt's to judge. Its badges
 *   are the SERIAL and the GRADE, and nothing on it is green or ticked.
 *
 *   PC (`data.shop`) asks "what is up, and what has left?" — Matt's own
 *   storefront, which IS his personal collection, currently for sale. No
 *   serial, no grade, and an age that is a number rather than a verdict — see
 *   that section's own header.
 *
 * Amber means nothing here. On Watching the one-of-one gold carries the only
 * accent a badge wears, so an auction countdown never goes amber: two
 * meanings for one colour on one screen is how somebody buys the wrong card.
 *
 * THE DIVISION OF LABOUR. The engine does all of the judgement and sorts
 * every list before publishing. This module recomputes NONE of it:
 *
 *   - `all_in` is printed, never derived from `price + ship`. If the engine's
 *     arithmetic and this page's ever disagree, the engine is right, and a
 *     number invented here would be indistinguishable from a real one.
 *   - the order of every list is the order it arrived in.
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
 * plus the raw wall stamp, no countdown, no error.
 *
 * RULE 4: the thumbnails are `<img>` tags pointing at the listing host's own
 * CDN — the snapshot-image carve-out. Kept as narrow as possible: http(s)
 * only via `safeUrl`, `referrerpolicy="no-referrer"` so the URL of Matt's
 * homepage never reaches the host, `loading="lazy"` so nothing is fetched
 * until the sheet is actually open, and a plain grey box whenever there is no
 * usable image. The service worker never caches them.
 *
 * RULE 10: every title, seller and player lands via textContent, the alt text
 * included, and every row's anchor goes through `safeUrl` — a row whose URL is
 * junk stays a row, it just stops being tappable.
 */

import { el, empty, genericCard, safeUrl } from '../lib/dom.js';
import { ctTime, usd, msUntil, countdown } from '../lib/fmt.js';

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

/** 1204 -> '1,204'. A feedback score, so it is a count and not a currency. */
function count(v) {
  const n = num(v);
  return n === null ? '' : n.toLocaleString('en-US');
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
 * eBay does not always say what postage costs, and when it does not there is
 * no all-in to print. The line says `+ ship?` and STOPS — no arrow pointing at
 * nothing, and certainly no total this page invented out of a missing number.
 */
function priceLine(item, { auction = false } = {}) {
  const parts = [];
  const price = usd(item.price);
  parts.push(el('span', { cls: 'cards-price', text: auction ? `bid ${price}` : price }));
  if (item.ship === null) {
    parts.push(el('span', { cls: 'cards-ship', text: '+ ship?' }));
    return el('div', { cls: 'cards-money' }, parts);
  }
  parts.push(el('span', { cls: 'cards-ship', text: `+ ${usd(item.ship)} ship` }));
  parts.push(el('span', { cls: 'cards-arrow', attrs: { 'aria-hidden': 'true' }, text: '→' }));
  parts.push(el('span', { cls: 'cards-allin', text: usd(item.allIn) }));
  return el('div', { cls: 'cards-money' }, parts);
}

/**
 * The end-time line: a live countdown, with the wall-clock time behind it.
 *
 *     ⏱ 1h 42m        ends 7:48 PM
 *
 * BOTH halves come from `ends_utc` (Matt, 2026-09-20). The countdown is the
 * number he reads at a glance; the clock time is the one he can trust without
 * arithmetic, and it is formatted by `ctTime`, which pins America/Chicago
 * explicitly. That pin is the whole point: this is a Central-time board, and
 * opening it on a laptop in Denver must not quietly shift every auction by an
 * hour.
 *
 * `ends_ct` is NOT a display field. It is the pre-v1.6 fallback below and
 * nothing else — the one place it reaches the DOM, printed raw and unparsed.
 *
 * Pushes a clock entry onto `clocks` when there is a real instant to count
 * from, so the sheet's single interval can repaint it. Returns null when the
 * listing carries no end time at all.
 */
function endsLine(item, clocks) {
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
  // At zero the row goes grey — it has not gone wrong, it is over — and it
  // stays exactly where it is until the engine's next pass removes it. A row
  // vanishing under Matt's thumb mid-scroll would be the worse bug.
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

/** A section heading, printed only when the section has something under it. */
const sectionHead = (text) => el('h4', { cls: 'cards-head', text });

/**
 * The small ⚠︎ a stale tile wears, or null.
 *
 * Keyed off the TILE's own status and nothing else — `stale` means the sweep
 * half-answered. What DID arrive is still real, so the rows render and the
 * mark carries the reason (rule 8): the tile's `error`, else what the faces
 * say they could not reach, else when each face last swept (its `updated_at`,
 * in Central), else a plain sentence.
 *
 * `faces` is `[[label, payload], …]` — the two faces on the board, or the one
 * whose sheet is open.
 */
function staleMark(tile, faces) {
  if (str(tile && tile.status) !== 'stale') return null;
  const errors = faces.flatMap(([, f]) => arr(obj(f).errors).filter(Boolean).map(String));
  const swept = faces
    .map(([label, f]) => {
      const at = ctTime(obj(f).updated_at);
      return at ? `${label} ${at}` : '';
    })
    .filter(Boolean);
  const reason =
    str(tile.error).trim() ||
    errors.join(' · ') ||
    (swept.length ? `last sweep: ${swept.join(' · ')}` : '') ||
    'the listing pull did not finish';
  return el('p', { cls: 'tile-foot cards-stale' }, [
    el('span', {
      cls: 'cards-warn',
      text: '⚠︎',
      attrs: { title: reason, 'aria-label': `feed trouble: ${reason}` },
    }),
  ]);
}

// --------------------------------------------------------- 🎯 Watching (data.pc)

/**
 * One find — a listing, plus the two things that make it first off the press.
 *
 * `serial` is the engine's own display string and is printed verbatim — the
 * page does not build "1/25" out of `num` and `den`, it is handed it. The
 * ints ride along for anyone who needs to count, and nothing here does.
 *
 * `grade` is always a string from the engine, which only emits graded cards.
 * It is treated as possibly-null anyway: a row with no grade still renders,
 * it just loses the chip. Raw cards are out of scope by ruling, so there is
 * deliberately no "ungraded" affordance to fall into.
 */
function planFind(raw) {
  const f = obj(raw);
  return {
    title: str(f.title).trim(),
    player: str(f.player).trim(),
    type: str(f.type).trim().toUpperCase(),
    price: num(f.price),
    ship: num(f.ship),
    allIn: num(f.all_in),
    endsCt: str(f.ends_ct).trim(),
    // The instant. `ends_ct` is its wall-clock twin and stays text forever.
    endsUtc: str(f.ends_utc).trim(),
    seller: str(f.seller).trim(),
    sellerFb: num(f.seller_fb),
    listed: str(f.listed).trim(),
    url: str(f.url),
    image: str(f.image),
    isNew: f.new === true,
    serial: str(f.serial).trim(),
    num: num(f.num),
    den: num(f.den),
    oneOfOne: f.one_of_one === true,
    grade: str(f.grade).trim(),
  };
}

/**
 * The serial badge — the visual anchor of a Watching row.
 *
 * Violet, because this is a collection and not a deal: there is no gate to
 * clear and so no green. A one-of-one wears the same badge in gold, reading
 * its own serial, which for a 1/1 is "1/1" — one badge, not two saying the
 * same thing. The gold is its own token and NOT the warn amber.
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
 * One find, laid out: serial-and-grade first, money second, because the
 * question this sheet answers is "does it exist, and in what grade".
 */
function pcRow(find, clocks) {
  const auction = find.type === 'AUCTION';
  const ends = auction ? endsLine(find, clocks) : null;

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
        priceLine(find, { auction }),
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

  // The clock greys the whole row at zero, not just its own line, so it needs
  // a handle on the row — which only exists once the kids are built. The
  // first paint happens here, for the same reason.
  if (ends && ends.entry) {
    ends.entry.row = row;
    paintClock(ends.entry, ends.entry.ms);
  }
  return row;
}

/**
 * The Watching sheet: first off the press, then the one-of-ones.
 *
 * `finds` arrives ordered — first-of-run, then one-of-ones — and the order
 * INSIDE each class is the engine's. This partitions on `one_of_one` rather
 * than trusting the boundary to be where it looks, and re-sorts neither half.
 *
 * The builder returns the clock's teardown. The shell holds it and calls it
 * when the sheet closes or another one opens — a countdown left running
 * behind a closed sheet would tick against detached nodes forever.
 */
function pcBody(pc, data, tile) {
  const finds = arr(pc.finds).map(planFind);
  const firsts = finds.filter((f) => !f.oneOfOne);
  const ones = finds.filter((f) => f.oneOfOne);
  const errors = arr(pc.errors).filter(Boolean).map(String);
  const counts = obj(pc.counts);
  const shown = num(counts.shown);
  const found = num(pc.total_found);

  return (body) => {
    const clocks = [];

    // What the net could not reach, said once and quietly, at the top —
    // because everything below it may be an incomplete picture.
    if (errors.length) {
      body.appendChild(el('p', { cls: 'cards-errors', text: `feed trouble: ${errors.join(' · ')}` }));
    }
    const warn = staleMark(tile, [['Watching', pc]]);
    if (warn) body.appendChild(warn);

    // The caps are deliberate — per class and per seller — so the gap between
    // what was found and what is listed is said out loud rather than left to
    // look like a short night. When they match there is nothing to say.
    if (shown !== null && found !== null && found > shown) {
      body.appendChild(el('p', { cls: 'pc-showing', text: `Showing ${shown} of ${found}` }));
    }

    if (!finds.length) {
      body.appendChild(empty('nothing new — 1/N PSA only'));
    } else {
      // First-of-run is the target; one-of-ones are the bonus class. That
      // order is the engine's and it is the order they are read in.
      if (firsts.length) {
        body.appendChild(sectionHead(`First off the press (${firsts.length})`));
        body.appendChild(el('div', { cls: 'pc-list' }, firsts.map((f) => pcRow(f, clocks))));
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

// ------------------------------------------------------- 🏷️ Selling (data.shop)

/**
 * 🏷️ Selling — Matt's OWN eBay storefront (thelannylp): the cards he is
 * moving. (Labelled 🎖️ PC v1.25–v1.33; renamed 2026-10-05 when the true PC
 * — the keepers, not for sale — became its own thing.) What is up, and what has dropped off.
 *
 * WHAT THIS FACE IS NOT. It is not a gate and it is not a hunt. There is no
 * FMV, no percentage, no ✓, no MAX, and unlike Watching there is no serial
 * and no grade either: these are Matt's listings, not finds. The only things
 * a row carries are the photo, the title, the asking price, what kind of
 * listing it is, and how long it has been up.
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
 * The Selling sheet: errors, what is listed, what has dropped off, one footer.
 *
 * Nothing in here ticks, so — unlike Watching — the builder hands back no
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
    const warn = staleMark(tile, [['Selling', shop]]);
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

/** A button for a face the engine has not lit: visible, inert, wearing "soon". */
function soonButton(face) {
  return el('button', { cls: 'cards-btn cards-btn-soon', attrs: { type: 'button', disabled: 'disabled' } }, [
    el('span', { cls: 'cards-emoji', attrs: { 'aria-hidden': 'true' }, text: face.emoji }),
    el('span', { cls: 'cards-btn-label', text: face.label }),
    el('span', { cls: 'cards-soon', text: 'soon' }),
  ]);
}

function liveButton(face, { chipNode = null, open = null }) {
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
      chipNode,
    ]
  );
}

// Label ≠ key, on purpose — see the note at the top of this file.
const WATCHING_FACE = { key: 'pc', emoji: '🎯', label: 'Watching', tone: 'pc' };
const SELLING_FACE = { key: 'shop', emoji: '🏷️', label: 'Selling', tone: 'shop' };

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

  const buttons = [];

  // 🎯 Watching (`data.pc`) — first. Its chip counts arrivals and nothing
  // else: there is no gate here to have cleared, so a count of finds would be
  // a number with no decision in it. Zero new means no chip; the button stays
  // tappable, because "nothing new tonight" is worth being able to confirm.
  // `pc: null` is the engine degraded, so the button greys to "soon" rather
  // than vanishing off the menu.
  const hasPc = isFace(data.pc);
  const pc = obj(data.pc);
  if (!hasPc) {
    buttons.push(soonButton(WATCHING_FACE));
  } else {
    const fresh = arr(pc.finds).filter((f) => obj(f).new === true).length;
    buttons.push(
      liveButton(WATCHING_FACE, {
        chipNode: fresh
          ? el('span', { cls: 'cards-count cards-count-pc' }, [
              el('span', { text: String(fresh) }),
              el('span', { cls: 'cards-count-new', text: 'new' }),
            ])
          : null,
        open: openPanel ? () => openPanel('🎯 Watching', pcBody(pc, data, tile)) : null,
      })
    );
  }

  // 🏷️ Selling (`data.shop`) — second. Its chip is `active`, the engine's own
  // count of what is up — a plain number with no decision in it.
  const hasShop = isFace(data.shop);
  const shop = obj(data.shop);
  const shopActive = num(shop.active);
  if (!hasShop) {
    buttons.push(soonButton(SELLING_FACE));
  } else {
    buttons.push(
      liveButton(SELLING_FACE, {
        chipNode:
          shopActive === null
            ? null
            : el('span', { cls: 'cards-count cards-count-shop', text: String(shopActive) }),
        open: openPanel ? () => openPanel('🏷️ Selling', shopBody(shop, data, tile)) : null,
      })
    );
  }

  root.appendChild(el('div', { cls: 'cards-menu', attrs: { role: 'group', 'aria-label': 'Cards' } }, buttons));

  // One faint line per live face, in the menu's order. Every part is omitted
  // rather than guessed at, so a payload that half-arrived says less instead
  // of saying something wrong.
  if (hasPc) {
    const c = obj(pc.counts);
    const pcBits = [];
    const bookends = num(c.bookend);
    if (bookends !== null) pcBits.push(`${bookends} 1/N`);
    const oneOfOnes = num(c.one_of_one);
    if (oneOfOnes !== null) pcBits.push(`${oneOfOnes} 1/1s`);
    if (pcBits.length) root.appendChild(el('p', { cls: 'tile-foot', text: pcBits.join(' · ') }));
  }

  // `{n} listed`, and what has left the board only when something has —
  // "0 dropped off" would be the tile reporting on a week nothing happened.
  if (hasShop) {
    const shopBits = [];
    if (shopActive !== null) shopBits.push(`${shopActive} listed`);
    const dropped = arr(shop.gone).length;
    if (dropped) shopBits.push(`${dropped} dropped off`);
    if (shopBits.length) root.appendChild(el('p', { cls: 'tile-foot', text: shopBits.join(' · ') }));
  }

  const warn = staleMark(tile, [['Watching', data.pc], ['Selling', data.shop]]);
  if (warn) root.appendChild(warn);
}
