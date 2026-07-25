# Soapbox — user guide

Everything Soapbox does, in the order you'll meet it.

## Organizations & signing in

Each organization is completely separate: its own sign-in accounts, contacts,
groups, templates, events, and email history live in their own database.
Nothing is shared or visible across organizations.

Sign in at `/app/` with just your **email** and **password** — the app works
out which organization you belong to from your email address, so there's no
organization field to fill in. Organizations are created by the server
operator with `node scripts/create-org.mjs …`, which prints the first
administrator's credentials. (The organization's short "slug" still appears
in public event URLs like `/o/your-org/e/…`, but you never type it to log in.)

**Roles.** Admins manage settings and team members; members do everything
else (events, contacts, sending). Add teammates in **Settings → Team
members** — the app generates a temporary password shown once. Locked out
entirely? The operator can run `node scripts/reset-password.mjs`.

## Contacts

**Contacts** is your organization's address book: name (required), email
(needed for email invitations), phone (for your reference / phone RSVPs),
and notes.

**Importing.** Contacts → *Import CSV*. Paste spreadsheet text or choose a
file. Recognized columns, any order, case-insensitive: `name` (or
`first name` + `last name`), `email`, `phone`, `notes`. Rows whose email
already exists are skipped, so re-importing the same file never creates
duplicates.

**Groups** are reusable audiences ("Choir", "Volunteers", "Board"). Create
them on the Groups page, or select contacts and use *Add to group…*. In the
event wizard you invite a whole group with one click.

## Venues

The **Venues** page is a library of the places you host at — each with a name,
address, phone, and a map link (a Google Maps or directions URL). Save a venue
once and reuse it for every event.

In the event wizard's first step, the **Venue** dropdown fills the address,
phone, and map link from any saved venue in one click — or you can type a
one-off. Started the wizard and realized the venue isn't saved yet? Just type
the details and hit **"Save these details as a reusable venue"** — it's added
to your library without leaving the wizard. On the public event page, guests
see the phone as a tap-to-call link and a **"Get directions"** link to the map.

**Unsubscribes.** Every email carries an unsubscribe link in its footer.
Unsubscribed people are marked in your contact list, skipped automatically by
every send, and reported ("2 unsubscribed skipped"). You can also toggle the
flag manually when someone asks in person.

## Templates & placeholders

**Templates** hold reusable invitation wording. The **default** template
(star it on the Templates page) pre-fills the wizard for new events.

Write with **placeholders** — click a chip to insert one at the cursor; each
fills in per event and per guest at send time:

| Placeholder | Becomes |
| --- | --- |
| `{{first_name}}` / `{{recipient_name}}` | Guest's first / full name |
| `{{event_title}}` | Event title |
| `{{event_date}}` | "Saturday, August 15, 2026" |
| `{{event_time}}` | "6:00 PM – 9:00 PM" |
| `{{venue_name}}` / `{{venue_address}}` | Venue fields |
| `{{host_name}}` | Host (falls back to the organization name) |
| `{{rsvp_deadline}}` | Formatted deadline |
| `{{event_description}}` | Description text |
| `{{org_name}}` | Organization display name |
| `{{event_link}}` | Public event page |
| `{{rsvp_link}}` | Guest's personal RSVP page |
| `{{accept_link}}` / `{{decline_link}}` | One-click response links |

You never need to place the response links yourself — every invitation email
automatically ends with the event-details card and the big green
**✓ Accept** / red **✗ Decline** buttons.

## Creating an event: the wizard

**Events → New event.** Five steps; progress saves automatically, so you can
leave and resume any time (it stays a draft until you send or publish).

1. **Event details** — title (required), host, date/times, timezone note,
   venue (pick a saved one or add a new one right here), description.
2. **RSVP options** — *Collect RSVPs* or *Open event* (no RSVP; invitations
   become informational with a "View event" button). For RSVP events:
   optional deadline (responses close after it), optional capacity (total
   places including plus-ones — accepting closes when full), plus-ones and
   the largest allowed party size, and whether the public page shows the
   guest list (first names + last initial). The *shareable link* toggle
   controls whether strangers with the link can RSVP.
3. **Invitation & flyer** — design the flyer: pick one of six templates,
   each with its own fixed colors. Four are portrait (Blue, White, Red,
   Retro) and two are wide (Spotlight, Panel), which run side-on with the
   type on the left and one photo down the right. Then set fonts, title
   size, four short text slots (eyebrow / tagline / footnote / contact),
   and the featured images — up to three side by side on a portrait
   template (e.g. featured speakers), or a single full-height photo on a
   wide one — each with an optional caption. On the Panel template,
   separating the footnote with `·` turns it into up to three bullet rows.
   Long text shrinks and wraps automatically so it always stays
   inside the flyer. The preview is live and pixel-identical to the public
   page. Below it, write the email: start from a template, insert
   placeholders, and *Preview email* to see the real rendering. The email
   leads with your message and nothing above it — tick **Include flyer in
   email** if you want the artwork in there too. That sends a picture of the
   finished flyer under the Accept / Decline buttons, re-made automatically
   whenever you change the design or the event's date, time or venue.
