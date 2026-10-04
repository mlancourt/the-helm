/**
 * yeoman — the ship's correspondence clerk (vault spec `Yeoman-Tile-Spec.md`,
 * rulings Y1–Y16).
 *
 * Paste what someone sent (or nothing, to start fresh), say who they are and
 * what you want to happen, get back ONE draft in Matt's own register (Y4),
 * then nudge it, copy it, or hand it to Messages / Mail. Matt hits send. The
 * Yeoman never does (Y11): there is no fetch here but `ctx.actions.draft`,
 * and the only ways out are the clipboard and two anchors Matt taps himself.
 *
 * No producer, no snapshot entry (Y15). The face renders from nothing: the
 * shell hands an ASK-band tile an empty stand-in rather than rule 9's
 * "missing" card, and `tile` is never read below.
 *
 * Y7 — never invent a fact. The model writes `[PRICE]`, `[DAY/TIME]`,
 * `[PART #]` where the inputs withheld one, and this module prints the draft
 * and the Worker's `blanks` EXACTLY as delivered. It contains no string
 * substitution of any kind, so it cannot fill in what the input withheld.
 *
 * Y11 — `sms:` and `mailto:` are admitted on exactly two anchors, built by
 * `handoffHref()` alone, from the draft (and subject) through
 * encodeURIComponent. No other scheme, no `target`, and `safeUrl()` is not
 * widened: these hrefs are composed here from the model's words, never read
 * from a snapshot.
 *
 * Y13 — the pasted message, the intent, the draft, the read and the history
 * live in this sheet's closure and die with it. The ONE thing written to
 * localStorage is the recents list (name · role · context, last 12), which
 * Matt types himself. Every string lands via textContent (rule 10).
 * Rule 7: there is no clock in this module at all.
 */

import { el, clear } from '../lib/dom.js';

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

// ------------------------------------------------------------------ face

export function render(root, _tile, ctx) {
  const title = (ctx && ctx.title) || 'Yeoman';
  const open = (mode) => (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    ctx.actions.openPanel(title, (body) => buildSheet(body, mode, ctx));
  };

  root.appendChild(el('p', { cls: 'yeo-line', text: 'paste a message, get your reply' }));
  root.appendChild(
    el('div', { cls: 'yeo-face' }, [
      el('button', { cls: 'btn yeo-face-btn', text: 'Reply', attrs: { type: 'button' }, on: { click: open('reply') } }),
      el('button', { cls: 'btn yeo-face-btn', text: 'New message', attrs: { type: 'button' }, on: { click: open('compose') } }),
    ])
  );
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
