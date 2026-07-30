import { Router } from 'express';
import { insertId, withTx } from '../lib/db.js';
import { wrap, v, ApiError } from '../lib/validate.js';
import { randomSlug, randomToken } from '../lib/tokens.js';
import { normalizeFlyer } from '../lib/flyer.js';
import { sanitizeRichText } from '../lib/sanitizeHtml.js';
import { eventStats } from '../lib/stats.js';
import { orgApiKey, senderFor, sendEmail } from '../lib/email.js';
import { getSetting } from '../lib/db.js';
import {
  parseFlyer, publicUrl, getInvitesForEvent, queueEmails, renderEmailFor,
  previewLinks, logTestEmail, inviteEmail, inviteName, INVITE_SELECT, DEFAULT_BODIES,
} from '../lib/sending.js';

export const eventRouter = Router();

function getEvent(db, id) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(v.int(id, { label: 'event id', min: 1 }));
  if (!event) throw new ApiError(404, 'Event not found.');
  return event;
}

function serializeEvent(req, ev) {
  return {
    ...ev,
    flyer: parseFlyer(ev),
    allow_plus_ones: Boolean(ev.allow_plus_ones),
    show_guest_list: Boolean(ev.show_guest_list),
    share_enabled: Boolean(ev.share_enabled),
    share_url: publicUrl(req.org.slug, `/e/${ev.slug}`),
  };
}

function serializeGuest(row) {
  return {
    id: row.id,
    contact_id: row.contact_id,
    name: inviteName(row),
    email: inviteEmail(row),
    phone: row.contact_phone || '',
    unsubscribed: Boolean(row.contact_unsubscribed_at),
    source: row.source,
    email_status: row.email_status,
    response: row.response,
    party_size: row.party_size,
    note: row.note || '',
    responded_at: row.responded_at,
    created_at: row.created_at,
    token: row.token,
  };
}

// Fields the wizard / edit forms may set. Each validator normalizes or throws.
const EVENT_FIELDS = {
  title: (x) => v.str(x, { label: 'Title', max: 200 }),
  description: (x) => sanitizeRichText(v.optStr(x, { label: 'Description', max: 20000 })),
  host_name: (x) => v.optStr(x, { label: 'Host name', max: 200 }),
  venue_name: (x) => v.optStr(x, { label: 'Venue name', max: 200 }),
  venue_address: (x) => v.optStr(x, { label: 'Venue address', max: 400 }),
  venue_phone: (x) => v.optStr(x, { label: 'Venue phone', max: 50 }),
  venue_map_url: (x) => v.url(x, { label: 'Venue map link' }),
  date: (x) => v.date(x, { label: 'Date', required: false }),
  start_time: (x) => v.time(x, { label: 'Start time' }),
  end_time: (x) => v.time(x, { label: 'End time' }),
  timezone_note: (x) => v.optStr(x, { label: 'Timezone note', max: 60 }),
  rsvp_mode: (x) => v.oneOf(x, ['rsvp', 'open'], { label: 'RSVP mode', fallback: 'rsvp' }),
  rsvp_deadline: (x) => v.date(x, { label: 'RSVP deadline', required: false }),
  capacity: (x) => (x === null || x === '' ? null : v.int(x, { label: 'Capacity', min: 1, max: 1000000 })),
  allow_plus_ones: (x) => (v.bool(x, true) ? 1 : 0),
  // 0 = unlimited (no cap on plus-ones).
  max_party_size: (x) => v.int(x, { label: 'Max party size', min: 0, max: 99, required: false, fallback: 0 }),
  show_guest_list: (x) => (v.bool(x, false) ? 1 : 0),
  share_enabled: (x) => (v.bool(x, true) ? 1 : 0),
  email_subject: (x) => v.optStr(x, { label: 'Email subject', max: 300 }),
  email_body: (x) => v.optStr(x, { label: 'Email message', max: 20000 }),
  flyer: (x) => JSON.stringify(normalizeFlyer(x)),
};

