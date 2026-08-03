// Everything between "the host clicked send" and "rows sit in the email
// queue": link building, per-recipient rendering, dedupe/skip rules.
import { config } from './env.js';
import { insertId } from './db.js';
import { hmacHex, safeEqual } from './tokens.js';
import { normalizeFlyer, flyerColors } from './flyer.js';
import { buildTagContext, buildBroadcastTagContext, renderTags } from './mergeTags.js';
import {
  renderInvitationEmail, renderMessageEmail, renderBroadcastEmail,
  DEFAULT_INVITE_BODY, DEFAULT_NUDGE_BODY, DEFAULT_FOLLOW_UP_BODY, DEFAULT_CANCEL_BODY,
} from './emailTemplates.js';

export const DEFAULT_BODIES = {
  invitation: DEFAULT_INVITE_BODY,
  nudge: DEFAULT_NUDGE_BODY,
  follow_up: DEFAULT_FOLLOW_UP_BODY,
  cancellation: DEFAULT_CANCEL_BODY,
};

export function publicUrl(orgSlug, path) {
  return `${config.baseUrl}/o/${orgSlug}${path}`;
}

export function buildLinks(orgSlug, event, invite = null) {
  const links = { event: publicUrl(orgSlug, `/e/${event.slug}`) };
  if (invite) {
    links.rsvp = publicUrl(orgSlug, `/i/${invite.token}`);
    links.accept = `${links.rsvp}/accept`;
    links.decline = `${links.rsvp}/decline`;
    links.unsub = publicUrl(orgSlug, `/u/${invite.token}`);
  }
  return links;
}

// Resolves an {{image:token}} marker in a message body to the file's public
// URL. Emails are read anywhere, so it has to be absolute.
export function orgImageUrl(orgSlug) {
  return (token) => publicUrl(orgSlug, `/files/${token}`);
}

export function parseFlyer(event) {
  let raw = {};
  try { raw = JSON.parse(event.flyer || '{}'); } catch { /* corrupted json -> defaults */ }
  return normalizeFlyer(raw);
}

export function eventAccent(event) {
  return flyerColors(parseFlyer(event)).accent;
}

// Public URLs for a flyer's featured images, aligned to flyer.imageTokens
// (empty string for an empty slot). Passed straight into renderFlyer.
export function flyerImageUrls(orgSlug, flyer) {
  return normalizeFlyer(flyer).imageTokens.map((t) => (t ? publicUrl(orgSlug, `/files/${t}`) : ''));
}

// URL of the picture-of-the-flyer that goes at the foot of the invitation
// email — empty unless the host turned the option on and the designer has
// rendered one.
export function flyerSnapshotUrl(orgSlug, flyer) {
  const f = normalizeFlyer(flyer);
  if (!f.includeFlyerImage || !f.flyerImageToken) return '';
  return publicUrl(orgSlug, `/files/${f.flyerImageToken}`);
}

export function inviteName(invite) {
  return invite.contact_name || invite.guest_name || '';
}

export function inviteEmail(invite) {
  return (invite.contact_email || invite.guest_email || '').toLowerCase();
}

export function isUnsubscribed(db, email) {
  if (!email) return false;
  const row = db.prepare(
    'SELECT id FROM contacts WHERE email = ? AND unsubscribed_at IS NOT NULL'
  ).get(email);
  return Boolean(row);
}

// Join used everywhere invites are listed: live contact info wins, snapshot
// fields cover contacts that were deleted later.
export const INVITE_SELECT = `
  SELECT i.*, c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone,
         c.unsubscribed_at AS contact_unsubscribed_at
  FROM invites i LEFT JOIN contacts c ON c.id = i.contact_id
`;

export function getInvitesForEvent(db, eventId) {
  return db.prepare(`${INVITE_SELECT} WHERE i.event_id = ? ORDER BY i.created_at, i.id`).all(eventId);
}

