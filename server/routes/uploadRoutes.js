import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { uploadsDir, insertId } from '../lib/db.js';
import { wrap, v, ApiError } from '../lib/validate.js';
import { randomToken } from '../lib/tokens.js';
import { publicUrl } from '../lib/sending.js';

export const uploadRouter = Router();

const MAX_BYTES = 5 * 1024 * 1024;

// Magic-byte sniffing: the claimed mime type is ignored; the actual file
// signature decides. Only common web image formats are accepted.
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// Images are uploaded as data URLs in a JSON body (keeps the dependency
// footprint at zero); 5 MB decoded cap.
uploadRouter.post('/uploads', wrap(async (req, res) => {
  const name = v.optStr(req.body.name, { label: 'File name', max: 300 });
  const dataUrl = v.str(req.body.data, { label: 'File data', max: 8_000_000 });
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new ApiError(400, 'Expected a base64 data URL.');
  let buf;
  try {
    buf = Buffer.from(match[2], 'base64');
  } catch {
    throw new ApiError(400, 'Could not decode the file.');
  }
  if (buf.length === 0) throw new ApiError(400, 'The file is empty.');
  if (buf.length > MAX_BYTES) throw new ApiError(400, 'Images must be 5 MB or smaller.');
  const mime = sniffImage(buf);
  if (!mime) throw new ApiError(400, 'Only JPEG, PNG, GIF, and WebP images are supported.');

  // `replace` overwrites an existing upload in place, keeping its token and
  // URL. The flyer designer re-renders its picture-of-the-flyer every time the
  // design changes, and this stops each re-render leaving a stale file behind.
  const replace = String(req.body.replace || '');
  const existing = /^[A-Za-z0-9]{6,64}$/.test(replace)
    ? req.db.prepare('SELECT * FROM uploads WHERE token = ?').get(replace)
    : null;

  const token = existing ? existing.token : randomToken(28);
  const dir = uploadsDir(req.org.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, token), buf);
  let id = existing ? existing.id : 0;
  if (existing) {
    req.db.prepare('UPDATE uploads SET original_name = ?, mime = ?, bytes = ? WHERE id = ?')
      .run(name || null, mime, buf.length, existing.id);
  } else {
    id = insertId(req.db.prepare(
      'INSERT INTO uploads (token, original_name, mime, bytes) VALUES (?, ?, ?, ?)'
    ).run(token, name || null, mime, buf.length));
  }
  res.status(201).json({
    id,
    token,
    url: publicUrl(req.org.slug, `/files/${token}`),
    bytes: buf.length,
    mime,
  });
}));