function pickEventFields(body) {
  const out = {};
  for (const [key, validate] of Object.entries(EVENT_FIELDS)) {
    if (body[key] !== undefined) out[key] = validate(body[key]);
  }
  return out;
}

// --- CRUD ------------------------------------------------------------------

eventRouter.get('/events', wrap(async (req, res) => {
  const rows = req.db.prepare(
    `SELECT * FROM events ORDER BY CASE WHEN date IS NULL OR date = '' THEN 1 ELSE 0 END, date DESC, id DESC`
  ).all();
  res.json({ events: rows.map((ev) => ({ ...serializeEvent(req, ev), stats: eventStats(req.db, ev.id) })) });
}));

eventRouter.post('/events', wrap(async (req, res) => {
  const fields = pickEventFields(req.body);
  if (!fields.title) throw new ApiError(400, 'Title is required.');
  if (fields.flyer === undefined) fields.flyer = JSON.stringify(normalizeFlyer({}));
  const slug = randomSlug(10);
  const keys = Object.keys(fields);
  const info = req.db.prepare(
    `INSERT INTO events (slug, created_by, ${keys.join(', ')})
     VALUES (?, ?, ${keys.map(() => '?').join(', ')})`
  ).run(slug, req.user.id, ...keys.map((k) => fields[k] === '' ? null : fields[k]));
  const event = req.db.prepare('SELECT * FROM events WHERE id = ?').get(insertId(info));
  res.status(201).json({ event: serializeEvent(req, event), stats: eventStats(req.db, event.id) });
}));

eventRouter.get('/events/:id', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  res.json({ event: serializeEvent(req, event), stats: eventStats(req.db, event.id) });
}));

eventRouter.put('/events/:id', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const fields = pickEventFields(req.body);
  if (Object.keys(fields).length === 0) return res.json({ event: serializeEvent(req, event) });
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  req.db.prepare(`UPDATE events SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...Object.keys(fields).map((k) => fields[k] === '' ? null : fields[k]), event.id);
  const updated = req.db.prepare('SELECT * FROM events WHERE id = ?').get(event.id);
  res.json({ event: serializeEvent(req, updated), stats: eventStats(req.db, event.id) });
}));

eventRouter.delete('/events/:id', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  req.db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  res.json({ ok: true });
}));

eventRouter.post('/events/:id/duplicate', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const copyKeys = ['description', 'host_name', 'venue_name', 'venue_address', 'start_time', 'end_time',
    'timezone_note', 'rsvp_mode', 'capacity', 'allow_plus_ones', 'max_party_size', 'show_guest_list',
    'share_enabled', 'flyer', 'email_subject', 'email_body'];
  const title = `Copy of ${event.title}`.slice(0, 200);
  const info = req.db.prepare(
    `INSERT INTO events (slug, title, status, created_by, ${copyKeys.join(', ')})
     VALUES (?, ?, 'draft', ?, ${copyKeys.map(() => '?').join(', ')})`
  ).run(randomSlug(10), title, req.user.id, ...copyKeys.map((k) => event[k]));
  const copy = req.db.prepare('SELECT * FROM events WHERE id = ?').get(insertId(info));
  res.status(201).json({ event: serializeEvent(req, copy) });
}));

function assertPublishable(event) {
  if (!event.title || !event.date) {
    throw new ApiError(400, 'The event needs a title and a date before it can be published or sent.');
  }
}

eventRouter.post('/events/:id/publish', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  assertPublishable(event);
  req.db.prepare(`UPDATE events SET status = 'published', updated_at = datetime('now') WHERE id = ?`).run(event.id);
  res.json({ ok: true, status: 'published' });
}));

eventRouter.post('/events/:id/cancel', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  if (event.status === 'cancelled') throw new ApiError(400, 'This event is already cancelled.');
  const notify = v.bool(req.body.notify, false);
  req.db.prepare(`UPDATE events SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(event.id);
  const updatedEvent = { ...event, status: 'cancelled' };
  let result = { queued: 0, skipped: { no_email: 0, unsubscribed: 0 } };
  if (notify) {
    const invites = getInvitesForEvent(req.db, event.id)
      .filter((i) => i.response === 'yes' || i.email_status === 'sent');
    result = queueEmails(req.db, {
      org: req.org,
      event: updatedEvent,
      invites,
      kind: 'cancellation',
      subjectTemplate: v.optStr(req.body.subject, { max: 300 }) || `Cancelled: ${event.title}`,
      bodyTemplate: v.optStr(req.body.body, { max: 20000 }) || DEFAULT_BODIES.cancellation,
      markInvitation: false,
    });
  }
  res.json({ ok: true, status: 'cancelled', notified: result.queued, skipped: result.skipped });
}));

