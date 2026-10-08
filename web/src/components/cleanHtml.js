// Turn formatted text — pasted from a document, an email or a web page, or
// typed in the editor — into the small rich-text vocabulary the server keeps:
// paragraphs, line breaks, bold, italic, underline, three text sizes, the
// editor's fonts, left / centre / right alignment, bulleted and numbered
// lists, links and pictures. Everything else gives way to the template, so a
// pasted colour or typeface never fights the flyer's own.
//
// The result is built as a fresh tree rather than edited in place: each run of
// text is appended under exactly the formatting it needs, and a run with the
// same formatting as the one before it joins it, so a document that sets every
// word in its own <span> comes out as plain, readable markup.

const DROP = new Set([
  'script', 'style', 'head', 'title', 'meta', 'link', 'template', 'noscript', 'iframe', 'object',
  'embed', 'svg', 'math', 'button', 'input', 'select', 'textarea', 'canvas', 'video', 'audio',
]);
const BLOCKS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article', 'header',
  'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'pre', 'address', 'center', 'dl', 'dt',
  'dd', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'caption', 'hr',
]);
const SIZES = ['sm', 'lg', 'xl'];
const FONTS = ['serif', 'sans', 'mono'];
const ALIGNS = ['left', 'center', 'right'];

// The editor's own classes, read back off its markup.
function classOf(el, group, values) {
  const list = el.classList;
  return values.find((v) => list.contains(`rt-${group}-${v}`)) || '';
}

// A pasted size, in px, as one of the three sizes or normal. Documents set
// body text anywhere from 10 to 14 points, so only a clear step counts.
function sizeFor(px) {
  if (!(px > 0)) return '';
  if (px < 12.6) return 'sm';
  if (px >= 24) return 'xl';
  if (px >= 18.6) return 'lg';
  return '';
}

function pxOf(value, parentPx) {
  const m = /^([\d.]+)(px|pt|em|rem|%)?$/i.exec(String(value || '').trim());
  if (!m) {
    const named = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32 };
    return named[String(value || '').trim().toLowerCase()] || 0;
  }
  const n = parseFloat(m[1]);
  switch ((m[2] || 'px').toLowerCase()) {
    case 'pt': return n * (4 / 3);
    case 'em': return n * parentPx;
    case 'rem': return n * 16;
    case '%': return (n / 100) * parentPx;
    default: return n;
  }
}

const FONT_TAG_PX = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };

// The formatting an element passes on to the text inside it.
function inherit(el, st) {
  const tag = el.tagName.toLowerCase();
  const s = el.style;
  const next = { ...st };
  if (tag === 'b' || tag === 'strong') next.bold = true;
  if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'var') next.italic = true;
  if (tag === 'u' || tag === 'ins') next.underline = true;
  if (/^h[1-6]$/.test(tag)) {
    next.bold = true;
    if (tag === 'h1' || tag === 'h2') next.size = 'xl';
    else if (tag === 'h3') next.size = 'lg';
  }
  if (tag === 'small') next.size = 'sm';
  if (tag === 'big') next.size = 'lg';
  if (tag === 'font' && el.getAttribute('size')) {
    const n = parseInt(el.getAttribute('size'), 10);
    if (FONT_TAG_PX[n]) next.size = sizeFor(FONT_TAG_PX[n]);
  }
  // Inline styles win over the tag: Google Docs wraps a whole paste in
  // <b style="font-weight:normal">.
  const weight = s.fontWeight;
  if (weight) next.bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
  if (s.fontStyle) next.italic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
  const deco = `${s.textDecorationLine || ''} ${s.textDecoration || ''}`;
  if (/underline/.test(deco)) next.underline = true;
  else if (/\bnone\b/.test(deco) && tag !== 'a') next.underline = false;
  if (s.fontSize) {
    next.px = pxOf(s.fontSize, st.px) || st.px;
    next.size = sizeFor(next.px);
  }
  // The editor's own classes.
  const size = classOf(el, 'fs', SIZES);
  if (size) next.size = size;
  const font = classOf(el, 'ff', FONTS);
  if (font) next.font = font;
  if (tag === 'a') {
    const href = (el.getAttribute('href') || '').trim();
    next.href = /^(https?:\/\/|mailto:)/i.test(href) ? href : '';
  }
  return next;
}

function alignOf(el) {
  const raw = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
  if (raw === 'center' || raw === 'right' || raw === 'left') return raw;
  if (raw === 'justify' || raw === 'start') return 'left';
  if (raw === 'end') return 'right';
  if (el.tagName.toLowerCase() === 'center') return 'center';
  return classOf(el, 'al', ALIGNS);
}

