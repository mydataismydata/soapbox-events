// Standalone broadcasts: email blasts not tied to an event. They reuse the
// flyer designer, templates, merge tags and the email queue, but have no
// RSVP or guest tracking — the email_log rows are the per-recipient record.
import { Router } from 'express';
import { insertId, withTx, getSetting } from '../lib/db.js';
import { wrap, v, ApiError } from '../lib/validate.js';
import { randomSlug } from '../lib/tokens.js';
import { normalizeFlyer } from '../lib/flyer.js';
import { broadcastStats } from '../lib/stats.js';
import { orgApiKey, senderFor, sendEmail } from '../lib/email.js';
import {
  parseFlyer, publicUrl, resolveRecipients, queueBroadcastEmails,
  renderBroadcastEmailFor, broadcastViewUrl,
} from '../lib/sending.js';

export const broadcastRouter = Router();

function getBroadcast(db, id) {
  const b = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(v.int(id, { label: 'broadcast id', min: 1 }));
  if (!b) throw new ApiError(404, 'Broadcast not found.');
  return b;
}

function sanitizeAudience(a) {
  const o = a && typeof a === 'object' ? a : {};
  const ints = (arr) => (Array.isArray(arr)
    ? [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 0))].slice(0, 20000) : []);
  const news = Array.isArray(o.new_contacts)
    ? o.new_contacts.slice(0, 2000)
      .map((n) => ({ name: String(n?.name || '').slice(0, 200), email: String(n?.email || '').slice(0, 254) }))
      .filter((n) => n.name.trim())
    : [];
  return { contact_ids: ints(o.contact_ids), group_ids: ints(o.group_ids), new_contacts: news };
}

function parseAudience(b) {
  try {
    const a = JSON.parse(b.audience || '{}');
    return { contact_ids: a.contact_ids || [], group_ids: a.group_ids || [], new_contacts: a.new_contacts || [] };
  } catch {
    return { contact_ids: [], group_ids: [], new_contacts: [] };
  }
}

const BROADCAST_FIELDS = {
  title: (x) => v.str(x, { label: 'Title', max: 200 }),
  subject: (x) => v.optStr(x, { label: 'Subject', max: 300 }),
  body: (x) => v.optStr(x, { label: 'Message', max: 60000 }),
  web_version: (x) => (v.bool(x, true) ? 1 : 0),
  flyer: (x) => JSON.stringify(normalizeFlyer(x)),
  audience: (x) => JSON.stringify(sanitizeAudience(x)),
};

function pickBroadcastFields(body) {
  const out = {};
  for (const [key, validate] of Object.entries(BROADCAST_FIELDS)) {
    if (body[key] !== undefined) out[key] = validate(body[key]);
  }
  return out;
}

function serializeBroadcast(req, b) {
  return {
    ...b,
    flyer: parseFlyer(b),
    audience: parseAudience(b),
    web_version: Boolean(b.web_version),
    share_url: publicUrl(req.org.slug, `/b/${b.slug}`),
    stats: broadcastStats(req.db, b.id),
  };
}

// --- CRUD ------------------------------------------------------------------

broadcastRouter.get('/broadcasts', wrap(async (req, res) => {
  const rows = req.db.prepare(
    'SELECT * FROM broadcasts ORDER BY COALESCE(sent_at, updated_at) DESC, id DESC'
  ).all();
  res.json({ broadcasts: rows.map((b) => serializeBroadcast(req, b)) });
}));

broadcastRouter.post('/broadcasts', wrap(async (req, res) => {
  const fields = pickBroadcastFields(req.body);
  if (!fields.title) throw new ApiError(400, 'Title is required.');
  if (fields.flyer === undefined) fields.flyer = JSON.stringify(normalizeFlyer({}));
  const keys = Object.keys(fields);
  const info = req.db.prepare(
    `INSERT INTO broadcasts (slug, created_by, ${keys.join(', ')})
     VALUES (?, ?, ${keys.map(() => '?').join(', ')})`
  ).run(randomSlug(10), req.user.id, ...keys.map((k) => fields[k]));
  const b = req.db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(insertId(info));
  res.status(201).json({ broadcast: serializeBroadcast(req, b) });
}));

broadcastRouter.get('/broadcasts/:id', wrap(async (req, res) => {
  res.json({ broadcast: serializeBroadcast(req, getBroadcast(req.db, req.params.id)) });
}));

