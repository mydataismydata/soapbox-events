// HTML escaping and the shared shell for public pages (event landing pages,
// RSVP pages, unsubscribe). Public pages are server-rendered, self-contained
// (inline CSS, no scripts required) and work in any browser or email webview.

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Pictures inside a message body. The body is plain text everywhere in this
// app, so an image is a marker the composer inserts rather than an <img> the
// author has to write:
//
//     {{image:<upload token>}}          full width
//     {{image:<upload token>|half}}     half, centred
//
// The marker survives merge-tag rendering untouched (renderTags only matches
// {{lower_case_words}}), and it is expanded AFTER escaping, so the only HTML
// that reaches the reader is built here from a validated token.
const IMAGE_RE = /\{\{\s*image:([A-Za-z0-9]{6,64})(?:\s*\|\s*(full|half|small))?\s*\}\}/g;

// Email bodies are 600px wide. Anything narrower is centred.
const IMAGE_WIDTHS = { full: 600, half: 300, small: 200 };

// `width` is spelled out as an attribute as well as in the style, because
// Outlook ignores max-width and will otherwise print the image at its
// natural pixel size, however large that is.
function imageTag(url, size) {
  const w = IMAGE_WIDTHS[size] || IMAGE_WIDTHS.full;
  const centre = w < IMAGE_WIDTHS.full ? ' margin-left:auto; margin-right:auto;' : '';
  return `<img src="${esc(url)}" alt="" width="${w}" style="width:100%; max-width:${w}px;`
    + ` height:auto; display:block; border:0;${centre}">`;
}

// Replaces markers with <img>, or removes them when there is no way to build
// a URL — a leftover "{{image:…}}" in front of a guest would be worse.
export function expandImageMarkers(html, imageUrl) {
  return String(html).replace(IMAGE_RE, (_m, token, size) => {
    const url = typeof imageUrl === 'function' ? imageUrl(token) : '';
    return url ? imageTag(url, size) : '';
  });
}

// For the plain-text alternative, where a picture has nothing to say.
export function stripImageMarkers(text) {
  return String(text || '').replace(IMAGE_RE, '').replace(/\n{3,}/g, '\n\n');
}

