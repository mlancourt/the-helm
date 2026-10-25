/**
 * yeoman — Wren's face (vault spec `Wren-Tile-Spec.md` v1.0, WT1–WT12), with
 * the Yeoman's drafter inside it as her hand (`Yeoman-Tile-Spec.md`, Y1–Y19).
 *
 * WT1 — the id stays `yeoman`; the label is hers. The card shows her brief's
 * opening, up to three "Worth your attention" lines, `more ▸`, and a badge that
 * counts her OPEN QUESTIONS and nothing else (W1: never a count of what is
 * waiting in the inbox). The sheet is four faces: Brief · Questions · Talk ·
 * Draft. Draft is the Yeoman's sheet, moved under a tab and otherwise
 * untouched.
 *
 * WT3 — the brief and the questions ride the snapshot (`tiles.yeoman.data`,
 * written by the engine's `wren()` producer). Names appear: H9 is waived for
 * this tile. `brief: null` is a quiet morning, not an error.
 *
 * WT4/WT10 — the page writes nothing but proposals. An answer is a
 * `wren_answer` event and a note is a `wren_note` event, both pending (rule 5)
 * with the undo valve until the engine lands them in her State/. Talk asks the
 * brain as `persona: "wren"` — read-only by construction — and falls back to
 * the Worker's snapshot `/api/ask` pinned to this tile (WT9).
 *
 * Bold in her lines (`**…**`) is built from split text: a <strong> node for
 * each closed pair, plain text nodes for the rest. Every string lands via
 * textContent (rule 10). Rule 7: dates are printed as given; there is no clock
 * in this module at all.
 *
 * Y7 — never invent a fact. The model writes `[PRICE]`, `[DAY/TIME]`,
 * `[PART #]` where the inputs withheld one, and this module prints the draft
 * and the Worker's `blanks` EXACTLY as delivered. It contains no string
 * substitution of any kind, so it cannot fill in what the input withheld.
 *
 * Y11 — `sms:` and `mailto:` are admitted on exactly two anchors, built by
 * `handoffHref()` alone, from the draft (and subject) through
 * encodeURIComponent. No other scheme, no new-window attribute, and
 * `safeUrl()` is not widened: these hrefs are composed here from the model's
 * words, never read from a snapshot.
 *
 * Y13 — the pasted message, the intent, the draft, the read and the history
 * live in this sheet's closure and die with it; so does Talk's transcript. The
 * ONE thing written to localStorage is the Yeoman's recents list (name · role
 * · context, last 12), which Matt types himself.
 */

import { el, clear, pill } from '../lib/dom.js';
import { FAILURES } from './ask.js';

const RECENTS_KEY = 'helm.yeoman.recents';
const MAX_RECENTS = 12;
/** "keep the last 3 drafts, one tap back" */
const KEEP_DRAFTS = 3;

/** Y6 — the Voice Book's registers. Value on the wire, label on the page. */
const ROLES = [
  ['customer', 'Customer'],
  ['prospect', 'Prospect'],
  ['vendor', 'Vendor'],
  ['crew', 'Crew'],
  ['family', 'Family'],
  ['friend', 'Friend'],
  ['other', 'Other'],
];
const ROLE_LABEL = Object.fromEntries(ROLES);

/** Y4 — variation comes from these, never from a menu of drafts. */
const NUDGES = ['shorter', 'warmer', 'firmer', 'more casual', 're-roll'];

const COPY = {
  drafting: 'drafting…',
  cap: 'daily cap reached — resets midnight UTC',
  out: 'the Yeoman’s out — try again',
  offline: 'needs a connection',
  noVoice: 'the Yeoman has no voice book loaded yet',
  needRole: 'who are they? pick a role first',
  needInput: 'paste a message or say what you want to happen',
  needIntent: 'say what you want to happen',
};

// ------------------------------------------------------------------ wren

const TALK_TURNS = 10;
const WREN_TEXT_MAX = 2000;

/** The brief's sections, in the order she writes them (SKILL §1), headed as the spec names them. */
const SECTIONS = [
  ['attention', 'Worth your attention'],
  ['people', 'People'],
  ['record', 'For the record'],
  ['question_lines', 'A question for you'],
];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lines = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
const stop = (e) => {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
};

