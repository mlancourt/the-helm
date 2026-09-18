/**
 * dinner — tonight's meal from the week's plan. Read-only.
 *
 * The HIT / MISS buttons lived here until 2026-09-18. Matt rules verdicts
 * during the Meal Planner's approval pass, and only on new recipes, so the
 * board carried a write affordance that duplicated a decision made elsewhere.
 * Removed rather than hidden. The `meal_verdict` event type stays defined in
 * the Worker and handled by the engine — dormant plumbing, not dead code — so
 * a verdict path can come back without a schema change.
 *
 * A verdict in the snapshot is the vault's own and already applied: render it,
 * never offer to change it. This tile no longer writes, so it takes no ctx.
 */
import { el, empty, pill } from '../lib/dom.js';
import { dayLabel } from '../lib/fmt.js';

export function render(el_, tile) {
  const data = tile.data || {};

  if (!data.meal) {
    el_.appendChild(empty('No meal planned.'));
  } else {
    // data.date is a Central 'YYYY-MM-DD' string — formatted from its parts.
    if (data.date) el_.appendChild(el('div', { cls: 'tile-subhead', text: dayLabel(data.date) }));
    el_.appendChild(el('div', { cls: 'dinner-meal', text: data.meal }));
    if (data.notes) el_.appendChild(el('p', { cls: 'dinner-notes', text: data.notes }));
  }

  // The applied verdict, straight from the vault.
  if (data.verdict) {
    el_.appendChild(
      el('div', { cls: 'dinner-verdict' }, [
        el('span', { cls: 'row-label', text: 'verdict' }),
        pill(String(data.verdict), data.verdict === 'HIT' ? 'good' : 'neutral'),
      ])
    );
  }
}
