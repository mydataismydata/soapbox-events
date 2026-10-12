// Event addresses. A meeting's page is at /<org>/<slug>.
//
// A public meeting's slug is its date and start time: 2026-oct-27-17-30.
// Guests can read it, it says which meeting it leads to, and anyone can find
// the meeting by its date. That is the point of a public meeting.
//
// A private meeting (share_enabled off) adds a random code to the date:
// 2026-oct-27-17-30-x7k2m9qp4d. Only people given the link can reach it, and
// a private meeting never answers at an address a stranger could guess.
//
// A meeting that moves gets a new address. Its old address goes into
// event_slugs and redirects to the new one, so the links in invitations that
// were already sent keep working.
import { randomSlug } from './tokens.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Every slug the public pages accept: date slugs, the random slugs events had
// before, and website slugs kept by an import.
export const EVENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

// A random code (the alphabet in tokens.js). Events had bare codes before
// they had dates, and a private meeting's address ends in one.
const CODE = '[a-hjkmnp-z2-9]{10}';
export const RANDOM_SLUG_RE = new RegExp(`^${CODE}$`);
const PRIVATE_SLUG_RE = new RegExp(`(?:^|-)(${CODE})$`);

// Whether nobody could reach this address without being given it.
export function isPrivateSlug(slug) {
  return PRIVATE_SLUG_RE.test(String(slug || ''));
}

// Public unless the shareable link was turned off. A new event's fields may
// not say, and the column defaults to on.
export function isPublicEvent(event) {
  return event.share_enabled === undefined || event.share_enabled === null || Boolean(Number(event.share_enabled));
}

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

// The address the event's date, time and privacy call for. An event that
// already fits keeps its address: a numbered public one, or a private one
// with the code it has.
function wantedSlug(db, event) {
  const current = event.slug || '';
  const base = dateSlug(event.date, event.start_time);

  if (isPublicEvent(event)) {
    // An event with no date keeps its code until it gets one. It cannot be
    // published or sent before then.
    if (!base) return current || randomSlug(10);
    if (current === base || new RegExp(`^${base}-\\d{1,4}$`).test(current)) return current;
    return freeSlug(db, base, event.id ?? null);
  }

  let code = PRIVATE_SLUG_RE.exec(current)?.[1] || randomSlug(10);
  for (;;) {
    const slug = base ? `${base}-${code}` : code;
    const holder = slugHolder(db, slug);
    if (holder === null || holder === event.id) return slug;
    code = randomSlug(10);
  }
}

// The address a new event starts with.
export function newEventSlug(db, fields = {}) {
  return wantedSlug(db, { ...fields, id: null, slug: '' });
}

// Moves the event to the address its date, time and privacy call for, and
// returns that address.
export function syncEventSlug(db, event) {
  const slug = wantedSlug(db, event);
  const isPublic = isPublicEvent(event);

  // A private meeting stops answering at every address a stranger could
  // guess, including the ones it had while it was public.
  if (!isPublic) {
    for (const row of db.prepare('SELECT slug FROM event_slugs WHERE event_id = ?').all(event.id)) {
      if (!isPrivateSlug(row.slug)) db.prepare('DELETE FROM event_slugs WHERE slug = ?').run(row.slug);
    }
  }
  if (slug === event.slug) return slug;

  // The old address is only worth keeping if a guest could have it, and only
  // if keeping it gives nothing away.
  const shared = event.status !== 'draft'
    || db.prepare('SELECT 1 FROM invites WHERE event_id = ? LIMIT 1').get(event.id);
  if (shared && (isPublic || isPrivateSlug(event.slug))) {
    db.prepare('INSERT OR IGNORE INTO event_slugs (slug, event_id) VALUES (?, ?)').run(event.slug, event.id);
  }
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
