// A deliberately tiny, allowlist-only HTML sanitizer for rich text: the event
// description, broadcast bodies and the flyer's text block. Each is authored by
// a signed-in member but rendered on public pages, so it must be safe by
// construction.
//
// The rule is simple: only a fixed set of formatting tags survive, the only
// attribute kept is `class` (and only class tokens from a fixed allowlist —
// the font/size classes the editor applies), and every other tag/attribute is
// dropped. Text between tags is HTML-escaped. There is no path for scripts,
// event handlers, styles, urls, or unknown tags to pass through.

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'a', 'img', 'ul', 'ol', 'li']);
const VOID_TAGS = new Set(['br', 'img']);
const ALLOWED_CLASSES = new Set([
  'rt-ff-serif', 'rt-ff-sans', 'rt-ff-mono',
  'rt-fs-sm', 'rt-fs-lg', 'rt-fs-xl',
  'rt-img-half', 'rt-img-small',
  'rt-al-left', 'rt-al-center', 'rt-al-right',
]);

// Email has no stylesheet to lean on, so the same classes are re-emitted as
// inline styles when rendering for an inbox. Sizes are absolute there because
// `em` compounds unpredictably across clients.
const EMAIL_STYLES = {
  'rt-ff-serif': "font-family:Georgia,'Times New Roman',serif;",
  'rt-ff-sans': "font-family:'Helvetica Neue',Arial,sans-serif;",
  'rt-ff-mono': "font-family:'Courier New',Courier,monospace;",
  'rt-fs-sm': 'font-size:13px;',
  'rt-fs-lg': 'font-size:19px;',
  'rt-fs-xl': 'font-size:25px;',
  'rt-al-left': 'text-align:left;',
  'rt-al-center': 'text-align:center;',
  'rt-al-right': 'text-align:right;',
};
const EMAIL_LINK_STYLE = 'color:#1f5fbf;';

// The flyer has no stylesheet either: it is drawn into the designer's frame,
// the event page and the picture-of-the-flyer alike. Sizes there are relative,
// so the text block follows the flyer's Title size, and colours are left out
// so the text takes the template's own ink.
const FLYER_STYLES = {
  ...EMAIL_STYLES,
  'rt-fs-sm': 'font-size:0.85em;',
  'rt-fs-lg': 'font-size:1.25em;',
  'rt-fs-xl': 'font-size:1.6em;',
};
// Per-tag spacing in the flyer. A list is an inline block, so a centred
// template centres the list as a whole while its points stay ranged left.
const FLYER_TAG_STYLES = {
  p: 'margin:0 0 0.6em;',
  ul: 'display:inline-block; max-width:100%; margin:0 0 0.6em; padding-left:1.4em; text-align:left;',
  ol: 'display:inline-block; max-width:100%; margin:0 0 0.6em; padding-left:1.6em; text-align:left;',
  li: 'margin:0.15em 0;',
};
const FLYER_LINK_STYLE = 'color:inherit; text-decoration:underline;';
const FLYER_IMAGE_WIDTHS = { 'rt-img-small': '33%', 'rt-img-half': '50%' };
// Widths mirror the marker syntax: the body column is 600px.
const IMAGE_WIDTHS = { 'rt-img-small': 200, 'rt-img-half': 300 };