function wrenData(tile) {
  const data = tile && isObj(tile.data) ? tile.data : null;
  const brief = data && isObj(data.brief) ? data.brief : null;
  const questions = data && Array.isArray(data.questions)
    ? data.questions.filter((q) => isObj(q) && typeof q.qid === 'string' && typeof q.text === 'string' && q.text.trim())
    : [];
  return { data, brief, questions };
}

/**
 * One line of hers, with `**…**` as <strong>. Split on the marker — even
 * pieces are plain, odd pieces are bold — and an unclosed marker stays as the
 * two asterisks it is.
 */
export function rich(tag, cls, text) {
  const node = el(tag, { cls });
  const parts = String(text).split('**');
  parts.forEach((seg, i) => {
    if (!seg) return;
    const odd = i % 2 === 1;
    if (odd && i < parts.length - 1) node.appendChild(el('strong', { text: seg }));
    else node.appendChild(document.createTextNode(odd ? `**${seg}` : seg));
  });
  return node;
}

/** Shell seam: `?tile=yeoman` opens this sheet on load (WT5). */
export function openSheet(tile, ctx, tab = 'brief') {
  const title = (ctx && ctx.title) || 'Wren';
  ctx.actions.openPanel(title, (body) => buildWren(body, tile, ctx, tab));
}

export function render(root, tile, ctx) {
  const { brief, questions } = wrenData(tile);
  const open = (tab) => (e) => {
    stop(e);
    openSheet(tile, ctx, tab);
  };

  if (questions.length) {
    root.appendChild(
      el('button', {
        cls: 'pill wren-badge',
        text: `${questions.length} question${questions.length === 1 ? '' : 's'}`,
        attrs: { type: 'button', 'aria-label': `${questions.length} open question${questions.length === 1 ? '' : 's'} from Wren` },
        on: { click: open('questions') },
      })
    );
  }

  if (brief) {
    const wrap = el('div', { cls: `wren-face${brief.stale ? ' wren-stale' : ''}` });
    if (brief.stale) wrap.appendChild(el('p', { cls: 'wren-stale-line', text: `brief from ${String(brief.date || 'an earlier day')} — not this morning’s` }));
    if (typeof brief.opening === 'string' && brief.opening.trim()) wrap.appendChild(rich('p', 'wren-opening', brief.opening));
    const attn = lines(brief.attention).slice(0, 3);
    if (attn.length) wrap.appendChild(el('ul', { cls: 'wren-attn' }, attn.map((t) => rich('li', 'wren-line', t))));
    wrap.appendChild(el('button', { cls: 'link-btn wren-more', text: 'more ▸', attrs: { type: 'button' }, on: { click: open('brief') } }));
    root.appendChild(wrap);
  } else {
    root.appendChild(el('p', { cls: 'yeo-line', text: 'No brief this morning.' }));
  }

  root.appendChild(
    el('div', { cls: 'yeo-face' }, [
      el('button', { cls: 'btn yeo-face-btn', text: 'Talk', attrs: { type: 'button' }, on: { click: open('talk') } }),
      el('button', { cls: 'btn yeo-face-btn', text: 'Draft', attrs: { type: 'button' }, on: { click: open('draft') } }),
    ])
  );
}

const TABS = [
  ['brief', 'Brief'],
  ['questions', 'Questions'],
  ['talk', 'Talk'],
  ['draft', 'Draft'],
];

function buildWren(body, tile, ctx, startTab) {
  const { data, brief, questions } = wrenData(tile);
  const builders = {
    brief: (pane) => briefPane(pane, brief),
    questions: (pane) => questionsPane(pane, questions, ctx),
    talk: (pane) => talkPane(pane, data, ctx),
    draft: (pane) => buildSheet(pane, 'reply', ctx),
  };
  const bar = el('div', { cls: 'wren-tabs', attrs: { role: 'tablist', 'aria-label': 'Wren' } });
  const panes = {};
  const built = new Set();
  const buttons = TABS.map(([key, label]) =>
    el('button', {
      cls: 'wren-tab',
      text: label,
      attrs: { type: 'button', role: 'tab', 'data-tab': key },
      on: { click: () => show(key) },
    })
  );
  for (const b of buttons) bar.appendChild(b);
  body.appendChild(bar);
  for (const [key] of TABS) {
    panes[key] = el('div', { cls: `wren-pane wren-pane-${key} hidden`, attrs: { role: 'tabpanel' } });
    body.appendChild(panes[key]);
  }

  // Each face is built the first time it is shown, so the Draft form's focus
  // never steals the keyboard from a Brief open.
  function show(key) {
    for (const b of buttons) b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === key));
    for (const [k] of TABS) panes[k].classList.toggle('hidden', k !== key);
    if (!built.has(key)) {
      built.add(key);
      builders[key](panes[key]);
    }
  }
  show(builders[startTab] ? startTab : 'brief');
}

