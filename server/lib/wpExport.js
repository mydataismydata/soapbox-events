// Interchange document for handing an event to the WordPress plugin
// (Event RSVP Manager), which builds the pages on the main website.
//
// The two systems model the same thing differently, so the translation is
// done HERE rather than in the importer — one place to look when a field
// stops lining up:
//
//   - Soapbox has one `name` per contact; WordPress needs first + last, both
//     NOT NULL. We split on the last space and also send the full name so the
//     importer can use it verbatim as the greeting.
//   - Soapbox counts a party INCLUDING the invitee (party_size 2 = them and a
//     guest); WordPress counts extra guests only. Both numbers are sent.
//   - Soapbox stores an absolute RSVP deadline; WordPress stores an offset in
//     days from the event. Both are sent.
//   - Responses are emitted in WordPress's vocabulary (accepted / declined /
//     pending) so the importer never has to translate yes/no/null.
//
// The document is a full snapshot, not a diff: exporting the same event again
// after guests have replied produces the same shape with fresh statuses, so
// one importer both seeds an event and syncs later responses.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';
import { uploadsDir } from './db.js';
import { INVITE_SELECT, publicUrl, parseFlyer } from './sending.js';

export const EXPORT_FORMAT = 'soapbox-event-export';
export const EXPORT_VERSION = 1;

// Anything larger is a sign something went wrong in the rasterizer; the
// document is JSON and gets base64'd, so it pays to keep a ceiling.
const MAX_FLYER_BYTES = 8 * 1024 * 1024;

// Fallback for a guest with no contact row (someone who RSVP'd through the
// share link). Contacts carry their own first/last and are used as stored.
// "Elena Rossi" -> first "Elena", last "Rossi". One-word names become the
// last name, since that is the field WordPress sorts and greets on.
export function splitName(full) {
  const clean = String(full || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { first_name: '', last_name: '' };
  const cut = clean.lastIndexOf(' ');
  if (cut === -1) return { first_name: '', last_name: clean };
  return { first_name: clean.slice(0, cut), last_name: clean.slice(cut + 1) };
}

const RESPONSE = { yes: 'accepted', no: 'declined' };

// Whole days between the RSVP deadline and the event, which is how WordPress
// stores a cutoff. Null when either date is missing.
export function deadlineOffsetDays(eventDate, deadline) {
  if (!eventDate || !deadline) return null;
  const a = Date.parse(`${eventDate}T00:00:00Z`);
  const b = Date.parse(`${deadline}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

// A data: URL from the browser's flyer rasterizer, or a stored upload token.
// Returns null rather than throwing — an event without a flyer picture is
// still worth exporting.
function flyerImage(db, orgSlug, { dataUrl, token }) {
  if (dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (m) {
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length && buf.length <= MAX_FLYER_BYTES) {
        return {
          filename: `flyer.${m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'}`,
          content_type: m[1],
          bytes: buf.length,
          data_base64: m[2],
          url: '',
        };
      }
    }
  }
  if (!token) return null;
  const row = db.prepare('SELECT * FROM uploads WHERE token = ?').get(token);
  if (!row) return null;
  try {
    const buf = fs.readFileSync(path.join(uploadsDir(orgSlug), row.token));
    if (!buf.length || buf.length > MAX_FLYER_BYTES) return null;
    return {
      filename: row.original_name || 'flyer.jpg',
      content_type: row.mime,
      bytes: buf.length,
      data_base64: buf.toString('base64'),
      url: publicUrl(orgSlug, `/files/${row.token}`),
    };
  } catch {
    return null; // the row outlived the file
  }
}