// Links, in the same spirit as images: written in the body rather than built
// out of HTML. Two spellings, both readable as they stand if anything ever
// shows the raw text:
//
//     [our endorsements](https://example.org/endorsements)
//     https://example.org/endorsements
//
// One pass over both, so a URL that has already been consumed as the target
// of a labelled link cannot be linked a second time. Only http(s) matches,
// which is what keeps javascript: and data: out — there is no allowlist to
// get wrong because no other scheme can reach the replacement at all.
const LINK_RE = /\[([^\][\n]{1,300})\]\((https?:\/\/[^\s)]{1,600})\)|(https?:\/\/[^\s<>"']{1,600})/g;

// Sentence punctuation that follows a bare URL belongs to the sentence, not
// to the address. Entities come off first: the text has already been escaped,
// so a trailing apostrophe arrives as "&#39;" and chopping the ";" alone
// would leave "&#39" glued to the href.
function trimUrlTail(url) {
  let out = url;
  for (let guard = 0; guard < 20; guard++) {
    const entity = /(&quot;|&#39;|&amp;)$/.exec(out);
    if (entity) { out = out.slice(0, -entity[0].length); continue; }
    if (/[.,;:!?]$/.test(out)) { out = out.slice(0, -1); continue; }
    // A closing bracket only belongs to the URL if it opened one.
    if (out.endsWith(')') && (out.match(/\(/g) || []).length < (out.match(/\)/g) || []).length) {
      out = out.slice(0, -1);
      continue;
    }
    break;
  }
  return out;
}

// Runs on already-escaped text, so `url` and `label` are safe to place in an
// attribute and in element content respectively — the escaping turned any
// quote or angle bracket into an entity before this saw it.
export function expandLinks(html, linkStyle = '') {
  const style = linkStyle ? ` style="${linkStyle}"` : '';
  return String(html).replace(LINK_RE, (match, label, url, bare) => {
    if (bare) {
      const href = trimUrlTail(bare);
      if (!href) return match;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${style}>${href}</a>`
        + bare.slice(href.length);
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer"${style}>${label}</a>`;
  });
}

// For the plain-text alternative: keep both the words and the address, since
// a label alone would be a dead end.
export function flattenLinks(text) {
  return String(text || '').replace(LINK_RE, (match, label, url, bare) =>
    (bare ? bare : `${label} (${url})`));
}

// Multiline plain text -> paragraphs. Blank lines split paragraphs; single
// newlines become <br>. Input is escaped, so user text cannot inject HTML.
// Pass `imageUrl` to turn {{image:…}} markers into pictures, and `linkStyle`
// to colour the links inline (emails need it; public pages have a stylesheet).
export function textToHtml(text, { imageUrl, linkStyle } = {}) {
  const paragraphs = String(text || '').trim().split(/\n\s*\n/);
  return paragraphs
    .filter((p) => p.trim())
    .map((p) => {
      const escaped = esc(p.trim()).replaceAll('\n', '<br>');
      // Links first, then pictures. The other way round, the bare-URL pass
      // would find the address inside an <img src> and wrap it in an anchor.
      return `<p>${expandImageMarkers(expandLinks(escaped, linkStyle), imageUrl)}</p>`;
    })
    .join('\n');
}

// The guest pages wear the admin app's "Clean light grids" look: white square
// cards with hairline borders on a pale blue-gray page, 3px-rounded controls,
// IBM Plex Sans for words and IBM Plex Mono for small uppercase labels. The
// values mirror web/src/styles/tokens.css; the fonts are the same files the
// app bundles, served from /fonts (see server/index.js).
const fontFace = (family, pkg, weight) => `@font-face { font-family: '${family}'; font-style: normal;
    font-weight: ${weight}; font-display: swap; src: url('/fonts/${pkg}/${pkg}-latin-${weight}-normal.woff2') format('woff2'); }`;
const FONT_FACES = [
  ...[400, 500, 600, 700].map((w) => fontFace('IBM Plex Sans', 'ibm-plex-sans', w)),
  ...[400, 500, 600].map((w) => fontFace('IBM Plex Mono', 'ibm-plex-mono', w)),
].join('\n  ');

const PUBLIC_CSS = `
  ${FONT_FACES}
  :root {
    --canvas: #eff3f8; --surface: #ffffff; --surface-2: #f6f8fb; --surface-3: #eaeff5;
    --line: #e0e6ee; --line-strong: #cbd4e1;
    --ink: #172334; --ink-2: #566276; --faint: #6f7a8c;
    --accent: #1f5fbf; --accent-hover: #174a96;
    --ok: #1f7a45; --ok-hover: #19663a; --ok-soft: #e9f5ee; --ok-line: #c4e2d0;
    --bad: #a33d2a; --bad-soft: #fdf1ee; --bad-line: #dba396;
    --warn: #8a6400; --warn-soft: #fdf6e3; --warn-line: #ecdcb0;
    --font: 'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { color-scheme: light; }
  body {
    font-family: var(--font); font-size: 15px; color: var(--ink); background: var(--canvas);
    line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); }
  .pub-wrap { max-width: 700px; margin: 0 auto; padding: 28px 16px 64px; }
  .pub-card {
    background: var(--surface); border: 1px solid var(--line); border-radius: 0;
    box-shadow: 0 1px 2px rgba(23, 35, 52, 0.05); padding: 24px 28px; margin-top: 16px;
  }
  .pub-card h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 14px; }
  .pub-muted { color: var(--ink-2); font-size: 14px; }
  .pub-detail { display: flex; gap: 16px; padding: 10px 0; font-size: 15px; }
  .pub-detail + .pub-detail, .rt-content + .pub-detail { border-top: 1px solid var(--line); }
  .pub-detail .k { flex: 0 0 84px; font-family: var(--mono); font-size: 11px; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-2); padding-top: 3px; }
  .pub-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px;
    border: 1px solid transparent; border-radius: 3px; cursor: pointer; text-decoration: none;
    text-align: center; font: inherit; font-size: 15px; font-weight: 600; line-height: 1.2;
    padding: 10px 24px; transition: background 120ms ease, border-color 120ms ease;
  }
  .pub-btn-yes { background: var(--ok); border-color: var(--ok); color: #ffffff; }
  .pub-btn-yes:hover { background: var(--ok-hover); border-color: var(--ok-hover); }
  .pub-btn-no { background: var(--surface); border-color: var(--bad-line); color: var(--bad); }
  .pub-btn-no:hover { background: var(--bad-soft); }
  .pub-btn-plain { background: var(--accent); border-color: var(--accent); color: #ffffff;
    font-size: 14px; min-height: 40px; padding: 8px 18px; }
  .pub-btn-plain:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .pub-btn-ghost { background: var(--surface); border-color: var(--line-strong); color: var(--ink);
    font-size: 14px; min-height: 40px; padding: 8px 18px; }
  .pub-btn-ghost:hover { background: var(--surface-2); }
  .pub-btn-off { background: var(--surface-3); border-color: var(--line); color: var(--faint); cursor: default; }
  .pub-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
  .pub-field { margin-bottom: 14px; }
  .pub-field label { display: block; font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
  .pub-field input, .pub-field select, .pub-field textarea {
    width: 100%; min-height: 44px; font: inherit; font-size: 15px; padding: 9px 12px;
    border: 1px solid var(--line-strong); border-radius: 3px; background: var(--surface); color: var(--ink);
  }
  .pub-field input:focus, .pub-field select:focus, .pub-field textarea:focus {
    outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(31, 95, 191, 0.22);
  }
  .pub-banner { border: 1px solid transparent; border-radius: 0; padding: 12px 16px;
    font-size: 14.5px; font-weight: 600; margin: 0 0 16px; }
  .pub-banner-ok { background: var(--ok-soft); border-color: var(--ok-line); color: var(--ok); }
  .pub-banner-no { background: var(--bad-soft); border-color: var(--bad-line); color: var(--bad); }
  .pub-banner-warn { background: var(--warn-soft); border-color: var(--warn-line); color: var(--warn); }
  .pub-footer { text-align: center; margin-top: 28px; font-family: var(--mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); }
  .pub-footer a { color: var(--faint); }
  .pub-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pub-chip { background: var(--surface-3); color: var(--ink-2); border-radius: 3px; padding: 4px 10px; font-size: 13px; }
  .rt-content { line-height: 1.6; }
  .rt-content p { margin: 0 0 10px; }
  .rt-content p:last-child { margin-bottom: 0; }
  .rt-content img { display: block; max-width: 100%; height: auto; border-radius: 0; margin: 6px 0; }
  .rt-content img.rt-img-half { max-width: 50%; margin-left: auto; margin-right: auto; }
  .rt-content img.rt-img-small { max-width: 200px; margin-left: auto; margin-right: auto; }
  .rt-ff-serif { font-family: Georgia, 'Times New Roman', serif; }
  .rt-ff-sans { font-family: 'Helvetica Neue', Arial, sans-serif; }
  .rt-ff-mono { font-family: 'Courier New', Courier, monospace; }
  .rt-fs-sm { font-size: 0.85em; }
  .rt-fs-lg { font-size: 1.25em; }
  .rt-fs-xl { font-size: 1.6em; }
  @media (max-width: 480px) {
    .pub-card { padding: 20px 16px; }
    .pub-actions .pub-btn { flex: 1 1 100%; }
  }
`;

export function publicPage({ title, bodyHtml, footerHtml = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="icon" href="data:,">
<style>${PUBLIC_CSS}</style>
</head>
<body>
<div class="pub-wrap">
${bodyHtml}
<div class="pub-footer">${footerHtml}</div>
</div>
</body>
</html>`;
}
