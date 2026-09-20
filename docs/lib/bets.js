/**
 * The bits of the betting board both bet tiles draw.
 *
 * `bets_live` is the sweat and `bets_ledger` is the look-back, but they share
 * a vocabulary: a streak is a streak, and 🔥 W5 must mean the same thing and
 * wear the same green on both cards. Two copies of this would eventually
 * disagree about what "L4" looks like, and the board's credibility is made of
 * exactly that kind of small agreement.
 *
 * Nothing in here computes anything. The engine settles; the page renders.
 */

import { el } from './dom.js';

/**
 * `🔥 W5` / `🧊 L3`, or nothing at all when there is no streak to name.
 *
 * A spelling this file does not recognise gets no chip rather than a
 * confident colour: green is a claim, and "S3" is not one we can make.
 */
export function streakChip(streak) {
  const s = streak === null || streak === undefined ? '' : String(streak).trim();
  if (!s) return null;
  const hot = /^W/i.test(s);
  const cold = /^L/i.test(s);
  if (!hot && !cold) return null;
  return el('span', { cls: `form-streak form-streak-${hot ? 'hot' : 'cold'}` }, [
    el('span', { cls: 'form-streak-emoji', attrs: { 'aria-hidden': 'true' }, text: hot ? '🔥' : '🧊' }),
    el('span', { text: s }),
  ]);
}
