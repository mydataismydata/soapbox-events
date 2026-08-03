// HTML email rendering. Emails use table layout and inline styles for broad
// client compatibility, and always include a plain-text alternative.
//
// The Accept / Decline buttons are deliberately rendered in fixed, high-
// contrast colors (green / red) regardless of the flyer palette so they are
// instantly identifiable in every invitation.
import { esc, textToHtml, stripImageMarkers, flattenLinks } from './html.js';
import { formatDate, formatTimeRange, formatWhen } from './format.js';
import { contrastOn } from './flyer.js';

const ACCEPT_COLOR = '#16a34a';
// Email has no stylesheet to lean on, so links carry their own colour.
const EMAIL_LINK_STYLE = 'color:#4f46e5;';
const DECLINE_COLOR = '#dc2626';

function button(href, label, bg, color = '#ffffff') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;"><tr>
    <td bgcolor="${bg}" style="border-radius:9px;">
      <a href="${esc(href)}" target="_blank"
         style="display:inline-block; padding:14px 32px; font-size:16px; font-weight:700;
                color:${color}; text-decoration:none; border-radius:9px;">${label}</a>
    </td></tr></table>`;
}

function detailRow(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:7px 14px 7px 0; font-size:12px; text-transform:uppercase; letter-spacing:0.08em;
        color:#6b7280; vertical-align:top; white-space:nowrap;">${esc(label)}</td>
    <td style="padding:7px 0; font-size:15px; color:#1f2937;">${esc(value)}</td>
  </tr>`;
}

function detailsBox({ event, links }) {
  const rows = [
    detailRow('When', formatWhen(event)),
    detailRow('Where', [event.venue_name, event.venue_address].filter(Boolean).join(' — ')),
    detailRow('Phone', event.venue_phone || ''),
    detailRow('Host', event.host_name || ''),
    event.rsvp_mode === 'rsvp' && event.rsvp_deadline
      ? detailRow('RSVP by', formatDate(event.rsvp_deadline)) : '',
  ].filter(Boolean).join('');
  if (!rows) return '';
  const eventLink = links?.event
    ? `<a href="${esc(links.event)}" style="color:#4f46e5;">Open the event page</a>` : '';
  const directions = event.venue_map_url
    ? `<a href="${esc(event.venue_map_url)}" style="color:#4f46e5;">Get directions</a>` : '';
  const linkLine = [eventLink, directions].filter(Boolean).join(' &nbsp;·&nbsp; ');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; margin:22px 0 6px;">
    <tr><td style="padding:16px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
      ${linkLine ? `<div style="padding-top:10px; font-size:13.5px;">${linkLine}</div>` : ''}
    </td></tr></table>`;
}

// The message opens with the host's own words — no coloured masthead, no
// title block, no featured-image strip. Anyone who wants a banner turns on
// "Include flyer in email", which puts the real flyer in the body instead.
function shell({ preheader, contentHtml, footerHtml }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge"></head>
<body style="margin:0; padding:0; background:#eef0f3;
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef0f3">
<tr><td align="center" style="padding:26px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0"
    style="max-width:600px; width:100%; background:#ffffff; border-radius:14px; overflow:hidden;">
    <tr><td style="padding:30px 36px;">${contentHtml}</td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
    <tr><td align="center" style="padding:18px 24px; font-size:12px; line-height:1.6; color:#9ca3af;">
      ${footerHtml}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// `imageUrl` resolves an {{image:token}} marker to a public file URL. It is
// threaded in from the caller rather than built here: this module knows how an
// email looks, not where the organization's files live.
function bodyBlock(bodyText, imageUrl) {
  const html = textToHtml(bodyText, { imageUrl, linkStyle: EMAIL_LINK_STYLE });
  if (!html) return '';
  return `<div style="font-size:15.5px; line-height:1.65; color:#374151;">${html}</div>`;
}

// Plain-text alternative: drop the blocks that came out empty, then separate
// what's left with one blank line. Building it block-by-block keeps the
// spacing right however many pieces a given email actually has.
function textBlocks(...blocks) {
  return blocks
    .map((b) => (Array.isArray(b) ? b.filter(Boolean).join('\n') : b))
    .map((b) => (b || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function footer({ orgName, toEmail, unsubUrl, note, viewUrl }) {
  return [
    note ? esc(note) : '',
    viewUrl ? `<a href="${esc(viewUrl)}" style="color:#9ca3af;">View this email online</a>` : '',
    `This email was sent to ${esc(toEmail)} by ${esc(orgName)}.`,
    unsubUrl ? `<a href="${esc(unsubUrl)}" style="color:#9ca3af;">Stop receiving emails from ${esc(orgName)}</a>` : '',
  ].filter(Boolean).join('<br>');
}

function rsvpButtons(links) {
  return `
  <div style="text-align:center; padding:10px 0 4px;">
    <div style="font-size:17px; font-weight:700; color:#1f2937; padding-bottom:14px;">Will you be there?</div>
    <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
      <td>${button(links.accept, '&#10003;&nbsp; Accept', ACCEPT_COLOR)}</td>
      <td style="width:18px;">&nbsp;</td>
      <td>${button(links.decline, '&#10007;&nbsp; Decline', DECLINE_COLOR)}</td>
    </tr></table>
    <div style="padding-top:14px; font-size:13px; color:#6b7280;">
      Buttons not working? <a href="${esc(links.rsvp)}" style="color:#4f46e5;">Open your RSVP page</a>
    </div>
  </div>`;
}

// A picture of the flyer at the foot of the invitation, under the RSVP
// buttons. It links to the event page so a click still goes somewhere useful,
// and carries alt text for clients that block images.
function flyerPicture(url, links) {
  if (!url) return '';
  const img = `<img src="${esc(url)}" alt="Event flyer" width="600"
    style="width:100%; max-width:600px; display:block; border:0; border-radius:10px;">`;
  const wrapped = links?.event
    ? `<a href="${esc(links.event)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
  return `<div style="padding:26px 0 2px; line-height:0;">${wrapped}</div>`;
}