// Matches a start/end tag, tolerating quoted attribute values that contain '>'.
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function escapeText(text) {
  return String(text)
    .replace(/&(?!(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attr(attrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[2] ?? m[3] ?? '') : '';
}

function safeClass(attrs) {
  const raw = attr(attrs, 'class');
  return raw.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c)).join(' ');
}

// Only three schemes can ever reach an href, and the check runs on the value
// with whitespace and control characters stripped, so "java\nscript:" cannot
// sneak past by being spelled oddly.
function safeHref(attrs) {
  const raw = attr(attrs, 'href').replace(/[\s\u0000-\u001f]/g, '');
  if (!raw) return '';
  return /^(https?:\/\/|mailto:)/i.test(raw) ? raw : '';
}

// Images may only point at this installation's own uploads. An arbitrary
// external src would let a newsletter silently phone home to anywhere.
const FILE_SRC_RE = /^(?:https?:\/\/[^/\s]+)?\/o\/[a-z0-9][a-z0-9-]{0,29}\/files\/[A-Za-z0-9]{6,64}$/;

function safeSrc(attrs) {
  const raw = attr(attrs, 'src').replace(/[\s\u0000-\u001f]/g, '');
  return FILE_SRC_RE.test(raw) ? raw : '';
}

function attrEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function classAttr(tag, cls, mode) {
  if (mode === 'page') return cls ? ` class="${cls}"` : '';
  const table = mode === 'flyer' ? FLYER_STYLES : EMAIL_STYLES;
  const style = (mode === 'flyer' ? FLYER_TAG_STYLES[tag] || '' : '')
    + (cls ? cls.split(/\s+/).map((c) => table[c] || '').join('') : '');
  return style ? ` style="${style}"` : '';
}

function imageHtml(src, cls, mode) {
  if (mode === 'flyer') {
    const width = FLYER_IMAGE_WIDTHS[cls.split(/\s+/).find((c) => FLYER_IMAGE_WIDTHS[c])] || '100%';
    return `<img src="${attrEscape(src)}" alt="" style="display:block; width:auto; max-width:${width};`
      + ' height:auto; margin:0.4em auto 0.7em; border-radius:4px;">';
  }
  const width = IMAGE_WIDTHS[cls.split(/\s+/).find((c) => IMAGE_WIDTHS[c])] || 600;
  if (mode !== 'email') return `<img src="${attrEscape(src)}" alt=""${cls ? ` class="${cls}"` : ''}>`;
  const centre = width < 600 ? ' margin-left:auto; margin-right:auto;' : '';
  return `<img src="${attrEscape(src)}" alt="" width="${width}" style="width:100%;`
    + ` max-width:${width}px; height:auto; display:block; border:0;${centre}">`;
}

// `mode: 'email'` swaps the stylesheet's classes for inline styles, which is
// the only thing an email client will honour. `mode: 'flyer'` does the same
// for the flyer's text block, with sizes relative to the flyer's own type.
export function sanitizeRichText(input, { maxLength = 20000, mode = 'page' } = {}) {
  if (mode !== 'email' && mode !== 'flyer') mode = 'page';
  let html = String(input ?? '');
  if (html.length > maxLength) html = html.slice(0, maxLength);
  // What sits inside these is code or page furniture, never words to keep.
  html = html.replace(/<(script|style|head|title|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');

  let out = '';
  let last = 0;
  const open = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    out += escapeText(html.slice(last, m.index));
    last = TAG_RE.lastIndex;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue; // drop unknown tag, keep surrounding text

    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx !== -1) {
        for (let k = open.length - 1; k >= idx; k--) out += `</${open[k]}>`;
        open.splice(idx);
      }
    } else if (VOID_TAGS.has(tag)) {
      if (tag === 'img') {
        const src = safeSrc(m[3] || '');
        if (src) out += imageHtml(src, safeClass(m[3] || ''), mode);
      } else {
        out += '<br>';
      }
    } else if (tag === 'a') {
      // A link whose target didn't pass still keeps its words — it just stops
      // being a link, which is the safe half of what the author wanted.
      const href = safeHref(m[3] || '');
      out += href
        ? `<a href="${attrEscape(href)}" target="_blank" rel="noopener noreferrer"`
          + `${mode === 'page' ? '' : ` style="${mode === 'flyer' ? FLYER_LINK_STYLE : EMAIL_LINK_STYLE}"`}>`
        : '<a>';
      open.push('a');
    } else {
      const cls = safeClass(m[3] || '');
      out += `<${tag}${classAttr(tag, cls, mode)}>`;
      open.push(tag);
    }
  }
  out += escapeText(html.slice(last));
  for (let k = open.length - 1; k >= 0; k--) out += `</${open[k]}>`;
  return out;
}

// Flatten rich text to readable plain text — used for the {{event_description}}
// merge tag, which drops into plain-text email bodies.
export function stripHtml(input) {
  return String(input ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Whether a stored description is HTML (new rich text) vs. legacy plain text,
// so old descriptions still render with their line breaks.
export function looksLikeHtml(text) {
  return /<(?:b|strong|i|em|u|br|p|div|span|a|img)\b[^>]*>/i.test(String(text ?? ''));
}