export function buildEventExport(db, org, event, { flyerDataUrl = '' } = {}) {
  const flyer = parseFlyer(event);
  const invites = db.prepare(`${INVITE_SELECT} WHERE i.event_id = ? ORDER BY i.id`).all(event.id);

  // Group names per contact, so the importer can rebuild the groups it needs.
  const groupRows = db.prepare(
    `SELECT gm.contact_id, g.name FROM group_members gm
     JOIN groups g ON g.id = gm.group_id ORDER BY g.name COLLATE NOCASE`
  ).all();
  const groupsFor = new Map();
  for (const row of groupRows) {
    if (!groupsFor.has(row.contact_id)) groupsFor.set(row.contact_id, []);
    groupsFor.get(row.contact_id).push(row.name);
  }

  const guests = invites.map((i) => {
    const name = i.contact_name || i.guest_name || '';
    const email = (i.contact_email || i.guest_email || '').toLowerCase();
    const response = RESPONSE[i.response] || 'pending';
    const partySize = Math.max(1, Number(i.party_size) || 1);
    // A contact's own first/last beat any guess made from the display name.
    const stored = i.contact_first_name || i.contact_last_name
      ? { first_name: i.contact_first_name || '', last_name: i.contact_last_name || '' }
      : null;
    return {
      name,
      ...(stored || splitName(name)),
      email,
      phone: i.contact_phone || '',
      response,
      // party_size is Soapbox's own number and includes the invitee.
      // extra_guests is what WordPress stores: extras only, and only once
      // someone has actually accepted — a pending reply claims no seats.
      party_size: partySize,
      extra_guests: response === 'accepted' ? partySize - 1 : 0,
      responded_at: i.responded_at || '',
      note: i.note || '',
      groups: groupsFor.get(i.contact_id) || [],
      unsubscribed: Boolean(i.contact_unsubscribed_at),
      invited_via: i.source,
      email_status: i.email_status,
    };
  });

  const counts = {
    guests: guests.length,
    accepted: guests.filter((g) => g.response === 'accepted').length,
    declined: guests.filter((g) => g.response === 'declined').length,
    pending: guests.filter((g) => g.response === 'pending').length,
    // Seats actually claimed by the people who accepted, invitee included.
    seats: guests.reduce((n, g) => n + (g.response === 'accepted' ? g.party_size : 0), 0),
    // Contacts WordPress cannot store: its invitee table keys on email.
    without_email: guests.filter((g) => !g.email).length,
  };

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    source: {
      app: config.appName,
      base_url: config.baseUrl,
      org_slug: org.slug,
      org_name: org.name,
    },
    event: {
      soapbox_id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description || '',
      host_name: event.host_name || '',
      status: event.status,
      date: event.date || '',
      start_time: event.start_time || '',
      end_time: event.end_time || '',
      // Soapbox keeps wall-clock time with no zone; the importer should fall
      // back to the WordPress site's timezone.
      timezone: null,
      timezone_note: event.timezone_note || '',
      venue: {
        name: event.venue_name || '',
        address: event.venue_address || '',
        phone: event.venue_phone || '',
        map_url: event.venue_map_url || '',
      },
      capacity: Number(event.capacity) || 0,
      rsvp_mode: event.rsvp_mode,
      allow_plus_ones: Boolean(event.allow_plus_ones),
      max_party_size: Number(event.max_party_size) || 1,
      // WordPress's max_extra_guests excludes the invitee.
      max_extra_guests: event.allow_plus_ones ? Math.max(0, (Number(event.max_party_size) || 1) - 1) : 0,
      rsvp_deadline: event.rsvp_deadline || '',
      rsvp_deadline_offset_days: deadlineOffsetDays(event.date, event.rsvp_deadline),
      show_guest_list: Boolean(event.show_guest_list),
      public_url: publicUrl(org.slug, `/e/${event.slug}`),
      email: {
        subject: event.email_subject || '',
        body: event.email_body || '',
        // Placeholders are {{event_title}}-style and are NOT translated here;
        // the importer decides what its own template language wants.
        placeholder_syntax: 'soapbox',
      },
      flyer_style: flyer.style,
    },
    flyer_image: flyerImage(db, org.slug, {
      dataUrl: flyerDataUrl,
      token: flyer.flyerImageToken,
    }),
    guests,
    counts,
  };
}
