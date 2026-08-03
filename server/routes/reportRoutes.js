import { Router } from 'express';
import { wrap, v, ApiError } from '../lib/validate.js';
import { eventStats, broadcastStats, monthEmailCount } from '../lib/stats.js';
import { getQuota, orgApiKey } from '../lib/email.js';
import { toCsv } from '../lib/csv.js';
import { getSetting } from '../lib/db.js';
import { getInvitesForEvent, inviteEmail, inviteName, publicUrl, previewRecipients } from '../lib/sending.js';
import { formatWhen } from '../lib/format.js';

export const reportRouter = Router();

function today() {
  return new Date().toISOString().slice(0, 10);
}

reportRouter.get('/dashboard', wrap(async (req, res) => {
  const db = req.db;
  const counts = {
    events: Number(db.prepare('SELECT COUNT(*) AS n FROM events').get().n),
    upcoming: Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'published' AND date >= ?").get(today()).n),
    drafts: Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE status = 'draft'").get().n),
    // Unsubscribed contacts are excluded from the reported total.
    contacts: Number(db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE unsubscribed_at IS NULL').get().n),
    groups: Number(db.prepare('SELECT COUNT(*) AS n FROM groups').get().n),
    broadcasts: Number(db.prepare('SELECT COUNT(*) AS n FROM broadcasts').get().n),
  };
  const upcoming = db.prepare(
    "SELECT * FROM events WHERE date >= ? AND status != 'cancelled' ORDER BY date ASC LIMIT 6"
  ).all(today()).map((ev) => ({
    id: ev.id, title: ev.title, date: ev.date, start_time: ev.start_time,
    venue_name: ev.venue_name, status: ev.status, when: formatWhen(ev),
    rsvp_mode: ev.rsvp_mode,
    stats: eventStats(db, ev.id),
  }));
  const recent = db.prepare(`
    SELECT i.id, i.response, i.party_size, i.responded_at, i.guest_name, i.source,
           c.name AS contact_name, e.title AS event_title, e.id AS event_id
    FROM invites i
    LEFT JOIN contacts c ON c.id = i.contact_id
    JOIN events e ON e.id = i.event_id
    WHERE i.responded_at IS NOT NULL
    ORDER BY i.responded_at DESC LIMIT 10
  `).all().map((r) => ({
    id: r.id, event_id: r.event_id, event_title: r.event_title,
    name: r.contact_name || r.guest_name || 'Guest', response: r.response,
    party_size: r.party_size, responded_at: r.responded_at, source: r.source,
  }));
  const broadcasts = db.prepare(
    'SELECT id, title, slug, status, web_version, sent_at, updated_at FROM broadcasts ORDER BY COALESCE(sent_at, updated_at) DESC, id DESC LIMIT 5'
  ).all().map((b) => ({
    id: b.id, title: b.title, slug: b.slug, status: b.status,
    web_version: Boolean(b.web_version), sent_at: b.sent_at, updated_at: b.updated_at,
    stats: broadcastStats(db, b.id),
  }));
  const quota = await getQuota(orgApiKey(db));
  res.json({ counts, upcoming, recent, broadcasts, month_emails: monthEmailCount(db), quota });
}));

// Dry-run: how many emails a recipient selection would actually send (unique
// addresses minus no-email/unsubscribed). Powers the wizards' recipient counts.
reportRouter.post('/recipients/preview', wrap(async (req, res) => {
  res.json(previewRecipients(req.db, {
    contactIds: v.intArray(req.body.contact_ids, { label: 'contact_ids' }),
    groupIds: v.intArray(req.body.group_ids, { label: 'group_ids' }),
    excludedIds: v.intArray(req.body.excluded_contact_ids, { label: 'excluded_contact_ids' }),
    newContacts: Array.isArray(req.body.new_contacts) ? req.body.new_contacts : [],
  }));
}));

reportRouter.get('/quota', wrap(async (req, res) => {
  const quota = await getQuota(orgApiKey(req.db));
  res.json({ ...quota, mode: quota.configured ? 'live' : 'simulation', month_emails: monthEmailCount(req.db) });
}));

// --- CSV exports -----------------------------------------------------------

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

reportRouter.get('/export/contacts.csv', wrap(async (req, res) => {
  const rows = req.db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE').all();
  sendCsv(res, 'contacts.csv', toCsv(rows, [
    { key: 'name', label: 'name' },
    { key: 'email', label: 'email' },
    { key: 'phone', label: 'phone' },
    { key: 'notes', label: 'notes' },
    { label: 'unsubscribed', get: (r) => (r.unsubscribed_at ? 'yes' : '') },
    { key: 'created_at', label: 'created_at' },
  ]));
}));

reportRouter.get('/export/groups.csv', wrap(async (req, res) => {
  const rows = req.db.prepare(`
    SELECT g.name AS group_name, c.name AS contact_name, c.email, c.phone
    FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    LEFT JOIN contacts c ON c.id = gm.contact_id
    ORDER BY g.name COLLATE NOCASE, c.name COLLATE NOCASE
  `).all();
  sendCsv(res, 'groups.csv', toCsv(rows, [
    { key: 'group_name', label: 'group' },
    { key: 'contact_name', label: 'contact_name' },
    { key: 'email', label: 'email' },
    { key: 'phone', label: 'phone' },
  ]));
}));

reportRouter.get('/export/venues.csv', wrap(async (req, res) => {
  const rows = req.db.prepare('SELECT * FROM venues ORDER BY name COLLATE NOCASE').all();
  sendCsv(res, 'venues.csv', toCsv(rows, [
    { key: 'name', label: 'name' },
    { key: 'address', label: 'address' },
    { key: 'phone', label: 'phone' },
    { key: 'map_url', label: 'map_url' },
    { key: 'created_at', label: 'created_at' },
  ]));
}));

reportRouter.get('/export/events.csv', wrap(async (req, res) => {
  const rows = req.db.prepare('SELECT * FROM events ORDER BY date DESC, id DESC').all()
    .map((ev) => ({ ...ev, ...eventStats(req.db, ev.id), share_url: publicUrl(req.org.slug, `/e/${ev.slug}`) }));
  sendCsv(res, 'events.csv', toCsv(rows, [
    { key: 'title', label: 'title' },
    { key: 'status', label: 'status' },
    { key: 'date', label: 'date' },
    { key: 'start_time', label: 'start_time' },
    { key: 'end_time', label: 'end_time' },
    { key: 'venue_name', label: 'venue_name' },
    { key: 'venue_address', label: 'venue_address' },
    { key: 'venue_phone', label: 'venue_phone' },
    { key: 'venue_map_url', label: 'venue_map_url' },
    { key: 'rsvp_mode', label: 'rsvp_mode' },
    { key: 'rsvp_deadline', label: 'rsvp_deadline' },
    { key: 'capacity', label: 'capacity' },
    { key: 'invited', label: 'invited' },
    { key: 'emails_sent', label: 'emails_sent' },
    { key: 'accepted', label: 'accepted' },
    { key: 'guests_attending', label: 'guests_attending' },
    { key: 'declined', label: 'declined' },
    { key: 'awaiting', label: 'awaiting_reply' },
    { key: 'share_url', label: 'share_url' },
    { key: 'created_at', label: 'created_at' },
  ]));
}));

reportRouter.get('/export/broadcasts.csv', wrap(async (req, res) => {
  const rows = req.db.prepare('SELECT * FROM broadcasts ORDER BY COALESCE(sent_at, updated_at) DESC, id DESC').all()
    .map((b) => ({ ...b, ...broadcastStats(req.db, b.id), web_url: publicUrl(req.org.slug, `/b/${b.slug}`) }));
  sendCsv(res, 'broadcasts.csv', toCsv(rows, [
    { key: 'title', label: 'title' },
    { key: 'status', label: 'status' },
    { key: 'subject', label: 'subject' },
    { key: 'recipients', label: 'recipients' },
    { key: 'sent', label: 'sent' },
    { key: 'failed', label: 'failed' },
    { label: 'web_version', get: (r) => (r.web_version ? 'yes' : '') },
    { key: 'web_url', label: 'web_url' },
    { key: 'sent_at', label: 'sent_at' },
    { key: 'created_at', label: 'created_at' },
  ]));
}));

reportRouter.get('/export/events/:id/guests.csv', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'event id', min: 1 });
  const event = req.db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) throw new ApiError(404, 'Event not found.');
  const rows = getInvitesForEvent(req.db, id);
  const safeTitle = event.title.replace(/[^\w-]+/g, '_').slice(0, 60) || 'event';
  sendCsv(res, `guests_${safeTitle}.csv`, toCsv(rows, [
    { label: 'name', get: (r) => inviteName(r) },
    { label: 'email', get: (r) => inviteEmail(r) },
    { label: 'phone', get: (r) => r.contact_phone || '' },
    { key: 'source', label: 'source' },
    { key: 'email_status', label: 'email_status' },
    { label: 'response', get: (r) => r.response || 'pending' },
    { key: 'party_size', label: 'party_size' },
    { key: 'note', label: 'note' },
    { key: 'responded_at', label: 'responded_at' },
    { key: 'created_at', label: 'invited_at' },
  ]));
}));

