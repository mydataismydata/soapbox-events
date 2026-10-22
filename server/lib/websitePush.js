// Publishing an organization's meetings to its website.
//
// An organization can name a website address and a token in Settings. When it
// does, a change that alters what a visitor would see sends the whole current
// set of published meetings to that address, batched with any other changes
// made within a few seconds of it. The receiving site replaces its copy with
// what arrived.
//
// The payload is the complete set rather than a delta. A delivery that is
// missed, duplicated or applied out of order still converges on the right
// answer, which is what makes it safe to fire and forget.
//
// The whole module is inert for an organization with no website configured,
// which is most of them. `publishEvents()` returns immediately in that case,
// having read one setting and done nothing else.
//
// Delivery follows the shape the email queue already uses: attempt, record
// the outcome, let a person retry a failure from the UI. It deliberately does
// NOT retry forever on its own. A website that has been down for a week
// should show a red row someone can act on, not generate a thousand log
// entries nobody reads.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';
import { getSetting, orgDb, uploadsDir } from './db.js';
import { localToday } from './clock.js';
import { parseFlyer, eventUrl } from './sending.js';

export const PUSH_FORMAT = 'soapbox-website-push';
export const PUSH_VERSION = 1;

// The receiving script would take 12 MB, but on shared hosting it never gets
// the chance: the web server in front of it refuses a body of 1 MiB or more
// with a 413 page of its own. sjcrlc.org does exactly that (measured
// 2026-10-22, when ten meetings' flyers first came to 1.04 MiB). Flyers are
// left out until the body fits under this, with room to spare.
const MAX_BODY_BYTES = 1_000_000;
const MAX_FLYER_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

// Past meetings stay on the website for a while so its calendar has an
// archive. Beyond this they fall out of the payload and off the site.
const KEEP_PAST_DAYS = 400;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * The website settings for one organization.
 * Both empty is the normal case and means "no website".
 */
export function websiteConfig(db) {
  return {
    url: String(getSetting(db, 'website_push_url', '') || '').trim(),
    token: String(getSetting(db, 'website_push_token', '') || '').trim(),
  };
}

export function websiteConfigured(db) {
  const { url, token } = websiteConfig(db);
  return Boolean(url && token);
}

/**
 * Every event the website should currently be showing.
 *
 * A private meeting (shareable link off) is never sent. The website is
 * public, and a private meeting's address is meant to reach only the people
 * it was given to.
 */
function publishableEvents(db) {
  return db.prepare(
    `SELECT * FROM events
      WHERE status = 'published'
        AND share_enabled = 1
        AND date IS NOT NULL AND date != ''
        AND date >= ?
      ORDER BY date ASC`
  ).all(isoDaysAgo(KEEP_PAST_DAYS));
}

/**
 * The rendered flyer picture for one event, base64.
 *
 * Returns null when the event has no flyer, which is the common case for a
 * plain monthly meeting. This is the same lookup `flyerImage()` in
 * wpExport.js does for the stored-token branch: the flyer JSON holds an
 * upload token, the `uploads` row holds the mime type, and the file on disk
 * is named for the token.
 *
 * `includeFlyerImage` is deliberately not checked. That flag says whether the
 * picture goes at the foot of the invitation email, which is a separate
 * question from whether the website should show it. wpExport.js makes the
 * same choice.
 */
function readFlyerBytes(db, orgSlug, event) {
  try {
    const token = parseFlyer(event)?.flyerImageToken;
    if (!token) return null;
    const row = db.prepare('SELECT * FROM uploads WHERE token = ?').get(token);
    if (!row) return null;
    const buf = fs.readFileSync(path.join(uploadsDir(orgSlug), row.token));
    if (!buf.length || buf.length > MAX_FLYER_BYTES) return null;
    return { contentType: row.mime || 'image/jpeg', base64: buf.toString('base64') };
  } catch {
    return null; // a missing picture must never fail the delivery
  }
}

/**
 * The order flyers earn their place in a delivery that cannot carry them all.
 *
 * Upcoming meetings come first, soonest first, because they are what people
 * visit the website to find. Past meetings follow, newest first, so the
 * oldest corner of the archive is the first to lose its picture.
 */
