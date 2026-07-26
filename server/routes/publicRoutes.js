// Guest-facing pages. Everything here is server-rendered HTML that works
// without JavaScript, reached through unguessable tokens:
//
//   /o/<org>/e/<slug>        event landing page (shareable link, open RSVPs)
//   /o/<org>/i/<token>       personal invite page (RSVP, change response)
//   /o/<org>/i/<token>/accept|decline   one-click buttons from emails
//   /o/<org>/u/<token>       unsubscribe
//   /o/<org>/files/<token>   uploaded images (flyer photos)
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { getOrg, orgDb, uploadsDir, insertId } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { esc, textToHtml, publicPage } from '../lib/html.js';
import { renderFlyer, flyerColors, mixWithWhite } from '../lib/flyer.js';
import { parseFlyer, publicUrl, flyerImageUrls, verifyContactToken } from '../lib/sending.js';
import { buildBroadcastTagContext, renderTags } from '../lib/mergeTags.js';
import { sanitizeRichText, looksLikeHtml } from '../lib/sanitizeHtml.js';
import { formatWhen, formatDate, firstName } from '../lib/format.js';
import { buildIcs, googleCalendarUrl } from '../lib/ics.js';
import { randomToken } from '../lib/tokens.js';
import { take } from '../lib/ratelimit.js';
import { isValidEmail } from '../lib/validate.js';

export const publicRouter = Router({ mergeParams: true });

// --- org resolution --------------------------------------------------------

publicRouter.use((req, res, next) => {
  const slug = String(req.params.orgSlug || '').toLowerCase();
  const org = getOrg(slug);
  if (!org) {
    return res.status(404).send(publicPage({
      title: 'Not found',
      bodyHtml: `<div class="pub-card"><h2>Page not found</h2>
        <p class="pub-muted">This link doesn't point to anything. Double-check the address you were given.</p></div>`,
    }));
  }
  req.pub = { org: { slug: org.slug, name: org.name }, db: orgDb(slug) };
  next();
});

function notFoundPage(res, message = "This link doesn't point to anything.") {
  return res.status(404).send(publicPage({
    title: 'Not found',
    bodyHtml: `<div class="pub-card"><h2>Page not found</h2><p class="pub-muted">${esc(message)}</p></div>`,
  }));
}

// --- helpers ---------------------------------------------------------------

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function eventBySlug(db, slug) {
  if (!/^[a-z0-9]{4,20}$/.test(String(slug))) return null;
  return db.prepare('SELECT * FROM events WHERE slug = ?').get(slug) || null;
}

function inviteByToken(db, token) {
  if (!/^[A-Za-z0-9]{10,64}$/.test(String(token))) return null;
  return db.prepare('SELECT * FROM invites WHERE token = ?').get(token) || null;
}

function deadlinePassed(event) {
  return Boolean(event.rsvp_deadline && event.rsvp_deadline < todayIso());
}

