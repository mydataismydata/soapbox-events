// Publishing an organization's meetings to its website.
//
// An organization can name a website address and a token in Settings. When it
// does, every change that alters what a visitor would see sends the whole
// current set of published meetings to that address. The receiving site
// replaces its copy with what arrived.
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

import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';
import { getSetting, orgDb, uploadsDir } from './db.js';
import { parseFlyer, publicUrl } from './sending.js';

export const PUSH_FORMAT = 'soapbox-website-push';
export const PUSH_VERSION = 1;

// Anything larger and the receiving end refuses it, so the flyers are dropped
// and the meetings go out on their own rather than the delivery failing.
const MAX_BODY_BYTES = 11 * 1024 * 1024;
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

/** Every event the website should currently be showing. */
function publishableEvents(db) {
  return db.prepare(
    `SELECT * FROM events
      WHERE status = 'published'
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
 * Build the document.
 *
 * Flyers are attached last and dropped wholesale if the body would exceed the
 * size the receiver accepts. Meetings without their artwork are worth far
 * more than a delivery that fails.
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
    public_url: publicUrl(org.slug, `/e/${event.slug}`),
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

  if (!includeFlyers) return payload;

  const flyers = {};
  for (const event of rows) {
    const bytes = readFlyerBytes(db, org.slug, event);
    if (bytes) {
      flyers[event.slug] = {
        content_type: bytes.contentType,
        data_base64: bytes.base64,
      };
    }
  }
  if (Object.keys(flyers).length) payload.flyers = flyers;

  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BODY_BYTES) {
    delete payload.flyers;
  }
  return payload;
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

/**
 * Send the current set of meetings to the organization's website.
 *
 * Returns a result describing what happened, which the caller records in the
 * delivery log. It never throws: publishing an event must not fail because a
 * website is down.
 */
export async function publishEvents(orgSlug, org, { reason = 'manual' } = {}) {
  const db = orgDb(orgSlug);
  if (!db) return { skipped: true, reason: 'no-org' };

  const { url, token } = websiteConfig(db);

  // The normal case for most organizations: no website, nothing to do.
  if (!url || !token) {
    return { skipped: true, reason: 'no-website' };
  }

  let payload;
  try {
    payload = buildPayload(db, org);
  } catch (err) {
    return { ok: false, status: 0, reason, error: `Could not build the payload: ${err.message}`, retryable: false };
  }

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

    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON; keep the text */ }

    return {
      ok: res.ok,
      status: res.status,
      reason,
      events: payload.events.length,
      flyers: payload.flyers ? Object.keys(payload.flyers).length : 0,
      error: res.ok ? '' : (body?.error || text.slice(0, 300) || `HTTP ${res.status}`),
      // 5xx and 429 are the website's problem and may clear on their own.
      // 4xx is a configuration mistake and will fail identically forever.
      retryable: res.status === 429 || res.status >= 500,
      sent_at: payload.sent_at,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      reason,
      events: payload.events.length,
      flyers: payload.flyers ? Object.keys(payload.flyers).length : 0,
      error: unreachable(err),
      retryable: true,
    };
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
    `INSERT INTO website_deliveries (reason, ok, status, events, flyers, error, retryable)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(result.reason || 'manual'),
    result.ok ? 1 : 0,
    Number(result.status) || 0,
    Number(result.events) || 0,
    Number(result.flyers) || 0,
    result.error ? String(result.error).slice(0, 1000) : null,
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
    `SELECT id, sent_at, reason, ok, status, events, flyers, error, retryable
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
export async function publishAndLog(org, { reason = 'manual' } = {}) {
  const result = await publishEvents(org.slug, org, { reason });
  if (result.skipped) return result;
  const db = orgDb(org.slug);
  if (db) recordDelivery(db, result);
  return result;
}