function insertEmailLog(db, { event, invite, kind, toName, toEmail, subject, html, text }) {
  const info = db.prepare(
    `INSERT INTO email_log (event_id, invite_id, kind, to_name, to_email, subject, html, body_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(event ? event.id : null, invite ? invite.id : null, kind, toName || '', toEmail, subject, html, text);
  return insertId(info);
}

// Links used in test sends and previews: every button lands on the public
// event page instead of mutating a real invite.
export function previewLinks(orgSlug, event) {
  const eventUrl = publicUrl(orgSlug, `/e/${event.slug}`);
  return { event: eventUrl, rsvp: eventUrl, accept: eventUrl, decline: eventUrl, unsub: '' };
}

export function renderEmailFor({ org, event, invite, kind, subjectTemplate, bodyTemplate, linksOverride }) {
  const name = inviteName(invite);
  const email = inviteEmail(invite);
  const links = linksOverride || buildLinks(org.slug, event, invite);
  const ctx = buildTagContext({ org, event, inviteName: name, links });
  const subject = renderTags(subjectTemplate, ctx).trim() || `You're invited: ${event.title}`;
  const bodyText = renderTags(bodyTemplate, ctx);
  const accent = eventAccent(event);
  const common = {
    org, event, accent, toName: name, toEmail: email,
    bodyText, links, unsubUrl: links.unsub, imageUrl: orgImageUrl(org.slug),
  };
  const rendered = kind === 'invitation'
    ? renderInvitationEmail({
      ...common,
      flyerImageUrl: flyerSnapshotUrl(org.slug, parseFlyer(event)),
    })
    : renderMessageEmail({ ...common, kind });
  return { subject, html: rendered.html, text: rendered.text, toName: name, toEmail: email };
}

// Queue one kind of email to a set of invites, applying the skip rules.
// Returns counts the UI reports back to the host.
export function queueEmails(db, { org, event, invites, kind, subjectTemplate, bodyTemplate, markInvitation }) {
  let queued = 0;
  const skipped = { no_email: 0, unsubscribed: 0, already_queued: 0 };
  for (const invite of invites) {
    const email = inviteEmail(invite);
    if (!email) { skipped.no_email++; continue; }
    if (invite.contact_unsubscribed_at || isUnsubscribed(db, email)) { skipped.unsubscribed++; continue; }
    if (markInvitation && invite.email_status === 'queued') { skipped.already_queued++; continue; }
    const msg = renderEmailFor({ org, event, invite, kind, subjectTemplate, bodyTemplate });
    insertEmailLog(db, { event, invite, kind, ...msg, html: msg.html, text: msg.text });
    if (markInvitation) {
      db.prepare('UPDATE invites SET email_status = ? WHERE id = ?').run('queued', invite.id);
    }
    queued++;
  }
  return { queued, skipped };
}

export function logTestEmail(db, { event, toEmail, subject, html, text, status, error }) {
  const info = db.prepare(
    `INSERT INTO email_log (event_id, invite_id, kind, to_name, to_email, subject, html, body_text, status, error, sent_at)
     VALUES (?, NULL, 'test', '', ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(event.id, toEmail, subject, html, text, status, error || null);
  return insertId(info);
}

// --- broadcasts (email blasts not tied to an event) ------------------------

// Stateless unsubscribe token for broadcast recipients: "<contactId>.<hmac>".
// Broadcasts have no per-recipient invite row, so the link is derived from the
// contact id and verified with the server secret — no extra storage needed.
export function signContactToken(contactId) {
  const id = String(contactId);
  return `${id}.${hmacHex(config.sessionSecret, `bunsub:${id}`).slice(0, 24)}`;
}

export function verifyContactToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [id, sig] = parts;
  if (!/^\d+$/.test(id)) return null;
  if (!safeEqual(sig, hmacHex(config.sessionSecret, `bunsub:${id}`).slice(0, 24))) return null;
  return Number(id);
}

export function broadcastViewUrl(orgSlug, broadcast) {
  return publicUrl(orgSlug, `/b/${broadcast.slug}`);
}

export function broadcastUnsubUrl(orgSlug, contactId) {
  return contactId ? publicUrl(orgSlug, `/bu/${signContactToken(contactId)}`) : '';
}

// Stand-in for "send a copy to an address that isn't on the list". A real
// unsubscribe link belongs to a contact, and handing out someone else's would
// let a stray click remove a real person. This one resolves to a page that
// explains itself — so the copy still carries the link and the
// List-Unsubscribe header a deliverability test is looking for.
export const PREVIEW_UNSUB = 'preview';

export function previewUnsubUrl(orgSlug) {
  return publicUrl(orgSlug, `/bu/${PREVIEW_UNSUB}`);
}

// Turn a { contact_ids, group_ids, new_contacts } selection into a deduped
// list of { contact_id, name, email }. New people are saved to the contact
// list (when saveNew), mirroring the event guest flow. Meant to run inside a
// transaction when saving is involved.
export function resolveRecipients(db, {
  contactIds = [], groupIds = [], excludedIds = [], newContacts = [], saveNew = true,
}) {
  const ids = new Set(contactIds.map(Number));
  for (const gid of groupIds) {
    for (const m of db.prepare('SELECT contact_id FROM group_members WHERE group_id = ?').all(gid)) {
      ids.add(Number(m.contact_id));
    }
  }
  // Someone unticked in the list stays out, even though their group is in.
  // Applied last so it wins over every way of being included.
  for (const id of excludedIds) ids.delete(Number(id));

  const out = [];
  const seenEmail = new Set();
  const push = (contactId, name, email) => {
    const e = (email || '').toLowerCase();
    if (e && seenEmail.has(e)) return;
    if (e) seenEmail.add(e);
    out.push({ contact_id: contactId ?? null, name: name || '', email: e });
  };

  const getContact = db.prepare('SELECT * FROM contacts WHERE id = ?');
  for (const cid of ids) {
    const c = getContact.get(cid);
    if (c) push(c.id, c.name, c.email || '');
  }

  const contactByEmail = db.prepare('SELECT * FROM contacts WHERE email = ?');
  const insertContact = db.prepare('INSERT INTO contacts (name, email, phone) VALUES (?, ?, ?)');
  for (const raw of Array.isArray(newContacts) ? newContacts.slice(0, 2000) : []) {
    const name = String(raw?.name || '').trim().slice(0, 200);
    if (!name) continue;
    const email = String(raw?.email || '').trim().toLowerCase().slice(0, 254);
    const phone = String(raw?.phone || '').trim().slice(0, 50);
    let contactId = null;
    if (email) {
      const existing = contactByEmail.get(email);
      if (existing) contactId = existing.id;
      else if (saveNew) contactId = insertId(insertContact.run(name, email, phone || null));
    } else if (saveNew) {
      contactId = insertId(insertContact.run(name, null, phone || null));
    }
    push(contactId, name, email);
  }
  return out;
}

// Dry-run count of how many emails a { contact_ids, group_ids, new_contacts }
// selection would actually send: unique addresses, minus no-email and
// unsubscribed. Used to show recipient counts (not group counts) before send.
export function previewRecipients(db, { contactIds = [], groupIds = [], excludedIds = [], newContacts = [] }) {
  const resolved = resolveRecipients(db, { contactIds, groupIds, excludedIds, newContacts, saveNew: false });
  let recipients = 0;
  for (const r of resolved) {
    if (r.email && !isUnsubscribed(db, r.email)) recipients++;
  }
  return { recipients, total: resolved.length };
}

export function renderBroadcastEmailFor({ org, broadcast, recipient, subjectTemplate, bodyTemplate, viewUrl, unsubUrl }) {
  const name = recipient?.name || '';
  const email = (recipient?.email || '').toLowerCase();
  const ctx = buildBroadcastTagContext({ org, recipientName: name, links: { view: viewUrl || '' } });
  const subject = renderTags(subjectTemplate, ctx).trim() || broadcast.title || org.name;
  const bodyText = renderTags(bodyTemplate, ctx);
  // The flyer no longer rides along in the email — it still fronts the
  // broadcast's web version, which publicRoutes renders from the same design.
  const rendered = renderBroadcastEmail({
    org, title: broadcast.title,
    toEmail: email, bodyText, viewUrl: viewUrl || '', unsubUrl: unsubUrl || '',
    imageUrl: orgImageUrl(org.slug),
  });
  return { subject, html: rendered.html, text: rendered.text, toName: name, toEmail: email };
}

// Queue one email per recipient, applying the same skip rules as events.
export function queueBroadcastEmails(db, { org, broadcast, recipients, subjectTemplate, bodyTemplate }) {
  let queued = 0;
  const skipped = { no_email: 0, unsubscribed: 0 };
  const viewUrl = broadcast.web_version ? broadcastViewUrl(org.slug, broadcast) : '';
  const insert = db.prepare(
    `INSERT INTO email_log (broadcast_id, kind, to_name, to_email, subject, html, body_text)
     VALUES (?, 'broadcast', ?, ?, ?, ?, ?)`
  );
  for (const r of recipients) {
    const email = (r.email || '').toLowerCase();
    if (!email) { skipped.no_email++; continue; }
    if (isUnsubscribed(db, email)) { skipped.unsubscribed++; continue; }
    const unsubUrl = broadcastUnsubUrl(org.slug, r.contact_id);
    const msg = renderBroadcastEmailFor({ org, broadcast, recipient: r, subjectTemplate, bodyTemplate, viewUrl, unsubUrl });
    insert.run(broadcast.id, msg.toName || '', email, msg.subject, msg.html, msg.text);
    queued++;
  }
  return { queued, skipped };
}
