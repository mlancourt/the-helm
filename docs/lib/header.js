/**
 * The topbar's text, as pure functions.
 *
 * This exists so the one rule that matters up here is testable without booting
 * the page: **the board never prints who is holding the token.** `/api/data`
 * still returns `me` — it is part of the Worker contract and the page still
 * reads it — but the header speaks for the machine, not for the operator. The
 * name that used to sit here is now a fixed label, and `me.name` is rendered
 * nowhere on the board.
 *
 * If a future ruling wants identity back on screen, it goes through this file
 * and the test that guards it, not into a template string in app.js.
 */

import { ago } from './fmt.js';

/** Who the board says it is. Not a person, and deliberately not `me.name`. */
export const OPERATOR = 'LannyAI';

/**
 * The line under the wordmark: `LannyAI  ·  snapshot 49m ago`.
 *
 * Takes the snapshot, never the session — there is no parameter here that
 * could carry a name into the output.
 */
export function subheadText(snapshot) {
  const bits = [OPERATOR];
  const rel = snapshot?.generated_at ? ago(snapshot.generated_at) : '';
  if (rel) bits.push(`snapshot ${rel}`);
  return bits.join('  ·  ');
}
