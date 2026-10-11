// Event addresses. A meeting's page is at /<org>/<slug>, and the slug is the
// meeting's date and start time: 2026-oct-27-17-30. Guests can read it, and
// it says which meeting it leads to.
//
// A meeting that moves gets a new address. Its old address goes into
// event_slugs and redirects to the new one, so the links in invitations that
// were already sent keep working.
import { randomSlug } from './tokens.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Every slug the public pages accept: date slugs, the random slugs events had
// before, and website slugs kept by an import.
export const EVENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

// The random slugs events had before (the alphabet in tokens.js).
export const RANDOM_SLUG_RE = /^[a-hjkmnp-z2-9]{10}$/;

// 2026-10-27 at 17:30 -> 2026-oct-27-17-30. With no start time the address
// is the day alone, and with no date there is no date address at all.
export function dateSlug(date, startTime) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const month = d && MONTHS[Number(d[2]) - 1];
  if (!month) return '';
  const t = /^(\d{2}):(\d{2})$/.exec(String(startTime || ''));
  return [d[1], month, d[3], ...(t ? [t[1], t[2]] : [])].join('-');
}

// Id of the event that answers at this address, now or as an old address.
export function slugHolder(db, slug) {
  const row = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug)
    || db.prepare('SELECT event_id AS id FROM event_slugs WHERE slug = ?').get(slug);
  return row ? Number(row.id) : null;
}

// The first of base, base-2, base-3… that nobody else answers at. Two
// meetings at the same date and time are the only way to need a number.
function freeSlug(db, base, eventId = null) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const holder = slugHolder(db, slug);
    if (holder === null || holder === eventId) return slug;
  }
}

// The address a new event starts with. An event made without a date has a
// random one until it gets a date. It cannot be published or sent before then.
export function newEventSlug(db, { date, start_time: startTime } = {}) {
  const base = dateSlug(date, startTime);
  return base ? freeSlug(db, base) : randomSlug(10);
}

// Moves the event to the address its date and time call for, and returns
// that address. An event already there, numbered or not, stays put.
export function syncEventSlug(db, event) {
  const base = dateSlug(event.date, event.start_time);
  if (!base) return event.slug;
  if (event.slug === base || new RegExp(`^${base}-\\d+$`).test(event.slug)) return event.slug;

  const slug = freeSlug(db, base, event.id);
  // The old address is only worth keeping if a guest could have it.
  const shared = event.status !== 'draft'
    || db.prepare('SELECT 1 FROM invites WHERE event_id = ? LIMIT 1').get(event.id);
  if (shared) db.prepare('INSERT OR IGNORE INTO event_slugs (slug, event_id) VALUES (?, ?)').run(event.slug, event.id);
  // Moving back to an earlier address makes it the current one again.
  db.prepare('DELETE FROM event_slugs WHERE slug = ? AND event_id = ?').run(slug, event.id);
  db.prepare('UPDATE events SET slug = ? WHERE id = ?').run(slug, event.id);
  return slug;
}

// The local part of the event's calendar UID. It is the event's first public
// address, so a calendar entry added before a move is updated rather than
// doubled when the guest adds the event again.
export function eventUidKey(db, event) {
  const first = db.prepare('SELECT slug FROM event_slugs WHERE event_id = ? ORDER BY id LIMIT 1').get(event.id);
  return first ? first.slug : event.slug;
}
