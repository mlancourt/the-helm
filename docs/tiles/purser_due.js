/**
 * purser_due — cards coming due.
 *
 * Rule 6: money never moves from here. There is no pay button, no invoice, no
 * link out to a card portal. This tile reports and nothing more.
 *
 * `amount_display` is the vault's call about whether a figure is safe to show
 * on a phone screen in public. When it is false the amount is withheld
 * entirely — not blurred, not truncated, not rendered as zero.
 */

import { el, empty, pill } from '../lib/dom.js';
import { usd, prettyDate, daysBetween, ctToday } from '../lib/fmt.js';

function dueChip(due, today) {
  const days = daysBetween(today, due);
  if (days === null) return pill(String(due ?? '—'), 'neutral');
  if (days < 0) return pill(`${Math.abs(days)}d overdue`, 'bad');
  if (days === 0) return pill('due today', 'bad');
  if (days === 1) return pill('due tomorrow', 'warn');
  if (days <= 5) return pill(`${days}d`, 'warn');
  return pill(`${days}d`, 'neutral');
}

function itemRow(item, today) {
  const flags = [];
  if (item.autopay) flags.push('autopay');
  if (item.reminder_armed) flags.push('reminder armed');

  return el('div', { cls: 'purser-row' }, [
    el('div', { cls: 'purser-main' }, [
      el('div', { cls: 'purser-card', text: item.card || '—' }),
      el('div', { cls: 'purser-meta', text: [prettyDate(item.due), flags.join(' · ')].filter(Boolean).join('  ·  ') }),
    ]),
    el('div', { cls: 'purser-side' }, [
      dueChip(item.due, today),
      el('div', {
        cls: 'purser-amount',
        text: item.amount_display ? usd(item.amount) : '•••',
      }),
    ]),
  ]);
}

export function render(el_, tile) {
  const items = Array.isArray(tile.data?.items) ? tile.data.items : [];
  if (!items.length) {
    el_.appendChild(empty('Nothing due.'));
    return;
  }
  const today = ctToday();
  // Soonest first. Sorting date-only strings lexically is correct for
  // zero-padded ISO dates and needs no parsing at all.
  const sorted = [...items].sort((a, b) => String(a.due ?? '').localeCompare(String(b.due ?? '')));
  el_.appendChild(el('div', { cls: 'purser' }, sorted.map((i) => itemRow(i, today))));
  el_.appendChild(el('p', { cls: 'tile-foot', text: 'Display only. Nothing here moves money.' }));
}