reportRouter.get('/export/emails.csv', wrap(async (req, res) => {
  const rows = req.db.prepare(`
    SELECT l.created_at, l.sent_at, l.kind, l.to_name, l.to_email, l.subject, l.status, l.error,
           e.title AS event_title
    FROM email_log l LEFT JOIN events e ON e.id = l.event_id
    ORDER BY l.id DESC LIMIT 10000
  `).all();
  sendCsv(res, 'emails.csv', toCsv(rows, [
    { key: 'created_at', label: 'queued_at' },
    { key: 'sent_at', label: 'sent_at' },
    { key: 'kind', label: 'kind' },
    { key: 'to_name', label: 'to_name' },
    { key: 'to_email', label: 'to_email' },
    { key: 'subject', label: 'subject' },
    { key: 'status', label: 'status' },
    { key: 'error', label: 'error' },
    { key: 'event_title', label: 'event' },
  ]));
}));

// Full JSON backup of the organization's data (secrets and password hashes
// excluded; the data/ directory itself is the true full backup).
reportRouter.get('/export/backup.json', wrap(async (req, res) => {
  const db = req.db;
  const all = (sql) => db.prepare(sql).all();
  const settings = {};
  for (const row of all('SELECT key, value FROM settings')) {
    settings[row.key] = row.key === 'smtp2go_api_key' && row.value ? '[configured]' : row.value;
  }
  const backup = {
    format: 'soapbox-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    organization: { slug: req.org.slug, name: req.org.name },
    settings,
    users: all('SELECT id, email, name, role, active, created_at, last_login_at FROM users'),
    contacts: all('SELECT * FROM contacts'),
    groups: all('SELECT * FROM groups'),
    group_members: all('SELECT * FROM group_members'),
    templates: all('SELECT * FROM templates'),
    events: all('SELECT * FROM events'),
    invites: all('SELECT * FROM invites'),
    broadcasts: all('SELECT * FROM broadcasts'),
    email_log: all(`SELECT id, event_id, invite_id, broadcast_id, kind, to_name, to_email, subject, status,
      error, provider_id, created_at, sent_at FROM email_log`),
    uploads: all('SELECT * FROM uploads'),
  };
  res.setHeader('Content-Disposition', `attachment; filename="backup_${req.org.slug}.json"`);
  res.json(backup);
}));
