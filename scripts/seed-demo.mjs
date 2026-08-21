#!/usr/bin/env node
// Create a "demo" organization filled with sample data, so the app can be
// explored immediately after install. Safe to run once; refuses to run twice.
//
//   node scripts/seed-demo.mjs
import { config } from '../server/lib/env.js';
import { getOrg, setSetting, insertId } from '../server/lib/db.js';
import { contactInserter } from '../server/lib/contacts.js';
import { createOrgWithAdmin } from '../server/lib/orgSetup.js';
import { randomSlug, randomToken } from '../server/lib/tokens.js';
import { queueEmails, getInvitesForEvent, DEFAULT_BODIES } from '../server/lib/sending.js';
import { processAllQueued } from '../server/lib/queue.js';

const PASSWORD = 'demo-demo-demo';

if (getOrg('demo')) {
  console.error('The "demo" organization already exists. Delete data/orgs/demo and its row in data/core.db to reseed.');
  process.exit(1);
}

const { db } = createOrgWithAdmin({
  slug: 'demo',
  name: 'Riverside Community Club',
  adminEmail: 'demo@example.com',
  adminName: 'Demo Admin',
  password: PASSWORD,
});

function daysFromNow(days) {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

// --- contacts --------------------------------------------------------------
const PEOPLE = [
  ['Ava Thompson', 'ava.thompson@example.com', '555-0101'],
  ['Ben Okafor', 'ben.okafor@example.com', '555-0102'],
  ['Carmen Diaz', 'carmen.diaz@example.com', '555-0103'],
  ['David Kim', 'david.kim@example.com', ''],
  ['Elena Rossi', 'elena.rossi@example.com', '555-0105'],
  ['Frank Miller', 'frank.miller@example.com', ''],
  ['Grace Chen', 'grace.chen@example.com', '555-0107'],
  ['Hassan Ali', 'hassan.ali@example.com', ''],
  ['Iris Novak', 'iris.novak@example.com', '555-0109'],
  ['James Wright', 'james.wright@example.com', ''],
  ['Keiko Tanaka', 'keiko.tanaka@example.com', '555-0111'],
  ['Liam Murphy', '', '555-0112'],
];
const contactIds = [];
const addContact = contactInserter(db);
for (const [name, email, phone] of PEOPLE) {
  contactIds.push(addContact({ name, email, phone }));
}

// --- groups ----------------------------------------------------------------
const choirId = insertId(db.prepare("INSERT INTO groups (name, description) VALUES ('Choir', 'Members of the community choir')").run());
const volunteersId = insertId(db.prepare("INSERT INTO groups (name, description) VALUES ('Volunteers', 'Regular event volunteers')").run());
const addMember = db.prepare('INSERT INTO group_members (group_id, contact_id) VALUES (?, ?)');
contactIds.slice(0, 5).forEach((id) => addMember.run(choirId, id));
contactIds.slice(5, 9).forEach((id) => addMember.run(volunteersId, id));

// --- an extra template -----------------------------------------------------
db.prepare('INSERT INTO templates (name, subject, body) VALUES (?, ?, ?)').run(
  'Formal invitation',
  'An invitation from {{org_name}}: {{event_title}}',
  `Dear {{full_name}},

{{host_name}} requests the pleasure of your company at {{event_title}}, to be held on {{event_date}} at {{venue_name}}.

Kindly respond by {{rsvp_deadline}} using the buttons below.

With warm regards,
{{host_name}}`
);

// --- sending settings (simulation still applies without an API key) --------
setSetting(db, 'sender_name', 'Riverside Community Club');
setSetting(db, 'sender_email', 'invites@example.org');

// --- event 1: published picnic with responses ------------------------------
const picnicFlyer = JSON.stringify({
  style: 'white', font: 'sans', scale: 'm',
  eyebrow: "You're invited", tagline: 'Bring a dish, bring a friend!',
  note: 'Rain location: the community hall', showHost: true,
});
const picnicId = insertId(db.prepare(`
  INSERT INTO events (slug, title, description, host_name, venue_name, venue_address, date,
    start_time, end_time, rsvp_mode, rsvp_deadline, capacity, allow_plus_ones, max_party_size,
    show_guest_list, share_enabled, status, flyer, email_subject, email_body)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rsvp', ?, 60, 1, 6, 1, 1, 'published', ?, ?, ?)
`).run(
  randomSlug(10),
  'Summer Potluck Picnic',
  'Our annual all-ages potluck in the park. The club provides grills, drinks, and games — you bring your favorite dish and your best picnic-blanket manners.',
  'The Social Committee',
  'Riverside Park — Pavilion B',
  '400 River Road, Springfield',
  daysFromNow(21), '12:00', '15:00', daysFromNow(14),
  picnicFlyer,
  "You're invited: {{event_title}} 🌞",
  DEFAULT_BODIES.invitation
));

// Invite the choir + a few others, then simulate the sends.
const inviteIds = [];
for (const cid of contactIds.slice(0, 9)) {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(cid);
  const info = db.prepare(`
    INSERT INTO invites (event_id, contact_id, guest_name, guest_email, token, source)
    VALUES (?, ?, ?, ?, ?, 'email')
  `).run(picnicId, c.id, c.name, c.email, randomToken(24));
  inviteIds.push(insertId(info));
}
const org = { slug: 'demo', name: 'Riverside Community Club' };
const picnic = db.prepare('SELECT * FROM events WHERE id = ?').get(picnicId);
queueEmails(db, {
  org, event: picnic,
  invites: getInvitesForEvent(db, picnicId),
  kind: 'invitation',
  subjectTemplate: picnic.email_subject,
  bodyTemplate: picnic.email_body,
  markInvitation: true,
});
await processAllQueued();

// Simulated guest responses.
const respond = db.prepare(
  `UPDATE invites SET response = ?, party_size = ?, note = ?, responded_at = datetime('now', ?) WHERE id = ?`
);
respond.run('yes', 2, 'We will bring lemonade!', '-2 days', inviteIds[0]);
respond.run('yes', 4, null, '-1 days', inviteIds[1]);
respond.run('yes', 1, 'Can I help with setup?', '-3 hours', inviteIds[2]);
respond.run('no', 1, 'Out of town, sadly', '-1 hours', inviteIds[3]);
// A walk-in RSVP via the share link.
db.prepare(`
  INSERT INTO invites (event_id, contact_id, guest_name, guest_email, token, source, response, party_size, responded_at)
  VALUES (?, NULL, 'Nora Svensson', 'nora.svensson@example.com', ?, 'link', 'yes', 2, datetime('now', '-30 minutes'))
`).run(picnicId, randomToken(24));

// --- event 2: open house (no RSVP) -----------------------------------------
db.prepare(`
  INSERT INTO events (slug, title, description, host_name, venue_name, venue_address, date,
    start_time, end_time, rsvp_mode, share_enabled, status, flyer)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, 'published', ?)
`).run(
  randomSlug(10),
  'Community Open House',
  'Drop in, meet the teams, and see what the club does. No registration needed.',
  'Riverside Community Club',
  'Clubhouse',
  '12 Main Street, Springfield',
  daysFromNow(35), '17:00', '20:00',
  JSON.stringify({ style: 'white', font: 'sans', scale: 'm', eyebrow: 'Open house', tagline: 'Everyone welcome', note: '', showHost: false })
);

// --- event 3: a draft the wizard can pick up -------------------------------
db.prepare(`
  INSERT INTO events (slug, title, description, host_name, venue_name, date, start_time,
    rsvp_mode, status, flyer)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'rsvp', 'draft', ?)
`).run(
  randomSlug(10),
  'Autumn Gala Dinner',
  'Save the date — details coming soon.',
  'The Events Committee',
  'Grand Hall',
  daysFromNow(90), '18:30',
  JSON.stringify({ style: 'retro', font: 'sans', scale: 'm', eyebrow: 'Save the date', tagline: 'An evening of dinner and dancing', note: 'Black tie optional', showHost: true })
);

console.log('');
console.log('Demo organization created.');
console.log(`  Sign-in URL:   ${config.baseUrl}/app/`);
console.log('  Email:         demo@example.com');
console.log(`  Password:      ${PASSWORD}`);
console.log('');
console.log('Emails were "sent" in simulation mode — open Emails in the app to view them.');
