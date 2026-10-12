// Bot traps for the public RSVP form. It is the one form on the site that
// anybody can post to without a personal link.
//
// Two traps:
//   - A field people never see. A bot fills in every field it finds.
//   - A signed timestamp, made when the form is drawn. A bot posts straight
//     to the form's address, or posts the moment the page loads. A person
//     reads the flyer first.
//
// Nothing here uses JavaScript, so the form still works without it.
import { config } from './env.js';
import { hmacHex, safeEqual } from './tokens.js';

// Named like a field a bot expects. Browsers do not autofill a website.
export const TRAP_FIELD = 'website';

// A form left open longer than this is drawn again before it counts.
const MAX_AGE_MS = 3 * 86400_000;

function sign(eventId, ts) {
  return hmacHex(config.sessionSecret, `rsvp-form:${eventId}:${ts}`).slice(0, 24);
}

// The hidden fields that go inside the form. The trap is moved off the
// screen rather than hidden outright, since some bots skip hidden inputs.
export function trapFields(eventId, now = Date.now()) {
  return `<div class="pub-trap" aria-hidden="true">
      <label for="${TRAP_FIELD}">Website</label>
      <input id="${TRAP_FIELD}" name="${TRAP_FIELD}" type="text" tabindex="-1" autocomplete="off" value="">
    </div>
    <input type="hidden" name="t" value="${now}.${sign(eventId, now)}">`;
}

// What to do with a posted form:
//   'bot'   - no person does this. Answer as if it worked, and keep nothing.
//   'retry' - it may be a person: the stamp is missing, wrong or old, or the
//             reply came too fast. Draw the form again, filled in.
//   ''      - take the reply.
export function checkSubmission(eventId, body, now = Date.now()) {
  if (String(body[TRAP_FIELD] || '').trim()) return 'bot';
  // A person's name never holds a web address.
  if (/https?:\/\/|www\./i.test(String(body.name || ''))) return 'bot';
  const m = /^(\d{10,16})\.([0-9a-f]{24})$/.exec(String(body.t || ''));
  if (!m || !safeEqual(m[2], sign(eventId, m[1]))) return 'retry';
  const age = now - Number(m[1]);
  if (age < config.rsvpMinFillMs || age > MAX_AGE_MS) return 'retry';
  return '';
}
