/**
 * ask — the chat panel. A bottom sheet on the phone, a docked panel on desktop.
 *
 * Rendered ONCE by app.js, because the transcript lives in this closure and a
 * re-render on every data refresh would wipe it. `ctx.actions` are stable
 * closures over app state, so they stay correct across refreshes. History is in memory only: never localStorage, never the snapshot,
 * never an event. Closing the sheet keeps it; reloading the page drops it.
 *
 * Rule 10: every answer lands via textContent. A model reply is untrusted data
 * exactly like a snapshot string.
 *
 * Every /api/ask failure is a reason string from the Worker, not a stack
 * trace: the chat says what went wrong in Matt's words and keeps the
 * transcript (rule 8).
 */

import { el, clear, pill } from '../lib/dom.js';

const MAX_TURNS = 10;

/**
 * Worker reason -> what the chat says, and what the mode chip reads.
 * An unmapped reason falls through to the Worker's own message, which is
 * already short and human.
 */
const FAILURES = {
  cap: ['The day\u2019s ask budget is spent. It resets at 00:00 UTC.', 'cap'],
  timeout: ['The model did not answer in time. Worth another go.', 'slow'],
  upstream: ['The model API is not answering right now.', 'offline'],
  no_key: ['Ask is not configured on the Worker yet (no model key).', 'unset'],
  no_system: ['Ask has no system prompt installed yet.', 'unset'],
  too_large: ['That question carried too much with it.', 'snapshot'],
  unauthorized: ['The Worker did not recognise this token.', 'offline'],
};

/** The build-request affordance from the brief. */
const BUILD_RE = /^\s*(add a tile\b|build\b|i want a tile\b)/i;