function acceptedSeats(db, eventId, excludeInviteId = null) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(party_size), 0) AS n FROM invites
     WHERE event_id = ? AND response = 'yes' ${excludeInviteId ? 'AND id != ?' : ''}`
  ).get(...(excludeInviteId ? [eventId, excludeInviteId] : [eventId]));
  return Number(row.n || 0);
}

function seatsLeft(db, event, excludeInviteId = null) {
  if (!event.capacity) return null;
  return Math.max(0, event.capacity - acceptedSeats(db, event.id, excludeInviteId));
}

function pageBgFor(event) {
  const colors = flyerColors(parseFlyer(event));
  return mixWithWhite(colors.ink, 0.07);
}

function flyerHtmlFor(req, event) {
  const flyer = parseFlyer(event);
  const imageUrls = flyerImageUrls(req.pub.org.slug, flyer);
  return renderFlyer({ event, flyer, imageUrls });
}

function calendarButtons(req, event, icsPath) {
  if (!event.date || event.status === 'cancelled') return '';
  const gcal = googleCalendarUrl({ event, url: publicUrl(req.pub.org.slug, `/e/${event.slug}`) });
  return `<div class="pub-actions">
    <a class="pub-btn pub-btn-ghost" href="${esc(gcal)}" target="_blank" rel="noopener">Add to Google Calendar</a>
    <a class="pub-btn pub-btn-ghost" href="${esc(icsPath)}">Download .ics (Apple / Outlook)</a>
  </div>`;
}

function detailsCard(event) {
  const tel = String(event.venue_phone || '').replace(/[^\d+]/g, '');
  const rows = [
    { k: 'When', v: formatWhen(event) },
    { k: 'Where', v: [event.venue_name, event.venue_address].filter(Boolean).join(' — ') },
    event.venue_phone ? { k: 'Phone', html: `<a href="tel:${esc(tel)}">${esc(event.venue_phone)}</a>` } : null,
    event.venue_map_url
      ? { k: 'Map', html: `<a href="${esc(event.venue_map_url)}" target="_blank" rel="noopener noreferrer">Get directions ↗</a>` }
      : null,
    { k: 'Host', v: event.host_name || '' },
    event.rsvp_mode === 'rsvp' && event.rsvp_deadline ? { k: 'RSVP by', v: formatDate(event.rsvp_deadline) } : null,
  ].filter((r) => r && (r.v || r.html));
  if (!rows.length && !event.description) return '';
  // Descriptions are stored as sanitized rich-text HTML; older ones are plain
  // text, rendered with textToHtml so their line breaks survive.
  const descHtml = event.description
    ? (looksLikeHtml(event.description) ? sanitizeRichText(event.description) : textToHtml(event.description))
    : '';
  return `<div class="pub-card">
    ${descHtml ? `<div class="rt-content" style="font-size:15.5px; margin-bottom:${rows.length ? '16px' : '0'};">${descHtml}</div>` : ''}
    ${rows.map((r) => `<div class="pub-detail"><div class="k">${esc(r.k)}</div><div>${r.html || esc(r.v)}</div></div>`).join('')}
  </div>`;
}

function guestListCard(db, event) {
  if (!event.show_guest_list) return '';
  const rows = db.prepare(`
    SELECT COALESCE(c.name, i.guest_name) AS name, i.party_size
    FROM invites i LEFT JOIN contacts c ON c.id = i.contact_id
    WHERE i.event_id = ? AND i.response = 'yes'
    ORDER BY i.responded_at LIMIT 80
  `).all(event.id);
  if (!rows.length) return '';
  const chips = rows.map((r) => {
    const parts = String(r.name || 'Guest').trim().split(/\s+/);
    const shown = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
    const extra = r.party_size > 1 ? ` +${r.party_size - 1}` : '';
    return `<span class="pub-chip">${esc(shown)}${esc(extra)}</span>`;
  }).join('');
  const total = db.prepare(
    `SELECT COALESCE(SUM(party_size), 0) AS n FROM invites WHERE event_id = ? AND response = 'yes'`
  ).get(event.id);
  return `<div class="pub-card"><h2>Who's coming (${Number(total.n)})</h2><div class="pub-chips">${chips}</div></div>`;
}

// max_party_size of 0 means unlimited — offer a number input rather than a
// dropdown of every value.
function partyCap(event) {
  if (!event.allow_plus_ones) return 1;
  const cap = Number(event.max_party_size) || 0;
  return cap > 0 ? cap : 99;
}