function briefPane(pane, brief) {
  if (!brief) {
    pane.appendChild(el('p', { cls: 'empty', text: 'No brief this morning.' }));
    return;
  }
  const wrap = el('div', { cls: `wren-brief${brief.stale ? ' wren-stale' : ''}` });
  if (brief.stale) wrap.appendChild(el('p', { cls: 'wren-stale-line', text: `brief from ${String(brief.date || 'an earlier day')} — not this morning’s` }));
  if (typeof brief.title === 'string' && brief.title) wrap.appendChild(el('h3', { cls: 'wren-title', text: brief.title }));
  if (typeof brief.opening === 'string' && brief.opening.trim()) wrap.appendChild(rich('p', 'wren-opening', brief.opening));
  const extra = Array.isArray(brief.extra)
    ? brief.extra.filter((x) => isObj(x) && typeof x.title === 'string').map((x) => [x.lines, x.title])
    : [];
  for (const [ls, heading] of [...SECTIONS.map(([key, h]) => [brief[key], h]), ...extra]) {
    const items = lines(ls);
    if (!items.length) continue;
    wrap.appendChild(el('h4', { cls: 'wren-head', text: heading }));
    wrap.appendChild(el('ul', { cls: 'wren-list' }, items.map((t) => rich('li', 'wren-line', t))));
  }
  if (typeof brief.path === 'string' && brief.path) wrap.appendChild(el('p', { cls: 'wren-source', text: brief.path }));
  pane.appendChild(wrap);
}

/** What the shell said is still pending, as {qid -> event}. */
function pendingAnswers(ctx) {
  const out = new Map();
  for (const ev of Array.isArray(ctx && ctx.pending) ? ctx.pending : []) {
    if (ev && ev.type === 'wren_answer' && isObj(ev.payload) && typeof ev.payload.qid === 'string') out.set(ev.payload.qid, ev);
  }
  return out;
}

function questionsPane(pane, questions, ctx) {
  const pending = pendingAnswers(ctx);
  const list = el('div', { cls: 'wren-qs' });
  pane.appendChild(list);

  function paint() {
    clear(list);
    if (!questions.length) {
      list.appendChild(el('p', { cls: 'empty', text: 'No open questions.' }));
      return;
    }
    for (const q of questions) list.appendChild(row(q));
  }

  function row(q) {
    const box = el('div', { cls: 'wren-q' });
    if (typeof q.date === 'string' && q.date) box.appendChild(el('span', { cls: 'wren-q-date', text: q.date }));
    box.appendChild(el('p', { cls: 'wren-q-text', text: q.text }));
    const ev = pending.get(q.qid);
    if (ev) {
      box.appendChild(
        el('div', { cls: 'wren-pending' }, [
          pill('pending', 'pending'),
          el('span', { cls: 'wren-said', text: String(ev.payload.answer || '') }),
          undoButton(ev, () => {
            pending.delete(q.qid);
            paint();
          }),
        ])
      );
      return box;
    }
    const answer = el('textarea', {
      cls: 'yeo-paste wren-answer hidden',
      attrs: { rows: '3', maxlength: String(WREN_TEXT_MAX), placeholder: 'Your answer', 'aria-label': 'Your answer' },
    });
    const say = el('p', { cls: 'yeo-status hidden', attrs: { role: 'status' } });
    const send = el('button', {
      cls: 'btn btn-send wren-send hidden',
      text: 'Send',
      attrs: { type: 'button' },
      on: {
        click: async () => {
          const text = val(answer).trim();
          if (!text) return;
          if (text.length > WREN_TEXT_MAX) {
            status(say, `that is over ${WREN_TEXT_MAX} characters`, true);
            return;
          }
          send.disabled = true;
          try {
            const stored = await ctx.actions.submitEvent(
              { type: 'wren_answer', payload: { qid: q.qid, question: q.text, answer: text } },
              { quiet: true }
            );
            pending.set(q.qid, stored && isObj(stored.payload) ? stored : { id: stored && stored.id, payload: { answer: text } });
            paint();
          } catch (e) {
            send.disabled = false;
            status(say, `couldn’t send that — ${String((e && e.message) || 'try again')}`, true);
          }
        },
      },
    });
    const tapTo = el('button', {
      cls: 'link-btn wren-tap',
      text: 'Answer',
      attrs: { type: 'button' },
      on: {
        click: () => {
          answer.classList.remove('hidden');
          send.classList.remove('hidden');
          tapTo.classList.add('hidden');
          if (typeof answer.focus === 'function') answer.focus();
        },
      },
    });
    box.appendChild(tapTo);
    box.appendChild(answer);
    box.appendChild(send);
    box.appendChild(say);
    return box;
  }

  function undoButton(ev, done) {
    const b = el('button', {
      cls: 'link-btn wren-undo',
      text: 'undo',
      attrs: { type: 'button' },
      on: {
        click: async () => {
          b.disabled = true;
          try {
            if (ev.id) await ctx.actions.withdrawEvent(ev.id, { quiet: true });
            done();
          } catch {
            b.disabled = false;
            b.textContent = 'undo failed — it may have landed';
          }
        },
      },
    });
    return b;
  }

  paint();
}

