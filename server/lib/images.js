import fs from 'node:fs';
import path from 'node:path';
import { uploadsDir, insertId } from './db.js';
import { randomToken } from './tokens.js';

// Magic-byte sniffing: the claimed mime type is ignored; the actual file
// signature decides. Only common web image formats are accepted.
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// Keep a picture as a new upload and return its token. The caller has
// already checked it with sniffImage.
export function storeImage(db, orgSlug, buf, mime, name = '') {
  const token = randomToken(28);
  const dir = uploadsDir(orgSlug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, token), buf);
  insertId(db.prepare(
    'INSERT INTO uploads (token, original_name, mime, bytes) VALUES (?, ?, ?, ?)'
  ).run(token, name || null, mime, buf.length));
  return token;
}