4. **Guests** — tick groups, tick individual contacts, and add brand-new
   people inline (they're saved to your contacts too). People without an
   email address can be invited but only reached by phone/link.
5. **Review & send** — summary, warnings (e.g. missing date), **Send test
   email** to yourself, then **Send invitations** or **Save without
   sending**. Sending publishes the event page and queues one personalized
   email per guest.

## Broadcasts (email blasts, no event)

Sometimes you need to email your people about something that isn't an event —
an endorsement, a primary reminder, a newsletter. **Broadcasts** do exactly
that: the same flyer designer and templates as events, but no RSVP, no guest
list, no date/venue.

**Broadcasts → New broadcast** opens a slimmed four-step wizard:

1. **Details** — a title (the internal name, also shown on the web version),
   the email subject (defaults to the title), and whether to publish a **web
   version** (see below).
2. **Design & message** — the flyer designer, here producing a *masthead* (the
   styled title block that fronts the web version — no date/venue lines). Then
   the message body, with a template picker and the `{{first_name}}`,
   `{{recipient_name}}`, and `{{org_name}}` placeholders. The email itself goes
   out as your message and nothing else, so the masthead only appears if the
   web version is on.
3. **Recipients** — pick groups and individual contacts, or add new people
   inline (they're saved to your contacts, just like the event wizard).
4. **Review & send** — send yourself a test first, then send. One email is
   queued per recipient who has an address and hasn't unsubscribed.

**Web version.** With it on, the email includes a “View this email online” link
to an unguessable page that renders the masthead and your message — handy when
a mail client clips a long email. Turn it off for an email-only broadcast. It's
a per-broadcast toggle.

**Unsubscribe still applies.** Every broadcast email has an unsubscribe link,
and anyone who has unsubscribed (from a broadcast *or* an event) is skipped and
counted in the send summary. The broadcast page shows delivery counts
(recipients, sent, queued, failed) and a full email log with one-click retry,
exactly like an event's email log. Broadcasts also export to CSV
(Settings → Export, or the button on the Broadcasts page).

## The guest experience

- The **invitation email** shows the event details and two unmistakable
  buttons. One click records their answer and lands them on a confirmation
  page — where they can set how many people they're bringing, leave a note
  for the host, add the event to Google Calendar, or download an .ics file
  for Apple/Outlook.
- The **event page** (`/o/your-org/e/…`) shows the flyer, description,
  details, optionally who's coming, and — if the shareable link is on — an
  RSVP form for people who were never individually invited (name + email +
  party size). Forward the link anywhere; new RSVPs appear in your guest
  list automatically, marked "via link".
- Guests can **change their response** any time until the deadline via their
  personal link. After the deadline the page says responses are closed.
- Cancelling an event puts a clear banner on the page and (optionally)
  notifies everyone who was contacted or had accepted.

## Managing an event

The event page in the app has three tabs:

- **Guests** — everyone invited, their invitation status
  (sent/queued/failed), response, party size, and note. Filter by status;
  add guests; **✓ / ✗** to record phone RSVPs yourself; **✉** to send or
  resend one invitation; **＋** to save a via-link guest into contacts;
  export the list as CSV.
- **Follow-ups & nudges** — three composers: *remind guests who haven't
  replied* (includes the Accept/Decline buttons again), *message everyone
  who accepted* (e.g. parking details), or *message everyone*. Audience,
  subject, and body are editable, placeholders work, and you can preview
  before sending. The app reports how many were queued and how many
  unsubscribed people were skipped.
- **Email log** — every email for this event with its exact rendered
  content, status (queued → sent, or simulated in simulation mode), any
  provider error, and one-click retry for failures.

Header actions: view the public page, edit (reopens the wizard), duplicate
(new draft with the same design/settings, empty guest list), cancel (with
optional notification), and delete for drafts and cancelled events.

## Reports, quota, and your data

- **Dashboard** — upcoming events with yes/no/waiting counts, recent
  responses as they happen, contacts total, emails sent this month, and
  SMTP2GO quota remaining.
- **Event stats** — invited, emailed, accepted (plus total headcount
  including plus-ones), declined, awaiting reply, not yet reached.
- **Exports** (Settings → Export, plus buttons throughout): contacts,
  groups, events (with per-event stats and share URLs), per-event guest
  lists, and the full email log as CSV; plus a complete JSON backup of the
  organization. The server operator's `data/` directory is a byte-perfect
  backup of everything.

## Email sending modes

- **Simulation** (no SMTP2GO key anywhere): sends complete instantly with
  status "Simulated" and full rendered content in the email log. Perfect for
  evaluating and for designing invitations.
- **Live** (key set in `.env` or in Settings → Email sending): mails go out
  through SMTP2GO, throttled (default 60/minute), with failures recorded and
  retryable. Set the sender name and a sender email on your verified domain
  first — the wizard's test-send button is the quickest check.

## Tips

- Send yourself a test email before every real send — it's one click in the
  wizard's review step.
- Set an RSVP deadline a few days before you actually need numbers, then use
  the nudge composer on the stragglers.
- Duplicating last year's event keeps the flyer and wording — you only
  update the date and guests.
- Phone-only guests: invite them (no email needed), call them, and record
  their answer with the ✓/✗ buttons in the guest table.