function partySelect(event, current = 1) {
  if (!event.allow_plus_ones) return '';
  const cap = Number(event.max_party_size) || 0;
  if (!cap) {
    return `<div class="pub-field"><label for="party_size">How many in your party?</label>
      <input id="party_size" name="party_size" type="number" min="1" max="99" value="${Math.max(1, current)}"
        style="max-width:150px;"></div>`;
  }
  const options = Array.from({ length: cap }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === current ? 'selected' : ''}>${n === 1 ? 'Just me' : `${n} people (me + ${n - 1})`}</option>`)
    .join('');
  return `<div class="pub-field"><label for="party_size">How many in your party?</label>
    <select id="party_size" name="party_size">${options}</select></div>`;
}

function statusBanner(text, kind = 'ok') {
  return `<div class="pub-banner pub-banner-${kind}">${text}</div>`;
}

function orgFooter(req) {
  return `${esc(req.pub.org.name)}`;
}

// --- event landing page ----------------------------------------------------

publicRouter.get('/e/:slug', (req, res) => {
  const db = req.pub.db;
  const event = eventBySlug(db, req.params.slug);
  if (!event) return notFoundPage(res);

  // Drafts are only visible to signed-in members of the same organization.
  let previewBanner = '';
  if (event.status === 'draft') {
    const session = resolveSession(req);
    if (!session || session.org.slug !== req.pub.org.slug) return notFoundPage(res);
    previewBanner = statusBanner('Draft preview — guests cannot see this page yet.', 'warn');
  }

  const cancelled = event.status === 'cancelled';
  const closed = deadlinePassed(event);
  const left = seatsLeft(db, event);
  const full = left !== null && left <= 0;

  let rsvpCard = '';
  if (!cancelled && event.rsvp_mode === 'open') {
    rsvpCard = `<div class="pub-card"><h2>No RSVP needed</h2>
      <p class="pub-muted">This is an open event — just show up! Add it to your calendar so you don't miss it.</p>
      ${calendarButtons(req, event, `/o/${esc(req.pub.org.slug)}/e/${esc(event.slug)}/ics`)}</div>`;
  } else if (!cancelled && event.rsvp_mode === 'rsvp') {
    if (!event.share_enabled) {
      rsvpCard = `<div class="pub-card"><h2>RSVP</h2>
        <p class="pub-muted">RSVPs for this event are by personal invitation. Use the link in your invitation email to respond.</p></div>`;
    } else if (closed) {
      rsvpCard = `<div class="pub-card"><h2>RSVP closed</h2>
        <p class="pub-muted">The RSVP deadline (${esc(formatDate(event.rsvp_deadline))}) has passed.</p></div>`;
    } else if (full) {
      rsvpCard = `<div class="pub-card"><h2>Event is full</h2>
        <p class="pub-muted">All ${esc(String(event.capacity))} places have been taken. Contact the host if you have questions.</p></div>`;
    } else {
      rsvpCard = `<div class="pub-card"><h2>Will you be there?</h2>
        <form method="post" action="/o/${esc(req.pub.org.slug)}/e/${esc(event.slug)}/rsvp">
          <div class="pub-field"><label for="name">Your name</label>
            <input id="name" name="name" required maxlength="200" autocomplete="name"></div>
          <div class="pub-field"><label for="email">Your email</label>
            <input id="email" name="email" type="email" required maxlength="254" autocomplete="email"></div>
          ${partySelect(event)}
          <div class="pub-field"><label for="note">Message for the host (optional)</label>
            <input id="note" name="note" maxlength="500"></div>
          <div class="pub-actions">
            <button class="pub-btn pub-btn-yes" type="submit" name="attending" value="yes">&#10003;&nbsp; I'll be there</button>
            <button class="pub-btn pub-btn-no" type="submit" name="attending" value="no">&#10007;&nbsp; Can't make it</button>
          </div>
        </form>
        ${left !== null ? `<p class="pub-muted" style="margin-top:12px;">${esc(String(left))} of ${esc(String(event.capacity))} places remaining.</p>` : ''}
      </div>`;
    }
  }

  res.send(publicPage({
    title: event.title,
    pageBg: pageBgFor(event),
    bodyHtml: `
      ${previewBanner}
      ${cancelled ? statusBanner('This event has been cancelled.', 'no') : ''}
      ${flyerHtmlFor(req, event)}
      ${detailsCard(event)}
      ${rsvpCard}
      ${!cancelled && event.rsvp_mode === 'rsvp' ? `<div class="pub-card">${calendarButtons(req, event, `/o/${esc(req.pub.org.slug)}/e/${esc(event.slug)}/ics`) || '<p class="pub-muted">Calendar links appear once the event has a date.</p>'}</div>` : ''}
      ${guestListCard(db, event)}
    `,
    footerHtml: orgFooter(req),
  }));
});

// Open RSVP from the shareable link: creates (or updates) an invite keyed by
// the guest's email, then redirects to their personal invite page.
publicRouter.post('/e/:slug/rsvp', (req, res) => {
  const db = req.pub.db;
  const event = eventBySlug(db, req.params.slug);
  if (!event || event.status !== 'published') return notFoundPage(res);
  if (event.rsvp_mode !== 'rsvp' || !event.share_enabled) return notFoundPage(res);
  if (!take(`rsvp:${req.ip}`, 30, 60 * 60 * 1000)) {
    return res.status(429).send(publicPage({
      title: 'Slow down', bodyHtml: `<div class="pub-card"><h2>Too many requests</h2>
      <p class="pub-muted">Please wait a little while and try again.</p></div>`,
    }));
  }

  const name = String(req.body.name || '').trim().slice(0, 200);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  const attending = req.body.attending === 'no' ? 'no' : 'yes';
  const note = String(req.body.note || '').trim().slice(0, 500) || null;
  let party = Number(req.body.party_size || 1);
  if (!Number.isInteger(party) || party < 1) party = 1;
  party = Math.min(party, partyCap(event));

  if (!name || !isValidEmail(email)) {
    return res.status(400).send(publicPage({
      title: 'Check your details', bodyHtml: `<div class="pub-card"><h2>Something's missing</h2>
      <p class="pub-muted">Please go back and enter your name and a valid email address.</p></div>`,
    }));
  }
  if (deadlinePassed(event)) return res.redirect(303, `/o/${req.pub.org.slug}/e/${event.slug}`);

  // Reuse an existing invite for this email (personal invite or earlier link
  // RSVP); otherwise create a fresh one.
  let invite = db.prepare(`
    SELECT i.* FROM invites i
    LEFT JOIN contacts c ON c.id = i.contact_id
    WHERE i.event_id = ? AND (i.guest_email = ? OR c.email = ?)
    ORDER BY i.id LIMIT 1
  `).get(event.id, email, email);

  if (attending === 'yes') {
    const left = seatsLeft(db, event, invite?.id ?? null);
    if (left !== null && party > left) {
      return res.send(publicPage({
        title: 'Event is full', pageBg: pageBgFor(event),
        bodyHtml: `${flyerHtmlFor(req, event)}
          <div class="pub-card"><h2>Not enough places left</h2>
          <p class="pub-muted">${left === 0 ? 'The event has filled up.' : `Only ${left} place${left === 1 ? '' : 's'} remain${left === 1 ? 's' : ''}.`}
          You can go back and try a smaller party size.</p></div>`,
        footerHtml: orgFooter(req),
      }));
    }
  }

  if (invite) {
    db.prepare(`UPDATE invites SET guest_name = ?, guest_email = ?, response = ?, party_size = ?, note = ?, responded_at = ? WHERE id = ?`)
      .run(name, email, attending, party, note, nowSql(), invite.id);
  } else {
    const contact = db.prepare('SELECT id FROM contacts WHERE email = ?').get(email);
    const info = db.prepare(`
      INSERT INTO invites (event_id, contact_id, guest_name, guest_email, token, source, response, party_size, note, responded_at)
      VALUES (?, ?, ?, ?, ?, 'link', ?, ?, ?, ?)
    `).run(event.id, contact?.id ?? null, name, email, randomToken(24), attending, party, note, nowSql());
    invite = db.prepare('SELECT * FROM invites WHERE id = ?').get(insertId(info));
  }
  res.redirect(303, `/o/${req.pub.org.slug}/i/${invite.token}?thanks=1`);
});

publicRouter.get('/e/:slug/ics', (req, res) => {
  const event = eventBySlug(req.pub.db, req.params.slug);
  if (!event || event.status === 'draft') return notFoundPage(res);
  const ics = buildIcs({
    event, orgName: req.pub.org.name,
    url: publicUrl(req.pub.org.slug, `/e/${event.slug}`),
    uidKey: event.slug,
  });
  if (!ics) return notFoundPage(res, 'This event has no date yet.');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="event.ics"');
  res.send(ics);
});

// --- personal invite pages -------------------------------------------------

function respondCard(req, event, invite) {
  const db = req.pub.db;
  const closed = deadlinePassed(event);
  const cancelled = event.status === 'cancelled';
  if (cancelled || closed) return '';
  const base = `/o/${esc(req.pub.org.slug)}/i/${esc(invite.token)}`;
  const left = seatsLeft(db, event, invite.id);
  const yesDisabled = left !== null && left <= 0 && invite.response !== 'yes';

  const changeForm = invite.response === 'yes' && event.allow_plus_ones
    ? `<form method="post" action="${base}" style="margin-top:18px;">
        ${partySelect(event, invite.party_size)}
        <div class="pub-field"><label for="note">Message for the host (optional)</label>
          <input id="note" name="note" maxlength="500" value="${esc(invite.note || '')}"></div>
        <button class="pub-btn pub-btn-plain" type="submit">Update my RSVP</button>
      </form>`
    : '';

  return `<div class="pub-card">
    <h2>${invite.response === null ? 'Will you be there?' : 'Change your response'}</h2>
    <div class="pub-actions">
      ${yesDisabled
        ? `<span class="pub-btn" style="background:#e5e7eb; color:#9ca3af;">Event is full</span>`
        : `<a class="pub-btn pub-btn-yes" href="${base}/accept">&#10003;&nbsp; ${invite.response === 'yes' ? "I'm still coming" : "I'll be there"}</a>`}
      <a class="pub-btn pub-btn-no" href="${base}/decline">&#10007;&nbsp; ${invite.response === 'no' ? 'Still can’t make it' : 'Can’t make it'}</a>
    </div>
    ${changeForm}
  </div>`;
}

publicRouter.get('/i/:token', (req, res) => {
  const db = req.pub.db;
  const invite = inviteByToken(db, req.params.token);
  if (!invite) return notFoundPage(res);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(invite.event_id);
  if (!event || event.status === 'draft') return notFoundPage(res);

  const name = firstName(invite.guest_name || '') || 'there';
  const q = req.query;
  let banner = '';
  if (event.status === 'cancelled') banner = statusBanner('This event has been cancelled.', 'no');
  else if (q.full !== undefined) banner = statusBanner('Sorry — the event has filled up, so we could not register your acceptance.', 'warn');
  else if (q.closed !== undefined) banner = statusBanner('The RSVP deadline has passed, so responses can no longer be changed.', 'warn');
  else if (q.done === 'accept' || q.thanks !== undefined && invite.response === 'yes') banner = statusBanner(`Wonderful, ${esc(name)} — you're on the list! We've saved your RSVP.`, 'ok');
  else if (q.done === 'decline' || q.thanks !== undefined && invite.response === 'no') banner = statusBanner(`Thanks for letting us know, ${esc(name)}. We'll miss you!`, 'no');
  else if (q.updated !== undefined) banner = statusBanner('Your RSVP has been updated.', 'ok');
  else if (invite.response === 'yes') banner = statusBanner(`You're going! ${invite.party_size > 1 ? `Party of ${invite.party_size}.` : ''}`, 'ok');
  else if (invite.response === 'no') banner = statusBanner("You've declined this invitation.", 'no');
  else if (event.rsvp_mode === 'rsvp' && deadlinePassed(event)) banner = statusBanner('The RSVP deadline has passed.', 'warn');

  res.send(publicPage({
    title: event.title,
    pageBg: pageBgFor(event),
    bodyHtml: `
      ${banner}
      ${flyerHtmlFor(req, event)}
      ${detailsCard(event)}
      ${event.rsvp_mode === 'rsvp' ? respondCard(req, event, invite) : ''}
      ${invite.response !== 'no' && event.status !== 'cancelled'
        ? `<div class="pub-card">${calendarButtons(req, event, `/o/${esc(req.pub.org.slug)}/i/${esc(invite.token)}/ics`) || '<p class="pub-muted">Calendar links appear once the event has a date.</p>'}</div>`
        : ''}
      ${guestListCard(db, event)}
      <div class="pub-card"><p class="pub-muted">Shareable event page:
        <a href="/o/${esc(req.pub.org.slug)}/e/${esc(event.slug)}">${esc(publicUrl(req.pub.org.slug, `/e/${event.slug}`))}</a></p></div>
    `,
    footerHtml: orgFooter(req),
  }));
});

