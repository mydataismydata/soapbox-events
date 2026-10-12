// Database schemas. Two kinds of database exist:
//
//   core.db          — the tiny registry of organizations (slug -> db file).
//   orgs/<slug>/org.db — EVERYTHING belonging to one organization: its users,
//                        sessions, contacts, events, invites, email log.
//
// Tenant isolation is physical: there is no organization id column anywhere,
// because data from two organizations never shares a database file. A query
// cannot leak across tenants — it would have to open a different file.
//
// Migrations use PRAGMA user_version. To evolve a schema later, push another
// entry onto the relevant array; every database is brought up to date on open.
// An entry is SQL, or a function of the database for a change SQL can't make.

import { RANDOM_SLUG_RE, syncEventSlug } from './eventSlug.js';

export const CORE_MIGRATIONS = [
  `
  CREATE TABLE organizations (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

export const ORG_MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );

  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT COLLATE NOCASE,
    phone TEXT,
    notes TEXT,
    unsubscribed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_contacts_email ON contacts(email);

  CREATE TABLE groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
  );

  CREATE TABLE templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    host_name TEXT,
    venue_name TEXT,
    venue_address TEXT,
    date TEXT,
    start_time TEXT,
    end_time TEXT,
    timezone_note TEXT,
    rsvp_mode TEXT NOT NULL DEFAULT 'rsvp' CHECK (rsvp_mode IN ('rsvp', 'open')),
    rsvp_deadline TEXT,
    capacity INTEGER,
    allow_plus_ones INTEGER NOT NULL DEFAULT 1,
    max_party_size INTEGER NOT NULL DEFAULT 5,
    show_guest_list INTEGER NOT NULL DEFAULT 0,
    share_enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
    flyer TEXT NOT NULL DEFAULT '{}',
    email_subject TEXT,
    email_body TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_events_date ON events(date);

  CREATE TABLE invites (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    guest_name TEXT,
    guest_email TEXT COLLATE NOCASE,
    token TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'email' CHECK (source IN ('email', 'link', 'manual')),
    email_status TEXT NOT NULL DEFAULT 'not_sent'
      CHECK (email_status IN ('not_sent', 'queued', 'sent', 'failed')),
    response TEXT CHECK (response IN ('yes', 'no')),
    responded_at TEXT,
    party_size INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, contact_id)
  );
  CREATE INDEX idx_invites_event ON invites(event_id);
  CREATE INDEX idx_invites_email ON invites(guest_email);

  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    invite_id INTEGER REFERENCES invites(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('invitation', 'follow_up', 'nudge', 'cancellation', 'test')),
    to_name TEXT,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    body_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'sending', 'sent', 'simulated', 'failed')),
    error TEXT,
    provider_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
  );
  CREATE INDEX idx_email_log_status ON email_log(status);
  CREATE INDEX idx_email_log_event ON email_log(event_id);

  CREATE TABLE uploads (
    id INTEGER PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    original_name TEXT,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `,

  // Migration 2: a reusable venue library. Events keep snapshotting their
  // venue_name/venue_address (so past invitations never change under you and
  // deleting a venue can't break an event); picking a saved venue simply
  // fills those fields, plus the new phone / map-link fields.
  `
  CREATE TABLE venues (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    map_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE events ADD COLUMN venue_phone TEXT;
  ALTER TABLE events ADD COLUMN venue_map_url TEXT;
  `,

  // Migration 3: standalone broadcasts (email blasts not tied to an event).
  // A broadcast reuses the flyer designer, templates and the email queue, but
  // has no RSVP/guest tracking — the email_log rows are its per-recipient
  // record. email_log gains a broadcast_id and its kind CHECK is widened to
  // allow 'broadcast', which requires rebuilding the table (SQLite cannot
  // alter a CHECK constraint in place). Nothing references email_log, so the
  // drop/rename is safe with foreign keys enabled.
  `
  CREATE TABLE broadcasts (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    flyer TEXT NOT NULL DEFAULT '{}',
    audience TEXT NOT NULL DEFAULT '{}',
    web_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
  );

  CREATE TABLE email_log_new (
    id INTEGER PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    invite_id INTEGER REFERENCES invites(id) ON DELETE SET NULL,
    broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('invitation', 'follow_up', 'nudge', 'cancellation', 'test', 'broadcast')),
    to_name TEXT,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    body_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'sending', 'sent', 'simulated', 'failed')),
    error TEXT,
    provider_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
  );
  INSERT INTO email_log_new
    (id, event_id, invite_id, kind, to_name, to_email, subject, html, body_text, status, error, provider_id, created_at, sent_at)
    SELECT id, event_id, invite_id, kind, to_name, to_email, subject, html, body_text, status, error, provider_id, created_at, sent_at
    FROM email_log;
  DROP TABLE email_log;
  ALTER TABLE email_log_new RENAME TO email_log;
  CREATE INDEX idx_email_log_status ON email_log(status);
  CREATE INDEX idx_email_log_event ON email_log(event_id);
  CREATE INDEX idx_email_log_broadcast ON email_log(broadcast_id);
  `,
  // Migration 4: contacts collect a first and last name of their own. `name`
  // stays as the display string every other table and template already reads,
  // composed from the two on write. The backfill splits at the first space,
  // which is exactly what {{first_name}} has always rendered — so no existing
  // contact's greeting changes. A one-word name is a first name.
  `
  ALTER TABLE contacts ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE contacts ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
  UPDATE contacts SET
    first_name = CASE WHEN instr(trim(name), ' ') > 0
                      THEN substr(trim(name), 1, instr(trim(name), ' ') - 1)
                      ELSE trim(name) END,
    last_name  = CASE WHEN instr(trim(name), ' ') > 0
                      THEN ltrim(substr(trim(name), instr(trim(name), ' ') + 1))
                      ELSE '' END;
  CREATE INDEX idx_contacts_last_name ON contacts(last_name COLLATE NOCASE);
  `,

  // Migration 5: the website delivery log. Replaces the self-healing that
  // polling had for free: a push that fails leaves a red row with a Resend
  // button rather than silently never arriving.
  `
  CREATE TABLE website_deliveries (
    id INTEGER PRIMARY KEY,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    reason TEXT NOT NULL,          -- publish | edit | cancel | delete | settings | manual
    ok INTEGER NOT NULL,
    status INTEGER NOT NULL,       -- HTTP status, 0 when the request never completed
    events INTEGER NOT NULL DEFAULT 0,
    flyers INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    retryable INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_website_deliveries_sent ON website_deliveries(sent_at DESC);
  `,

  // Migration 6: a broadcast can carry one attached file, held as its upload
  // token. Each queued email keeps its own copy of the token, so what was
  // queued is what goes out even if the broadcast is edited mid-send.
  `
  ALTER TABLE broadcasts ADD COLUMN attachment TEXT NOT NULL DEFAULT '';
  ALTER TABLE email_log ADD COLUMN attachment TEXT;
  `,

  // Migration 7: a meeting's address is its date and time rather than a
  // random code. Each dated event moves to its date address, and an address
  // a guest could hold is kept in event_slugs to redirect.
  (db) => {
    db.exec(`
      CREATE TABLE event_slugs (
        id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_event_slugs_event ON event_slugs(event_id);
    `);
    const dated = db.prepare(`SELECT * FROM events WHERE date IS NOT NULL AND date != '' ORDER BY id`).all();
    for (const event of dated) {
      if (RANDOM_SLUG_RE.test(event.slug)) syncEventSlug(db, event);
    }
  },

  // Migration 8: a private meeting (shareable link off) is at its date plus
  // a random code, and stops answering at any address a stranger could
  // guess. Migration 7 gave private meetings plain date addresses too.
  (db) => {
    for (const event of db.prepare('SELECT * FROM events WHERE share_enabled = 0 ORDER BY id').all()) {
      syncEventSlug(db, event);
    }
  },

  // Migration 9: surveys. A survey is sent like a meeting invitation, but
  // asks questions instead of taking an RSVP.
  //
  //   surveys           the questions are JSON on the survey (surveyQuestions.js)
  //   survey_invites    one per person asked, with their personal link
  //   survey_responses  one per set of answers, keyed by question id
  //
  // An anonymous survey's responses have no invite_id, so nothing in the
  // database says whose they are. Their ids are random rather than counted,
  // and their times are only a day, so the order people answered in can't
  // pair them up with the invites either.
  //
  // email_log gains a survey_id and a survey_invite_id, and its kind CHECK
  // gains the two survey emails, so it is rebuilt as migration 3 did.
  `
  CREATE TABLE surveys (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    questions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    share_enabled INTEGER NOT NULL DEFAULT 0,
    anonymous INTEGER NOT NULL DEFAULT 0,
    closes_on TEXT,
    email_subject TEXT,
    email_body TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    opened_at TEXT,
    closed_at TEXT
  );

  CREATE TABLE survey_invites (
    id INTEGER PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    guest_name TEXT,
    guest_email TEXT COLLATE NOCASE,
    token TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'email' CHECK (source IN ('email', 'link', 'manual')),
    email_status TEXT NOT NULL DEFAULT 'not_sent'
      CHECK (email_status IN ('not_sent', 'queued', 'sent', 'failed')),
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (survey_id, contact_id)
  );
  CREATE INDEX idx_survey_invites_survey ON survey_invites(survey_id);
  CREATE INDEX idx_survey_invites_email ON survey_invites(guest_email);

  CREATE TABLE survey_responses (
    id INTEGER PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    invite_id INTEGER UNIQUE REFERENCES survey_invites(id) ON DELETE SET NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_survey_responses_survey ON survey_responses(survey_id);

  CREATE TABLE email_log_new (
    id INTEGER PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    invite_id INTEGER REFERENCES invites(id) ON DELETE SET NULL,
    broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL,
    survey_id INTEGER REFERENCES surveys(id) ON DELETE SET NULL,
    survey_invite_id INTEGER REFERENCES survey_invites(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('invitation', 'follow_up', 'nudge', 'cancellation', 'test', 'broadcast',
      'survey', 'survey_reminder')),
    to_name TEXT,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    body_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'sending', 'sent', 'simulated', 'failed')),
    error TEXT,
    provider_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT,
    attachment TEXT
  );
  INSERT INTO email_log_new
    (id, event_id, invite_id, broadcast_id, kind, to_name, to_email, subject, html, body_text, status, error,
     provider_id, created_at, sent_at, attachment)
    SELECT id, event_id, invite_id, broadcast_id, kind, to_name, to_email, subject, html, body_text, status, error,
     provider_id, created_at, sent_at, attachment
    FROM email_log;
  DROP TABLE email_log;
  ALTER TABLE email_log_new RENAME TO email_log;
  CREATE INDEX idx_email_log_status ON email_log(status);
  CREATE INDEX idx_email_log_event ON email_log(event_id);
  CREATE INDEX idx_email_log_broadcast ON email_log(broadcast_id);
  CREATE INDEX idx_email_log_survey ON email_log(survey_id);
  `,
];
