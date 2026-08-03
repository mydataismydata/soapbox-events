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
    + ` height:auto; display:block; border:0; border-radius:8px;${centre}">`;
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

// Multiline plain text -> paragraphs. Blank lines split paragraphs; single
// newlines become <br>. Input is escaped, so user text cannot inject HTML.
// Pass `imageUrl` to turn {{image:…}} markers into pictures.
export function textToHtml(text, { imageUrl } = {}) {
  const paragraphs = String(text || '').trim().split(/\n\s*\n/);
  return paragraphs
    .filter((p) => p.trim())
    .map((p) => `<p>${expandImageMarkers(esc(p.trim()).replaceAll('\n', '<br>'), imageUrl)}</p>`)
    .join('\n');
}

const PUBLIC_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #26272b; line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  .pub-wrap { max-width: 700px; margin: 0 auto; padding: 28px 16px 64px; }
  .pub-card {
    background: #ffffff; border-radius: 14px; padding: 28px;
    box-shadow: 0 1px 3px rgba(15, 15, 20, 0.09), 0 8px 28px rgba(15, 15, 20, 0.07);
    margin-top: 20px;
  }
  .pub-card h2 { font-size: 19px; margin-bottom: 12px; }
  .pub-muted { color: #6b6f76; font-size: 14px; }
  .pub-detail { display: flex; gap: 10px; padding: 7px 0; font-size: 15.5px; }
  .pub-detail .k { min-width: 84px; color: #6b6f76; font-size: 13px; text-transform: uppercase;
    letter-spacing: 0.06em; padding-top: 2px; }
  .pub-btn {
    display: inline-block; border: 0; cursor: pointer; text-decoration: none; text-align: center;
    font-size: 16px; font-weight: 700; padding: 13px 30px; border-radius: 9px;
    font-family: inherit;
  }
  .pub-btn-yes { background: #16a34a; color: #ffffff; }
  .pub-btn-no { background: #ffffff; color: #b91c1c; border: 2px solid #dc2626; }
  .pub-btn-plain { background: #26272b; color: #ffffff; font-weight: 600; font-size: 14.5px;
    padding: 10px 20px; }
  .pub-btn-ghost { background: #f1f2f4; color: #26272b; font-weight: 600; font-size: 14.5px;
    padding: 10px 20px; }
  .pub-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
  .pub-field { margin-bottom: 14px; }
  .pub-field label { display: block; font-size: 13.5px; font-weight: 600; margin-bottom: 5px; }
  .pub-field input, .pub-field select, .pub-field textarea {
    width: 100%; font-size: 15.5px; font-family: inherit; padding: 10px 12px;
    border: 1.5px solid #d5d8dd; border-radius: 8px; background: #fff; color: inherit;
  }
  .pub-field input:focus, .pub-field select:focus, .pub-field textarea:focus {
    outline: 2px solid #6366f1; outline-offset: 1px; border-color: #6366f1;
  }
  .pub-banner { border-radius: 10px; padding: 12px 16px; font-size: 15px; font-weight: 600;
    margin-top: 20px; }
  .pub-banner-ok { background: #dcfce7; color: #14532d; }
  .pub-banner-no { background: #fee2e2; color: #7f1d1d; }
  .pub-banner-warn { background: #fef3c7; color: #713f12; }
  .pub-footer { text-align: center; margin-top: 28px; font-size: 12.5px; color: #9a9ea6; }
  .pub-footer a { color: #9a9ea6; }
  .pub-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .pub-chip { background: #f1f2f4; border-radius: 999px; padding: 5px 14px; font-size: 13.5px; }
  .rt-content { line-height: 1.6; }
  .rt-content p { margin: 0 0 10px; }
  .rt-content p:last-child { margin-bottom: 0; }
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

export function publicPage({ title, bodyHtml, pageBg = '#f2f3f5', footerHtml = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="icon" href="data:,">
<style>${PUBLIC_CSS}
  body { background: ${esc(pageBg)}; }
</style>
</head>
<body>
<div class="pub-wrap">
${bodyHtml}
<div class="pub-footer">${footerHtml}</div>
</div>
</body>
</html>`;
}
