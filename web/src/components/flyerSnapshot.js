// Turn the rendered flyer into a JPEG, in the browser.
//
// The flyer is HTML + inline SVG, so there is nothing to rasterize it with on
// the server without pulling in a headless browser. Instead the page draws it
// itself: the flyer document is laid out in an off-screen iframe, its markup is
// wrapped in an SVG <foreignObject>, and that SVG is painted onto a canvas.
//
// Two rules make this work: an SVG used as an image cannot load anything from
// the network, so every <img> has to be inlined as a data URL first; and no
// outside stylesheet applies, so the box-sizing reset has to travel with the
// markup.

const RESET = '<style>*, *::before, *::after { box-sizing: border-box; }</style>';
// Room for the widest template. Narrower ones cap themselves well below this.
const LAYOUT_WIDTH = 920;
// Cap the pixel width so a wide flyer at 2x doesn't produce a needlessly large
// picture; 2x keeps text crisp on high-density screens.
const MAX_PIXEL_WIDTH = 1400;

function dataUrlFor(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function inlineImages(root) {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    const res = await fetch(src, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Could not read the flyer image (${res.status})`);
    img.setAttribute('src', await dataUrlFor(await res.blob()));
  }));
}

function openFrame(srcdoc, width) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  Object.assign(frame.style, {
    position: 'fixed', left: '-10000px', top: '0', border: '0',
    width: `${width}px`, height: '100px', opacity: '0', pointerEvents: 'none',
  });
  document.body.appendChild(frame);
  frame.srcdoc = srcdoc; // only takes effect once the frame is in the document
  return frame;
}

// Wait for the flyer to actually be in the frame, then give the browser one
// frame to lay it out. The `load` event is no help here: it fires for the
// about:blank document the iframe starts on, before srcdoc has been parsed,
// and contentDocument is replaced when it is — so poll for real content.
function frameReady(frame, timeoutMs = 5000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const doc = frame.contentDocument;
      if (doc && doc.body && doc.body.children.length) {
        // A plain timeout, not requestAnimationFrame: a background tab stops
        // painting, and rAF with it, which would stall the capture forever.
        setTimeout(() => resolve(doc), 0);
        return;
      }
      if (performance.now() - started > timeoutMs) { reject(new Error('The flyer did not render.')); return; }
      setTimeout(tick, 25);
    };
    tick();
  });
}

// Wait for the featured images inside the frame, so the capture isn't taken
// against half-loaded artwork.
function imagesSettled(doc) {
  const pending = [...doc.images].filter((im) => !im.complete);
  if (!pending.length) return Promise.resolve();
  return Promise.all(pending.map((im) => new Promise((resolve) => {
    im.addEventListener('load', resolve, { once: true });
    im.addEventListener('error', resolve, { once: true });
  })));
}

function loadImage(src, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const done = setTimeout(() => reject(new Error('The flyer image timed out.')), timeoutMs);
    img.onload = () => { clearTimeout(done); resolve(img); };
    img.onerror = () => { clearTimeout(done); reject(new Error('The flyer image could not be drawn.')); };
    img.src = src;
  });
}

// Render `srcdoc` (a snapshot-mode flyer document) to a JPEG data URL. The
// frame is laid out at the widest a flyer can be; each template caps itself
// below that, so measuring the card is what decides the picture's size.
export async function flyerToJpeg(srcdoc) {
  const frame = openFrame(srcdoc, LAYOUT_WIDTH);
  try {
    const doc = await frameReady(frame);
    await imagesSettled(doc);
    const card = doc.body.firstElementChild;
    const box = card.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.ceil(box.height);
    if (!width || !height) throw new Error('The flyer has not rendered yet.');

    const holder = doc.createElement('div');
    holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    holder.setAttribute('style', `width:${width}px; background:#ffffff;`);
    holder.innerHTML = RESET;
    holder.appendChild(card.cloneNode(true));
    await inlineImages(holder);

    // XMLSerializer, not innerHTML: <foreignObject> content is parsed as XML,
    // so void elements have to come out self-closed.
    const markup = new XMLSerializer().serializeToString(holder);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;

    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

    const ratio = Math.min(2, MAX_PIXEL_WIDTH / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    // JPEG has no transparency; paint the page white first so any gap in the
    // design comes out white rather than black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    frame.remove();
  }
}