function recordResponse(req, res, answer) {
  const db = req.pub.db;
  const invite = inviteByToken(db, req.params.token);
  if (!invite) return notFoundPage(res);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(invite.event_id);
  if (!event || event.status === 'draft') return notFoundPage(res);
  const base = `/o/${req.pub.org.slug}/i/${invite.token}`;

  if (event.status === 'cancelled') return res.redirect(303, base);
  if (event.rsvp_mode !== 'rsvp') return res.redirect(303, base);
  if (deadlinePassed(event)) return res.redirect(303, `${base}?closed=1`);
  if (answer === 'yes') {
    const left = seatsLeft(db, event, invite.id);
    if (left !== null && invite.party_size > left) return res.redirect(303, `${base}?full=1`);
  }
  db.prepare('UPDATE invites SET response = ?, responded_at = ? WHERE id = ?')
    .run(answer, nowSql(), invite.id);
  res.redirect(303, `${base}?done=${answer === 'yes' ? 'accept' : 'decline'}`);
}

publicRouter.get('/i/:token/accept', (req, res) => recordResponse(req, res, 'yes'));
publicRouter.get('/i/:token/decline', (req, res) => recordResponse(req, res, 'no'));

publicRouter.post('/i/:token', (req, res) => {
  const db = req.pub.db;
  if (!take(`iupd:${req.ip}`, 60, 60 * 60 * 1000)) return res.status(429).send('Too many requests');
  const invite = inviteByToken(db, req.params.token);
  if (!invite) return notFoundPage(res);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(invite.event_id);
  if (!event || event.status !== 'published') return notFoundPage(res);
  if (deadlinePassed(event)) return res.redirect(303, `/o/${req.pub.org.slug}/i/${invite.token}?closed=1`);

  let party = Number(req.body.party_size || invite.party_size);
  if (!Number.isInteger(party) || party < 1) party = invite.party_size;
  party = Math.min(party, partyCap(event));
  const note = String(req.body.note ?? invite.note ?? '').trim().slice(0, 500) || null;

  if (invite.response === 'yes') {
    const left = seatsLeft(db, event, invite.id);
    if (left !== null && party > left) {
      return res.redirect(303, `/o/${req.pub.org.slug}/i/${invite.token}?full=1`);
    }
  }
  db.prepare('UPDATE invites SET party_size = ?, note = ? WHERE id = ?').run(party, note, invite.id);
  res.redirect(303, `/o/${req.pub.org.slug}/i/${invite.token}?updated=1`);
});

