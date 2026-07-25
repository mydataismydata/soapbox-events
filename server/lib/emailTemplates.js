// HTML email rendering. Emails use table layout and inline styles for broad
// client compatibility, and always include a plain-text alternative.
//
// The Accept / Decline buttons are deliberately rendered in fixed, high-
// contrast colors (green / red) regardless of the flyer palette so they are
// instantly identifiable in every invitation.
import { esc, textToHtml } from './html.js';
import { formatDate, formatTimeRange, formatWhen } from './format.js';
import { contrastOn } from './flyer.js';

const ACCEPT_COLOR = '#16a34a';
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

function shell({ accent, preheader, headerHtml, contentHtml, footerHtml }) {
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
    <tr><td bgcolor="${accent}" style="padding:0; line-height:0; font-size:0;">&nbsp;</td></tr>
    ${headerHtml}
    <tr><td style="padding:8px 36px 30px;">${contentHtml}</td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
    <tr><td align="center" style="padding:18px 24px; font-size:12px; line-height:1.6; color:#9ca3af;">
      ${footerHtml}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// The email banner: 1–3 featured images in a row (email-safe table layout).
function headerImages(imageUrls) {
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean);
  if (!urls.length) return '';
  if (urls.length === 1) {
    return `<tr><td style="padding:0; line-height:0;">
      <img src="${esc(urls[0])}" alt="" width="600" style="width:100%; max-height:300px; object-fit:cover; display:block;">
    </td></tr>`;
  }
  const w = Math.floor(600 / urls.length);
  const h = urls.length === 2 ? 200 : 150;
  const cells = urls.map((u) => `<td width="${w}" style="padding:0; line-height:0; vertical-align:top;">
    <img src="${esc(u)}" alt="" width="${w}" style="width:100%; height:${h}px; object-fit:cover; display:block;">
  </td>`).join('');
  return `<tr><td style="padding:0; line-height:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${cells}</tr></table>
  </td></tr>`;
}

