/**
 * Safe DOM construction.
 *
 * Rule 10: snapshot strings, ESPN text, and /ask answers are untrusted data.
 * Everything here goes through textContent. There is no innerHTML in this
 * codebase and there must never be one — if you need markup, compose elements.
 */

/**
 * el('div', {cls, text, attrs, on}, [children]) -> HTMLElement
 * `text` is always set via textContent, never parsed as markup.
 */
export function el(tag, opts = {}, kids = []) {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === null || v === undefined || v === false) continue;
      node.setAttribute(k, String(v));
    }
  }
  if (opts.on) {
    for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A labelled value row — the workhorse of most tiles. */
export function row(label, value, cls = '') {
  return el('div', { cls: `row ${cls}`.trim() }, [
    el('span', { cls: 'row-label', text: label }),
    el('span', { cls: 'row-value', text: value }),
  ]);
}

export function pill(text, tone = 'neutral') {
  return el('span', { cls: `pill pill-${tone}`, text });
}

/**
 * A snapshot URL, vetted — or null.
 *
 * URLs arrive from the snapshot, so anything that is not http(s) is refused
 * here rather than becoming a javascript: or data: link further down. One
 * definition, because `extLink` is not the only shape a link takes: a tile
 * whose whole row is tappable needs the same guard around its own anchor.
 */
export function safeUrl(href) {
  try {
    const u = new URL(String(href));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * An external link. Always rel="noopener noreferrer" — target="_blank" without
 * it hands the opened page a handle on ours.
 *
 * A URL the guard above refuses renders as inert text instead of a link.
 */
export function extLink(href, text, cls = '') {
  const safe = safeUrl(href);
  if (!safe) return el('span', { cls, text });
  return el('a', {
    cls,
    text,
    attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' },
  });
}

/** "Nothing here" filler, so an empty list never looks like a broken tile. */
export function empty(text) {
  return el('p', { cls: 'empty', text });
}