broadcastRouter.put('/broadcasts/:id', wrap(async (req, res) => {
  const b = getBroadcast(req.db, req.params.id);
  const fields = pickBroadcastFields(req.body);
  if (Object.keys(fields).length === 0) return res.json({ broadcast: serializeBroadcast(req, b) });
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  req.db.prepare(`UPDATE broadcasts SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...Object.keys(fields).map((k) => fields[k]), b.id);
  res.json({ broadcast: serializeBroadcast(req, req.db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(b.id)) });
}));

broadcastRouter.delete('/broadcasts/:id', wrap(async (req, res) => {
  const b = getBroadcast(req.db, req.params.id);
  req.db.prepare('DELETE FROM broadcasts WHERE id = ?').run(b.id);
  res.json({ ok: true });
}));

broadcastRouter.post('/broadcasts/:id/duplicate', wrap(async (req, res) => {
  const b = getBroadcast(req.db, req.params.id);
  const copyKeys = ['subject', 'body', 'flyer', 'audience', 'web_version'];
  const info = req.db.prepare(
    `INSERT INTO broadcasts (slug, title, status, created_by, ${copyKeys.join(', ')})
     VALUES (?, ?, 'draft', ?, ${copyKeys.map(() => '?').join(', ')})`
  ).run(randomSlug(10), `Copy of ${b.title}`.slice(0, 200), req.user.id, ...copyKeys.map((k) => b[k]));
  const copy = req.db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(insertId(info));
  res.status(201).json({ broadcast: serializeBroadcast(req, copy) });
}));

// --- preview / test / send -------------------------------------------------

broadcastRouter.post('/broadcasts/:id/email-preview', wrap(async (req, res) => {
  const b = getBroadcast(req.db, req.params.id);
  const subject = req.body.subject !== undefined && String(req.body.subject).trim() !== ''
    ? v.str(req.body.subject, { label: 'Subject', max: 300 }) : (b.subject || b.title);
  const body = req.body.body !== undefined && String(req.body.body).trim() !== ''
    ? v.str(req.body.body, { label: 'Body', max: 60000 }) : (b.body || '');
  const viewUrl = b.web_version ? broadcastViewUrl(req.org.slug, b) : '';
  const msg = renderBroadcastEmailFor({
    org: req.org, broadcast: b, recipient: { name: 'Alex Rivera', email: 'alex@example.com' },
    subjectTemplate: subject, bodyTemplate: body, viewUrl, unsubUrl: viewUrl || '#',
  });
  res.json({ subject: msg.subject, html: msg.html, to: 'alex@example.com' });
}));

broadcastRouter.post('/broadcasts/:id/test-email', wrap(async (req, res) => {
  const b = getBroadcast(req.db, req.params.id);
  const to = req.body.to ? v.email(req.body.to, { label: 'Recipient' }) : req.user.email;
  const viewUrl = b.web_version ? broadcastViewUrl(req.org.slug, b) : '';
  const msg = renderBroadcastEmailFor({
    org: req.org, broadcast: b, recipient: { name: req.user.name, email: to },
    subjectTemplate: `[Test] ${b.subject || b.title}`, bodyTemplate: b.body || '', viewUrl, unsubUrl: '',
  });
  const { sender, replyTo } = senderFor(req.db, req.org.name, 'broadcast');
  const result = await sendEmail({
    apiKey: orgApiKey(req.db),
    sender,
    replyTo,
    toName: req.user.name, toEmail: to, subject: msg.subject, html: msg.html, text: msg.text,
  });
  const status = result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed';
  // Logged with kind='test' so it shows in the broadcast log but is excluded
  // from the recipient count.
  req.db.prepare(
    `INSERT INTO email_log (broadcast_id, kind, to_name, to_email, subject, html, body_text, status, error, sent_at)
     VALUES (?, 'test', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(b.id, req.user.name, to, msg.subject, msg.html, msg.text, status, result.error || null);
  if (!result.ok) throw new ApiError(502, `Test email failed: ${result.error}`);
  res.json({ status });
}));

broadcastRouter.post('/broadcasts/:id/send', wrap(async (req, res) => {
  const b = getBroadcast(req.db, req.params.id);
  if (!b.title) throw new ApiError(400, 'Give the broadcast a title before sending.');

  // Prefer the selection posted by the wizard; fall back to the saved audience.
  const stored = parseAudience(b);
  const sel = {
    contactIds: v.intArray(req.body.contact_ids ?? stored.contact_ids, { label: 'contact_ids' }),
    groupIds: v.intArray(req.body.group_ids ?? stored.group_ids, { label: 'group_ids' }),
    newContacts: Array.isArray(req.body.new_contacts) ? req.body.new_contacts : stored.new_contacts,
    saveNew: true,
  };

  const result = withTx(req.db, () => {
    const recipients = resolveRecipients(req.db, sel);
    if (recipients.length === 0) {
      throw new ApiError(400, 'No recipients selected — pick people or groups first.');
    }
    const r = queueBroadcastEmails(req.db, {
      org: req.org, broadcast: b, recipients,
      subjectTemplate: b.subject || b.title,
      bodyTemplate: b.body || '',
    });
    req.db.prepare(
      "UPDATE broadcasts SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(b.id);
    return r;
  });

  const updated = req.db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(b.id);
  res.json({ ...result, broadcast: serializeBroadcast(req, updated) });
}));