// The wrappers a run of text needs, outermost first. Two runs whose chains
// match share their elements.
function chainOf(st) {
  const chain = [];
  if (st.href) chain.push({ tag: 'a', href: st.href });
  const cls = [st.size && `rt-fs-${st.size}`, st.font && `rt-ff-${st.font}`].filter(Boolean).join(' ');
  if (cls) chain.push({ tag: 'span', cls });
  if (st.bold) chain.push({ tag: 'b' });
  if (st.italic) chain.push({ tag: 'i' });
  // A link is underlined already.
  if (st.underline && !st.href) chain.push({ tag: 'u' });
  return chain;
}

function matches(node, w) {
  if (!node || node.nodeType !== 1 || node.tagName.toLowerCase() !== w.tag) return false;
  if (w.tag === 'a') return node.getAttribute('href') === w.href;
  if (w.tag === 'span') return node.className === w.cls;
  return true;
}

function imageSizeClass(img) {
  const w = parseFloat(img.getAttribute('width')) || pxOf(img.style.width, 16);
  if (img.classList.contains('rt-img-small') || (w > 0 && w <= 220)) return 'rt-img-small';
  if (img.classList.contains('rt-img-half') || (w > 0 && w <= 360)) return 'rt-img-half';
  return '';
}

const EMOJI_ALT = /^[^\x00-\x7f]{1,8}$/;

