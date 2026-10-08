// Trim a plain white or black border off a picture before it becomes a flyer's
// background. A strip like that, left by a scan or an editor, is invisible on
// its own but shows as a hard line where the photo templates fade the picture
// out. Only rows and columns that are flat white or flat black all the way
// across are cut, and never more than a fifth of the picture from any side,
// so a photo's own pale sky or dark shadow stays.

const SCAN = 600; // the edges are found on a copy this size, then cut at full size
const MOST = 0.2; // the most that is trimmed from any one side
const STRAY = 0.01; // the share of pixels in a row that may stray from flat

function load(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That picture could not be read.'));
    img.src = url;
  });
}

// A pixel's tone: 'w' for near white, 'k' for near black, '' for anything else.
function tone(d, i) {
  const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
  if (d[i + 3] < 250) return '';
  if (r >= 244 && g >= 244 && b >= 244) return 'w';
  if (r <= 12 && g <= 12 && b <= 12) return 'k';
  return '';
}

// How many of a side's lines are flat, counting in from the edge. `pixel(line,
// k)` is the index of the k-th pixel along that line.
function flatLines(d, lines, length, pixel) {
  const want = tone(d, pixel(0, Math.floor(length / 2)));
  if (!want) return 0;
  const allowed = Math.floor(length * STRAY);
  let n = 0;
  for (; n < Math.floor(lines * MOST); n++) {
    let off = 0;
    for (let k = 0; k < length && off <= allowed; k++) if (tone(d, pixel(n, k)) !== want) off++;
    if (off > allowed) break;
  }
  return n;
}

// A data URL of `file` with its plain edges cut away, or null when it has none
// (or can't be read here), in which case the file goes up as it is.
export async function trimPlainEdges(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return null;
    const k = Math.min(1, SCAN / Math.max(W, H));
    const w = Math.max(1, Math.round(W * k));
    const h = Math.max(1, Math.round(H * k));
    const scan = document.createElement('canvas');
    scan.width = w;
    scan.height = h;
    const sx = scan.getContext('2d', { willReadFrequently: true });
    sx.drawImage(img, 0, 0, w, h);
    const d = sx.getImageData(0, 0, w, h).data;
    const at = (x, y) => (y * w + x) * 4;
    const cut = {
      top: flatLines(d, h, w, (n, i) => at(i, n)),
      bottom: flatLines(d, h, w, (n, i) => at(i, h - 1 - n)),
      left: flatLines(d, w, h, (n, i) => at(n, i)),
      right: flatLines(d, w, h, (n, i) => at(w - 1 - n, i)),
    };
    if (!cut.top && !cut.bottom && !cut.left && !cut.right) return null;
    // Back to full size, and one line further in, so the soft edge a JPEG
    // leaves next to the strip goes with it.
    const full = (n) => (n ? Math.ceil((n + 1) / k) : 0);
    const x0 = full(cut.left);
    const y0 = full(cut.top);
    const x1 = W - full(cut.right);
    const y1 = H - full(cut.bottom);
    if (x1 - x0 < W / 2 || y1 - y0 < H / 2) return null;
    const out = document.createElement('canvas');
    out.width = x1 - x0;
    out.height = y1 - y0;
    out.getContext('2d').drawImage(img, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    // A PNG stays a PNG while that fits the 5 MB limit; anything else is a photo.
    if (file.type === 'image/png') {
      const png = out.toDataURL('image/png');
      if (png.length < 6_500_000) return png;
    }
    return out.toDataURL('image/jpeg', 0.92);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