export function render(root, tile, ctx) {
  /** @type {{role:'user'|'assistant', content:string}[]} */
  const history = [];
  let pinned = null; // {tile_id, data}
  let busy = false;

  // ---------------------------------------------------------------- layout
  const transcript = el('div', { cls: 'ask-transcript' });
  const modeChip = pill('snapshot', 'mode');
  const pinBar = el('div', { cls: 'ask-pin hidden' });

  const input = el('textarea', {
    cls: 'ask-input',
    attrs: { rows: '1', placeholder: 'Ask about the board…', 'aria-label': 'Ask a question' },
  });

  const sendBtn = el('button', {
    cls: 'btn btn-send',
    text: 'Ask',
    attrs: { type: 'button' },
    on: { click: () => submit() },
  });

  const offer = el('div', { cls: 'ask-offer hidden' });

  // -------------------------------------------------------------- helpers
  function bubble(role, text, cls = '') {
    return el('div', { cls: `bubble bubble-${role} ${cls}`.trim() }, [
      el('div', { cls: 'bubble-text', text }),
    ]);
  }

  function scrollDown() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function paint() {
    clear(transcript);
    if (!history.length) {
      // One line, deliberately: the empty state IS the sheet's height before
      // the first question, and a two-line hint opens a sheet twice as tall as
      // it needs to be.
      transcript.appendChild(
        el('p', { cls: 'empty ask-hint', text: 'Ask about the board, or long-press a tile.' })
      );
    }
    for (const m of history) transcript.appendChild(bubble(m.role, m.content));
    scrollDown();
  }

  function setPinned(next) {
    pinned = next;
    clear(pinBar);
    if (!next) {
      pinBar.classList.add('hidden');
      return;
    }
    pinBar.classList.remove('hidden');
    pinBar.appendChild(el('span', { cls: 'ask-pin-label', text: `pinned: ${next.tile_id}` }));
    pinBar.appendChild(
      el('button', {
        cls: 'link-btn',
        text: 'unpin',
        attrs: { type: 'button' },
        on: { click: () => setPinned(null) },
      })
    );
  }

  function clearOffer() {
    clear(offer);
    offer.classList.add('hidden');
  }

  /**
   * A message that reads like a build request gets filed as one instead of
   * burning an /ask call on it — but it stays Matt's choice, so "Ask anyway"
   * is right there.
   */
  function offerBuildRequest(text) {
    clear(offer);
    offer.classList.remove('hidden');
    offer.appendChild(el('span', { cls: 'ask-offer-text', text: 'That reads like a build request.' }));
    offer.appendChild(
      el('button', {
        cls: 'btn btn-small',
        text: 'File as build request',
        attrs: { type: 'button' },
        on: {
          click: async () => {
            clearOffer();
            history.push({ role: 'user', content: text });
            paint();
            try {
              await ctx.actions.submitEvent({ type: 'build_request', payload: { text } });
              history.push({
                role: 'assistant',
                content: 'Filed as a build request. It stays pending until the engine picks it up.',
              });
            } catch (e) {
              history.push({ role: 'assistant', content: `Could not file that: ${e.message}` });
            }
            input.value = '';
            paint();
          },
        },
      })
    );
    offer.appendChild(
      el('button', {
        cls: 'btn btn-small btn-ghost',
        text: 'Ask anyway',
        attrs: { type: 'button' },
        on: {
          click: () => {
            clearOffer();
            submit({ force: true });
          },
        },
      })
    );
  }

  async function submit({ force = false } = {}) {
    if (busy) return;
    const q = input.value.trim();
    if (!q) return;

    if (!force && BUILD_RE.test(q)) {
      offerBuildRequest(q);
      return;
    }
    clearOffer();

    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    history.push({ role: 'user', content: q });
    paint();

    const thinking = bubble('assistant', 'thinking…', 'bubble-wait');
    transcript.appendChild(thinking);
    scrollDown();

    try {
      // Last MAX_TURNS entries, excluding the question we are about to send.
      const priorTurns = history.slice(0, -1).slice(-MAX_TURNS);
      const res = await ctx.actions.ask({
        q,
        history: priorTurns,
        tile_id: pinned?.tile_id,
        tile_data: pinned?.data,
      });
      transcript.removeChild(thinking);
      history.push({ role: 'assistant', content: String(res.answer ?? '') });
      if (res.mode) modeChip.textContent = String(res.mode);
      // The cap is real money on a card, so the cost of the last answer is
      // one long-press away rather than buried in the Worker log.
      if (typeof res.usd === 'number') modeChip.title = `last answer cost $${res.usd.toFixed(4)}`;
    } catch (e) {
      transcript.removeChild(thinking);
      // Rule 8: /ask down means the chat says so, plainly.
      // hasOwnProperty, not a bare lookup: a reason of "constructor" would
      // otherwise hand back an Object method and throw inside the catch.
      const [text, chip] = Object.prototype.hasOwnProperty.call(FAILURES, e.reason) ? FAILURES[e.reason] : [];
      history.push({ role: 'assistant', content: text || e.message || 'Ask is unavailable right now.' });
      modeChip.textContent = chip || 'offline';
      modeChip.title = e.reason ? `/ask failed: ${e.reason}` : '/ask failed';
    } finally {
      busy = false;
      sendBtn.disabled = false;
      // Trim the in-memory transcript so it cannot grow without bound.
      while (history.length > MAX_TURNS * 2) history.shift();
      paint();
    }
  }

  input.addEventListener('keydown', (e) => {
    // Enter sends; Shift+Enter is a newline. On a phone the on-screen keyboard
    // sends a plain Enter, which is the behaviour we want.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  // --------------------------------------------------------------- assemble
  root.appendChild(
    el('div', { cls: 'ask-head' }, [
      el('span', { cls: 'ask-title', text: 'Ask' }),
      modeChip,
      el('button', {
        cls: 'link-btn ask-clear',
        text: 'clear',
        attrs: { type: 'button' },
        on: {
          click: () => {
            history.length = 0;
            setPinned(null);
            clearOffer();
            modeChip.textContent = 'snapshot';
            modeChip.title = '';
            paint();
          },
        },
      }),
    ])
  );
  root.appendChild(pinBar);
  root.appendChild(transcript);
  root.appendChild(offer);
  root.appendChild(el('div', { cls: 'ask-compose' }, [input, sendBtn]));

  paint();

  // The controller app.js drives when a tile asks to be explained.
  return {
    pin(tile_id, data) {
      setPinned({ tile_id, data });
      input.value = `Explain this tile.`;
      input.focus();
    },
    focus() {
      input.focus();
    },
  };
}
