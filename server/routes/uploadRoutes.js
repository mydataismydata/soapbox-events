import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { uploadsDir, insertId } from '../lib/db.js';
import { wrap, v, ApiError } from '../lib/validate.js';
import { randomToken } from '../lib/tokens.js';
import { publicUrl } from '../lib/sending.js';
import { sniffImage, storeImage } from '../lib/images.js';
import { sniffAttachment, attachmentFilename } from '../lib/attachments.js';
import { fetchRemoteImage, RemoteImageError } from '../lib/remoteImage.js';
import { take } from '../lib/ratelimit.js';

export const uploadRouter = Router();

const MAX_BYTES = 5 * 1024 * 1024;

// Files are uploaded as data URLs in a JSON body (keeps the dependency
// footprint at zero); 5 MB decoded cap. Pictures are the default. `kind:
// 'attachment'` is a broadcast's attached file, which may also be a PDF or
// an Office document. The claimed type in the data URL is ignored either
// way: the bytes decide, and a browser that knows no type sends none.
uploadRouter.post('/uploads', wrap(async (req, res) => {
  const name = v.optStr(req.body.name, { label: 'File name', max: 300 });
  const dataUrl = v.str(req.body.data, { label: 'File data', max: 8_000_000 });
  const attachment = req.body.kind === 'attachment';
  const match = /^data:([\w/+.-]*);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new ApiError(400, 'Expected a base64 data URL.');
  let buf;
  try {
    buf = Buffer.from(match[2], 'base64');
  } catch {
    throw new ApiError(400, 'Could not decode the file.');
  }
  if (buf.length === 0) throw new ApiError(400, 'The file is empty.');
  if (buf.length > MAX_BYTES) {
    throw new ApiError(400, attachment ? 'Attachments must be 5 MB or smaller.' : 'Images must be 5 MB or smaller.');
  }
  let mime;
  let storedName = name || null;
  if (attachment) {
    const found = sniffAttachment(buf);
    if (!found) {
      throw new ApiError(400, 'Attach a PDF, a Word, Excel or PowerPoint file, or a picture. Office files with macros are not accepted.');
    }
    mime = found.mime;
    storedName = attachmentFilename(name, found.ext);
  } else {
    mime = sniffImage(buf);
    if (!mime) throw new ApiError(400, 'Only JPEG, PNG, GIF, and WebP images are supported.');
  }

  // `replace` overwrites an existing upload in place, keeping its token and
  // URL. The flyer designer re-renders its picture-of-the-flyer every time the
  // design changes, and this stops each re-render leaving a stale file behind.
  const replace = attachment ? '' : String(req.body.replace || '');
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
      .run(storedName, mime, buf.length, existing.id);
  } else {
    id = insertId(req.db.prepare(
      'INSERT INTO uploads (token, original_name, mime, bytes) VALUES (?, ?, ?, ?)'
    ).run(token, storedName, mime, buf.length));
  }
  res.status(201).json({
    id,
    token,
    url: publicUrl(req.org.slug, `/files/${token}`),
    name: storedName || '',
    bytes: buf.length,
    mime,
  });
}));

// Copy a picture in from another website, by its address. Text pasted into
// the flyer's text block brings its pictures as addresses; each one becomes
// an ordinary upload, so the flyer only ever shows pictures kept here.
uploadRouter.post('/uploads/remote', wrap(async (req, res) => {
  const url = v.str(req.body.url, { label: 'Picture address', max: 4000 });
  if (!take(`remote-image:${req.org.slug}`, 120, 10 * 60 * 1000)) {
    throw new ApiError(429, 'Too many pictures copied at once. Wait a few minutes and paste again.');
  }
  let got;
  try {
    got = await fetchRemoteImage(url);
  } catch (err) {
    throw new ApiError(400, err instanceof RemoteImageError ? err.message : 'The picture could not be fetched.');
  }
  const name = (() => {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').slice(0, 300); } catch { return ''; }
  })();
  const token = storeImage(req.db, req.org.slug, got.buf, got.mime, name);
  res.status(201).json({ token, url: publicUrl(req.org.slug, `/files/${token}`), mime: got.mime, bytes: got.buf.length });
}));