// --- guests ----------------------------------------------------------------

eventRouter.get('/events/:id/guests', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  res.json({ guests: getInvitesForEvent(req.db, event.id).map(serializeGuest), stats: eventStats(req.db, event.id) });
}));

// Add guests from contacts, groups, and/or brand-new people.
eventRouter.post('/events/:id/guests', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const contactIds = new Set(v.intArray(req.body.contact_ids, { label: 'contact_ids' }));
  const groupIds = v.intArray(req.body.group_ids, { label: 'group_ids' });
  const saveNew = v.bool(req.body.save_new, true);
  const newContacts = Array.isArray(req.body.new_contacts) ? req.body.new_contacts.slice(0, 500) : [];

  for (const gid of groupIds) {
    const members = req.db.prepare('SELECT contact_id FROM group_members WHERE group_id = ?').all(gid);
    for (const m of members) contactIds.add(Number(m.contact_id));
  }

  const existingByContact = new Set(
    req.db.prepare('SELECT contact_id FROM invites WHERE event_id = ? AND contact_id IS NOT NULL')
      .all(event.id).map((r) => Number(r.contact_id))
  );
  const existingEmails = new Set(
    getInvitesForEvent(req.db, event.id).map((i) => inviteEmail(i)).filter(Boolean)
  );

  let added = 0;
  let skipped = 0;
  let contactsCreated = 0;

  withTx(req.db, () => {
    const insertInvite = req.db.prepare(
      `INSERT INTO invites (event_id, contact_id, guest_name, guest_email, token, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const getContact = req.db.prepare('SELECT * FROM contacts WHERE id = ?');
    const contactByEmail = req.db.prepare('SELECT * FROM contacts WHERE email = ?');
    const insertContact = req.db.prepare('INSERT INTO contacts (name, email, phone) VALUES (?, ?, ?)');

    for (const cid of contactIds) {
      const contact = getContact.get(cid);
      if (!contact) continue;
      const email = (contact.email || '').toLowerCase();
      if (existingByContact.has(contact.id) || (email && existingEmails.has(email))) { skipped++; continue; }
      insertInvite.run(event.id, contact.id, contact.name, contact.email || null, randomToken(24), 'email');
      existingByContact.add(contact.id);
      if (email) existingEmails.add(email);
      added++;
    }

    for (const raw of newContacts) {
      const name = v.str(raw?.name, { label: 'Guest name', max: 200 });
      const email = v.optEmail(raw?.email, { label: 'Guest email' });
      const phone = v.optStr(raw?.phone, { label: 'Phone', max: 50 });
      if (email && existingEmails.has(email)) { skipped++; continue; }
      let contactId = null;
      if (email) {
        const existing = contactByEmail.get(email);
        if (existing) {
          contactId = existing.id;
        } else if (saveNew) {
          contactId = insertId(insertContact.run(name, email, phone || null));
          contactsCreated++;
        }
      } else if (saveNew) {
        contactId = insertId(insertContact.run(name, null, phone || null));
        contactsCreated++;
      }
      if (contactId && existingByContact.has(contactId)) { skipped++; continue; }
      insertInvite.run(event.id, contactId, name, email || null, randomToken(24), 'manual');
      if (contactId) existingByContact.add(contactId);
      if (email) existingEmails.add(email);
      added++;
    }
  });

  res.json({ added, skipped, contacts_created: contactsCreated, stats: eventStats(req.db, event.id) });
}));

// Host-side edit of a single guest (mark phone RSVPs, adjust party size...).
eventRouter.put('/events/:id/guests/:inviteId', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const inviteId = v.int(req.params.inviteId, { label: 'invite id', min: 1 });
  const invite = req.db.prepare('SELECT * FROM invites WHERE id = ? AND event_id = ?').get(inviteId, event.id);
  if (!invite) throw new ApiError(404, 'Guest not found.');

  const response = req.body.response === undefined
    ? invite.response
    : (req.body.response === null || req.body.response === ''
      ? null
      : v.oneOf(req.body.response, ['yes', 'no'], { label: 'Response' }));
  const partySize = req.body.party_size === undefined
    ? invite.party_size
    : v.int(req.body.party_size, { label: 'Party size', min: 1, max: 99 });
  const note = req.body.note === undefined ? invite.note : v.optStr(req.body.note, { label: 'Note', max: 1000 });

  const respondedAt = response !== invite.response
    ? (response ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null)
    : invite.responded_at;

  req.db.prepare('UPDATE invites SET response = ?, party_size = ?, note = ?, responded_at = ? WHERE id = ?')
    .run(response, partySize, note || null, respondedAt, inviteId);
  const updated = req.db.prepare(`${INVITE_SELECT} WHERE i.id = ?`).get(inviteId);
  res.json({ guest: serializeGuest(updated), stats: eventStats(req.db, event.id) });
}));

eventRouter.delete('/events/:id/guests/:inviteId', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const inviteId = v.int(req.params.inviteId, { label: 'invite id', min: 1 });
  const info = req.db.prepare('DELETE FROM invites WHERE id = ? AND event_id = ?').run(inviteId, event.id);
  if (Number(info.changes) === 0) throw new ApiError(404, 'Guest not found.');
  res.json({ ok: true });
}));

// Save a share-link guest into the contact list.
eventRouter.post('/events/:id/guests/:inviteId/add-contact', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const inviteId = v.int(req.params.inviteId, { label: 'invite id', min: 1 });
  const invite = req.db.prepare('SELECT * FROM invites WHERE id = ? AND event_id = ?').get(inviteId, event.id);
  if (!invite) throw new ApiError(404, 'Guest not found.');
  if (invite.contact_id) throw new ApiError(400, 'This guest is already in your contacts.');
  if (!invite.guest_email) throw new ApiError(400, 'This guest has no email to save.');
  let contact = req.db.prepare('SELECT * FROM contacts WHERE email = ?').get(invite.guest_email.toLowerCase());
  if (!contact) {
    const info = req.db.prepare('INSERT INTO contacts (name, email) VALUES (?, ?)')
      .run(invite.guest_name || invite.guest_email, invite.guest_email.toLowerCase());
    contact = req.db.prepare('SELECT * FROM contacts WHERE id = ?').get(insertId(info));
  }
  req.db.prepare('UPDATE invites SET contact_id = ? WHERE id = ?').run(contact.id, invite.id);
  res.json({ ok: true, contact_id: contact.id });
}));

// --- sending ---------------------------------------------------------------

eventRouter.post('/events/:id/send', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  assertPublishable(event);
  if (event.status === 'cancelled') throw new ApiError(400, 'This event is cancelled; reactivate it before sending.');

  const inviteIds = v.intArray(req.body.invite_ids, { label: 'invite_ids' });
  let invites = getInvitesForEvent(req.db, event.id);
  if (inviteIds.length > 0) {
    const wanted = new Set(inviteIds);
    invites = invites.filter((i) => wanted.has(i.id));
  } else {
    invites = invites.filter((i) => ['not_sent', 'failed'].includes(i.email_status) && i.response === null);
  }
  if (invites.length === 0) {
    throw new ApiError(400, 'No guests to email — everyone has already been contacted or responded.');
  }

  if (event.status === 'draft') {
    req.db.prepare(`UPDATE events SET status = 'published', updated_at = datetime('now') WHERE id = ?`).run(event.id);
    event.status = 'published';
  }

  const result = queueEmails(req.db, {
    org: req.org,
    event,
    invites,
    kind: 'invitation',
    subjectTemplate: event.email_subject || `You're invited: {{event_title}}`,
    bodyTemplate: event.email_body || DEFAULT_BODIES.invitation,
    markInvitation: true,
  });
  res.json({ ...result, stats: eventStats(req.db, event.id) });
}));