function flyerPriority(rows) {
  const today = localToday();
  const upcoming = rows.filter((event) => event.date >= today);
  const past = rows.filter((event) => event.date < today).reverse();
  return [...upcoming, ...past];
}

/**
 * Build the document.
 *
 * Returns the payload and how many flyers were left out of it.
 *
 * Flyers are attached last, one at a time in order of priority, and one that
 * would take the body over MAX_BODY_BYTES is left out. A smaller one after it
 * may still fit. Meetings without their artwork are worth far more than a
 * delivery that fails.
 */
export function buildPayload(db, org, { includeFlyers = true } = {}) {
  const rows = publishableEvents(db);

  const events = rows.map((event) => ({
    soapbox_id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description || '',
    status: event.status,
    date: event.date || '',
    start_time: event.start_time || '',
    end_time: event.end_time || '',
    // Soapbox stores wall-clock time on purpose: the meeting is at 6:30pm at
    // the venue. The website supplies its own zone.
    timezone_note: event.timezone_note || '',
    venue: {
      name: event.venue_name || '',
      address: event.venue_address || '',
      phone: event.venue_phone || '',
      map_url: event.venue_map_url || '',
    },
    rsvp_mode: event.rsvp_mode,
    // Where the website's RSVP button sends people. Soapbox owns the guest
    // list, so the reply is collected here and never on the website.
    public_url: eventUrl(org.slug, event),
  }));

  const payload = {
    format: PUSH_FORMAT,
    version: PUSH_VERSION,
    sent_at: new Date().toISOString(),
    source: {
      app: 'Soapbox',
      base_url: config.baseUrl,
      org_slug: org.slug,
      org_name: org.name,
    },
    events,
  };

  if (!includeFlyers) return { payload, omitted: 0 };

  const flyers = {};
  payload.flyers = flyers;
  let omitted = 0;
  for (const event of flyerPriority(rows)) {
    const bytes = readFlyerBytes(db, org.slug, event);
    if (!bytes) continue;
    flyers[event.slug] = {
      content_type: bytes.contentType,
      data_base64: bytes.base64,
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BODY_BYTES) {
      delete flyers[event.slug];
      omitted++;
    }
  }
  if (!Object.keys(flyers).length) delete payload.flyers;
  return { payload, omitted };
}

function countFlyers(payload) {
  return payload.flyers ? Object.keys(payload.flyers).length : 0;
}

/** What the delivery log says about flyers a delivery went without. */
function omittedNote(omitted) {
  if (!omitted) return '';
  return `Left out ${omitted} ${omitted === 1 ? 'flyer' : 'flyers'} to fit under the website's size limit.`;
}

/**
 * The website's reason for refusing a delivery, short enough for the log.
 *
 * The receiving script answers in JSON. A refusal from the web server in
 * front of it is an HTML page instead, and its title ("413 Request Entity
 * Too Large") says what its first few hundred characters of doctype do not.
 */
function refusal(status, text) {
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON; keep the text */ }
  if (body?.error) return String(body.error);
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
  if (title) return `The website's server answered ${title}`;
  return text.slice(0, 300) || `HTTP ${status}`;
}

/**
 * Why the request never completed, in words a volunteer can act on.
 *
 * fetch() reports almost everything as "fetch failed" and hides the reason on
 * `err.cause`, which is no use to somebody reading a delivery log. The common
 * causes each get a sentence of their own.
 */
function unreachable(err) {
  if (err.name === 'AbortError') return 'The website did not answer in time.';
  const code = err.cause?.code || err.code || '';
  if (code === 'ECONNREFUSED') return 'Nothing is listening at that address.';
  if (code === 'ENOTFOUND') return 'That address does not resolve to a server.';
  if (code === 'ECONNRESET') return 'The website closed the connection partway through.';
  if (code === 'CERT_HAS_EXPIRED') return "The website's security certificate has expired.";
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return "The website's security certificate is not trusted.";
  }
  if (err.message === 'unexpected redirect') return 'That address redirects somewhere else. Use the address it lands on.';
  const detail = String(err.cause?.message || err.message || 'unknown error').replace(/\.$/, '');
  return `Could not reach the website: ${detail}.`;
}

