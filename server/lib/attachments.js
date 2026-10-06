// A file attached to a broadcast's emails.
//
// A broadcast can carry one file, such as a PDF agenda, that goes out with
// every email it sends. It is uploaded once, kept with the other uploads, and
// read from disk each time an email is handed to SMTP2GO.
//
// What may be attached is decided by the file's contents, never by its name
// or the type the browser claims: a PDF, a Word, Excel or PowerPoint file, or
// a picture. Office files carrying macros are refused, and so is everything
// else, so a stolen login cannot turn a mailing list into a way to deliver a
// program.
import fs from 'node:fs';
import path from 'node:path';
import { uploadsDir } from './db.js';
import { sniffImage } from './images.js';

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

const PDF = 'application/pdf';
const OFFICE = [
  { folder: 'word/', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { folder: 'xl/', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { folder: 'ppt/', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
];
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

const ATTACHABLE = new Set([PDF, ...OFFICE.map((o) => o.mime), ...Object.keys(IMAGE_EXT)]);

// The names inside a zip, read from its central directory, or null when the
// bytes are not a zip this can read. Office files are zips, and the names
// say both which program made one and whether it carries macros.
export function zipEntries(buf) {
  if (buf.length < 22) return null;
  // The end-of-directory record is the last 22 bytes, or sits up to 64 KB
  // further back when the zip ends with a comment.
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  let end = -1;
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const names = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return null;
    const nameLength = buf.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    if (at + 46 + nameLength > buf.length) return null;
    names.push(buf.toString('utf8', at + 46, at + 46 + nameLength));
    at = next;
  }
  return names;
}

/** What a file is, judged by its bytes: { mime, ext }, or null when it may not be attached. */
export function sniffAttachment(buf) {
  if (!buf?.length) return null;
  // A PDF may have a few bytes of junk before its header.
  if (buf.subarray(0, 1024).includes('%PDF-')) return { mime: PDF, ext: 'pdf' };
  const image = sniffImage(buf);
  if (image) return { mime: image, ext: IMAGE_EXT[image] };
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const names = zipEntries(buf);
    if (!names || !names.includes('[Content_Types].xml')) return null;
    // Macros live in vbaProject.bin, and ActiveX controls in their own folder.
    if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n) || /(^|\/)activeX\//i.test(n))) return null;
    const office = OFFICE.find((o) => names.some((n) => n.startsWith(o.folder)));
    return office ? { mime: office.mime, ext: office.ext } : null;
  }
  return null;
}

// The name the file goes out under. It keeps what the person called it,
// minus anything that would break an email header or a file system, and it
// always ends in the extension the contents call for.
const KNOWN_EXT = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp)$/i;

export function attachmentFilename(original, ext) {
  let name = String(original || '').split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const own = /\.([A-Za-z0-9]+)$/.exec(name);
  const fits = own && (own[1].toLowerCase() === ext || (ext === 'jpg' && own[1].toLowerCase() === 'jpeg'));
  if (fits) {
    const stem = name.slice(0, -own[0].length).trim().slice(0, 100) || 'attachment';
    return `${stem}.${own[1]}`;
  }
  name = name.replace(KNOWN_EXT, '').replace(/[. ]+$/, '');
  return `${name.slice(0, 100).trim() || 'attachment'}.${ext}`;
}

/** The upload behind a token, when it is something that may be attached. */
export function attachmentRow(db, token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9]{6,64}$/.test(t)) return null;
  const row = db.prepare('SELECT * FROM uploads WHERE token = ?').get(t);
  return row && ATTACHABLE.has(row.mime) ? row : null;
}

/** What the wizard and the broadcast page show about an attachment. */
export function attachmentInfo(db, token) {
  const row = attachmentRow(db, token);
  return row ? { token: row.token, name: row.original_name || 'attachment', bytes: row.bytes, mime: row.mime } : null;
}

const GONE = 'The attached file is missing. Remove it from the broadcast, or attach it again.';

/** Why an attachment cannot go out, or '' when it can. Checked before anything is queued. */
export function attachmentProblem(db, orgSlug, token) {
  if (!token) return '';
  const row = attachmentRow(db, token);
  return row && fs.existsSync(path.join(uploadsDir(orgSlug), row.token)) ? '' : GONE;
}

/**
 * The `attachments` list sendEmail() takes for one email, read from disk:
 * { files: [] } when there is no attachment, { files: [file] } when there is.
 *
 * Returns { error } when the file has gone, so the email fails with a reason
 * rather than going out without the file it was sent to deliver.
 */
export function attachmentsFor(db, orgSlug, token) {
  if (!token) return { files: [] };
  const row = attachmentRow(db, token);
  if (!row) return { error: GONE };
  try {
    const buf = fs.readFileSync(path.join(uploadsDir(orgSlug), row.token));
    return { files: [{ filename: row.original_name || 'attachment', mimetype: row.mime, fileblob: buf.toString('base64') }] };
  } catch {
    return { error: GONE };
  }
}

/**
 * The Content-Disposition for serving an attachment, so a browser saves it
 * under its own name instead of opening it on this site's address.
 */
export function downloadDisposition(name) {
  const safe = String(name || 'attachment');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
