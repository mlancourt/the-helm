/**
 * dinner — tonight's meal, plus the only write affordance on the board.
 *
 * Rule 5: a verdict is a *proposal*. Tapping HIT does not set the verdict; it
 * files a meal_verdict event that stays pending until the engine applies it.
 * The tile badges it pending and keeps showing the snapshot's own verdict
 * (usually null) underneath — a submitted write is never rendered as applied.
 */

import { el, empty, pill } from '../lib/dom.js';
import { dayLabel } from '../lib/fmt.js';

export function render(el_, tile, ctx) {
  const data = tile.data || {};

  if (!data.meal) {
    el_.appendChild(empty('No meal planned.'));
  } else {
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

  // Anything still in flight for this date.
  const mine = (ctx.pending || []).filter(
    (e) => e.type === 'meal_verdict' && e.payload?.date === data.date
  );

  const status = el('div', { cls: 'dinner-status' });
  const buttons = el('div', { cls: 'dinner-actions' });

  const send = async (verdict) => {
    buttons.querySelectorAll('button').forEach((b) => (b.disabled = true));
    status.textContent = 'filing…';
    try {
      await ctx.actions.submitEvent({
        type: 'meal_verdict',
        payload: { date: data.date, verdict },
      });
      // Re-render happens from the top once the event lands.
    } catch (e) {
      status.textContent = e.message || 'could not file';
      buttons.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  };

  for (const v of ['HIT', 'MISS']) {
    buttons.appendChild(
      el('button', {
        cls: `btn btn-${v.toLowerCase()}`,
        text: v,
        attrs: { type: 'button' },
        on: { click: () => send(v) },
      })
    );
  }

  if (!data.date) {
    // Without a date the event cannot be validly addressed, so don't offer it.
    buttons.querySelectorAll('button').forEach((b) => (b.disabled = true));
    status.textContent = 'no date on this tile';
  }

  el_.appendChild(buttons);

  for (const evt of mine) {
    status.appendChild(
      el('div', { cls: 'pending-chip' }, [
        pill('pending', 'pending'),
        el('span', { cls: 'pending-text', text: `${evt.payload.verdict} — not applied yet` }),
        el('button', {
          cls: 'link-btn',
          text: 'withdraw',
          attrs: { type: 'button' },
          on: {
            click: async (ev) => {
              ev.target.disabled = true;
              try {
                await ctx.actions.withdrawEvent(evt.id);
              } catch (err) {
                ev.target.disabled = false;
                status.appendChild(el('span', { cls: 'warn-text', text: err.message }));
              }
            },
          },
        }),
      ])
    );
  }

  el_.appendChild(status);
}