function header({ accent, orgName, bannerLabel, title, whenLine, imageUrl, imageUrls }) {
  const onAccent = contrastOn(accent);
  const urls = imageUrls || (imageUrl ? [imageUrl] : []);
  return `
  <tr><td bgcolor="${accent}" style="padding:26px 36px 22px;">
    <div style="font-size:12.5px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase;
      color:${onAccent}; opacity:0.85;">${esc(bannerLabel || orgName)}</div>
    <div style="font-size:27px; font-weight:800; color:${onAccent}; padding-top:6px; line-height:1.2;">${esc(title)}</div>
    ${whenLine ? `<div style="font-size:14.5px; color:${onAccent}; opacity:0.9; padding-top:6px;">${esc(whenLine)}</div>` : ''}
  </td></tr>
  ${headerImages(urls)}`;
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

export function renderInvitationEmail({ org, event, accent, toName, toEmail, bodyText, links, imageUrl, imageUrls, flyerImageUrl, unsubUrl }) {
  const whenLine = formatWhen(event);
  const isRsvp = event.rsvp_mode === 'rsvp';
  const content = `
    ${textToHtml(bodyText) ? `<div style="font-size:15.5px; line-height:1.65; color:#374151; padding-top:16px;">
      ${textToHtml(bodyText)}</div>` : ''}
    ${detailsBox({ event, links })}
    ${isRsvp ? rsvpButtons(links) : `
      <div style="text-align:center; padding:16px 0 4px;">
        ${button(links.event, 'View event details', accent, contrastOn(accent))}
        <div style="padding-top:12px; font-size:13px; color:#6b7280;">No RSVP needed — this is an open event.</div>
      </div>`}
    ${flyerPicture(flyerImageUrl, links)}
  `;
  const html = shell({
    accent,
    preheader: `${event.title} — ${whenLine}`,
    headerHtml: header({ accent, orgName: org.name, bannerLabel: "You're invited", title: event.title, whenLine, imageUrl, imageUrls }),
    contentHtml: content,
    footerHtml: footer({ orgName: org.name, toEmail, unsubUrl }),
  });
  const text = [
    `${event.title}`,
    whenLine,
    [event.venue_name, event.venue_address].filter(Boolean).join(' — '),
    '',
    bodyText,
    '',
    isRsvp ? `Accept: ${links.accept}\nDecline: ${links.decline}\nYour RSVP page: ${links.rsvp}` : `Event page: ${links.event}`,
    '',
    `Sent to ${toEmail} by ${org.name}.`,
    unsubUrl ? `Unsubscribe: ${unsubUrl}` : '',
  ].filter((l) => l !== null).join('\n');
  return { html, text };
}

const KIND_BANNERS = {
  follow_up: { label: 'Event update', accentOverride: null },
  nudge: { label: 'Reminder — please RSVP', accentOverride: '#b45309' },
  cancellation: { label: 'Event cancelled', accentOverride: '#b91c1c' },
};

export function renderMessageEmail({ kind, org, event, accent, toEmail, bodyText, links, unsubUrl }) {
  const banner = KIND_BANNERS[kind] || { label: org.name };
  const usedAccent = banner.accentOverride || accent;
  const whenLine = formatWhen(event);
  const showButtons = kind === 'nudge' && event.rsvp_mode === 'rsvp' && event.status !== 'cancelled';
  const content = `
    ${textToHtml(bodyText) ? `<div style="font-size:15.5px; line-height:1.65; color:#374151; padding-top:16px;">
      ${textToHtml(bodyText)}</div>` : ''}
    ${kind === 'cancellation' ? '' : detailsBox({ event, links })}
    ${showButtons ? rsvpButtons(links) : ''}
  `;
  const html = shell({
    accent: usedAccent,
    preheader: `${banner.label}: ${event.title}`,
    headerHtml: header({ accent: usedAccent, orgName: org.name, bannerLabel: banner.label, title: event.title, whenLine: kind === 'cancellation' ? '' : whenLine }),
    contentHtml: content,
    footerHtml: footer({ orgName: org.name, toEmail, unsubUrl }),
  });
  const text = [
    `${banner.label}: ${event.title}`,
    kind === 'cancellation' ? '' : whenLine,
    '',
    bodyText,
    '',
    showButtons ? `Accept: ${links.accept}\nDecline: ${links.decline}` : (links?.event && kind !== 'cancellation' ? `Event page: ${links.event}` : ''),
    '',
    `Sent to ${toEmail} by ${org.name}.`,
    unsubUrl ? `Unsubscribe: ${unsubUrl}` : '',
  ].filter((l) => l !== null).join('\n');
  return { html, text };
}

// Standalone broadcast (email blast not tied to an event): the flyer accent
// and optional featured image in the header, the message body, then footer
// with the "view online" and unsubscribe links. No event details, no RSVP.
export function renderBroadcastEmail({ org, accent, bannerLabel, title, toEmail, bodyText, imageUrl, imageUrls, viewUrl, unsubUrl }) {
  const content = textToHtml(bodyText)
    ? `<div style="font-size:15.5px; line-height:1.65; color:#374151; padding-top:16px;">${textToHtml(bodyText)}</div>`
    : '';
  const html = shell({
    accent,
    preheader: title || bannerLabel || org.name,
    headerHtml: header({
      accent, orgName: org.name, bannerLabel: bannerLabel || org.name,
      title: title || org.name, whenLine: '', imageUrl, imageUrls,
    }),
    contentHtml: content,
    footerHtml: footer({ orgName: org.name, toEmail, unsubUrl, viewUrl }),
  });
  const text = [
    title || bannerLabel || org.name,
    '',
    bodyText,
    '',
    viewUrl ? `View online: ${viewUrl}` : '',
    `Sent to ${toEmail} by ${org.name}.`,
    unsubUrl ? `Unsubscribe: ${unsubUrl}` : '',
  ].filter(Boolean).join('\n');
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