function status(node, text, bad = false) {
  node.textContent = text || '';
  node.classList.toggle('hidden', !text);
  node.classList.toggle('yeo-status-bad', !!text && bad);
}

function talkPane(pane, data, ctx) {
  /** @type {{role:'user'|'assistant', content:string}[]} */
  const history = [];
  let busy = false;
  let note = null; // the wren_note filed from this conversation, while it is pending

  const chip = pill('vault', 'mode');
  let loginUrl = null;
  const signInBtn = el('button', {
    cls: 'pill pill-mode ask-signin hidden',
    text: 'sign in',
    attrs: { type: 'button', title: 'Open the brain’s sign-in in a new tab' },
    on: { click: () => loginUrl && window.open(loginUrl, '_blank') },
  });
  function setChip(text, title = '') {
    chip.textContent = text;
    chip.title = title;
    const signin = text === 'sign in' && !!loginUrl;
    chip.classList.toggle('hidden', signin);
    signInBtn.classList.toggle('hidden', !signin);
  }

  const transcript = el('div', { cls: 'ask-transcript wren-transcript' });
  const noteRow = el('div', { cls: 'wren-note hidden' });
  const input = el('textarea', {
    cls: 'ask-input',
    attrs: { rows: '1', maxlength: String(WREN_TEXT_MAX), placeholder: 'Talk to Wren…', 'aria-label': 'Talk to Wren' },
  });
  const sendBtn = el('button', { cls: 'btn btn-send', text: 'Send', attrs: { type: 'button' }, on: { click: () => submit() } });

  pane.appendChild(el('div', { cls: 'ask-head' }, [el('span', { cls: 'ask-title', text: 'Wren' }), chip, signInBtn]));
  pane.appendChild(transcript);
  pane.appendChild(noteRow);
  pane.appendChild(el('div', { cls: 'ask-compose' }, [input, sendBtn]));

  const lastMine = () => {
    for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') return history[i].content;
    return null;
  };

  function paint() {
    clear(transcript);
    if (!history.length) transcript.appendChild(el('p', { cls: 'empty ask-hint', text: 'Ask her about the brief, a person, or how to handle something.' }));
    for (const m of history) {
      transcript.appendChild(el('div', { cls: `bubble bubble-${m.role}` }, [el('div', { cls: 'bubble-text', text: m.content })]));
    }
    transcript.scrollTop = transcript.scrollHeight;
    paintNote();
  }

  /** WT10 — "Send as note" files MATT's last message, never hers. */
  function paintNote() {
    clear(noteRow);
    const mine = lastMine();
    noteRow.classList.toggle('hidden', !mine && !note);
    if (note) {
      noteRow.appendChild(pill('pending', 'pending'));
      noteRow.appendChild(el('span', { cls: 'wren-said', text: note.text }));
      const undo = el('button', {
        cls: 'link-btn wren-undo',
        text: 'undo',
        attrs: { type: 'button' },
        on: {
          click: async () => {
            undo.disabled = true;
            try {
              if (note.id) await ctx.actions.withdrawEvent(note.id, { quiet: true });
              note = null;
              paintNote();
            } catch {
              undo.disabled = false;
              undo.textContent = 'undo failed — it may have landed';
            }
          },
        },
      });
      noteRow.appendChild(undo);
      return;
    }
    if (!mine) return;
    const say = el('span', { cls: 'yeo-status hidden', attrs: { role: 'status' } });
    const btn = el('button', {
      cls: 'btn btn-small wren-note-btn',
      text: 'Send as note',
      attrs: { type: 'button', title: 'File your last message to her State/ as a note' },
      on: {
        click: async () => {
          const text = lastMine();
          if (!text) return;
          btn.disabled = true;
          try {
            const stored = await ctx.actions.submitEvent({ type: 'wren_note', payload: { text } }, { quiet: true });
            note = { id: stored && stored.id, text };
            paintNote();
          } catch (e) {
            btn.disabled = false;
            status(say, `couldn’t send that — ${String((e && e.message) || 'try again')}`, true);
          }
        },
      },
    });
    noteRow.appendChild(btn);
    noteRow.appendChild(say);
  }

  async function submit() {
    if (busy) return;
    const q = val(input).trim();
    if (!q) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    const prior = history.slice(-TALK_TURNS).map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: q });
    note = null;
    paint();
    const thinking = el('div', { cls: 'bubble bubble-assistant bubble-wait' }, [el('div', { cls: 'bubble-text', text: 'thinking…' })]);
    transcript.appendChild(thinking);
    // WT9: one payload. The brain answers as her (persona) and ignores the
    // pin; the Worker has no persona and answers from the snapshot, pinned to
    // this tile — which carries her brief.
    const payload = { q, history: prior, persona: 'wren', tile_id: 'yeoman' };
    payload.tile_data = data;
    try {
      const res = await ctx.actions.ask(payload);
      transcript.removeChild(thinking);
      history.push({ role: 'assistant', content: String((res && res.answer) ?? '') });
      setChip(res && res.mode ? String(res.mode) : chip.textContent, res && typeof res.usd === 'number' ? `last answer cost $${res.usd.toFixed(4)}` : '');
    } catch (e) {
      transcript.removeChild(thinking);
      const known = e && Object.prototype.hasOwnProperty.call(FAILURES, e.reason) ? FAILURES[e.reason] : [];
      history.push({ role: 'assistant', content: known[0] || (e && e.message) || 'She can’t be reached right now.' });
      if (e && e.reason === 'signin' && typeof e.login === 'string') loginUrl = e.login;
      setChip(known[1] || 'off', e && e.reason ? `/ask failed: ${e.reason}` : '/ask failed');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      while (history.length > TALK_TURNS) history.shift();
      paint();
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  paint();
  if (typeof input.focus === 'function') input.focus();
}