// --- public API ------------------------------------------------------------

export function renderInvitationEmail({ org, event, accent, toName, toEmail, bodyText, links, flyerImageUrl, unsubUrl, imageUrl }) {
  const whenLine = formatWhen(event);
  const isRsvp = event.rsvp_mode === 'rsvp';
  const content = `
    ${bodyBlock(bodyText, imageUrl)}
    ${detailsBox({ event, links })}
    ${isRsvp ? rsvpButtons(links) : `
      <div style="text-align:center; padding:16px 0 4px;">
        ${button(links.event, 'View event details', accent, contrastOn(accent))}
        <div style="padding-top:12px; font-size:13px; color:#6b7280;">No RSVP needed — this is an open event.</div>
      </div>`}
    ${flyerPicture(flyerImageUrl, links)}
  `;
  const html = shell({
    preheader: `${event.title} — ${whenLine}`,
    contentHtml: content,
    footerHtml: footer({ orgName: org.name, toEmail, unsubUrl }),
  });
  // The plain-text alternative follows the same order as the HTML: the
  // message first, then the details it refers to.
  const text = textBlocks(
    flattenLinks(stripImageMarkers(bodyText)),
    [event.title, whenLine, [event.venue_name, event.venue_address].filter(Boolean).join(' — ')],
    isRsvp
      ? [`Accept: ${links.accept}`, `Decline: ${links.decline}`, `Your RSVP page: ${links.rsvp}`]
      : `Event page: ${links.event}`,
    [`Sent to ${toEmail} by ${org.name}.`, unsubUrl ? `Unsubscribe: ${unsubUrl}` : ''],
  );
  return { html, text };
}

// Only the preheader — the inbox preview line — still says what kind of
// message this is. Nothing is stamped across the top of the body.
const KIND_PREHEADERS = {
  follow_up: 'Event update',
  nudge: 'Reminder — please RSVP',
  cancellation: 'Event cancelled',
};

export function renderMessageEmail({ kind, org, event, toEmail, bodyText, links, unsubUrl, imageUrl }) {
  const label = KIND_PREHEADERS[kind] || org.name;
  const whenLine = formatWhen(event);
  const showButtons = kind === 'nudge' && event.rsvp_mode === 'rsvp' && event.status !== 'cancelled';
  const content = `
    ${bodyBlock(bodyText, imageUrl)}
    ${kind === 'cancellation' ? '' : detailsBox({ event, links })}
    ${showButtons ? rsvpButtons(links) : ''}
  `;
  const html = shell({
    preheader: `${label}: ${event.title}`,
    contentHtml: content,
    footerHtml: footer({ orgName: org.name, toEmail, unsubUrl }),
  });
  const text = textBlocks(
    flattenLinks(stripImageMarkers(bodyText)),
    kind === 'cancellation' ? '' : [event.title, whenLine],
    showButtons
      ? [`Accept: ${links.accept}`, `Decline: ${links.decline}`]
      : (links?.event && kind !== 'cancellation' ? `Event page: ${links.event}` : ''),
    [`Sent to ${toEmail} by ${org.name}.`, unsubUrl ? `Unsubscribe: ${unsubUrl}` : ''],
  );
  return { html, text };
}

// Standalone broadcast (email blast not tied to an event): just the message
// body, then the footer with the "view online" and unsubscribe links. The
// flyer still fronts the web version — it is no longer stamped on the email.
export function renderBroadcastEmail({ org, title, toEmail, bodyText, viewUrl, unsubUrl, imageUrl }) {
  const html = shell({
    preheader: title || org.name,
    contentHtml: bodyBlock(bodyText, imageUrl),
    footerHtml: footer({ orgName: org.name, toEmail, unsubUrl, viewUrl }),
  });
  const text = textBlocks(
    flattenLinks(stripImageMarkers(bodyText)),
    viewUrl ? `View online: ${viewUrl}` : '',
    [`Sent to ${toEmail} by ${org.name}.`, unsubUrl ? `Unsubscribe: ${unsubUrl}` : ''],
  );
  return { html, text };
}

export const DEFAULT_BROADCAST_BODY =
`Hi {{first_name}},

Write your message here.

— {{org_name}}`;

export const DEFAULT_INVITE_BODY =
`Hi {{first_name}},

{{host_name}} invites you to {{event_title}} on {{event_date}}. We'd love to see you there!

Please let us know if you can make it using the buttons below.`;

export const DEFAULT_NUDGE_BODY =
`Hi {{first_name}},

Just a friendly reminder — we haven't heard back from you about {{event_title}} on {{event_date}}.

It only takes a second to reply with the buttons below. We hope you can join us!`;

export const DEFAULT_FOLLOW_UP_BODY =
`Hi {{first_name}},

Great news — you're confirmed for {{event_title}} on {{event_date}}. Here are the details once more; we're looking forward to seeing you!`;

export const DEFAULT_CANCEL_BODY =
`Hi {{first_name}},

We're sorry to share that {{event_title}}, planned for {{event_date}}, has been cancelled.

Thank you for your understanding — we hope to see you at a future event.`;