publicRouter.get('/i/:token/ics', (req, res) => {
  const db = req.pub.db;
  const invite = inviteByToken(db, req.params.token);
  if (!invite) return notFoundPage(res);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(invite.event_id);
  if (!event || event.status === 'draft') return notFoundPage(res);
  const ics = buildIcs({
    event, orgName: req.pub.org.name,
    url: publicUrl(req.pub.org.slug, `/e/${event.slug}`),
    uidKey: invite.token,
  });
  if (!ics) return notFoundPage(res, 'This event has no date yet.');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="event.ics"');
  res.send(ics);
});

// --- unsubscribe -----------------------------------------------------------

publicRouter.get('/u/:token', (req, res) => {
  const db = req.pub.db;
  const invite = inviteByToken(db, req.params.token);
  if (!invite) return notFoundPage(res);
  const email = invite.contact_id
    ? db.prepare('SELECT email FROM contacts WHERE id = ?').get(invite.contact_id)?.email
    : invite.guest_email;
  if (!email) return notFoundPage(res);
  res.send(publicPage({
    title: 'Unsubscribe',
    bodyHtml: `<div class="pub-card"><h2>Stop receiving emails?</h2>
      <p class="pub-muted">${esc(email)} will no longer receive invitations or updates from ${esc(req.pub.org.name)}.</p>
      <form method="post" action="/o/${esc(req.pub.org.slug)}/u/${esc(invite.token)}" style="margin-top:14px;">
        <button class="pub-btn pub-btn-plain" type="submit">Unsubscribe</button>
      </form></div>`,
    footerHtml: orgFooter(req),
  }));
});