// --------------------------------------------------------------- helpers

/**
 * Y11 — the ONE builder for the two hand-off anchors. Bare `sms:` with no
 * number (Matt picks the thread); `mailto:` with no address.
 */
function handoffHref(kind, draft, subject) {
  if (kind === 'sms') return `sms:?&body=${encodeURIComponent(draft)}`;
  const subj = subject ? `subject=${encodeURIComponent(subject)}&` : '';
  return `mailto:?${subj}body=${encodeURIComponent(draft)}`;
}

function nav() {
  return typeof navigator !== 'undefined' ? navigator : null;
}

function isOffline() {
  const n = nav();
  return !!n && n.onLine === false;
}

/** Worker failure -> the sheet's one line. */
function failureText(e) {
  const status = e && e.status;
  if (status === 429) return COPY.cap;
  if (status === 503 && e.reason === 'no_system') return COPY.noVoice;
  if (status === 400) return `couldn’t draft that — ${String(e.message || 'bad request')}`;
  // No status at all means the request never reached the Worker.
  if (!status) return isOffline() ? COPY.offline : COPY.out;
  return COPY.out;
}

function readRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((r) => r && typeof r.name === 'string' && r.name.trim() && ROLE_LABEL[r.role])
      .slice(0, MAX_RECENTS)
      .map((r) => ({ name: r.name, role: r.role, context: typeof r.context === 'string' ? r.context : '' }));
  } catch {
    return []; // private mode, blocked storage, or no storage at all
  }
}

