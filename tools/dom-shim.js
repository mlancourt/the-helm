/**
 * The Helm — a DOM shim for the tile tests. Node, zero deps.
 *
 * NOT jsdom. lib/dom.js uses a small, fixed slice of the DOM — createElement,
 * textContent, setAttribute, appendChild, classList, addEventListener — and 60
 * lines of it beats a dependency (rule 3).
 *
 * Shared by tools/test-tiles.js and tools/test-weather.js. It lives in its own
 * file so the two cannot drift into two different ideas of what a DOM is, and
 * so a fix made for one tile's test is a fix for every tile's test.
 *
 * Requiring this file installs `global.document`. That is the point: every
 * render module reaches for it at call time.
 */

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { for (const x of c) if (x) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  contains(c) { return this.set.has(c); }
  toggle(c) { if (this.set.has(c)) { this.set.delete(c); return false; } this.set.add(c); return true; }
  get value() { return [...this.set].join(' '); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.attrs = {};
    this.listeners = {};
    this.classList = new ClassList(this);
    this._text = '';
    // Layout does not exist here; the newsstand's overflow probe must survive
    // that rather than assume a real box.
    this.clientHeight = 0;
    this.scrollHeight = 0;
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this.classList.value; }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this._text; }
  appendChild(n) { this.childNodes.push(n); return n; }
  removeChild(n) { this.childNodes = this.childNodes.filter((c) => c !== n); return n; }
  get firstChild() { return this.childNodes[0] || null; }
  get previousSibling() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  querySelectorAll(sel) { return all(this).filter((n) => matches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function all(node, out = []) {
  for (const c of node.childNodes) { if (c instanceof El) { out.push(c); all(c, out); } }
  return out;
}
function matches(node, sel) {
  return sel.split(',').map((s) => s.trim()).some((s) =>
    s.startsWith('.') ? node.classList.contains(s.slice(1)) : node.tagName === s.toUpperCase()
  );
}

class TextNode {
  constructor(t) { this._text = String(t); }
  get textContent() { return this._text; }
}

/**
 * The document's own listeners.
 *
 * The cards sheet's auction clock repaints the moment a slept phone comes
 * back, which it learns from a `visibilitychange` on `document` — so the shim
 * has to be able to both register one and, just as importantly, forget it: a
 * teardown that failed to remove its listener is exactly the leak the test
 * is there to catch, and a shim with no `removeEventListener` could not tell
 * the difference.
 */
const docListeners = new Map();

global.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => new TextNode(t),
  hidden: false,
  addEventListener(type, fn) {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    docListeners.set(type, (docListeners.get(type) || []).filter((f) => f !== fn));
  },
};

/** How many listeners the document is holding for `type`. */
function docListenerCount(type) {
  return (docListeners.get(type) || []).length;
}

/** Fire one, the way the browser would. */
function fireDocEvent(type) {
  for (const fn of [...(docListeners.get(type) || [])]) fn();
}

module.exports = { ClassList, El, TextNode, all, matches, docListenerCount, fireDocEvent };
