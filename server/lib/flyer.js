// The flyer engine. A flyer is described by a small JSON object (style, fonts,
// size scale, short text slots, optional featured images) and rendered to
// self-contained HTML with inline styles only. Each style is a self-contained
// patriotic template with its own fixed colours — there is no separate palette
// to pick. The same renderer backs the designer's live preview and the public
// event landing page, so what you design is exactly what guests see.
import { esc } from './html.js';
import { formatDate, formatTimeRange } from './format.js';

// `landscape: true` marks the wide templates: they run side-on, with the type
// on the left and a single tall photo down the right, so they take one image
// instead of three and render on a wider card.
export const STYLES = [
  { id: 'blue', label: 'Blue', description: 'Navy field with a flag waving in from the top-right; tagline on a light-blue ribbon.' },
  { id: 'white', label: 'White', description: 'Cream between waving red stripes on top and a star-spangled flag below; navy ribbon.' },
  { id: 'red', label: 'Red', description: 'Bold red inside a starred white border, a small waving flag, tagline on a straight ribbon.' },
  { id: 'retro', label: 'Retro', description: 'Vintage navy, red and parchment stripes. All type — no photo needed.' },
  { id: 'spotlight', label: 'Spotlight', landscape: true, description: 'Wide. Bright-blue-to-midnight gradient, details on a white card, your photo standing at the right.' },
  { id: 'panel', label: 'Panel', landscape: true, description: 'Wide. Deep navy with a huge headline, an oversized date and a full-height photo panel.' },
];

export function isLandscape(style) {
  return STYLES.some((s) => s.id === style && s.landscape);
}

// Each style carries its own fixed colours. `accent` is what the invitation
// email header and the public page furniture use; the rest are template-specific.
const THEMES = {
  blue: { bg: '#0e1f44', ink: '#ffffff', accent: '#142a56', accent2: '#c02c39', red: '#c02c39', ribbon: '#5f8fd6', ribbonInk: '#ffffff', ribbonDark: '#3f6cb0' },
  white: { bg: '#ffffff', ink: '#17274e', accent: '#17274e', accent2: '#b0202f', red: '#c02c34', navy: '#17274e', ribbon: '#17274e', ribbonInk: '#ffffff', ribbonDark: '#0f1c39' },
  red: { bg: '#bb392c', ink: '#ffffff', accent: '#bb392c', accent2: '#16264c', red: '#bb392c', navy: '#16264c', ribbon: '#16264c', ribbonInk: '#ffffff' },
  retro: { bg: '#1e3a5f', ink: '#ece3cb', accent: '#1e3a5f', accent2: '#c0432f', red: '#c0432f', navy: '#1e3a5f', parchment: '#ddd2b4' },
  spotlight: { bg: '#0a1440', ink: '#ffffff', accent: '#12307f', accent2: '#e4f065', red: '#c02c39', navy: '#0a1440',
    // Bright blue on the left running down to near-black navy on the right.
    gradient: 'linear-gradient(102deg, #1e6dff 0%, #1a49c4 26%, #12307f 52%, #0a1440 78%, #050a24 100%)' },
  panel: { bg: '#2e3a5c', ink: '#f4eddd', accent: '#2e3a5c', accent2: '#c9bda2', red: '#b0202f', navy: '#2e3a5c', parchment: '#f4eddd' },
};

