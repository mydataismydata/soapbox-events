# Soapbox

A self-hosted replacement for eVite: events, designed invitations, RSVPs,
contact lists, and email delivery — with **no ads, no tracking, and no selling
of anyone's email address**. Built to serve **several completely independent
organizations from one installation**, with hard isolation between them.

## Features

**Events & invitations**
- Guided 5-step wizard: details → RSVP options → invitation & flyer → guests → review & send
- Flyer designer with 6 ready-made templates — four portrait (Blue, White,
  Red, Retro) and two wide (Spotlight, Panel) — each with its own fixed
  color scheme, 5 font pairings, adjustable title sizes, and featured
  images: up to three side by side on the portrait templates (e.g. featured
  speakers), or one full-height photo down the side on the wide ones
- Optional "include flyer in email": the designer renders the flyer to a JPEG
  in the browser (no headless browser on the server) and the invitation carries
  it under the Accept / Decline buttons
- Live preview — the exact renderer that guests see powers the design preview
- Invitation emails with prominent, fixed-color **Accept / Decline buttons**,
  automatic event-details card, plain-text alternative, and per-guest
  placeholders
- Templates with one-click merge tags: `{{first_name}}`, `{{event_date}}`,
  `{{venue_name}}`, `{{rsvp_link}}`, and a dozen more
- RSVP events or open events (no RSVP), RSVP deadlines, capacity limits,
  plus-ones with party-size caps, optional public guest list
- Per-event public landing page rendered from the flyer — no JavaScript
  required for guests
- Shareable link per event that accepts brand-new RSVPs (not tied to any
  invitee), perfect for forwarding
- One-click accept/decline from the email, guests can change their response,
  add a note to the host, and download calendar files (Google Calendar link +
  .ics for Apple/Outlook)
- Follow-up emails to accepted guests, nudge emails to non-responders,
  cancellation notices, test sends to yourself
- Duplicate past events; manual RSVP entry for phone responses

**Broadcasts**
- Standalone email blasts that aren't tied to an event — endorsements, primary
  reminders, newsletters — with the same flyer designer and templates, minus
  RSVP and guest tracking
- A slimmed wizard (details → design & message → recipients → review & send);
  send to groups and individual contacts, add new people inline
- Optional unguessable **web version** ("view this email online") per broadcast,
  rendered from the flyer masthead; per-send toggle. The email itself carries
  your message and nothing above it.
- Every broadcast email carries a one-click unsubscribe; unsubscribed contacts
  are skipped and shared with the event unsubscribe list
- Delivery report (recipients, sent, queued, failed) and a full email log with
  one-click retry
- Email logs everywhere — per event, per broadcast, and an organization-wide
  one — filterable by recipient, type and status, sortable on every column,
  and paginated

**People**
- Contact list with names, emails, phone numbers, and notes
- CSV import (flexible headers, safe to re-import) and CSV export
- Groups ("Choir", "Volunteers", …) — invite a whole group in one click
- Reusable **venue library** (name, address, phone, map link) — pick a saved
  venue in the wizard or add a new one without leaving it; guests get a
  tap-to-call phone and a "Get directions" link on the event page
- Unsubscribe link in every email footer; unsubscribed contacts are
  automatically skipped and reported

**Reporting & data**
- Per-event counts: invited, emails sent/queued/failed, accepted (with total
  headcount including plus-ones), declined, awaiting reply
- Dashboard with upcoming events and a live feed of recent responses
- SMTP2GO cycle quota: emails used, remaining, and cycle dates, plus a local
  count of emails sent this month
- Everything exports to CSV (contacts, groups, events, per-event guest lists,
  email log) plus a full JSON backup per organization

**Email delivery**
- SMTP2GO HTTP API (server-wide key and/or per-organization key)
- Built-in **simulation mode**: with no API key configured, every email is
  rendered and logged — viewable in the app — but nothing is delivered. The
  entire system is testable before you connect a provider.
- Throttled background queue, failure tracking with one-click retry,
  `List-Unsubscribe` header on every invitation

## Multi-tenancy: the isolation model

Tenant isolation is **physical, not logical**. Each organization gets its own
SQLite database file (`data/orgs/<slug>/org.db`) containing its own users,
sessions, contacts, events, and email log. There is no `organization_id`
column anywhere, because data from two organizations never shares a database.
A cross-tenant query is not a bug that validation must catch — it is
structurally impossible, since every request handler only ever holds the
single database belonging to the authenticated session's organization.

Sign-in is just **email + password** — the app finds which organization owns
that email (the password disambiguates in the rare case an address exists in
two orgs) and binds the session to it; no "organization" field to type.
Session cookies are HMAC-signed and bound to the organization that issued
them, and session tokens are stored hashed inside that organization's own
database. The tiny shared `data/core.db` holds only the registry of
organization names.