// What the website was last sent successfully, per organization, so a
// delivery that would carry exactly the same thing can be left out. It lives
// in memory: after a restart the first change simply sends.
const lastDelivered = new Map(); // org slug -> { url, digest }

// `sent_at` changes on every build, so it is left out of the comparison.
function digestOf(payload) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ ...payload, sent_at: '' }))
    .digest('hex');
}

/**
 * Send the current set of meetings to the organization's website.
 *
 * Returns a result describing what happened, which the caller records in the
 * delivery log. It never throws: publishing an event must not fail because a
 * website is down.
 *
 * `skipUnchanged` leaves out a delivery identical to the last one that
 * landed. Changes to meetings ask for it. The Resend button and a settings
 * save do not, because their whole point is to send.
 */
export async function publishEvents(orgSlug, org, { reason = 'manual', skipUnchanged = false } = {}) {
  const db = orgDb(orgSlug);
  if (!db) return { skipped: true, reason: 'no-org' };

  const { url, token } = websiteConfig(db);

  // The normal case for most organizations: no website, nothing to do.
  if (!url || !token) {
    return { skipped: true, reason: 'no-website' };
  }

  let payload;
  let omitted;
  try {
    ({ payload, omitted } = buildPayload(db, org));
  } catch (err) {
    return { ok: false, status: 0, reason, error: `Could not build the payload: ${err.message}`, retryable: false };
  }

  const digest = digestOf(payload);
  const last = lastDelivered.get(orgSlug);
  if (skipUnchanged && last && last.url === url && last.digest === digest) {
    return { skipped: true, reason: 'unchanged' };
  }
  // Until this attempt is known to have landed, nothing is known to be there.
  lastDelivered.delete(orgSlug);

  let sent = payload;
  try {
    let res = await post(url, token, sent);

    // A host with a lower ceiling than MAX_BODY_BYTES refuses before the
    // website's own script runs. The meetings matter more than their
    // pictures, so they go again on their own.
    if (res.status === 413 && sent.flyers) {
      const { flyers, ...bare } = sent;
      omitted += Object.keys(flyers).length;
      sent = bare;
      res = await post(url, token, sent);
    }

    // The digest is of what this change would send, so an unchanged meeting
    // set is still skipped after a delivery that had to go without flyers.
    if (res.ok) lastDelivered.set(orgSlug, { url, digest });

    return {
      ok: res.ok,
      status: res.status,
      reason,
      events: sent.events.length,
      flyers: countFlyers(sent),
      error: res.ok ? '' : refusal(res.status, res.text),
      note: res.ok ? omittedNote(omitted) : '',
      // 5xx and 429 are the website's problem and may clear on their own.
      // 4xx is a configuration mistake and will fail identically forever.
      retryable: res.status === 429 || res.status >= 500,
      sent_at: sent.sent_at,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      reason,
      events: sent.events.length,
      flyers: countFlyers(sent),
      error: unreachable(err),
      retryable: true,
    };
  }
}

/**
 * POST one document to the website.
 *
 * Resolves with the status and the reply as text whatever the status was.
 * Rejects only when no answer came back at all.
 */