export const FONTS = [
  { id: 'serif', label: 'Classic serif', heading: "Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif" },
  { id: 'sans', label: 'Modern sans', heading: "'Helvetica Neue', Helvetica, Arial, sans-serif", body: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: 'elegant', label: 'Elegant mix', heading: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif", body: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: 'friendly', label: 'Friendly round', heading: "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif", body: "Verdana, 'Segoe UI', sans-serif" },
  { id: 'typewriter', label: 'Typewriter', heading: "'Courier New', Courier, monospace", body: "'Courier New', Courier, monospace" },
];

export const SCALES = [
  { id: 's', label: 'Compact', f: 0.85 },
  { id: 'm', label: 'Standard', f: 1 },
  { id: 'l', label: 'Large', f: 1.15 },
  { id: 'xl', label: 'Extra large', f: 1.3 },
];

export const DEFAULT_FLYER = {
  style: 'blue',
  font: 'sans',
  scale: 'm',
  eyebrow: "You're invited",
  tagline: '',
  note: '',
  contact: '', // optional "who to contact" line in the details block
  showHost: true,
  showAddress: false, // include the venue address in the details block
  imageColumns: 1, // 1–3: how many featured images / columns to show
  imageTokens: [], // up to 3 upload tokens, one per column
  imageCaptions: [], // parallel to imageTokens (e.g. speaker names)
  imageToken: '', // legacy mirror of imageTokens[0]
  imageCaption: '', // legacy mirror of imageCaptions[0]
  includeFlyerImage: false, // show a picture of the flyer in the invitation email
  flyerImageToken: '', // upload token of that picture, rendered by the designer
};

export function normalizeFlyer(raw) {
  const f = { ...DEFAULT_FLYER, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!STYLES.some((s) => s.id === f.style)) f.style = 'blue';
  if (!FONTS.some((s) => s.id === f.font)) f.font = 'sans';
  if (!SCALES.some((s) => s.id === f.scale)) f.scale = 'm';
  // Colours are fixed per style now — drop any legacy palette selection so it
  // doesn't linger in stored JSON.
  delete f.paletteId;
  delete f.colors;
  f.eyebrow = String(f.eyebrow ?? '').slice(0, 60);
  f.tagline = String(f.tagline ?? '').slice(0, 140);
  f.note = String(f.note ?? '').slice(0, 200);
  f.contact = String(f.contact ?? '').slice(0, 120);
  f.showHost = Boolean(f.showHost);
  f.showAddress = Boolean(f.showAddress);
  // Featured images: up to three, shown in 1/2/3 centred columns. Fold a legacy
  // single imageToken/imageCaption into the arrays, and keep imageToken /
  // imageCaption populated (mirroring the first image) for any older reader.
  const validToken = (t) => (/^[A-Za-z0-9]{6,64}$/.test(String(t || '')) ? String(t) : '');
  let tokens = Array.isArray(f.imageTokens) ? f.imageTokens : [];
  let caps = Array.isArray(f.imageCaptions) ? f.imageCaptions : [];
  if (!tokens.length && f.imageToken) { tokens = [f.imageToken]; caps = caps.length ? caps : [f.imageCaption]; }
  // The wide templates have one photo well, so they keep a single image even if
  // the flyer was designed on a portrait template first.
  const maxImages = isLandscape(f.style) ? 1 : 3;
  f.imageTokens = tokens.slice(0, maxImages).map(validToken);
  f.imageCaptions = f.imageTokens.map((_, i) => String(caps[i] ?? '').slice(0, 160));
  let cols = parseInt(f.imageColumns, 10);
  if (!(cols >= 1 && cols <= 3)) cols = 1;
  f.imageColumns = Math.min(maxImages, Math.max(cols, f.imageTokens.filter(Boolean).length || 1));
  f.imageToken = f.imageTokens[0] || '';
  f.imageCaption = f.imageCaptions[0] || '';
  f.includeFlyerImage = Boolean(f.includeFlyerImage);
  f.flyerImageToken = validToken(f.flyerImageToken);
  return f;
}

export function flyerColors(flyer) {
  return THEMES[flyer && flyer.style] || THEMES.blue;
}

// --- color math ------------------------------------------------------------

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function isDark(hex) {
  return luminance(hex) < 0.35;
}

export function contrastOn(hex) {
  return isDark(hex) ? '#ffffff' : '#1c1c1e';
}

export function tint(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Opaque pastel derived from a color — used for page backgrounds so they
// render identically regardless of the viewer's light/dark preference.
export function mixWithWhite(hex, ratio) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => Math.round(255 + (c - 255) * ratio).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

// --- rendering helpers ------------------------------------------------------

function fontOf(flyer) {
  return FONTS.find((f) => f.id === flyer.font) || FONTS[1];
}

function scaleOf(flyer) {
  return (SCALES.find((s) => s.id === flyer.scale) || SCALES[1]).f;
}

function whenParts(event) {
  return {
    date: formatDate(event.date) || '',
    time: formatTimeRange(event.start_time, event.end_time),
  };
}

function px(n) {
  return `${Math.round(n)}px`;
}

// Optional caption rendered directly under a featured image.
function captionHtml(text, colors, scale, color) {
  if (!text) return '';
  return `<div style="font-size:${px(12.5 * scale)}; line-height:1.4; color:${color || tint(colors.ink, 0.7)};
    margin-top:7px; text-align:center; font-style:italic;">${esc(text)}</div>`;
}

// One framed featured image. `bg` shows through where an uploaded image is
// transparent, so a logo on a transparent PNG sits on the template's colour.
function imageFrame(border, bg) {
  return (url) => `<img src="${esc(url)}" alt="" style="display:block; width:100%; aspect-ratio:3/2;
    object-fit:cover; border-radius:8px; border:3px solid ${border}; background:${bg};">`;
}

// Render 1–3 featured images. One is centred; two sit side by side in equal
// columns; three keep the first two side by side with the third centred below.
function featuredImages(images, { scale, colors, frame, captionColor, marginTop = 22 }) {
  const n = images.length;
  if (!n) return '';
  const gap = px(14 * scale);
  const cap = (caption) => captionHtml(caption, colors, scale, captionColor);
  const col = (im) => `<div style="flex:1 1 0; min-width:0; text-align:center;">${frame(im.url)}${cap(im.caption)}</div>`;
  if (n === 1) {
    return `<div style="max-width:${px(300 * scale)}; margin:${px(marginTop)} auto 4px; text-align:center;">${frame(images[0].url)}${cap(images[0].caption)}</div>`;
  }
  const topRow = `<div style="display:flex; gap:${gap}; justify-content:center; align-items:flex-start;">${col(images[0])}${col(images[1])}</div>`;
  if (n === 2) {
    return `<div style="max-width:${px(430 * scale)}; margin:${px(marginTop)} auto 4px;">${topRow}</div>`;
  }
  return `<div style="max-width:${px(430 * scale)}; margin:${px(marginTop)} auto 4px;">
    ${topRow}
    <div style="display:flex; justify-content:center; margin-top:${gap};">
      <div style="width:calc(50% - ${px(7 * scale)}); min-width:0; text-align:center;">${frame(images[2].url)}${cap(images[2].caption)}</div>
    </div>
  </div>`;
}

// A horizontal rule broken by a centred star. `full` spans the whole width as a
// bottom flourish (the star masks the line with `bg`); otherwise it's short.
function lineStarDivider({ color, bg, scale, full = false, marginTop = 14 }) {
  if (full) {
    return `<div style="position:relative; height:${px(18 * scale)}; margin-top:${px(marginTop)};">
      <div style="position:absolute; left:0; right:0; top:50%; height:2px; background:${color};"></div>
      <span style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); background:${bg};
        padding:0 ${px(12 * scale)}; color:${color}; font-size:${px(16 * scale)}; line-height:1;">&#9733;</span></div>`;
  }
  return `<div style="margin-top:${px(marginTop)}; display:flex; align-items:center; justify-content:center; gap:${px(12 * scale)};">
    <div style="height:1.5px; width:${px(56 * scale)}; background:${color};"></div>
    <span style="color:${color}; font-size:${px(15 * scale)};">&#9733;</span>
    <div style="height:1.5px; width:${px(56 * scale)}; background:${color};"></div></div>`;
}

// Points along a horizontal wavy edge y = baseY + amp·sin(x·k + phase), x in
// [0,w] (or w→0 when reverse). The phase is absolute in x, so two edges at
// different baseY stay parallel — giving constant-thickness wavy stripes.
function wavyEdge(baseY, w, { amp = 8, period = 150, phase = 0, steps = 30 } = {}, reverse = false) {
  let out = '';
  for (let i = 0; i <= steps; i++) {
    const idx = reverse ? steps - i : i;
    const x = (w * idx) / steps;
    const y = baseY + amp * Math.sin((x / period) * 2 * Math.PI + phase);
    out += `L${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return out.trim();
}

// A rectangular "waving flag" of horizontal stripes with rippling edges,
// optionally with a star canton in the upper-left. Returns an <svg> the caller
// positions via `style`. Setting `white` to the page colour yields bare red
// waving stripes on that background.
function wavyStripeFlag({ vw = 320, vh = 160, stripes = 7, red = '#c02c39', white = '#ffffff',
  amp = 8, period = 150, phase = 0, canton = false, cantonColor = '#17274e', id = 'wf', style = '', stretch = false }) {
  const sh = vh / stripes;
  let bands = '';
  for (let i = 0; i < stripes; i++) {
    const y0 = i * sh;
    const y1 = (i + 1) * sh;
    const startY = (y0 + amp * Math.sin(phase)).toFixed(1);
    const top = wavyEdge(y0, vw, { amp, period, phase });
    const bot = wavyEdge(y1, vw, { amp, period, phase }, true);
    bands += `<path d="M0 ${startY} ${top} ${bot} Z" fill="${i % 2 ? white : red}"/>`;
  }
  let cant = '';
  let starPat = '';
  if (canton) {
    const cw = +(vw * 0.42).toFixed(1);
    const ch = +(sh * Math.max(3, Math.round(stripes * 0.55))).toFixed(1);
    const top0 = (amp * Math.sin(phase)).toFixed(1);
    const topEdge = wavyEdge(0, cw, { amp, period, phase });
    const botEdge = wavyEdge(ch, cw, { amp, period, phase }, true);
    starPat = `<pattern id="${id}st" width="${(vw * 0.09).toFixed(1)}" height="${(sh * 0.95).toFixed(1)}" patternUnits="userSpaceOnUse">
      <text x="1" y="${(sh * 0.72).toFixed(1)}" font-size="${(sh * 0.55).toFixed(1)}" fill="#ffffff">&#9733;</text></pattern>`;
    cant = `<clipPath id="${id}cc"><path d="M0 ${top0} ${topEdge} L${cw} ${(ch + Number(top0)).toFixed(1)} ${botEdge} Z"/></clipPath>
      <g clip-path="url(#${id}cc)">
        <rect x="-2" y="-2" width="${cw + 4}" height="${(ch + amp + 4).toFixed(1)}" fill="${cantonColor}"/>
        <rect x="-2" y="-2" width="${cw + 4}" height="${(ch + amp + 4).toFixed(1)}" fill="url(#${id}st)"/>
      </g>`;
  }
  return `<svg viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="${stretch ? 'none' : 'xMidYMid meet'}" xmlns="http://www.w3.org/2000/svg" style="${style}"><defs>${starPat}</defs>${bands}${cant}</svg>`;
}

function starRow(count, { size, color, gap = 0.4 }) {
  let s = '';
  for (let i = 0; i < count; i++) s += '&#9733;';
  return `<span style="color:${color}; font-size:${px(size)}; letter-spacing:${px(size * gap)};">${s}</span>`;
}

// Shrink a text field when it runs longer than the space allows, so long
// titles / taglines stay inside the flyer instead of spilling past the edge.
// `budget` ≈ how many characters fit on one line at `base` px. Text that can
// wrap gains height as well as width, so it only needs the square-root of the
// reduction; everything is floored so it never shrinks into illegibility.
function fitSize(text, base, budget, { min = 0.5 } = {}) {
  const len = String(text || '').length;
  if (len <= budget) return base;
  return Math.max(base * min, base * Math.sqrt(budget / len));
}

// "RSVP Requested" pill, shown when the event collects RSVPs.
function rsvpBadge(scale, { bg, ink, marginTop = 0 }) {
  return `<div style="margin-top:${px(marginTop * scale)};"><span style="display:inline-block; background:${bg}; color:${ink};
    font-weight:800; font-size:${px(12 * scale)}; letter-spacing:0.12em; text-transform:uppercase;
    padding:${px(6 * scale)} ${px(16 * scale)}; border-radius:999px;">RSVP Requested</span></div>`;
}

// A centred banner for the tagline. `folded` has 3-D end tails tucking behind
// the face; `straight` is a flat bar with flag-notched ends. Both cap their
// width and wrap — a long tagline shrinks and then runs onto a second line
// rather than pushing out past the flyer's edge.
const RIBBON_MAX = 400;

function foldedRibbon(text, { bandColor, ink, dark, scale, font }) {
  if (!text) return '';
  const h = 38 * scale;
  const tw = 22 * scale;
  const drop = 10 * scale;
  const tail = (side) => `<span style="position:absolute; top:${px(drop)}; ${side}:${px(-tw + 4)};
    width:${px(tw)}; height:${px(h)}; background:${dark}; z-index:1;
    clip-path:polygon(${side === 'left' ? '0 0, 100% 0, 100% 100%, 0 100%, 24% 50%' : '0 0, 100% 0, 76% 50%, 100% 100%, 0 100%'});"></span>`;
  const band = `<span style="position:relative; z-index:2; display:inline-block; max-width:${px(RIBBON_MAX * scale)};
    background:${bandColor}; color:${ink}; font-family:${font.heading}; font-weight:800;
    font-size:${px(fitSize(text, 14.5 * scale, 34, { min: 0.62 }))}; letter-spacing:0.08em; line-height:1.3;
    text-transform:uppercase; text-align:center; padding:${px(9 * scale)} ${px(26 * scale)};">${esc(text)}</span>`;
  return `<span style="position:relative; display:inline-block; max-width:100%; margin-top:${px(20 * scale)};">${tail('left')}${tail('right')}${band}</span>`;
}

function straightRibbon(text, { bandColor, ink, scale, font }) {
  if (!text) return '';
  const notch = px(14 * scale);
  return `<span style="display:inline-block; max-width:${px(RIBBON_MAX * scale)}; margin-top:${px(20 * scale)};
    background:${bandColor}; color:${ink}; font-family:${font.heading}; font-weight:800;
    font-size:${px(fitSize(text, 15 * scale, 34, { min: 0.62 }))}; letter-spacing:0.08em; line-height:1.3;
    text-transform:uppercase; text-align:center; padding:${px(10 * scale)} ${px(34 * scale)};
    clip-path:polygon(0 0, 100% 0, calc(100% - ${notch}) 50%, 100% 100%, 0 100%, ${notch} 50%);">${esc(text)}</span>`;
}

// Shared centred date/time/venue/host block used by the white and red
// templates. `ink` is the main colour, `sub` the muted one.
function metaStacked({ event, flyer, hostLine, scale, ink, sub }) {
  const w = whenParts(event);
  const parts = [];
  if (w.date) parts.push(`<div style="font-size:${px(16 * scale)}; font-weight:800; color:${ink};">${esc(w.date)}</div>`);
  if (w.time) parts.push(`<div style="font-size:${px(14 * scale)}; margin-top:3px; color:${sub};">${esc(w.time)}</div>`);
  if (event.venue_name) parts.push(`<div style="font-size:${px(14.5 * scale)}; margin-top:10px; font-weight:700; color:${ink};">${esc(event.venue_name)}</div>`);
  if (flyer.showAddress && event.venue_address) parts.push(`<div style="font-size:${px(13 * scale)}; margin-top:2px; color:${sub};">${esc(event.venue_address)}</div>`);
  if (hostLine) parts.push(`<div style="font-size:${px(11.5 * scale)}; margin-top:14px; text-transform:uppercase; letter-spacing:0.16em; color:${sub};">${esc(hostLine)}</div>`);
  if (flyer.contact) parts.push(`<div style="font-size:${px(12.5 * scale)}; margin-top:8px; color:${sub};">${esc(flyer.contact)}</div>`);
  if (!parts.length) return '';
  return `<div style="margin-top:${px(22 * scale)};">${parts.join('')}</div>`;
}

// The venue/time line shared by the compact templates: venue name and time
// always show; the address is opt-in via the flyer's showAddress toggle.
function venueTimeBits(event, flyer) {
  const w = whenParts(event);
  const venue = flyer.showAddress ? [event.venue_name, event.venue_address].filter(Boolean).join(', ') : event.venue_name;
  return { date: w.date, time: w.time, venue };
}

// --- wide (landscape) helpers ----------------------------------------------

// Tiny line icons for the wide templates' detail rows.
const ICON_PATHS = {
  pin: 'M12 2C8.1 2 5 5.1 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
  phone: 'M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C11.4 21 3 12.6 3 2.9c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.3z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.6V6h-2v7.6l5.2 3.1 1-1.7-4.2-2.4z',
  cal: 'M7 2v2H5.5A2.5 2.5 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5A2.5 2.5 0 0 0 18.5 4H17V2h-2v2H9V2H7zm12 8v9H5v-9h14z',
  arrow: 'M9 5l7 7-7 7',
};

function iconDot(name, { size, bg, ink, border = 'none' }) {
  const s = Math.round(size * 0.56);
  const stroke = name === 'arrow';
  return `<span style="display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;
    width:${px(size)}; height:${px(size)}; border-radius:999px; background:${bg}; border:${border};"><svg viewBox="0 0 24 24"
    width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg"
    fill="${stroke ? 'none' : ink}" ${stroke ? `stroke="${ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"` : ''}
    ><path d="${ICON_PATHS[name]}"/></svg></span>`;
}

// The single featured image of a wide template. It sits in a column that
// stretches to the card's full height, so a tall picture uses every pixel of it
// and a short one is centred in the space instead of being stretched.
function widePhoto(image, { minHeight, fit = 'cover', radius = 0, bg = 'transparent', scale, colors, captionColor }) {
  if (!image) return '';
  const cap = image.caption
    ? `<div style="position:absolute; left:0; right:0; bottom:0; padding:${px(10 * scale)} ${px(14 * scale)};
        background:rgba(6,10,26,0.55); color:${captionColor || '#ffffff'}; font-size:${px(12.5 * scale)};
        line-height:1.35; text-align:center;">${esc(image.caption)}</div>`
    : '';
  return `<div style="position:relative; align-self:stretch; width:100%; min-height:${px(minHeight)}; overflow:hidden;
    background:${bg}; border-radius:${px(radius)};">
    <img src="${esc(image.url)}" alt="" style="position:absolute; top:0; left:0; width:100%; height:100%;
      object-fit:${fit}; object-position:center; display:block;">${cap}</div>`;
}

// "2026-12-25" -> { day: '25', month: 'DEC' } for the Panel template's
// oversized date. Anything unparseable simply drops the block.
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function bigDateParts(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
  const [, m, d] = String(iso).split('-').map(Number);
  return { day: String(d), month: MONTH_ABBR[m - 1] || '' };
}

// --- templates -------------------------------------------------------------

function renderBlue({ event, flyer, colors, font, scale, images, hostLine, hideEventMeta }) {
  const c = colors;
  const w = whenParts(event);
  const vb = venueTimeBits(event, flyer);
  // Waving red stripes across the very top (navy shows between them), matching
  // the White template's crest.
  const flag = wavyStripeFlag({
    vw: 360, vh: 74, stripes: 4, red: c.red, white: c.bg, amp: 7, period: 150, phase: 0, id: 'blf', stretch: true,
    style: 'position:absolute; top:-6px; left:-12px; width:106%; height:98px; z-index:0;',
  });
  const img = featuredImages(images, { scale, colors: c, frame: imageFrame('#ffffff', '#ffffff'), captionColor: 'rgba(255,255,255,0.78)', marginTop: 22 });
  const rsvp = !hideEventMeta && event.rsvp_mode === 'rsvp' ? rsvpBadge(scale, { bg: c.red, ink: '#ffffff', marginTop: 24 }) : '';
  const meta = hideEventMeta ? '' : `
    <div style="margin-top:${px(24 * scale)}; display:flex; justify-content:center; align-items:center; gap:${px(20 * scale)};">
      ${w.date ? `<div style="font-size:${px(16 * scale)}; font-weight:700; letter-spacing:0.03em;">${esc(w.date)}</div>` : ''}
      ${w.date && w.time ? `<div style="width:1px; height:${px(24 * scale)}; background:rgba(255,255,255,0.5);"></div>` : ''}
      ${w.time ? `<div style="font-size:${px(16 * scale)}; font-weight:700;">${esc(w.time)}</div>` : ''}
    </div>
    ${w.date || w.time ? `<div style="height:3px; width:58%; background:${c.red}; margin:${px(14 * scale)} auto 0; border-radius:2px;"></div>` : ''}
    ${vb.venue ? `<div style="font-size:${px(15 * scale)}; font-weight:700; margin-top:${px(14 * scale)}; letter-spacing:0.03em;">${esc(vb.venue)}</div>` : ''}
    ${hostLine ? `<div style="font-size:${px(11.5 * scale)}; margin-top:${px(12 * scale)}; text-transform:uppercase; letter-spacing:0.16em; color:rgba(255,255,255,0.75);">${esc(hostLine)}</div>` : ''}
    ${flyer.contact ? `<div style="font-size:${px(12.5 * scale)}; margin-top:${px(8 * scale)}; color:rgba(255,255,255,0.8);">${esc(flyer.contact)}</div>` : ''}`;
  const inner = `
    <div style="position:relative; overflow:hidden; background:${c.bg}; color:${c.ink};
         font-family:${font.body}; padding:${px(108 * scale)} ${px(34 * scale)} ${px(30 * scale)};">
      ${flag}
      <div style="position:relative; z-index:1; text-align:center;">
        ${flyer.eyebrow ? `<div style="color:${c.red}; font-family:${font.heading}; font-weight:800;
          font-size:${px(fitSize(flyer.eyebrow, 26 * scale, 26))}; letter-spacing:0.04em; text-transform:uppercase;">${esc(flyer.eyebrow)}</div>` : ''}
        <div style="font-family:${font.heading}; font-weight:800; font-size:${px(fitSize(event.title, 54 * scale, 15))}; line-height:1.02;
          text-transform:uppercase; margin-top:${px(6 * scale)};">${esc(event.title || 'Untitled event')}</div>
        ${foldedRibbon(flyer.tagline, { bandColor: c.ribbon, ink: c.ribbonInk, dark: c.ribbonDark, scale, font })}
        ${img}
        ${rsvp}
        ${meta}
        ${flyer.note ? `<div style="margin-top:${px(16 * scale)}; font-size:${px(fitSize(flyer.note, 13 * scale, 60))}; color:rgba(255,255,255,0.8);">${esc(flyer.note)}</div>` : ''}
      </div>
    </div>`;
  return `<div style="background:#ffffff; padding:9px;">
    ${inner}
    <div style="height:13px; background:${c.red}; margin-top:9px; border-radius:2px;"></div>
  </div>`;
}

function renderWhite({ event, flyer, colors, font, scale, images, hostLine, hideEventMeta }) {
  const c = colors;
  const topStripes = wavyStripeFlag({
    vw: 360, vh: 70, stripes: 4, red: c.red, white: c.bg, amp: 7, period: 150, phase: 0, id: 'wht',
    style: 'position:absolute; top:-10px; left:-12px; width:106%; z-index:0;',
  });
  const img = featuredImages(images, { scale, colors: c, frame: imageFrame(c.navy, '#ffffff'), marginTop: 20 });
  const rsvp = !hideEventMeta && event.rsvp_mode === 'rsvp' ? rsvpBadge(scale, { bg: c.navy, ink: '#ffffff', marginTop: 20 }) : '';
  const meta = hideEventMeta ? '' : metaStacked({ event, flyer, hostLine, scale, ink: c.navy, sub: tint(c.navy, 0.7) });
  // Full-width navy line + star closes off the bottom in place of a flag; the
  // negative side margins let it bleed to the card's edges.
  const bottomDivider = hideEventMeta ? '' : `<div style="margin:${px(30 * scale)} ${px(-36 * scale)} 0;">${lineStarDivider({ color: c.navy, bg: c.bg, scale, full: true, marginTop: 0 })}</div>`;
  return `
    <div style="position:relative; overflow:hidden; background:${c.bg}; color:${c.navy};
         font-family:${font.body}; padding:${px(70 * scale)} ${px(36 * scale)} ${px(34 * scale)}; text-align:center;">
      ${topStripes}
      <div style="position:relative; z-index:1;">
        ${flyer.eyebrow ? `<div style="font-family:${font.heading}; font-weight:800; font-size:${px(fitSize(flyer.eyebrow, 30 * scale, 22))};
          text-transform:uppercase; letter-spacing:0.02em;">${esc(flyer.eyebrow)}</div>` : ''}
        <div style="font-family:${font.heading}; font-weight:800; font-size:${px(fitSize(event.title, 48 * scale, 17))}; line-height:1.02;
          text-transform:uppercase; color:${c.red}; margin-top:${px(6 * scale)};">${esc(event.title || 'Untitled event')}</div>
        ${foldedRibbon(flyer.tagline, { bandColor: c.ribbon, ink: c.ribbonInk, dark: c.ribbonDark, scale, font })}
        ${img}
        ${rsvp}
        ${flyer.note ? `<div style="margin-top:${px(18 * scale)}; font-family:${font.heading}; font-weight:800;
          font-size:${px(fitSize(flyer.note, 15 * scale, 40))}; letter-spacing:0.04em; text-transform:uppercase; color:${c.navy};">${esc(flyer.note)}</div>${lineStarDivider({ color: c.red, bg: c.bg, scale, marginTop: 14 })}` : ''}
        ${meta}
        ${bottomDivider}
      </div>
    </div>`;
}

function renderRed({ event, flyer, colors, font, scale, images, hostLine, hideEventMeta }) {
  const c = colors;
  const corner = (pos) => `<span style="position:absolute; ${pos} color:#ffffff; background:${c.bg}; font-size:22px; line-height:1; padding:0 2px;">&#9733;</span>`;
  const eyebrow = flyer.eyebrow ? `<div style="display:flex; align-items:center; justify-content:center; gap:${px(12 * scale)};
      color:#fff; font-family:${font.heading}; font-weight:700; font-size:${px(fitSize(flyer.eyebrow, 17 * scale, 30))};
      letter-spacing:0.14em; text-transform:uppercase;">
      <span style="font-size:${px(12 * scale)};">&#9733;</span>${esc(flyer.eyebrow)}<span style="font-size:${px(12 * scale)};">&#9733;</span></div>` : '';
  const img = featuredImages(images, { scale, colors: c, frame: imageFrame('#ffffff', '#ffffff'), captionColor: 'rgba(255,255,255,0.85)', marginTop: 18 });
  const rsvp = !hideEventMeta && event.rsvp_mode === 'rsvp' ? rsvpBadge(scale, { bg: c.navy, ink: '#ffffff', marginTop: 20 }) : '';
  const rule = `<div style="height:2px; width:70%; background:rgba(255,255,255,0.85); margin:${px(20 * scale)} auto;"></div>`;
  const meta = hideEventMeta ? '' : metaStacked({ event, flyer, hostLine, scale, ink: '#ffffff', sub: 'rgba(255,255,255,0.82)' });
  return `
    <div style="background:${c.bg}; padding:16px;">
      <div style="position:relative; border:2px dashed rgba(255,255,255,0.9); padding:${px(34 * scale)} ${px(26 * scale)} ${px(34 * scale)}; text-align:center;">
        ${corner('top:-11px; left:-11px;')}${corner('top:-11px; right:-11px;')}
        ${corner('bottom:-11px; left:-11px;')}${corner('bottom:-11px; right:-11px;')}
        ${eyebrow}
        <div style="font-family:${font.heading}; font-weight:800; color:#ffffff; font-size:${px(fitSize(event.title, 50 * scale, 16))};
          line-height:1.03; text-transform:uppercase; margin-top:${px(10 * scale)};">${esc(event.title || 'Untitled event')}</div>
        <div style="display:flex; justify-content:center;">${straightRibbon(flyer.tagline, { bandColor: c.ribbon, ink: c.ribbonInk, scale, font })}</div>
        ${img}
        ${rsvp}
        ${flyer.note ? `${rule}<div style="color:#fff; font-family:${font.heading}; font-weight:800; font-size:${px(fitSize(flyer.note, 17 * scale, 34))};
          letter-spacing:0.03em; text-transform:uppercase; line-height:1.3;">${esc(flyer.note)}</div>` : ''}
        ${meta ? `${rule}${meta}` : (flyer.note ? rule : '')}
      </div>
    </div>`;
}

function renderRetro({ event, flyer, colors, font, scale, images, hostLine, hideEventMeta }) {
  const c = colors;
  const hasImg = images.length > 0;
  const presents = hostLine ? `<div style="font-family:${font.heading}; font-weight:700; font-size:${px(13 * scale)};
    letter-spacing:0.22em; text-transform:uppercase; color:${c.parchment};">${esc(hostLine)}</div>` : '';
  const eyebrow = flyer.eyebrow ? `<div style="display:flex; align-items:center; justify-content:center; gap:${px(14 * scale)}; margin-top:${px(16 * scale)};">
    ${starRow(3, { size: 15 * scale, color: c.red, gap: 0.22 })}
    <span style="font-family:${font.heading}; font-weight:800; font-size:${px(18 * scale)}; letter-spacing:0.08em;
      text-transform:uppercase; color:${c.red};">${esc(flyer.eyebrow)}</span>
    ${starRow(3, { size: 15 * scale, color: c.red, gap: 0.22 })}</div>` : '';
  const img = hasImg ? featuredImages(images, { scale, colors: c, frame: imageFrame(c.parchment, '#ffffff'), captionColor: tint(c.parchment, 0.9), marginTop: 18 }) : '';
  const rsvp = !hideEventMeta && event.rsvp_mode === 'rsvp' ? rsvpBadge(scale, { bg: c.red, ink: c.parchment, marginTop: 14 }) : '';
  const topArea = `
    <div style="background:${c.navy}; color:${c.parchment}; text-align:center;
         padding:${px((hasImg ? 30 : 34) * scale)} ${px(30 * scale)} ${px((hasImg ? 28 : 38) * scale)};">
      ${presents}
      ${img}
      ${eyebrow}
      <div style="font-family:${font.heading}; font-weight:800; font-size:${px(fitSize(event.title, 72 * scale, 11))}; line-height:0.98;
        text-transform:uppercase; margin-top:${px(8 * scale)}; color:${c.parchment};">${esc(event.title || 'Untitled event')}</div>
      ${rsvp}
    </div>`;
  // A navy line + star divider, like the White template, sits between the
  // tagline and the footnote.
  const dividerRow = lineStarDivider({ color: c.navy, bg: c.parchment, scale, full: true, marginTop: 0 });
  // Stripes alternate red (parchment text) / parchment (navy text) down the page.
  const stripes = [];
  if (flyer.tagline) stripes.push({ tone: 'red', html: `<div style="font-family:${font.body}; font-size:${px(fitSize(flyer.tagline, 18 * scale, 46, { min: 0.65 }))}; line-height:1.35; color:${c.parchment};">${esc(flyer.tagline)}</div>` });
  if (!hasImg) stripes.push({ tone: 'parch', html: dividerRow });
  if (flyer.note) stripes.push({ tone: 'red', html: `<div style="font-family:${font.body}; font-size:${px(fitSize(flyer.note, 15 * scale, 60, { min: 0.7 }))}; color:${c.parchment}; line-height:1.3;">${esc(flyer.note)}</div>` });
  if (!hideEventMeta) {
    const vb = venueTimeBits(event, flyer);
    const dt = [vb.date, vb.time].filter(Boolean).map((b, i) => `<span style="color:${i % 2 ? c.red : c.navy};">${esc(b)}</span>`).join(`<span style="color:${c.navy}; font-weight:800;"> // </span>`);
    const lines = [];
    if (dt) lines.push(`<div style="font-family:${font.heading}; font-weight:800; font-size:${px(15 * scale)}; letter-spacing:0.02em; text-transform:uppercase;">${dt}</div>`);
    if (vb.venue) lines.push(`<div style="font-family:${font.heading}; font-weight:800; font-size:${px(15 * scale)}; letter-spacing:0.02em; text-transform:uppercase; color:${c.navy}; margin-top:${px(5 * scale)};">${esc(vb.venue)}</div>`);
    if (flyer.contact) lines.push(`<div style="font-family:${font.body}; font-size:${px(13 * scale)}; color:${c.navy}; margin-top:${px(4 * scale)};">${esc(flyer.contact)}</div>`);
    if (lines.length) stripes.push({ tone: 'parch', html: lines.join('') });
  }
  const stripeHtml = stripes.map((s) => `<div style="background:${s.tone === 'red' ? c.red : c.parchment}; text-align:center;
    padding:${px(18 * scale)} ${px(30 * scale)};">${s.html}</div>`).join('');
  return `<div style="font-family:${font.body};">${topArea}${stripeHtml}</div>`;
}

// Wide: a blue gradient running bright-to-midnight left to right, the type on
// the left with the details on a white card, and one tall photo down the right.
function renderSpotlight({ event, flyer, colors, font, scale, images, hostLine, hideEventMeta }) {
  const c = colors;
  const w = whenParts(event);
  const vb = venueTimeBits(event, flyer);
  const photo = images[0]
    ? `<div style="flex:1 1 34%; min-width:230px; box-sizing:border-box; display:flex;">${widePhoto(images[0], {
      minHeight: 280 * scale, fit: 'contain', scale, colors: c })}</div>`
    : '';

  // Detail rows sit on a white card, venue/contact on the left of a hairline
  // rule and the date/time on its right — as many cells as there is content.
  const row = (name, text) => `<div style="display:flex; align-items:center; gap:${px(10 * scale)};">
    ${iconDot(name, { size: 25 * scale, bg: c.accent, ink: '#ffffff' })}
    <span style="font-family:${font.heading}; font-weight:700; color:#16203f; line-height:1.25;
      font-size:${px(fitSize(text, 14 * scale, 24, { min: 0.72 }))};">${esc(text)}</span></div>`;
  const cell = (rows) => `<div style="flex:1 1 auto; min-width:0; display:grid; gap:${px(9 * scale)};">${rows.join('')}</div>`;
  const cells = [];
  if (!hideEventMeta) {
    const place = [];
    if (vb.venue) place.push(row('pin', vb.venue));
    if (flyer.contact) place.push(row('phone', flyer.contact));
    const when = [];
    if (w.date) when.push(row('cal', w.date));
    if (w.time) when.push(row('clock', w.time));
    if (place.length) cells.push(cell(place));
    if (when.length) cells.push(cell(when));
  }
  const card = cells.length
    ? `<div style="display:flex; align-items:stretch; gap:${px(16 * scale)}; background:#ffffff;
        border-radius:${px(10 * scale)}; padding:${px(15 * scale)} ${px(18 * scale)}; margin-top:${px(22 * scale)};">
        ${cells.join(`<div style="width:1px; background:rgba(20,30,70,0.16);"></div>`)}</div>`
    : '';
  const rsvp = !hideEventMeta && event.rsvp_mode === 'rsvp' ? rsvpBadge(scale, { bg: c.accent2, ink: '#101c40', marginTop: 18 }) : '';

  const left = `<div style="flex:1 1 ${photo ? '55%' : '100%'}; min-width:300px; box-sizing:border-box;
      display:flex; flex-direction:column; justify-content:center; padding:${px(40 * scale)} ${px(34 * scale)};">
    ${flyer.eyebrow ? `<div style="display:flex; align-items:center; gap:${px(9 * scale)};">
      <span style="color:${c.accent2}; font-size:${px(15 * scale)}; line-height:1;">&#9733;</span>
      <span style="font-family:${font.heading}; font-weight:700; letter-spacing:0.14em; text-transform:uppercase;
        font-size:${px(fitSize(flyer.eyebrow, 15 * scale, 30, { min: 0.7 }))};">${esc(flyer.eyebrow)}</span></div>` : ''}
    <div style="font-family:${font.heading}; font-weight:800; text-transform:uppercase; line-height:1.0;
      font-size:${px(fitSize(event.title, 54 * scale, 14))}; margin-top:${px(flyer.eyebrow ? 14 : 0)};">${esc(event.title || 'Untitled event')}</div>
    ${flyer.tagline ? `<div style="font-family:${font.heading}; font-weight:800; color:${c.accent2};
      text-transform:uppercase; letter-spacing:0.02em; line-height:1.15; margin-top:${px(8 * scale)};
      font-size:${px(fitSize(flyer.tagline, 26 * scale, 22, { min: 0.5 }))};">${esc(flyer.tagline)}</div>` : ''}
    ${card}
    ${rsvp}
    ${flyer.note ? `<div style="margin-top:${px(16 * scale)}; color:rgba(255,255,255,0.82);
      font-size:${px(fitSize(flyer.note, 13.5 * scale, 66, { min: 0.75 }))}; line-height:1.4;">${esc(flyer.note)}</div>` : ''}
    ${hostLine ? `<div style="margin-top:${px(16 * scale)}; font-style:italic; color:${c.accent2};
      font-size:${px(15 * scale)};">${esc(hostLine)}</div>` : ''}
  </div>`;

  return `<div style="background:${c.bg}; background-image:${c.gradient}; color:${c.ink}; font-family:${font.body};
    display:flex; flex-wrap:wrap; align-items:stretch;">${left}${photo}</div>`;
}

// Wide: a deep navy card — huge headline with outlined badges, the footnote
// broken into pill rows beside an oversized date, and a full-height photo panel.
function renderPanel({ event, flyer, colors, font, scale, images, hostLine, hideEventMeta }) {
  const c = colors;
  const cream = c.ink;
  const soft = tint(cream, 0.62);
  const line = tint(cream, 0.34);
  const w = whenParts(event);
  const vb = venueTimeBits(event, flyer);
  const photo = images[0]
    ? `<div style="flex:1 1 36%; min-width:240px; box-sizing:border-box; display:flex; padding:${px(18 * scale)};">${widePhoto(images[0], {
      minHeight: 300 * scale, fit: 'contain', radius: 6 * scale, scale, colors: c })}</div>`
    : '';

  const badge = (text) => `<div style="width:${px(94 * scale)}; height:${px(94 * scale)}; border-radius:999px;
    border:1px solid ${line}; display:flex; align-items:center; justify-content:center; text-align:center;
    padding:${px(10 * scale)}; font-family:${font.heading}; font-weight:700; text-transform:uppercase;
    letter-spacing:0.05em; line-height:1.25; font-size:${px(fitSize(text, 11.5 * scale, 15, { min: 0.68 }))};">${esc(text)}</div>`;
  const badges = [flyer.eyebrow, hostLine].filter(Boolean).map(badge);

  // The footnote doubles as a bullet list here: split it on · | ; so a couple of
  // short points become their own pill rows, as the template is drawn for.
  const points = String(flyer.note || '').split(/\s*[·•|;]\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const pills = points.map((t) => `<div style="display:flex; align-items:center; gap:${px(12 * scale)};
    border:1px solid ${line}; border-radius:999px; padding:${px(9 * scale)} ${px(16 * scale)};">
    ${iconDot('arrow', { size: 26 * scale, bg: 'transparent', ink: cream, border: `1px solid ${line}` })}
    <span style="font-family:${font.heading}; font-weight:700; text-transform:uppercase; line-height:1.25;
      font-size:${px(fitSize(t, 13 * scale, 34, { min: 0.7 }))};">${esc(t)}</span></div>`);
  const bd = hideEventMeta ? null : bigDateParts(event.date);
  const dateBlock = bd ? `<div style="flex:0 0 auto; text-align:center;">
    <div style="font-family:${font.heading}; font-weight:800; font-size:${px(54 * scale)}; line-height:0.88;">${esc(bd.day)}</div>
    <div style="font-family:${font.heading}; font-weight:800; font-size:${px(30 * scale)}; line-height:1;">${esc(bd.month)}</div>
    ${w.time ? `<div style="font-size:${px(12.5 * scale)}; margin-top:${px(6 * scale)}; color:${soft};">${esc(w.time)}</div>` : ''}
  </div>` : '';
  const midRow = pills.length || dateBlock
    ? `<div style="display:flex; align-items:center; gap:${px(20 * scale)}; margin-top:${px(22 * scale)};">
        ${pills.length ? `<div style="flex:1 1 auto; min-width:0; display:grid; gap:${px(10 * scale)};">${pills.join('')}</div>` : '<div style="flex:1 1 auto;"></div>'}
        ${dateBlock}</div>`
    : '';
  const rsvp = !hideEventMeta && event.rsvp_mode === 'rsvp' ? rsvpBadge(scale, { bg: c.accent2, ink: c.navy, marginTop: 18 }) : '';
  const footBits = [flyer.contact, vb.venue].filter(Boolean);
  const foot = !hideEventMeta && footBits.length
    ? `<div style="display:flex; flex-wrap:wrap; justify-content:space-between; gap:${px(12 * scale)};
        margin-top:${px(24 * scale)}; padding-top:${px(14 * scale)}; border-top:1px solid ${line};
        font-family:${font.heading}; font-weight:700; text-transform:uppercase; letter-spacing:0.03em;
        font-size:${px(12.5 * scale)}; color:${soft};">${footBits.map((b) => `<span>${esc(b)}</span>`).join('')}</div>`
    : '';

  const left = `<div style="flex:1 1 ${photo ? '54%' : '100%'}; min-width:300px; box-sizing:border-box;
      display:flex; flex-direction:column; justify-content:center; padding:${px(34 * scale)} ${px(32 * scale)};">
    <div style="display:flex; align-items:flex-start; gap:${px(16 * scale)};">
      <div style="flex:1 1 auto; min-width:0; font-family:${font.heading}; font-weight:800; text-transform:uppercase;
        line-height:0.95; font-size:${px(fitSize(event.title, 58 * scale, 12))};">${esc(event.title || 'Untitled event')}</div>
      ${badges.length ? `<div style="flex:0 0 auto; display:flex; flex-direction:column; gap:${px(10 * scale)};">${badges.join('')}</div>` : ''}
    </div>
    ${flyer.tagline ? `<div style="margin-top:${px(18 * scale)}; font-family:${font.heading}; font-weight:700;
      text-transform:uppercase; line-height:1.35; color:${tint(cream, 0.9)};
      font-size:${px(fitSize(flyer.tagline, 16 * scale, 74, { min: 0.72 }))};">${esc(flyer.tagline)}</div>` : ''}
    ${midRow}
    ${rsvp}
    ${foot}
  </div>`;

  return `<div style="background:${c.bg}; color:${cream}; font-family:${font.body};
    display:flex; flex-wrap:wrap; align-items:stretch;">${left}${photo}</div>`;
}

const RENDERERS = {
  blue: renderBlue, white: renderWhite, red: renderRed, retro: renderRetro,
  spotlight: renderSpotlight, panel: renderPanel,
};

// hideEventMeta drops the date/time/venue/host block so the same styles power
// a broadcast "masthead" (title + eyebrow + tagline + image), which has no
// event fields to show.
// `snapshot` renders the card for the designer's picture-of-the-flyer capture:
// a plain rectangle at a fixed width, with no page breakout, rounded corners or
// shadow — those only make sense against a page, not inside a JPEG.
export function renderFlyer({ event, flyer: rawFlyer, imageUrl = '', imageUrls = null, hideEventMeta = false, snapshot = false }) {
  const flyer = normalizeFlyer(rawFlyer);
  const colors = flyerColors(flyer);
  const font = fontOf(flyer);
  const scale = scaleOf(flyer);
  const hostLine = !hideEventMeta && flyer.showHost && event.host_name ? `Hosted by ${event.host_name}` : '';
  // Callers pass imageUrls aligned to flyer.imageTokens (or a single legacy
  // imageUrl). Drop empty slots and pair each surviving URL with its caption.
  const resolved = Array.isArray(imageUrls) ? imageUrls : (imageUrl ? [imageUrl] : []);
  const images = [];
  resolved.forEach((u, i) => { if (u) images.push({ url: String(u), caption: flyer.imageCaptions[i] || '' }); });
  const inner = (RENDERERS[flyer.style] || renderBlue)({ event, flyer, colors, font, scale, images, hostLine, hideEventMeta });
  // The wide templates need more room than the 640px portrait card, and more
  // than the public page's text column: they break out of it and centre on the
  // viewport instead. On a phone the card simply fills the screen and its two
  // columns stack.
  const wide = isLandscape(flyer.style);
  let box;
  if (snapshot) box = `width:100%; max-width:${wide ? SNAPSHOT_WIDE : SNAPSHOT_WIDTH}px; margin:0 auto;`;
  else if (wide) box = 'width:min(920px, calc(100vw - 32px)); margin-left:50%; transform:translateX(-50%);';
  else box = 'max-width:640px; margin:0 auto;';
  const chrome = snapshot
    ? ''
    : 'border-radius:12px; box-shadow:0 2px 8px rgba(10,10,15,0.12), 0 12px 40px rgba(10,10,15,0.12);';
  // overflow-wrap is inherited, so one declaration here keeps a single very
  // long word (a URL, say) inside every template.
  return `<div style="${box} overflow:hidden; overflow-wrap:break-word; ${chrome}">${inner}</div>`;
}

// How wide the picture-of-the-flyer capture is laid out before rasterizing.
// Portrait matches the card; wide matches its broken-out width.
export const SNAPSHOT_WIDTH = 640;
export const SNAPSHOT_WIDE = 920;

export function snapshotWidth(flyer) {
  return isLandscape(normalizeFlyer(flyer).style) ? SNAPSHOT_WIDE : SNAPSHOT_WIDTH;
}

// Standalone document for the designer's live preview iframe. In `snapshot`
// mode the page furniture goes away so the document is exactly the flyer,
// ready to be drawn onto a canvas.
export function renderFlyerDocument({ event, flyer, imageUrl, imageUrls, hideEventMeta = false, snapshot = false }) {
  const colors = flyerColors(normalizeFlyer(flyer));
  const html = renderFlyer({ event, flyer, imageUrl, imageUrls, hideEventMeta, snapshot });
  const body = snapshot
    ? 'margin:0; padding:0; background:#ffffff; color-scheme: light;'
    : `margin:0; padding:22px 10px; background:${mixWithWhite(colors.ink, 0.07)}; color-scheme: light;`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>*, *::before, *::after { box-sizing: border-box; }
body { ${body} }</style>
</head><body>${html}</body></html>`;
}

export function flyerPresets() {
  return {
    styles: STYLES,
    fonts: FONTS.map(({ id, label }) => ({ id, label })),
    scales: SCALES.map(({ id, label }) => ({ id, label })),
    defaults: DEFAULT_FLYER,
  };
}