export function cleanHtml(input) {
  const src = new DOMParser().parseFromString(String(input || ''), 'text/html');
  const doc = document.implementation.createHTMLDocument('');
  const out = doc.createElement('div');
  let container = out; // where the next block goes: the root, a list or a list item
  let block = null; // the paragraph text is going into
  let pending = null; // the alignment of the paragraph about to start
  let breakFirst = false; // a list item's next paragraph starts on a new line

  function endBlock() {
    block = null;
    pending = null;
    if (container.tagName === 'LI' && container.childNodes.length) breakFirst = true;
  }

  function ensureBlock() {
    if (container.tagName === 'LI') {
      if (breakFirst) { container.appendChild(doc.createElement('br')); breakFirst = false; }
      return container;
    }
    if (container.tagName === 'UL' || container.tagName === 'OL') {
      // Stray text inside a list becomes a point of its own.
      const li = doc.createElement('li');
      container.appendChild(li);
      return li;
    }
    if (!block) {
      block = doc.createElement('p');
      if (pending?.align) block.className = `rt-al-${pending.align}`;
      container.appendChild(block);
    }
    return block;
  }

  function append(node, chain) {
    let parent = ensureBlock();
    for (const w of chain) {
      const last = parent.lastChild;
      if (matches(last, w)) { parent = last; continue; }
      const el = doc.createElement(w.tag);
      if (w.tag === 'a') el.setAttribute('href', w.href);
      if (w.tag === 'span') el.className = w.cls;
      parent.appendChild(el);
      parent = el;
    }
    if (node.nodeType === 3 && parent.lastChild?.nodeType === 3) parent.lastChild.appendData(node.data);
    else parent.appendChild(node);
  }

  // Whether the paragraph being written ends in a space or a line break, or
  // has nothing in it yet, so that a space would be one too many.
  function atBreak() {
    const b = container.tagName === 'LI' ? container : block;
    if (!b || breakFirst) return true;
    const text = b.textContent;
    if (!text) return !b.querySelector('img');
    if (/\s$/.test(text)) return true;
    let last = b.lastChild;
    while (last && last.nodeType === 1 && last.tagName !== 'BR' && last.tagName !== 'IMG') last = last.lastChild;
    return Boolean(last && last.nodeType === 1 && last.tagName === 'BR');
  }

  function walk(node, st) {
    if (node.nodeType === 3) {
      let text = node.data.replace(/[\t\n\r ]+/g, ' ');
      if (st.pre) text = node.data.replace(/\r\n?/g, '\n');
      if (!text) return;
      if (text === ' ' && atBreak()) return;
      if (atBreak()) text = text.replace(/^ +/, '');
      if (st.pre && text.includes('\n')) {
        text.split('\n').forEach((line, i) => {
          if (i) append(doc.createElement('br'), []);
          if (line) append(doc.createTextNode(line), chainOf(st));
        });
        return;
      }
      append(doc.createTextNode(text), chainOf(st));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag) || tag.includes(':')) return; // o:p and friends from Word
    if (el.style.display === 'none' || el.style.visibility === 'hidden' || el.hasAttribute('hidden')) return;
    // Word draws its list bullets and numbers as text in a symbol font and
    // marks them this way. Keep the number, and a plain bullet for the symbol.
    if (/mso-list:\s*ignore/i.test(el.getAttribute('style') || '')) {
      const mark = el.textContent.replace(/[\s\u00a0]+/g, '');
      if (mark) append(doc.createTextNode(/^[\d.)(a-zA-Z]+$/.test(mark) && mark !== 'o' ? `${mark} ` : '\u2022 '), chainOf(st));
      return;
    }

    if (tag === 'br') { append(doc.createElement('br'), []); return; }
    if (tag === 'img') {
      const s = (el.getAttribute('src') || '').trim();
      const alt = (el.getAttribute('alt') || '').trim();
      // A picture of an emoji (Gmail, Slack) reads better as the emoji.
      if (EMOJI_ALT.test(alt) && (parseFloat(el.getAttribute('width')) || 99) <= 32) {
        append(doc.createTextNode(alt), chainOf(st));
        return;
      }
      if (!s) return;
      const img = doc.createElement('img');
      img.setAttribute('src', s);
      img.setAttribute('alt', '');
      const cls = imageSizeClass(el);
      if (cls) img.className = cls;
      append(img, st.href ? [{ tag: 'a', href: st.href }] : []);
      return;
    }

    const next = inherit(el, st);
    if (tag === 'pre') next.pre = true;

    if (tag === 'ul' || tag === 'ol') {
      endBlock();
      const list = doc.createElement(tag);
      // A list inside a list item nests under that item.
      const holder = container.tagName === 'UL' || container.tagName === 'OL'
        ? (container.lastElementChild || container)
        : container;
      holder.appendChild(list);
      const saved = container;
      container = list;
      for (const child of el.childNodes) walk(child, next);
      container = saved;
      block = null;
      pending = null;
      if (container.tagName === 'LI') breakFirst = true;
      return;
    }
    if (tag === 'li') {
      if (container.tagName !== 'UL' && container.tagName !== 'OL') {
        // A point with no list around it: a paragraph of its own.
        endBlock();
        for (const child of el.childNodes) walk(child, next);
        endBlock();
        return;
      }
      const li = doc.createElement('li');
      container.appendChild(li);
      const saved = container;
      container = li;
      breakFirst = false;
      for (const child of el.childNodes) walk(child, next);
      container = saved;
      breakFirst = false;
      return;
    }
    if (tag === 'td' || tag === 'th') {
      if (!atBreak()) append(doc.createTextNode(' '), []);
      for (const child of el.childNodes) walk(child, next);
      return;
    }
    if (BLOCKS.has(tag)) {
      endBlock();
      if (tag === 'hr') return;
      // Every block comes out as a paragraph.
      const align = alignOf(el);
      pending = { align };
      for (const child of el.childNodes) {
        walk(child, next);
        // A block inside this one ended it; the rest of this one picks up
        // its alignment again.
        if (!block && !pending) pending = { align };
      }
      endBlock();
      return;
    }
    for (const child of el.childNodes) walk(child, next);
  }

  for (const child of src.body.childNodes) walk(child, { px: 16 });

  // Trailing line breaks and empty paragraphs at either end are left over
  // from the source's layout, not part of the text.
  const isEmpty = (n) => n && n.nodeType === 1 && !n.textContent.trim() && !n.querySelector?.('img')
    && (n.tagName === 'BR' || n.tagName === 'P' || n.tagName === 'DIV');
  while (isEmpty(out.firstChild)) out.firstChild.remove();
  while (isEmpty(out.lastChild)) out.lastChild.remove();
  out.querySelectorAll('p, div, li').forEach((b) => {
    while (b.lastChild?.nodeType === 1 && b.lastChild.tagName === 'BR' && b.childNodes.length > 1) b.lastChild.remove();
  });
  out.querySelectorAll('ul, ol').forEach((l) => { if (!l.children.length) l.remove(); });
  return out;
}

// The cleaned markup as a string.
export function cleanHtmlString(input) {
  return cleanHtml(input).innerHTML;
}

// This installation's own pictures, which can stay as they are.
const OWN_FILE = /^(?:https?:\/\/[^/\s]+)?\/o\/[a-z0-9][a-z0-9-]{0,29}\/files\/[A-Za-z0-9]{6,64}$/;

export function isOwnFile(src) {
  return OWN_FILE.test(String(src || ''));
}
