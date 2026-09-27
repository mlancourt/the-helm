/**
 * dinner — tonight's meal, then the plan's whole week. Read-only.
 *
 * v1.22.0 (2026-09-27, Dinner-Tile-Spec D1–D6): the week under tonight, and
 * emoji on every meal. The ENGINE picks every emoji (the vault's dinner.json
 * maps meal names to food; a plan's own emoji wins) — this module prints the
 * strings it is given and decides nothing about food. On Saturday and Sunday
 * the engine sends NEXT week's plan when it has landed, labelled so; a plan
 * Matt hasn't locked in yet arrives as `status: 'proposed'` and says so.
 *
 * "Today" in the week list is the snapshot's own `data.date` — the same day
 * the headline is about — so the highlighted row and the headline can never
 * disagree. Dates are Central 'YYYY-MM-DD' strings compared as strings, never
 * parsed (rule 7).
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/** '🌮' + 'Walking Tacos' + ' ✨' — the emoji span is decoration, the name is the content. */
function dish(emoji, meal, isNew, cls) {
  return el('span', { cls }, [
    emoji ? el('span', { cls: 'dinner-emoji', text: emoji, attrs: { 'aria-hidden': 'true' } }) : null,
    el('span', { cls: 'dinner-name', text: meal }),
    isNew ? el('span', { cls: 'dinner-new', text: '✨', attrs: { 'aria-label': 'new recipe', title: 'New recipe' } }) : null,
  ]);
}

function week(w, today) {
  if (!w || typeof w !== 'object') return null;
  const days = Array.isArray(w.days) ? w.days.filter((d) => d && typeof d === 'object') : [];
  if (!days.length) return null;

  const head = el('div', { cls: 'dinner-week-head' }, [
    el('span', { text: `📅 ${str(w.label) || 'This week'}` }),
    w.status === 'proposed' ? pill('proposed', 'neutral') : null,
  ]);

  const rows = days.map((d) => {
    const date = str(d.date);
    let cls = 'dinner-day';
    if (YMD.test(date) && YMD.test(today)) {
      if (date === today) cls += ' is-today';
      else if (date < today) cls += ' is-past';
    }
    const vibe = str(d.vibe);
    const vibeEmoji = str(d.vibe_emoji);
    return el('div', { cls }, [
      el('span', { cls: 'dinner-dow', text: str(d.day) || date }),
      dish(str(d.emoji), str(d.meal) || '(no meal)', d.is_new === true, 'dinner-dish'),
      vibeEmoji
        ? el('span', { cls: 'dinner-vibe', text: vibeEmoji, attrs: { title: vibe || null, 'aria-label': vibe || null } })
        : el('span', { cls: 'dinner-vibe' }),
    ]);
  });

  return el('div', { cls: 'dinner-week' }, [head, ...rows]);
}

export function render(el_, tile) {
  const data = (tile && tile.data) || {};

  if (!data.meal) {
    el_.appendChild(empty('🍽️ Nothing planned tonight.'));
  } else {
    // data.date is a Central 'YYYY-MM-DD' string — formatted from its parts.
    const vibe = str(data.vibe);
    const sub = [data.date ? dayLabel(data.date) : '', vibe ? `${str(data.vibe_emoji)} ${vibe}`.trim() : '']
      .filter(Boolean)
      .join(' · ');
    if (sub) el_.appendChild(el('div', { cls: 'tile-subhead', text: sub }));
    el_.appendChild(el('div', { cls: 'dinner-meal' }, [dish(str(data.emoji), str(data.meal), data.is_new === true, 'dinner-dish')]));
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

  const w = week(data.week, str(data.date));
  if (w) el_.appendChild(w);
}