publicRouter.post('/u/:token', (req, res) => {
  const db = req.pub.db;
  if (!take(`unsub:${req.ip}`, 30, 60 * 60 * 1000)) return res.status(429).send('Too many requests');
  const invite = inviteByToken(db, req.params.token);
  if (!invite) return notFoundPage(res);
  const email = (invite.contact_id
    ? db.prepare('SELECT email FROM contacts WHERE id = ?').get(invite.contact_id)?.email
    : invite.guest_email)?.toLowerCase();
  if (!email) return notFoundPage(res);

  const existing = db.prepare('SELECT id FROM contacts WHERE email = ?').get(email);
  if (existing) {
    db.prepare(`UPDATE contacts SET unsubscribed_at = datetime('now') WHERE id = ?`).run(existing.id);
    db.prepare('DELETE FROM group_members WHERE contact_id = ?').run(existing.id);
  } else {
    db.prepare(`INSERT INTO contacts (name, email, unsubscribed_at) VALUES (?, ?, datetime('now'))`)
      .run(invite.guest_name || email, email);
  }
  res.send(publicPage({
    title: 'Unsubscribed',
    bodyHtml: `<div class="pub-card"><h2>You're unsubscribed</h2>
      <p class="pub-muted">${esc(email)} will not receive further emails from ${esc(req.pub.org.name)}.</p></div>`,
    footerHtml: orgFooter(req),
  }));
});