eventRouter.post('/events/:id/message', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const kind = v.oneOf(req.body.kind, ['follow_up', 'nudge'], { label: 'Message kind' });
  const audience = v.oneOf(req.body.audience, ['yes', 'no', 'pending', 'all'], {
    label: 'Audience', fallback: kind === 'nudge' ? 'pending' : 'yes',
  });
  const subject = v.optStr(req.body.subject, { label: 'Subject', max: 300 })
    || (kind === 'nudge' ? `Reminder to RSVP: ${event.title}` : `Update: ${event.title}`);
  const body = v.str(req.body.body, { label: 'Message', max: 20000 });

  let invites = getInvitesForEvent(req.db, event.id);
  if (audience === 'yes') invites = invites.filter((i) => i.response === 'yes');
  else if (audience === 'no') invites = invites.filter((i) => i.response === 'no');
  else if (audience === 'pending') invites = invites.filter((i) => i.response === null && i.email_status === 'sent');

  if (invites.length === 0) throw new ApiError(400, 'No guests match this audience yet.');

  const result = queueEmails(req.db, {
    org: req.org, event, invites, kind,
    subjectTemplate: subject, bodyTemplate: body, markInvitation: false,
  });
  res.json(result);
}));

eventRouter.post('/events/:id/email-preview', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const kind = v.oneOf(req.body.kind, ['invitation', 'follow_up', 'nudge', 'cancellation'], {
    label: 'kind', fallback: 'invitation',
  });
  const sample = getInvitesForEvent(req.db, event.id).find((i) => inviteEmail(i))
    || { guest_name: 'Alex Rivera', guest_email: 'alex@example.com', token: 'preview' };
  const subjectTemplate = req.body.subject !== undefined && String(req.body.subject).trim() !== ''
    ? v.str(req.body.subject, { label: 'Subject', max: 300 })
    : (kind === 'invitation' ? (event.email_subject || `You're invited: {{event_title}}`) : `About {{event_title}}`);
  const bodyTemplate = req.body.body !== undefined && String(req.body.body).trim() !== ''
    ? v.str(req.body.body, { label: 'Body', max: 20000 })
    : (kind === 'invitation' ? (event.email_body || DEFAULT_BODIES.invitation) : DEFAULT_BODIES[kind]);

  const msg = renderEmailFor({
    org: req.org, event, invite: sample, kind, subjectTemplate, bodyTemplate,
    linksOverride: previewLinks(req.org.slug, event),
  });
  res.json({ subject: msg.subject, html: msg.html, to: inviteEmail(sample) || 'alex@example.com' });
}));

eventRouter.post('/events/:id/test-email', wrap(async (req, res) => {
  const event = getEvent(req.db, req.params.id);
  const to = req.body.to ? v.email(req.body.to, { label: 'Recipient' }) : req.user.email;
  const pseudo = { guest_name: req.user.name, guest_email: to, token: 'preview' };
  const msg = renderEmailFor({
    org: req.org, event, invite: pseudo, kind: 'invitation',
    subjectTemplate: `[Test] ${event.email_subject || `You're invited: {{event_title}}`}`,
    bodyTemplate: event.email_body || DEFAULT_BODIES.invitation,
    linksOverride: previewLinks(req.org.slug, event),
  });
  const { sender, replyTo } = senderFor(req.db, req.org.name, 'event');
  const result = await sendEmail({
    apiKey: orgApiKey(req.db),
    sender,
    replyTo,
    toName: req.user.name,
    toEmail: to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  const status = result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed';
  logTestEmail(req.db, { event, toEmail: to, subject: msg.subject, html: msg.html, text: msg.text, status, error: result.error });
  if (!result.ok) throw new ApiError(502, `Test email failed: ${result.error}`);
  res.json({ status });
}));