async function post(url, token, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Not Authorization: Apache running PHP through CGI drops that header
        // before PHP sees it, and most county sites are on shared hosting.
        'X-Soapbox-Token': token,
        'User-Agent': 'Soapbox/1.0 (+website-push)',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error', // a redirect to another host would leak the token
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// --- the delivery log ------------------------------------------------------
//
// A push that fails is simply lost, which is the one thing a polling design
// gave away for free. These rows are what replaces it: a failure shows up in
// Settings in red, with a button that sends the same payload again.

// Old rows are worth nothing once the ten on screen have scrolled past them,
// and an organization pushing on every edit would otherwise accumulate them
// forever.
const KEEP_DELIVERIES = 200;

/** Write one attempt to the log. Never called for a skipped delivery. */
export function recordDelivery(db, result) {
  db.prepare(
    `INSERT INTO website_deliveries (reason, ok, status, events, flyers, error, note, retryable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(result.reason || 'manual'),
    result.ok ? 1 : 0,
    Number(result.status) || 0,
    Number(result.events) || 0,
    Number(result.flyers) || 0,
    result.error ? String(result.error).slice(0, 1000) : null,
    result.note ? String(result.note).slice(0, 1000) : null,
    result.retryable ? 1 : 0,
  );
  db.prepare(
    `DELETE FROM website_deliveries WHERE id NOT IN
       (SELECT id FROM website_deliveries ORDER BY id DESC LIMIT ?)`
  ).run(KEEP_DELIVERIES);
}

/** The most recent attempts, newest first, for the Settings panel. */
export function recentDeliveries(db, limit = 10) {
  return db.prepare(
    `SELECT id, sent_at, reason, ok, status, events, flyers, error, note, retryable
       FROM website_deliveries ORDER BY id DESC LIMIT ?`
  ).all(Number(limit) || 10).map((row) => ({
    id: row.id,
    sent_at: row.sent_at,
    reason: row.reason,
    ok: Boolean(row.ok),
    status: row.status,
    events: row.events,
    flyers: row.flyers,
    error: row.error || '',
    note: row.note || '',
    retryable: Boolean(row.retryable),
  }));
}

/**
 * Push, then log, in one call. This is what every caller outside the module
 * wants; `publishEvents()` on its own is the half that talks to the network.
 *
 * Returns the result so a caller that has somebody waiting on it — the Resend
 * button — can say what happened. A skipped delivery writes nothing, which is
 * the first acceptance criterion: an organization with no website configured
 * leaves no trace at all.
 */
export async function publishAndLog(org, { reason = 'manual', skipUnchanged = false } = {}) {
  const result = await publishEvents(org.slug, org, { reason, skipUnchanged });
  if (result.skipped) return result;
  const db = orgDb(org.slug);
  if (db) recordDelivery(db, result);
  return result;
}

// --- batching changes ------------------------------------------------------
//
// The event wizard saves on every step, and a published meeting used to send
// the whole set on each of those saves. One editing session put a dozen
// deliveries into the website within minutes, every one carrying all the
// meetings and all their flyers.
//
// A change now books a delivery instead of making one. The delivery goes out
// once the organization's meetings have been left alone for the settle time,
// so a run of saves becomes one delivery. MAX_WAIT_MS caps the wait for
// somebody who never stops editing. The delivery also skips itself when it
// would carry exactly what the website already has, so clicking through the
// wizard without changing anything sends nothing.

const MAX_WAIT_MS = 60_000;

// When a batch holds more than one kind of change, the log names the one a
// visitor would care about most.
const REASON_RANK = ['edit', 'import', 'publish', 'cancel', 'delete'];

const booked = new Map(); // org slug -> { org, reason, firstAt, timer }

/**
 * Book a delivery for an organization whose meetings have just changed.
 *
 * Returns at once. The delivery reads the table when it goes out, not now,
 * so a deleted meeting is long gone from it by then.
 */
export function schedulePublish(org, { reason = 'edit' } = {}) {
  const now = Date.now();
  const entry = booked.get(org.slug) || { reason, firstAt: now };
  clearTimeout(entry.timer);
  entry.org = org;
  if (REASON_RANK.indexOf(reason) > REASON_RANK.indexOf(entry.reason)) entry.reason = reason;

  const wait = Math.max(0, Math.min(config.websitePushSettleMs, entry.firstAt + MAX_WAIT_MS - now));
  entry.timer = setTimeout(() => {
    booked.delete(org.slug);
    // Nothing is waiting on this promise, so a throw would otherwise become
    // an unhandled rejection.
    publishAndLog(entry.org, { reason: entry.reason, skipUnchanged: true })
      .catch((err) => console.error('website push failed', err));
  }, wait);
  entry.timer.unref?.();
  booked.set(org.slug, entry);
}