// --- broadcast web version -------------------------------------------------

function broadcastBySlug(db, slug) {
  if (!/^[a-z0-9]{4,20}$/.test(String(slug))) return null;
  return db.prepare('SELECT * FROM broadcasts WHERE slug = ?').get(slug) || null;
}

publicRouter.get('/b/:slug', (req, res) => {
  const db = req.pub.db;
  const b = broadcastBySlug(db, req.params.slug);
  if (!b) return notFoundPage(res);

  // Drafts are visible only to a signed-in member of the same org (preview);
  // sent broadcasts require the web version to be enabled.
  if (b.status === 'draft') {
    const session = resolveSession(req);
    if (!session || session.org.slug !== req.pub.org.slug) return notFoundPage(res);
  } else if (!b.web_version) {
    return notFoundPage(res);
  }

  const flyer = parseFlyer(b);
  const imageUrls = flyerImageUrls(req.pub.org.slug, flyer);
  const flyerHtml = renderFlyer({ event: { title: b.title }, flyer, imageUrls, hideEventMeta: true });
  const ctx = buildBroadcastTagContext({ org: req.pub.org, recipientName: '' });
  const bodyText = renderTags(b.body || '', ctx);

  res.send(publicPage({
    title: b.title,
    pageBg: mixWithWhite(flyerColors(flyer).ink, 0.07),
    bodyHtml: `
      ${b.status === 'draft' ? statusBanner('Draft preview — this broadcast has not been sent yet.', 'warn') : ''}
      ${flyerHtml}
      ${bodyText.trim() ? `<div class="pub-card">${textToHtml(bodyText)}</div>` : ''}
    `,
    footerHtml: orgFooter(req),
  }));
});

// Broadcast unsubscribe (stateless signed contact token; see sending.js).
publicRouter.get('/bu/:token', (req, res) => {
  const db = req.pub.db;
  const contactId = verifyContactToken(req.params.token);
  const contact = contactId ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) : null;
  if (!contact || !contact.email) return notFoundPage(res);
  res.send(publicPage({
    title: 'Unsubscribe',
    bodyHtml: `<div class="pub-card"><h2>Stop receiving emails?</h2>
      <p class="pub-muted">${esc(contact.email)} will no longer receive announcements or invitations from ${esc(req.pub.org.name)}.</p>
      <form method="post" action="/o/${esc(req.pub.org.slug)}/bu/${esc(req.params.token)}" style="margin-top:14px;">
        <button class="pub-btn pub-btn-plain" type="submit">Unsubscribe</button>
      </form></div>`,
    footerHtml: orgFooter(req),
  }));
});

publicRouter.post('/bu/:token', (req, res) => {
  const db = req.pub.db;
  if (!take(`unsub:${req.ip}`, 30, 60 * 60 * 1000)) return res.status(429).send('Too many requests');
  const contactId = verifyContactToken(req.params.token);
  const contact = contactId ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) : null;
  const email = (contact?.email || '').toLowerCase();
  if (!email) return notFoundPage(res);
  db.prepare(`UPDATE contacts SET unsubscribed_at = datetime('now') WHERE email = ?`).run(email);
  db.prepare('DELETE FROM group_members WHERE contact_id IN (SELECT id FROM contacts WHERE email = ?)').run(email);
  res.send(publicPage({
    title: 'Unsubscribed',
    bodyHtml: `<div class="pub-card"><h2>You're unsubscribed</h2>
      <p class="pub-muted">${esc(email)} will not receive further emails from ${esc(req.pub.org.name)}.</p></div>`,
    footerHtml: orgFooter(req),
  }));
});

// --- uploaded files --------------------------------------------------------

publicRouter.get('/files/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9]{6,64}$/.test(token)) return res.status(404).end();
  const row = req.pub.db.prepare('SELECT * FROM uploads WHERE token = ?').get(token);
  if (!row) return res.status(404).end();
  const file = path.join(uploadsDir(req.pub.org.slug), token);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file);
});