/** Newest first, one per name+role, twelve at most. Name, role, context only. */
function saveRecent(entry) {
  const key = (r) => `${r.name.trim().toLowerCase()}|${r.role}`;
  const next = [entry, ...readRecents().filter((r) => key(r) !== key(entry))].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* recents are a convenience; the draft does not need them */
  }
  return next;
}

function val(node) {
  return typeof node.value === 'string' ? node.value : '';
}

// ----------------------------------------------------------------- sheet

function buildSheet(body, startMode, ctx) {
  let mode = startMode === 'compose' ? 'compose' : 'reply';
  let channel = 'text';
  /** [{result, nudge}] — the thread, at most KEEP_DRAFTS long. */
  let drafts = [];
  let at = -1;
  let busy = false;

  const sheet = el('div', { cls: 'yeo-sheet' });
  body.appendChild(sheet);

  // -- segmented controls ------------------------------------------------
  function segmented(label, options, get, set) {
    const wrap = el('div', { cls: 'yeo-seg', attrs: { role: 'group', 'aria-label': label } });
    const buttons = options.map(([value, text]) =>
      el('button', {
        cls: 'yeo-seg-btn',
        text,
        attrs: { type: 'button', 'data-value': value },
        on: { click: () => { set(value); paint(); } },
      })
    );
    const paint = () => {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === get()));
    };
    for (const b of buttons) wrap.appendChild(b);
    paint();
    return wrap;
  }

  const modeSeg = segmented('Reply or new message', [['reply', 'Reply'], ['compose', 'New']], () => mode, (v) => {
    mode = v;
    syncMode();
  });
  const channelSeg = segmented('Channel', [['text', 'Text'], ['email', 'Email']], () => channel, (v) => {
    channel = v;
    if (drafts.length) showResult();
  });
  sheet.appendChild(el('div', { cls: 'yeo-segs' }, [modeSeg, channelSeg]));

  // -- To ----------------------------------------------------------------
  const nameIn = el('input', {
    cls: 'yeo-input yeo-name',
    attrs: { type: 'text', placeholder: 'Name', 'aria-label': 'Their name', autocomplete: 'off' },
  });
  const roleSel = el('select', { cls: 'yeo-select yeo-role', attrs: { 'aria-label': 'Who they are to you' } }, [
    el('option', { text: 'Who are they?', attrs: { value: '' } }),
    ...ROLES.map(([value, text]) => el('option', { text, attrs: { value } })),
  ]);
  roleSel.value = '';
  const contextIn = el('input', {
    cls: 'yeo-input yeo-context',
    attrs: { type: 'text', placeholder: 'Context — e.g. waiting on a part two weeks', 'aria-label': 'Context', autocomplete: 'off' },
  });
  sheet.appendChild(el('div', { cls: 'yeo-label', text: 'To' }));
  sheet.appendChild(el('div', { cls: 'yeo-to' }, [nameIn, roleSel, contextIn]));

  const recentsRow = el('div', { cls: 'yeo-recents' });
  sheet.appendChild(recentsRow);
  function paintRecents(list) {
    clear(recentsRow);
    recentsRow.classList.toggle('hidden', !list.length);
    for (const r of list) {
      recentsRow.appendChild(
        el('button', {
          cls: 'yeo-chip yeo-recent',
          text: `${r.name} · ${ROLE_LABEL[r.role]}`,
          attrs: { type: 'button', title: r.context || null },
          on: {
            click: () => {
              nameIn.value = r.name;
              roleSel.value = r.role;
              contextIn.value = r.context || '';
            },
          },
        })
      );
    }
  }
  paintRecents(readRecents());

  // -- paste (Reply only) ------------------------------------------------
  const paste = el('textarea', {
    cls: 'yeo-paste',
    attrs: { rows: '4', placeholder: 'Paste their message', 'aria-label': 'Their message' },
  });
  const pasteBtn = el('button', {
    cls: 'btn btn-small yeo-paste-btn',
    text: 'Paste',
    attrs: { type: 'button' },
    on: {
      // readText() must be called inside the tap itself (Y12) — iOS shows its
      // own paste prompt, which is fine.
      click: () => {
        const clip = nav() && nav().clipboard;
        if (!clip || typeof clip.readText !== 'function') {
          say('paste blocked — long-press the box to paste');
          return;
        }
        clip.readText().then(
          (t) => {
            if (t) paste.value = t;
          },
          () => say('paste blocked — long-press the box to paste')
        );
      },
    },
  });
  const pasteBlock = el('div', { cls: 'yeo-paste-block' }, [
    el('div', { cls: 'yeo-paste-head' }, [el('span', { cls: 'yeo-label', text: 'Their message' }), pasteBtn]),
    paste,
  ]);
  sheet.appendChild(pasteBlock);

  // -- intent ------------------------------------------------------------
  const intentIn = el('input', {
    cls: 'yeo-input yeo-intent',
    attrs: { type: 'text', placeholder: 'e.g. yes but push to Thursday', 'aria-label': 'What do you want to happen?', autocomplete: 'off' },
  });
  sheet.appendChild(el('label', { cls: 'yeo-label', text: 'What do you want to happen?' }));
  sheet.appendChild(intentIn);

  const draftBtn = el('button', {
    cls: 'btn btn-send yeo-draft-btn',
    text: 'Draft',
    attrs: { type: 'button' },
    on: { click: () => run(null) },
  });
  sheet.appendChild(draftBtn);

  const status = el('p', { cls: 'yeo-status hidden', attrs: { role: 'status' } });
  sheet.appendChild(status);
  const result = el('div', { cls: 'yeo-result hidden' });
  sheet.appendChild(result);

  function say(text, bad = false) {
    status.textContent = text || '';
    status.classList.toggle('hidden', !text);
    status.classList.toggle('yeo-status-bad', !!text && bad);
  }

  function syncMode() {
    pasteBlock.classList.toggle('hidden', mode !== 'reply');
  }
  syncMode();

  // -- the request -------------------------------------------------------
  function requestBody(nudge) {
    const role = val(roleSel);
    const name = val(nameIn).trim();
    const context = val(contextIn).trim();
    const intent = val(intentIn).trim();
    const incoming = mode === 'reply' ? val(paste) : '';

    if (!role) return { problem: COPY.needRole };
    if (!intent && !incoming.trim()) return { problem: mode === 'reply' ? COPY.needInput : COPY.needIntent };

    const to = { name, role };
    if (context) to.context = context;
    const req = { mode, channel, to };
    if (incoming.trim()) req.incoming = incoming;
    if (intent) req.intent = intent;
    if (nudge) {
      req.nudge = nudge;
      req.history = historyThrough(at);
    }
    return { req };
  }

  /** The thread up to draft `k`: each draft as an assistant turn, joined by the nudge that made the next. */
  function historyThrough(k) {
    const turns = [];
    for (let i = 0; i <= k && i < drafts.length; i++) {
      if (i > 0) turns.push({ role: 'user', content: `NUDGE: ${drafts[i].nudge}` });
      turns.push({ role: 'assistant', content: drafts[i].result.draft });
    }
    return turns;
  }

  function setBusy(on) {
    busy = on;
    draftBtn.disabled = on;
    for (const b of result.querySelectorAll('.yeo-nudge')) b.disabled = on;
  }

  async function run(nudge) {
    if (busy) return;
    const { req, problem } = requestBody(nudge);
    if (problem) {
      say(problem, true);
      return;
    }
    if (isOffline()) {
      say(COPY.offline, true);
      return;
    }
    if (req.to.name) paintRecents(saveRecent({ name: req.to.name, role: req.to.role, context: req.to.context || '' }));

    setBusy(true);
    say(COPY.drafting);
    try {
      const r = await ctx.actions.draft(req);
      const entry = { result: normalize(r), nudge };
      // A nudge from an earlier draft branches from there; a fresh Draft
      // starts a new thread.
      drafts = nudge ? [...drafts.slice(0, at + 1), entry] : [entry];
      drafts = drafts.slice(-KEEP_DRAFTS);
      at = drafts.length - 1;
      say('');
      showResult();
      // The form fills the phone; bring the draft up to where the thumb is.
      if (typeof result.scrollIntoView === 'function') result.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) {
      say(failureText(e), true);
    } finally {
      setBusy(false);
    }
  }

  /** The Worker's answer, typed — and otherwise untouched (Y7). */
  function normalize(r) {
    const s = (v) => (typeof v === 'string' && v ? v : null);
    return {
      read: s(r && r.read),
      assumed: s(r && r.assumed),
      subject: s(r && r.subject),
      draft: r && typeof r.draft === 'string' ? r.draft : '',
      blanks: Array.isArray(r && r.blanks) ? r.blanks.filter((b) => typeof b === 'string' && b) : [],
    };
  }

  // -- the result --------------------------------------------------------
  function showResult() {
    clear(result);
    const cur = drafts[at];
    if (!cur) {
      result.classList.add('hidden');
      return;
    }
    const r = cur.result;
    result.classList.remove('hidden');

    if (r.read) result.appendChild(el('p', { cls: 'yeo-read', text: r.read }));
    if (r.assumed) result.appendChild(el('p', { cls: 'yeo-assumed', text: r.assumed }));
    const subject = channel === 'email' ? r.subject : null;
    if (subject) result.appendChild(el('p', { cls: 'yeo-subject', text: `Subject: ${subject}` }));

    result.appendChild(el('div', { cls: 'yeo-draft', text: r.draft }));
    if (r.blanks.length) result.appendChild(el('p', { cls: 'yeo-blanks', text: `fill in: ${r.blanks.join(', ')}` }));

    // Nudges, plus one tap back (and forward again) through the last three.
    const nudgeRow = el('div', { cls: 'yeo-nudges' });
    if (drafts.length > 1) {
      nudgeRow.appendChild(
        el('button', {
          cls: 'yeo-chip yeo-back',
          text: '←',
          attrs: { type: 'button', 'aria-label': 'Previous draft', disabled: at === 0 ? '' : null },
          on: { click: () => { if (at > 0) { at--; showResult(); } } },
        })
      );
      nudgeRow.appendChild(el('span', { cls: 'yeo-pos', text: `${at + 1}/${drafts.length}` }));
      nudgeRow.appendChild(
        el('button', {
          cls: 'yeo-chip yeo-fwd',
          text: '→',
          attrs: { type: 'button', 'aria-label': 'Next draft', disabled: at === drafts.length - 1 ? '' : null },
          on: { click: () => { if (at < drafts.length - 1) { at++; showResult(); } } },
        })
      );
    }
    for (const n of NUDGES) {
      nudgeRow.appendChild(
        el('button', { cls: 'yeo-chip yeo-nudge', text: n, attrs: { type: 'button' }, on: { click: () => run(n) } })
      );
    }
    result.appendChild(nudgeRow);

    // Copy + hand-off. Never send (Y11).
    const copyBtn = el('button', {
      cls: 'btn yeo-copy',
      text: 'Copy',
      attrs: { type: 'button' },
      on: { click: () => copy(r.draft, copyBtn) },
    });
    result.appendChild(
      el('div', { cls: 'yeo-hand' }, [
        copyBtn,
        el('a', { cls: 'btn yeo-sms', text: 'Open in Messages', attrs: { href: handoffHref('sms', r.draft) } }),
        el('a', { cls: 'btn yeo-mail', text: 'Open in Mail', attrs: { href: handoffHref('mail', r.draft, subject) } }),
      ])
    );
  }

  function copy(text, btn) {
    const done = (ok) => {
      btn.textContent = ok ? 'Copied' : 'Select and copy';
    };
    const clip = nav() && nav().clipboard;
    if (clip && typeof clip.writeText === 'function') {
      clip.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
    } else {
      done(fallbackCopy(text));
    }
  }

  /** Y11's fallback: a selected, off-screen textarea and execCommand. */
  function fallbackCopy(text) {
    const buf = el('textarea', { cls: 'yeo-copy-buf', attrs: { readonly: '', 'aria-hidden': 'true', tabindex: '-1' } });
    buf.value = text;
    sheet.appendChild(buf);
    let ok = false;
    try {
      if (typeof buf.select === 'function') buf.select();
      ok = typeof document.execCommand === 'function' && document.execCommand('copy') === true;
    } catch {
      ok = false;
    }
    sheet.removeChild(buf);
    return ok;
  }

  // Y12 — the paste box is the path, so it is where the sheet opens.
  const first = mode === 'reply' ? paste : intentIn;
  if (typeof first.focus === 'function') first.focus();
}