Creating an organization deliberately requires server access:

```
node scripts/create-org.mjs --slug sjc --name "St. James Community" \
  --admin-email you@example.org --admin-name "Your Name"
```

## Quick start

Requires **Node.js 22.13+ (Node 24 LTS recommended)** — nothing else. The
only runtime dependency is Express; SQLite is Node's built-in driver.

```bash
npm install
npm run build          # builds the admin app into server/public/app
npm run seed-demo      # optional: demo org with sample data (org "demo",
                       # demo@example.com / demo-demo-demo)
npm start              # serves everything on http://localhost:3000
```

Sign in at `http://localhost:3000/app/`. Without an SMTP2GO key the app runs
in simulation mode — sends are rendered into the email log instead of being
delivered, so you can try the whole flow immediately.

To create your real organization:

```bash
node scripts/create-org.mjs --slug myorg --name "My Organization" \
  --admin-email me@example.org --admin-name "My Name"
```

For production setup (VPS requirements, HTTPS, SMTP2GO configuration, DNS,
backups) see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. For a tour of the
app itself see **[docs/GUIDE.md](docs/GUIDE.md)**. For the admin UI's design
tokens and shared components see **[docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)**.

## Configuration

Copy `.env.example` to `.env`. Everything has a sane default for local use;
production needs `BASE_URL` (links in emails are built from it).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listening port |
| `BASE_URL` | `http://localhost:PORT` | Public URL used in email links |
| `DATA_DIR` | `./data` | Databases + uploads (this is the entire app state) |
| `SMTP2GO_API_KEY` | _(empty = simulation)_ | Server-wide SMTP2GO key; can be overridden per organization in Settings |
| `EMAILS_PER_MINUTE` | `60` | Outbound queue throttle |
| `SESSION_DAYS` | `14` | Session lifetime (sliding) |
| `SESSION_SECRET` | _(auto-generated)_ | Cookie signing secret, persisted to `DATA_DIR/secret.key` if unset |
| `TRUST_PROXY` | unset | Set `1` behind a reverse proxy |
| `NODE_ENV` | `development` | Set `production` on servers |

## Commands

```bash
npm start              # run the server
npm run build          # build the admin SPA (rerun after changing web/)
npm run smoke          # full end-to-end API test against a throwaway data dir
npm run create-org     # create an organization (see flags above)
npm run reset-password # reset a user's password from the console
npm run seed-demo      # create the demo organization
scripts/backup.sh      # tar.gz the data directory into backups/
```

Development with hot reload for the admin app:

```bash
npm run dev            # terminal 1: API + public pages on :3000
npm run dev:web        # terminal 2: Vite dev server on :5173 (proxies to :3000)
```

## Architecture

```
server/               Node + Express (ES modules, zero native deps)
  index.js            app assembly, security headers, static serving
  lib/                config, db (node:sqlite), auth (scrypt + HMAC cookies),
                      flyer renderer, email templates, SMTP2GO client,
                      merge tags, ICS, CSV, queue, rate limits
  routes/             JSON API (cookie-authed, CSRF-guarded) + public pages
web/                  React admin app (Vite), served at /app
scripts/              create-org, reset-password, seed-demo, smoke-test, backup
data/                 runtime state: core.db + one directory per organization
```

Public guest URLs are namespaced per organization and token-based:

```
/o/<org>/e/<event-slug>        landing page + open RSVP form
/o/<org>/i/<invite-token>      personal RSVP page
/o/<org>/i/<token>/accept      one-click accept (from email button)
/o/<org>/i/<token>/decline     one-click decline
/o/<org>/u/<token>             unsubscribe (event invitation)
/o/<org>/b/<slug>              broadcast web version ("view in browser")
/o/<org>/bu/<token>            unsubscribe (broadcast)
```

## Security notes

- Passwords: scrypt with per-user salt; constant-time verification
- Sessions: 32-char random tokens stored **hashed**, HMAC-signed cookies
  (`HttpOnly`, `SameSite=Lax`, `Secure` in production), sliding expiry
- CSRF: SameSite cookies plus a required custom header on every mutating call
- Login and public RSVP endpoints are rate-limited
- All SQL uses prepared statements; all HTML output is escaped
- Uploads are validated by magic bytes (JPEG/PNG/GIF/WebP only, 5 MB cap) and
  served with fixed content types from unguessable URLs
- Strict security headers (CSP, nosniff, frame-ancestors, referrer policy)
- The email footer carries the recipient, the sending organization, and an
  unsubscribe link; invitations include a `List-Unsubscribe` header

## Roadmap ideas

SMS invitations (contacts already store phone numbers), automatic event-day
reminders, bounce webhooks from SMTP2GO, comment walls, and a restore tool
that rebuilds an organization from its JSON backup.
