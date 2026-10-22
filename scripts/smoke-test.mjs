#!/usr/bin/env node
// End-to-end smoke test. Boots the real server against a throwaway data
// directory and exercises the whole flow over HTTP: organizations, login,
// contacts, groups, events, sending (simulated), accept/decline links,
// share-link RSVPs, nudges, exports — plus cross-organization isolation.
//
//   npm run smoke
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendQueue, sendLabel, sendSummary } from '../web/src/components/sendQueue.js';
import { personName, splitPersonName } from '../server/lib/contacts.js';
import { fetchRemoteImage } from '../server/lib/remoteImage.js';
import { meetingEnd, meetingOver } from '../server/lib/clock.js';
import { allScenes, helpFor, sectionsFor } from '../web/src/help/content.js';
import { normalizeQuestions, parseAnswers, tally, answerText } from '../server/lib/surveyQuestions.js';

const PORT = 3870 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'soapbox-smoke-'));
// Sending stays simulated unless a test sets an organization's API key, and
// then it goes to a stand-in for SMTP2GO on this port that records each email.
const SMTP_PORT = PORT + 600;
const ENV = {
  ...process.env, PORT: String(PORT), BASE_URL: BASE, DATA_DIR, NODE_ENV: 'test', SMTP2GO_API_KEY: '',
  SMTP2GO_API_BASE: `http://127.0.0.1:${SMTP_PORT}/v3`,
  // A website delivery waits this long for more changes. The checks below
  // give it 600ms to land.
  WEBSITE_PUSH_SETTLE_MS: '150',
  // How old the RSVP form must be before a reply counts (botGuard.js).
  RSVP_MIN_FILL_MS: '300',
};

let passed = 0;
const failures = [];
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failures.push(label); console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function fatal(msg) {
  console.error(`FATAL: ${msg}`);
  cleanup(1);
}

let server = null;
function cleanup(code) {
  if (server) server.kill('SIGTERM');
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(code);
}

// Minimal API client with a cookie jar.
class Client {
  constructor() { this.cookie = ''; }
  async raw(method, url, { body, form, headers = {}, redirect = 'manual' } = {}) {
    const h = { 'x-requested-with': 'sjc-vite', ...headers };
    let payload;
    if (form) {
      h['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(`${BASE}${url}`, { method, headers: h, body: payload, redirect });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return res;
  }
  async api(method, url, body) {
    const res = await this.raw(method, url, { body });
    let data = null;
    try { data = await res.json(); } catch { /* non-json */ }
    return { status: res.status, data };
  }
}

// The public RSVP form takes a reply only from a form drawn a moment ago
// (botGuard.js). This loads the page, waits like a person, and sends it.
const FILL_MS = 350;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function formStamp(pagePath) {
  const html = await (await fetch(`${BASE}${pagePath}`)).text();
  return html.match(/name="t" value="([^"]+)"/)?.[1] || '';
}
async function rsvpByForm(pagePath, fields, { wait = FILL_MS, stamp } = {}) {
  const t = stamp ?? await formStamp(pagePath);
  if (wait) await pause(wait);
  return fetch(`${BASE}${pagePath}/rsvp`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...(t ? { t } : {}), ...fields }).toString(),
  });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  fatal('server did not start');
}

async function waitFor(fn, label, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  check(label, false, 'timed out');
  return false;
}

// ---------------------------------------------------------------------------
console.log(`smoke test: data dir ${DATA_DIR}, port ${PORT}`);
server = spawn('node', ['server/index.js'], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(`[server] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[server:err] ${d}`));
await waitForServer();
console.log('server is up');

// --- create two organizations via the CLI ----------------------------------
for (const [slug, name, email] of [
  ['alpha', 'Alpha Society', 'admin@alpha.test'],
  ['beta', 'Beta Club', 'admin@beta.test'],
]) {
  const r = spawnSync('node', ['scripts/create-org.mjs',
    '--slug', slug, '--name', name, '--admin-email', email,
    '--admin-name', 'Admin', '--password', 'correct-horse-battery'], { env: ENV, encoding: 'utf8' });
  check(`create-org ${slug}`, r.status === 0, r.stderr);
}

const A = new Client();
const B = new Client();

// --- auth ------------------------------------------------------------------
{
  const bad = await A.api('POST', '/api/auth/login', { email: 'admin@alpha.test', password: 'wrong-password-x' });
  check('login rejects bad password', bad.status === 401);
  const noHeader = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@alpha.test', password: 'correct-horse-battery' }),
  });
  check('CSRF header is required', noHeader.status === 403);
  // Email alone routes to the owning org — no organization field needed.
  const ok = await A.api('POST', '/api/auth/login', { email: 'admin@alpha.test', password: 'correct-horse-battery' });
  check('login succeeds and resolves org from email', ok.status === 200 && ok.data?.org?.slug === 'alpha');
  const me = await A.api('GET', '/api/auth/me');
  check('me returns user', me.status === 200 && me.data?.user?.role === 'admin');
  check('login returns the build, the same as me does',
    ok.data?.app?.build > 0 && ok.data.app.build === me.data?.app?.build, JSON.stringify(ok.data?.app));
  const okB = await B.api('POST', '/api/auth/login', { email: 'admin@beta.test', password: 'correct-horse-battery' });
  check('org B login succeeds and resolves to beta', okB.status === 200 && okB.data?.org?.slug === 'beta');
}

// --- contacts & groups -----------------------------------------------------
let contactIds = [];
let groupId = null;
{
  const people = [
    { name: 'Ava Thompson', email: 'ava@guest.test', phone: '555-1' },
    { name: 'Ben Okafor', email: 'ben@guest.test' },
    { name: 'Carmen Diaz', email: 'carmen@guest.test' },
    { name: 'Phone Only', phone: '555-9' },
  ];
  for (const p of people) {
    const r = await A.api('POST', '/api/contacts', p);
    check(`create contact ${p.name}`, r.status === 201, JSON.stringify(r.data));
    contactIds.push(r.data?.contact?.id);
  }
  const dup = await A.api('POST', '/api/contacts', { name: 'Dup', email: 'ava@guest.test' });
  check('duplicate contact email rejected', dup.status === 409);

  const g = await A.api('POST', '/api/groups', { name: 'Choir', contact_ids: contactIds.slice(0, 2) });
  groupId = g.data?.group?.id;
  check('create group', g.status === 201 && groupId > 0);
  const gl = await A.api('GET', '/api/groups');
  check('group member count', gl.data?.groups?.[0]?.member_count === 2, JSON.stringify(gl.data));

  const imp = await A.api('POST', '/api/contacts/import', {
    csv: 'name,email,phone\nIris Novak,iris@guest.test,555-2\nAva Thompson,ava@guest.test,555-1\n',
  });
  check('CSV import adds 1 / skips duplicate', imp.data?.added === 1 && imp.data?.skipped === 1, JSON.stringify(imp.data));
  const list = await A.api('GET', '/api/contacts');
  check('contact list has 5', list.data?.contacts?.length === 5);
  const iris = list.data.contacts.find((c) => c.email === 'iris@guest.test');
  if (iris) contactIds.push(iris.id);
}

// --- templates & merge tags ------------------------------------------------
{
  const tags = await A.api('GET', '/api/merge-tags');
  check('merge tags listed', Array.isArray(tags.data?.tags) && tags.data.tags.some((t) => t.tag === 'accept_link'));
  check('full_name tag replaces recipient_name',
    tags.data.tags.some((t) => t.tag === 'full_name') && !tags.data.tags.some((t) => t.tag === 'recipient_name'));
  const tpl = await A.api('POST', '/api/templates', {
    name: 'Test template', subject: 'Come to {{event_title}}', body: 'Hi {{first_name}}, see you at {{venue_name}}!',
  });
  check('create template', tpl.status === 201);
}

// --- venues ----------------------------------------------------------------
{
  const created = await A.api('POST', '/api/venues', {
    name: 'Grand Hall', address: '1 Plaza Way', phone: '(555) 100-2000',
    map_url: 'https://maps.example.com/grandhall',
  });
  check('create venue', created.status === 201 && created.data?.venue?.id > 0);
  const dup = await A.api('POST', '/api/venues', { name: 'grand hall' });
  check('duplicate venue name rejected (case-insensitive)', dup.status === 409);
  const badUrl = await A.api('POST', '/api/venues', { name: 'Bad', map_url: 'javascript:alert(1)' });
  check('unsafe map link rejected', badUrl.status === 400);
  const list = await A.api('GET', '/api/venues');
  check('venue list', list.data?.venues?.length === 1 && list.data.venues[0].phone === '(555) 100-2000');
  const upd = await A.api('PUT', `/api/venues/${created.data.venue.id}`, { phone: '(555) 111-3000' });
  check('update venue', upd.status === 200);
  const merge = await A.api('GET', '/api/merge-tags');
  check('venue_phone merge tag present', merge.data.tags.some((t) => t.tag === 'venue_phone'));
  const tmp = await A.api('POST', '/api/venues', { name: 'Temp Venue' });
  check('delete venue', (await A.api('DELETE', `/api/venues/${tmp.data.venue.id}`)).status === 200);
}

// --- event lifecycle -------------------------------------------------------
let eventId = null;
let eventSlug = null;
const future = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
const deadline = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
{
  const r = await A.api('POST', '/api/events', {
    title: 'Test Gala', description: 'A night to remember', host_name: 'The Committee',
    venue_name: 'Grand Hall', venue_address: '1 Plaza Way',
    venue_phone: '(555) 100-2000', venue_map_url: 'https://maps.example.com/grandhall',
    date: future, start_time: '18:00', end_time: '22:00', rsvp_mode: 'rsvp', rsvp_deadline: deadline,
    capacity: 50, allow_plus_ones: true, max_party_size: 4, show_guest_list: true,
  });
  eventId = r.data?.event?.id;
  eventSlug = r.data?.event?.slug;
  // Its address is its date and start time, e.g. 2026-oct-27-18-00.
  check('create event', r.status === 201 && eventId > 0 && /^\d{4}-[a-z]{3}-\d{2}-18-00$/.test(eventSlug || ''), eventSlug);

  const upd = await A.api('PUT', `/api/events/${eventId}`, {
    flyer: { style: 'retro', font: 'sans', scale: 'l', eyebrow: 'Save the date', tagline: 'Dinner & dancing',
      contact: 'Questions? Call Jane', showAddress: true, bgTopHalf: true,
      imageColumns: 3, imageTokens: ['imgAAAAAA', 'imgBBBBBB', 'imgCCCCCC'], imageCaptions: ['Ada Speaker', 'Grace Speaker', 'Alan Speaker'] },
    email_subject: "You're invited: {{event_title}}",
    email_body: 'Hi {{first_name}},\n\nJoin us at {{venue_name}} on {{event_date}}.\n\nRSVP: {{rsvp_link}}',
  });
  const uflyer = upd.data?.event?.flyer || {};
  check('update event + flyer', upd.status === 200 && uflyer.style === 'retro');
  check('flyer stores 3 image columns', uflyer.imageColumns === 3 && Array.isArray(uflyer.imageTokens) && uflyer.imageTokens.length === 3);
  check('flyer image tokens + captions stored', uflyer.imageTokens?.[2] === 'imgCCCCCC' && uflyer.imageCaptions?.[1] === 'Grace Speaker');
  check('flyer mirrors first image for legacy readers', uflyer.imageToken === 'imgAAAAAA' && uflyer.imageCaption === 'Ada Speaker');
  check('flyer stores contact + showAddress', uflyer.contact === 'Questions? Call Jane' && uflyer.showAddress === true);
  check('flyer stores the top-half background option', uflyer.bgTopHalf === true);

  // Rich-text description is sanitized: safe tags kept, scripts + junk dropped.
  const rich = await A.api('PUT', `/api/events/${eventId}`, {
    description: '<b>Bold</b> and <span class="rt-fs-lg danger">big</span><script>alert(1)</script>',
  });
  const desc = rich.data?.event?.description || '';
  check('description keeps safe formatting', desc.includes('<b>Bold</b>') && desc.includes('class="rt-fs-lg"'));
  check('description strips scripts + unknown classes',
    !/<script/i.test(desc) && !desc.includes('danger'));

  const draftHidden = await fetch(`${BASE}/alpha/${eventSlug}`);
  check('draft landing hidden from public', draftHidden.status === 404);
  const draftOld = await fetch(`${BASE}/o/alpha/e/${eventSlug}`, { redirect: 'manual' });
  check('and from public at its old-style address', draftOld.status === 404);
  const draftMoved = await A.raw('GET', `/o/alpha/e/${eventSlug}`);
  check('an old-style address redirects a member to the event’s own',
    draftMoved.status === 301 && draftMoved.headers.get('location') === `/alpha/${eventSlug}`, draftMoved.headers.get('location'));
  const draftPreview = await A.raw('GET', `/alpha/${eventSlug}`);
  check('draft landing visible to signed-in org member', draftPreview.status === 200);
  const draftHtml = await draftPreview.text();
  check('landing renders all three featured images',
    draftHtml.includes('/files/imgAAAAAA') && draftHtml.includes('/files/imgBBBBBB') && draftHtml.includes('/files/imgCCCCCC'));
  check('landing renders featured-image captions', draftHtml.includes('Grace Speaker'));
  check('landing renders RSVP Requested banner + contact',
    /RSVP Requested/i.test(draftHtml) && draftHtml.includes('Questions? Call Jane'));
}

// --- guests + sending ------------------------------------------------------
{
  const add = await A.api('POST', `/api/events/${eventId}/guests`, {
    contact_ids: contactIds.slice(2), group_ids: [groupId],
  });
  check('add guests (group + contacts, deduped)', add.data?.added === 5, JSON.stringify(add.data));

  const send = await A.api('POST', `/api/events/${eventId}/send`, {});
  check('send queues 4 (skips no-email)', send.status === 200 && send.data?.queued === 4 && send.data?.skipped?.no_email === 1,
    JSON.stringify(send.data));

  const ev = await A.api('GET', `/api/events/${eventId}`);
  check('event auto-published on send', ev.data?.event?.status === 'published');

  await waitFor(async () => {
    const r = await A.api('GET', `/api/emails?event_id=${eventId}&status=simulated`);
    return r.data?.emails?.length === 4;
  }, 'queue processes 4 invitations (simulated)');
}

// --- accept via email link -------------------------------------------------
let guests = [];
{
  const g = await A.api('GET', `/api/events/${eventId}/guests`);
  guests = g.data?.guests || [];
  check('guest list has 5', guests.length === 5);
  check('invitations marked sent', guests.filter((x) => x.email_status === 'sent').length === 4);

  const emailDetailId = (await A.api('GET', `/api/emails?event_id=${eventId}`)).data.emails.at(-1).id;
  const detail = await A.api('GET', `/api/emails/${emailDetailId}`);
  const html = detail.data?.email?.html || '';
  check('email html contains accept + decline + unsubscribe links',
    html.includes('/accept') && html.includes('/decline') && html.includes('/u/'));

  // --- email log: filtering, sorting, paging -------------------------------
  const all = await A.api('GET', `/api/emails?event_id=${eventId}&per_page=100`);
  const logged = all.data.emails.length;
  check('email log reports its own total', all.data.total === logged && all.data.pages === 1);
  check('email log counts what is still in flight', typeof all.data.pending === 'number');

  const one = all.data.emails[0];
  const hit = await A.api('GET', `/api/emails?event_id=${eventId}&q=${encodeURIComponent(one.to_email)}`);
  check('email log filters by recipient',
    hit.data.total >= 1 && hit.data.emails.every((e) => e.to_email === one.to_email));
  const partial = await A.api('GET', `/api/emails?event_id=${eventId}&q=${encodeURIComponent(one.to_email.slice(2, 7))}`);
  check('recipient filter matches on a fragment', partial.data.total >= 1);
  const miss = await A.api('GET', `/api/emails?event_id=${eventId}&q=nobody-by-that-name`);
  check('recipient filter can match nothing', miss.data.total === 0 && miss.data.emails.length === 0);

  const byKind = await A.api('GET', `/api/emails?event_id=${eventId}&kind=invitation`);
  check('email log filters by type', byKind.data.emails.every((e) => e.kind === 'invitation'));

  const asc = await A.api('GET', `/api/emails?event_id=${eventId}&sort=recipient&dir=asc&per_page=100`);
  const desc = await A.api('GET', `/api/emails?event_id=${eventId}&sort=recipient&dir=desc&per_page=100`);
  const ascTo = asc.data.emails.map((e) => e.to_email);
  check('email log sorts by recipient', String(ascTo) === String([...ascTo].sort()));
  check('sort direction flips the order', String(desc.data.emails.map((e) => e.to_email)) === String([...ascTo].reverse()));
  const unsortable = await A.api('GET', `/api/emails?event_id=${eventId}&sort=;DROP TABLE email_log`);
  check('unknown sort column falls back safely', unsortable.status === 200 && unsortable.data.emails.length > 0);

  const p1 = await A.api('GET', `/api/emails?event_id=${eventId}&per_page=2&page=1&sort=recipient&dir=asc`);
  const p2 = await A.api('GET', `/api/emails?event_id=${eventId}&per_page=2&page=2&sort=recipient&dir=asc`);
  check('email log paginates', p1.data.emails.length === 2 && p1.data.pages === Math.ceil(logged / 2));
  check('pages do not overlap', !p1.data.emails.some((a) => p2.data.emails.some((b) => b.id === a.id)));

  // The org-wide log spans every event and broadcast, so it needs the source.
  const orgWide = await A.api('GET', '/api/emails?per_page=200');
  check('org-wide log includes more than one event\'s worth', orgWide.data.total >= logged);
  check('org-wide log names each email\'s source',
    orgWide.data.emails.filter((e) => e.event_id).every((e) => Boolean(e.event_title)));

  const withEmail = guests.filter((x) => x.email && x.email_status === 'sent');
  const acceptRes = await fetch(`${BASE}/o/alpha/i/${withEmail[0].token}/accept`, { redirect: 'manual' });
  check('accept link redirects', acceptRes.status === 303);
  const landing = await fetch(`${BASE}/o/alpha/i/${withEmail[0].token}?done=accept`);
  const landingHtml = await landing.text();
  check('confirmation page renders', landing.status === 200 && landingHtml.includes('Test Gala'));

  const declineRes = await fetch(`${BASE}/o/alpha/i/${withEmail[1].token}/decline`, { redirect: 'manual' });
  check('decline link redirects', declineRes.status === 303);

  const after = await A.api('GET', `/api/events/${eventId}/guests`);
  const accepted = after.data.guests.find((x) => x.id === withEmail[0].id);
  const declined = after.data.guests.find((x) => x.id === withEmail[1].id);
  check('accept recorded', accepted?.response === 'yes');
  check('decline recorded', declined?.response === 'no');
}

// --- share-link RSVP (new person) ------------------------------------------
{
  const res = await rsvpByForm(`/alpha/${eventSlug}`,
    { name: 'Walk In', email: 'walkin@guest.test', attending: 'yes', party_size: '2', note: 'Found the link!' });
  check('share-link RSVP redirects to personal page', res.status === 303 && (res.headers.get('location') || '').startsWith('/alpha/i/'));
  const g = await A.api('GET', `/api/events/${eventId}/guests`);
  const walkin = g.data.guests.find((x) => x.email === 'walkin@guest.test');
  check('share-link guest recorded as yes +1', walkin?.response === 'yes' && walkin?.party_size === 2 && walkin?.source === 'link');

  const stats = (await A.api('GET', `/api/events/${eventId}`)).data?.stats;
  check('stats: accepted 2, declined 1, awaiting 2, attending 3',
    stats?.accepted === 2 && stats?.declined === 1 && stats?.awaiting === 2 && stats?.guests_attending === 3,
    JSON.stringify(stats));
  // Labels the email log tab without the tab having to be opened first.
  const logCount = (await A.api('GET', `/api/emails?event_id=${eventId}&per_page=200`)).data.total;
  check('stats count the event\'s logged emails', stats?.emails_logged === logCount,
    `${stats?.emails_logged} vs ${logCount}`);
}

// --- nudge + follow-up -----------------------------------------------------
{
  const nudge = await A.api('POST', `/api/events/${eventId}/message`, {
    kind: 'nudge', audience: 'pending', body: 'Hi {{first_name}}, please RSVP for {{event_title}}!',
  });
  check('nudge goes to 2 pending', nudge.data?.queued === 2, JSON.stringify(nudge.data));
  const followUp = await A.api('POST', `/api/events/${eventId}/message`, {
    kind: 'follow_up', audience: 'yes', body: 'See you soon at {{venue_name}}!',
  });
  check('follow-up goes to 2 accepted', followUp.data?.queued === 2, JSON.stringify(followUp.data));
  await waitFor(async () => {
    const r = await A.api('GET', '/api/emails?status=simulated');
    return (r.data?.emails || []).filter((e) => e.kind === 'nudge').length === 2
      && (r.data?.emails || []).filter((e) => e.kind === 'follow_up').length === 2;
  }, 'queue processes nudges and follow-ups');
}

// --- email preview + test send ---------------------------------------------
{
  const prev = await A.api('POST', `/api/events/${eventId}/email-preview`, { kind: 'invitation' });
  check('email preview renders', prev.status === 200 && String(prev.data?.html || '').includes('Test Gala'));
  check('invitation has no flyer picture by default', !/alt="Event flyer"/.test(prev.data?.html || ''));
  const test = await A.api('POST', `/api/events/${eventId}/test-email`, {});
  check('test email simulated', test.data?.status === 'simulated', JSON.stringify(test.data));

  // "Include flyer in email": the picture the designer rendered goes in under
  // the Accept / Decline buttons.
  const ev = (await A.api('GET', `/api/events/${eventId}`)).data.event;
  await A.api('PUT', `/api/events/${eventId}`, {
    flyer: { ...ev.flyer, includeFlyerImage: true, flyerImageToken: 'flyerSNAPshot1' },
  });
  const withFlyer = await A.api('POST', `/api/events/${eventId}/email-preview`, { kind: 'invitation' });
  const fh = String(withFlyer.data?.html || '');
  check('invitation embeds the flyer picture', fh.includes('/files/flyerSNAPshot1') && fh.includes('alt="Event flyer"'));
  check('flyer picture sits after the RSVP buttons',
    fh.indexOf('/files/flyerSNAPshot1') > fh.indexOf('Decline</a>'));
  const followUp = await A.api('POST', `/api/events/${eventId}/email-preview`, { kind: 'follow_up' });
  check('flyer picture is invitation-only', !/alt="Event flyer"/.test(String(followUp.data?.html || '')));
  await A.api('PUT', `/api/events/${eventId}`, { flyer: ev.flyer });
}

// --- uploads + flyer preview -----------------------------------------------
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await A.api('POST', '/api/uploads', { name: 'dot.png', data: png });
  check('upload accepted', up.status === 201 && up.data?.token, JSON.stringify(up.data));
  const img = await fetch(`${BASE}/o/alpha/files/${up.data.token}`);
  check('uploaded file served with mime', img.status === 200 && img.headers.get('content-type') === 'image/png');
  const bad = await A.api('POST', '/api/uploads', { name: 'x.txt', data: 'data:text/plain;base64,aGVsbG8=' });
  check('non-image upload rejected', bad.status === 400);

  // The designer re-renders its picture-of-the-flyer on every edit and reuses
  // one upload for it, rather than leaving a trail of dead files.
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const again = await A.api('POST', '/api/uploads', { name: 'flyer.jpg', data: gif, replace: up.data.token });
  check('upload replace keeps the same token', again.status === 201 && again.data?.token === up.data.token);
  check('upload replace rewrites the file', again.data?.mime === 'image/gif');

  const fp = await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Preview Party', date: future },
      flyer: { style: 'classic', imageColumns: 2, imageTokens: ['prevIMGone', 'prevIMGtwo'], imageCaptions: ['One', 'Two'] } },
  });
  const fpHtml = await fp.text();
  check('flyer preview renders', fp.status === 200 && fpHtml.includes('Preview Party'));
  check('flyer preview renders multiple images',
    fpHtml.includes('/files/prevIMGone') && fpHtml.includes('/files/prevIMGtwo'));

  const pres = await A.api('GET', '/api/flyer/presets');
  const ids = (pres.data?.styles || []).map((s) => s.id);
  check('six templates, four portrait then two wide',
    ids.join(',') === 'classic,dark,light,retro,spotlight,panel', ids.join(','));
  const wideIds = (pres.data?.styles || []).filter((s) => s.landscape).map((s) => s.id);
  check('wide templates flagged for the designer', wideIds.join(',') === 'spotlight,panel', wideIds.join(','));
  const photoStyles = (pres.data?.styles || []).filter((s) => s.photo).map((s) => `${s.id}:${s.photo}`);
  check('photo templates flagged with their tone', photoStyles.join(',') === 'dark:dark,light:light', photoStyles.join(','));

  // The Dark template paints an uploaded photo as a full-bleed background under
  // a legibility scrim; with no image it falls back to a gradient ground.
  const darkBg = await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Gala Evening', date: future },
      flyer: { style: 'dark', bgToken: 'bgIMGxxxx', eyebrow: 'You are invited' } },
  });
  const darkBgHtml = await darkBg.text();
  check('dark flyer paints its background image under a reverse vignette',
    darkBgHtml.includes('/files/bgIMGxxxx') && darkBgHtml.includes('rgba(6,9,16,1)'));
  const darkPlain = await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Gala Evening', date: future }, flyer: { style: 'dark' } },
  });
  const darkPlainHtml = await darkPlain.text();
  check('dark flyer with no image uses a gradient ground',
    darkPlain.status === 200 && !darkPlainHtml.includes('/files/') && darkPlainHtml.includes('radial-gradient'));
  // "Overlay on top half only": the photo fills a box across the top that runs
  // to halfway plus the fade (an <img> covering it, not a covering background),
  // fades out over that last stretch, and the vignette still sits over it.
  const darkTop = await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Gala Evening', date: future },
      flyer: { style: 'dark', bgToken: 'bgIMGxxxx', bgTopHalf: true } },
  });
  const darkTopHtml = await darkTop.text();
  check('dark top-half fills past halfway and fades the photo out there',
    /<img src="[^"]*\/files\/bgIMGxxxx"[^>]*width:100%; height:100%; object-fit:cover; object-position:center top/.test(darkTopHtml)
      && darkTopHtml.includes(' height:calc(50% + 168px)') && darkTopHtml.includes('mask-image:linear-gradient')
      && darkTopHtml.includes('rgba(0,0,0,1) calc(100% - 168px)') && darkTopHtml.includes('rgba(0,0,0,0) calc(100% - 0px)')
      && !darkTopHtml.includes("background-image:url('"));
  check('dark top-half keeps the vignette over the photo', darkTopHtml.includes('filter:blur('));
  // Light is Dark with white for black: the same vignette core and the same
  // top-half fade, byte for byte, in the other colour.
  const renderStyle = async (style, extra = {}) => (await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Gala Evening', date: future }, flyer: { style, bgToken: 'bgIMGxxxx', ...extra } },
  })).text();
  const coreOf = (h) => (h.match(/<div style="position:absolute; inset:[^"]*filter:blur\([^)]*\);"><\/div>/) || [''])[0];
  const boxOf = (h) => (h.match(/<div style="position:absolute; top:0; left:0; right:0; height:[^"]*">/) || [''])[0];
  const [darkCover, lightCover] = [await renderStyle('dark'), await renderStyle('light')];
  check('light has the same vignette core as dark, in white', coreOf(lightCover) !== ''
    && coreOf(lightCover) === coreOf(darkCover).replace('rgba(6,9,16,1)', '#ffffff'));
  const [darkHalf, lightHalf] = [await renderStyle('dark', { bgTopHalf: true }), await renderStyle('light', { bgTopHalf: true })];
  check('light has the same top-half fade as dark, into white', boxOf(lightHalf) !== ''
    && boxOf(lightHalf) === boxOf(darkHalf) && lightHalf.includes('background-color:#ffffff;'));
  const lightPlain = await (await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Gala Evening', date: future }, flyer: { style: 'light' } },
  })).text();
  check('light with no image uses a soft white ground',
    !lightPlain.includes('/files/') && lightPlain.includes('radial-gradient(120% 85% at 50% 0%, #ffffff 0%'));

  // A long tagline must shrink and wrap rather than run off the flyer's edge.
  const longTag = 'Doors open early for coffee, live music, and a neighbourhood potluck supper';
  for (const style of ids) {
    const lp = await A.raw('POST', '/api/flyer/preview', {
      body: { event: { title: 'A Rather Long Event Title For Testing', date: future },
        flyer: { style, tagline: longTag } },
    });
    const lhtml = await lp.text();
    check(`${style}: long tagline wraps and shrinks`,
      lhtml.includes(longTag) && !/white-space:nowrap/.test(lhtml));
  }
  const dropped = await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Legacy', date: future }, flyer: { style: 'landscape' } },
  });
  check('retired landscape style falls back', dropped.status === 200);

  // The wide templates take a single image, whatever the flyer arrived with.
  for (const style of wideIds) {
    const wp = await A.raw('POST', '/api/flyer/preview', {
      body: { event: { title: 'Preview Party', date: future, venue_name: 'The Pavilion', start_time: '18:00' },
        flyer: { style, imageColumns: 3, imageTokens: ['prevIMGone', 'prevIMGtwo', 'prevIMGthr'] } },
    });
    const whtml = await wp.text();
    check(`${style}: one image only`,
      whtml.includes('/files/prevIMGone') && !whtml.includes('/files/prevIMGtwo'));
    check(`${style}: renders a wide side-by-side card`,
      whtml.includes('flex-wrap:wrap') && whtml.includes('min(920px'));
  }

  // "Text block instead of pictures": formatted text where the featured
  // pictures go, cut down to the rich-text allowlist, showing only this
  // installation's own pictures, in every template.
  const textHtml = '<p class="rt-al-left">Hello <b>friends</b><script>alert(1)</script></p>'
    + '<ul><li>Raffle</li></ul><img src="https://elsewhere.example/x.png">'
    + `<img src="${BASE}/o/alpha/files/txtIMGone" class="rt-img-half">`;
  for (const style of ids) {
    const th = await (await A.raw('POST', '/api/flyer/preview', {
      body: { event: { title: 'Text Night', date: future },
        flyer: { style, textBlock: true, textHtml, imageTokens: ['prevIMGone'] } },
    })).text();
    check(`${style}: text block takes the pictures' place`,
      th.includes('Hello <b>friends</b>') && th.includes('/files/txtIMGone') && !th.includes('/files/prevIMGone'));
    check(`${style}: text block is sanitized`, !/<script|alert\(1\)|elsewhere\.example/.test(th));
  }
  const tc = await (await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Text Night', date: future }, flyer: { style: 'classic', textBlock: true, textHtml } },
  })).text();
  check('text block styles its paragraphs, lists and pictures inline',
    tc.includes('text-align:left;') && tc.includes('<ul style="display:inline-block;')
      && /<img src="\/o\/alpha\/files\/txtIMGone"[^>]*max-width:50%/.test(tc));
  const off = await (await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Text Night', date: future }, flyer: { style: 'classic', textBlock: false, textHtml, imageTokens: ['prevIMGone'] } },
  })).text();
  check('text block unticked shows the pictures again', off.includes('/files/prevIMGone') && !off.includes('friends'));
  const ghost = await (await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Text Night', date: future }, flyer: { style: 'classic', textBlock: true }, edit: true },
  })).text();
  const bare = await (await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Text Night', date: future }, flyer: { style: 'classic', textBlock: true } },
  })).text();
  check('empty text block is a placeholder only while editing',
    ghost.includes('data-slot="text" data-ghost') && !bare.includes('data-slot') && !bare.includes('Text block'));

  const before = (await A.api('GET', `/api/events/${eventId}`)).data?.event?.flyer;
  const stored = (await A.api('PUT', `/api/events/${eventId}`, { flyer: { ...before, textBlock: true, textHtml } })).data?.event?.flyer || {};
  check('flyer stores the text block, sanitized',
    stored.textBlock === true && String(stored.textHtml).includes('<b>friends</b>') && !/script|elsewhere/.test(stored.textHtml));
  check('text block keeps its own pictures by path', String(stored.textHtml).includes('src="/o/alpha/files/txtIMGone"'));
  const blank = (await A.api('PUT', `/api/events/${eventId}`, { flyer: { ...before, textHtml: '<p><br></p> <div>&nbsp;</div>' } })).data?.event?.flyer || {};
  check('text block with no words or pictures is stored empty', blank.textHtml === '');
  await A.api('PUT', `/api/events/${eventId}`, { flyer: before });

  // Pictures in pasted text are copied in by the server, which must never be
  // pointed at itself or the network it sits on.
  for (const url of [`http://127.0.0.1:${PORT}/o/alpha/files/${up.data.token}`, 'http://localhost/x.png',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/x.png', 'http://10.0.0.8/x.png',
    'file:///etc/passwd', 'ftp://example.org/x.png']) {
    const r = await A.api('POST', '/api/uploads/remote', { url });
    check(`picture copier refuses ${url}`, r.status === 400, JSON.stringify(r.data));
  }
  const copied = await fetchRemoteImage(`${BASE}/o/alpha/files/${up.data.token}`, { allowPrivate: true });
  check('picture copier fetches and checks a picture', copied.mime === 'image/gif' && copied.buf.length > 0);
  let notPicture = '';
  try { await fetchRemoteImage(`${BASE}/api/health`, { allowPrivate: true }); } catch (err) { notPicture = err.message; }
  check('picture copier refuses what is not a picture', /not a JPEG, PNG, GIF or WebP/.test(notPicture), notPicture);

  // Snapshot mode is what the designer rasterizes into the email's JPEG: a
  // plain rectangle, no page breakout, no shadow, no page background.
  const snap = await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Preview Party', date: future }, flyer: { style: 'spotlight' }, snapshot: true },
  });
  const snapHtml = await snap.text();
  check('snapshot flyer drops the page furniture',
    snapHtml.includes('Preview Party') && !snapHtml.includes('box-shadow') && !snapHtml.includes('translateX(-50%)'));
  check('snapshot flyer is laid out at a fixed width', snapHtml.includes('max-width:920px'));
  check('presets give the designer the email picture widths',
    pres.data?.snapshotWidths?.portrait === 640 && pres.data?.snapshotWidths?.wide === 920);

  // A picture on its own keeps its own shape inside a 300px square, so a tall
  // one stays tall; pictures side by side are cropped to 3:2 to match.
  const lone = await (await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Preview Party', date: future }, flyer: { style: 'classic', imageTokens: ['prevIMGone'] } },
  })).text();
  check('a single picture keeps its own proportions',
    /\/files\/prevIMGone"[^>]*max-height:300px/.test(lone) && !/\/files\/prevIMGone"[^>]*aspect-ratio/.test(lone));
  check('pictures side by side are cropped to match', /\/files\/prevIMGone"[^>]*aspect-ratio:3\/2/.test(fpHtml));

  // The designer's own flyer: in edit mode every typed line, the picture tile
  // and the photo templates' background are marked for the designer's buttons,
  // and an empty line is drawn as a faint placeholder. Nothing else ever
  // carries those marks: not the plain preview, not the email picture.
  const SLOTS = {
    classic: 'eyebrow,tagline,image-add,contact,note',
    dark: 'bg,eyebrow,tagline,image-add,contact,note',
    light: 'bg,eyebrow,tagline,image-add,contact,note',
    retro: 'image-add,eyebrow,tagline,note,contact',
    spotlight: 'eyebrow,tagline,contact,note,image-add',
    panel: 'eyebrow,tagline,note:0,contact,image-add',
  };
  const slotsIn = (h) => [...h.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]).join(',');
  const draw = async (extra) => (await A.raw('POST', '/api/flyer/preview', { body: extra })).text();
  for (const style of ids) {
    const body = { event: { title: 'Mark Party', date: future, venue_name: 'Hall' }, flyer: { style, eyebrow: 'Hello' } };
    const edit = await draw({ ...body, edit: true });
    check(`${style}: edit mode marks every line and the picture tile`, slotsIn(edit) === SLOTS[style], slotsIn(edit));
    check(`${style}: the empty lines are drawn as placeholders`, (edit.match(/ data-ghost\b/g) || []).length === 4);
    check(`${style}: edit mode brings its own styles`, edit.includes('[data-ghost]'));
    const plain = await draw(body);
    check(`${style}: the plain preview carries no editing marks`,
      !/data-slot|data-ghost|\[data-ghost\]/.test(plain) && plain.includes('Hello'));
    const shot = await draw({ ...body, edit: true, snapshot: true });
    check(`${style}: the email picture never carries editing marks`, !/data-slot|data-ghost/.test(shot));
  }
  const filled = await draw({ event: { title: 'Mark Party', date: future },
    flyer: { style: 'classic', imageTokens: ['prevIMGone', 'prevIMGtwo'], imageCaptions: ['Ada', ''] }, edit: true });
  check('edit mode marks each picture and its caption',
    slotsIn(filled).includes('image:0,caption:0,image:1,caption:1') && /data-slot="caption:1" data-ghost/.test(filled));
  const bullets = await draw({ event: { title: 'Mark Party', date: future },
    flyer: { style: 'panel', note: 'Free parking · Doors at 5' }, edit: true });
  check('Panel marks each footnote bullet and a spare for the next',
    slotsIn(bullets).includes('note:0,note:1,note:2') && /data-slot="note:2" data-ghost/.test(bullets));
  const mast = await draw({ event: { title: 'News' }, flyer: { style: 'classic' }, mode: 'broadcast', edit: true });
  check('a broadcast masthead has no contact line to type on',
    !slotsIn(mast).split(',').includes('contact') && slotsIn(mast).startsWith('eyebrow'));
}

// --- public pages ----------------------------------------------------------
{
  const landing = await fetch(`${BASE}/alpha/${eventSlug}`, { redirect: 'manual' });
  const html = await landing.text();
  check('landing page renders with RSVP form + guest list', landing.status === 200
    && html.includes('Test Gala') && html.includes('Will you be there?') && html.includes("Who's coming"));
  check('landing page shows venue phone + directions link', landing.status === 200
    && html.includes('(555) 100-2000') && html.includes('Get directions')
    && html.includes('https://maps.example.com/grandhall'));
  check('landing page flyer carries no editing marks', !/data-slot|data-ghost/.test(html));
  // The guest pages wear the admin app's look, typeface included.
  check('guest pages use the app typeface', html.includes("font-family: 'IBM Plex Sans'")
    && html.includes('/fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2'));
  const font = await fetch(`${BASE}/fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2`);
  check('the typeface is served from /fonts', font.status === 200
    && /font\/woff2/.test(font.headers.get('content-type') || ''));
  const ics = await fetch(`${BASE}/alpha/${eventSlug}/ics`);
  const icsText = await ics.text();
  check('ICS download works', ics.status === 200 && icsText.includes('BEGIN:VCALENDAR') && icsText.includes('SUMMARY:Test Gala'));
  check('ICS UID is namespaced with the BASE_URL host',
    icsText.includes(`UID:${eventSlug}@${new URL(BASE).hostname}`), icsText.match(/UID:.*/)?.[0]);
}

// --- unsubscribe -----------------------------------------------------------
{
  const g = await A.api('GET', `/api/events/${eventId}/guests`);
  const pending = g.data.guests.find((x) => x.response === null && x.email);
  const unsub = await fetch(`${BASE}/o/alpha/u/${pending.token}`, { method: 'POST', redirect: 'manual' });
  check('unsubscribe works', unsub.status === 200);
  const contacts = await A.api('GET', '/api/contacts');
  const unsubbed = contacts.data.contacts.find((c) => c.email === pending.email);
  check('contact marked unsubscribed', Boolean(unsubbed?.unsubscribed_at));
  const nudge2 = await A.api('POST', `/api/events/${eventId}/message`, {
    kind: 'nudge', audience: 'pending', body: 'Second reminder for {{event_title}}',
  });
  check('unsubscribed guest skipped in later sends', nudge2.data?.skipped?.unsubscribed >= 1, JSON.stringify(nudge2.data));
}

// --- exports ---------------------------------------------------------------
{
  const csv = await A.raw('GET', '/api/export/contacts.csv');
  const text = await csv.text();
  check('contacts CSV export', csv.status === 200 && text.includes('Ava Thompson'));
  const guestsCsv = await A.raw('GET', `/api/export/events/${eventId}/guests.csv`);
  const gtext = await guestsCsv.text();
  check('guests CSV export', guestsCsv.status === 200 && gtext.includes('walkin@guest.test'));
  const venuesCsv = await A.raw('GET', '/api/export/venues.csv');
  const vtext = await venuesCsv.text();
  check('venues CSV export', venuesCsv.status === 200 && vtext.includes('Grand Hall'));
  const backup = await A.api('GET', '/api/export/backup.json');
  check('JSON backup', backup.status === 200 && backup.data?.contacts?.length === 5 && backup.data?.events?.length === 1);
  const quota = await A.api('GET', '/api/quota');
  check('quota reports simulation mode + month count', quota.data?.mode === 'simulation' && quota.data?.month_emails >= 8,
    JSON.stringify(quota.data));
}

// --- ISOLATION: organization B sees nothing of organization A --------------
{
  const contacts = await B.api('GET', '/api/contacts');
  check('ISOLATION: B has zero contacts', contacts.data?.contacts?.length === 0);
  const events = await B.api('GET', '/api/events');
  check('ISOLATION: B has zero events', events.data?.events?.length === 0);
  const ev = await B.api('GET', `/api/events/${eventId}`);
  check('ISOLATION: B cannot fetch A\'s event id', ev.status === 404);
  const guests = await B.api('GET', `/api/events/${eventId}/guests`);
  check('ISOLATION: B cannot fetch A\'s guests', guests.status === 404);

  // Forge a cookie: take A's valid session but claim org "beta".
  const parts = decodeURIComponent(A.cookie.split('=').slice(1).join('=')).split('.');
  const forged = encodeURIComponent(`beta.${parts[1]}.${parts[2]}`);
  const forgedRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { cookie: `sv_session=${forged}`, 'x-requested-with': 'sjc-vite' },
  });
  check('ISOLATION: forged org-swapped cookie rejected', forgedRes.status === 401);

  // A's session token replayed inside B's org namespace must also fail even
  // with a fresh valid signature — B's database has no such session row.
  const noAuth = await fetch(`${BASE}/api/contacts`, { headers: { 'x-requested-with': 'sjc-vite' } });
  check('no cookie -> 401', noAuth.status === 401);
}

// --- open events + cancel + duplicate --------------------------------------
{
  const open = await A.api('POST', '/api/events', { title: 'Open House', date: future, rsvp_mode: 'open' });
  await A.api('POST', `/api/events/${open.data.event.id}/publish`, {});
  const page = await fetch(`${BASE}/alpha/${open.data.event.slug}`);
  const html = await page.text();
  check('open event landing shows no-RSVP message', html.includes('No RSVP needed'));

  const dup = await A.api('POST', `/api/events/${eventId}/duplicate`, {});
  check('duplicate event', dup.status === 201 && dup.data?.event?.title === 'Copy of Test Gala' && dup.data?.event?.status === 'draft');

  const cancel = await A.api('POST', `/api/events/${eventId}/cancel`, { notify: true });
  check('cancel notifies responded+contacted guests', cancel.status === 200 && cancel.data?.notified >= 3, JSON.stringify(cancel.data));
  const cancelledLanding = await fetch(`${BASE}/alpha/${eventSlug}`);
  const cHtml = await cancelledLanding.text();
  check('cancelled landing shows banner, no RSVP form', cHtml.includes('cancelled') && !cHtml.includes('Will you be there?'));
}

// --- event addresses: the meeting's date and time --------------------------
{
  const mk = (body) => A.api('POST', '/api/events', { title: 'Address test', ...body });
  const slugOf = (r) => r.data?.event?.slug;
  const first = await mk({ date: '2031-03-04', start_time: '17:30' });
  check('an event is addressed by its date and time', slugOf(first) === '2031-mar-04-17-30', slugOf(first));
  check('and its link is /<org>/<that>', first.data?.event?.share_url === `${BASE}/alpha/2031-mar-04-17-30`,
    first.data?.event?.share_url);
  const twin = await mk({ date: '2031-03-04', start_time: '17:30' });
  check('a second meeting at the same time is numbered', slugOf(twin) === '2031-mar-04-17-30-2', slugOf(twin));
  const allDay = await mk({ date: '2031-03-04' });
  check('a meeting with no start time is at its date alone', slugOf(allDay) === '2031-mar-04', slugOf(allDay));

  const undated = await mk({});
  check('an event made without a date has a random address', /^[a-z2-9]{10}$/.test(slugOf(undated) || ''), slugOf(undated));
  const dated = await A.api('PUT', `/api/events/${undated.data.event.id}`, { date: '2031-03-05', start_time: '09:00' });
  check('and moves to its date address once it has one', slugOf(dated) === '2031-mar-05-09-00', slugOf(dated));
  const draftOld = await A.raw('GET', `/alpha/${slugOf(undated)}`);
  check('a draft’s earlier address is not kept', draftOld.status === 404);

  // A published meeting that moves keeps answering at its old address.
  const id = first.data.event.id;
  await A.api('POST', `/api/events/${id}/publish`, {});
  const uid = (t) => t.match(/UID:.*/)?.[0];
  const icsBefore = await (await fetch(`${BASE}/alpha/2031-mar-04-17-30/ics`)).text();
  const moved = await A.api('PUT', `/api/events/${id}`, { start_time: '19:00' });
  check('a meeting that moves gets a new address', slugOf(moved) === '2031-mar-04-19-00', slugOf(moved));
  const old = await fetch(`${BASE}/alpha/2031-mar-04-17-30`, { redirect: 'manual' });
  check('its old address redirects to the new one',
    old.status === 301 && old.headers.get('location') === '/alpha/2031-mar-04-19-00', `${old.status} ${old.headers.get('location')}`);
  const older = await fetch(`${BASE}/o/alpha/e/2031-mar-04-17-30`, { redirect: 'manual' });
  check('and so does its old-style address',
    older.status === 301 && older.headers.get('location') === '/alpha/2031-mar-04-19-00', `${older.status} ${older.headers.get('location')}`);
  const page = await fetch(`${BASE}/alpha/2031-mar-04-17-30`);
  check('which lands on the meeting', page.status === 200 && page.url.endsWith('/alpha/2031-mar-04-19-00'), page.url);
  const icsAfter = await (await fetch(`${BASE}/alpha/2031-mar-04-19-00/ics`)).text();
  check('its calendar entry keeps its identity', uid(icsBefore) && uid(icsBefore) === uid(icsAfter),
    `${uid(icsBefore)} / ${uid(icsAfter)}`);
  const rsvp = await rsvpByForm('/alpha/2031-mar-04-17-30', { name: 'Late Reader', email: 'late@guest.test', attending: 'yes' });
  check('an RSVP sent to the old address is taken',
    rsvp.status === 303 && (rsvp.headers.get('location') || '').startsWith('/alpha/i/'), rsvp.headers.get('location'));

  const third = await mk({ date: '2031-03-04', start_time: '17:30' });
  check('an old address is not handed to another meeting', slugOf(third) === '2031-mar-04-17-30-3', slugOf(third));
  const back = await A.api('PUT', `/api/events/${id}`, { start_time: '17:30' });
  check('a meeting that moves back gets its address back', slugOf(back) === '2031-mar-04-17-30', slugOf(back));
  const fromLater = await fetch(`${BASE}/alpha/2031-mar-04-19-00`, { redirect: 'manual' });
  check('and the time it moved away from redirects there', fromLater.headers.get('location') === '/alpha/2031-mar-04-17-30',
    fromLater.headers.get('location'));

  const crossOrg = await fetch(`${BASE}/beta/2031-mar-04-17-30`);
  check('another organization has nothing at that address', crossOrg.status === 404);
  const noOrg = await fetch(`${BASE}/nobody/2031-mar-04-17-30`);
  check('an address under no organization is not found', noOrg.status === 404);
  const apiMiss = await A.api('GET', '/api/no-such-thing');
  check('an unknown API address still answers in JSON', apiMiss.status === 404 && apiMiss.data?.error === 'Not found',
    JSON.stringify(apiMiss.data));
}

// --- private meetings ------------------------------------------------------
{
  const code = '[a-hjkmnp-z2-9]{10}';
  const priv = await A.api('POST', '/api/events', { title: 'Board Only', date: '2031-04-01', start_time: '19:00', share_enabled: false });
  const pslug = priv.data?.event?.slug || '';
  check('a private meeting is at its date plus a random code', new RegExp(`^2031-apr-01-19-00-${code}$`).test(pslug), pslug);
  const pid = priv.data.event.id;
  await A.api('POST', `/api/events/${pid}/publish`, {});
  const page = await fetch(`${BASE}/alpha/${pslug}`);
  const html = await page.text();
  check('its page answers there', page.status === 200 && html.includes('Board Only'));
  check('and tells search engines not to list it', html.includes('<meta name="robots" content="noindex">') && !html.includes('rel="canonical"'));
  check('and takes no open RSVPs', !html.includes('Will you be there?') && html.includes('by personal invitation'));
  check('the date alone does not find it', (await fetch(`${BASE}/alpha/2031-apr-01-19-00`)).status === 404);

  // Public, then private: every address a stranger could guess goes away.
  const pub = await A.api('POST', '/api/events', { title: 'Going Private', date: '2031-04-02', start_time: '19:00' });
  const gid = pub.data.event.id;
  await A.api('POST', `/api/events/${gid}/publish`, {});
  const pubHtml = await (await fetch(`${BASE}/alpha/2031-apr-02-19-00`)).text();
  check('a public meeting’s page may be listed by search engines',
    pubHtml.includes(`<link rel="canonical" href="${BASE}/alpha/2031-apr-02-19-00">`) && !pubHtml.includes('noindex'));
  await A.api('PUT', `/api/events/${gid}`, { start_time: '18:00' }); // leaves 19:00 as an old address
  const hidden = await A.api('PUT', `/api/events/${gid}`, { share_enabled: false });
  const hslug = hidden.data?.event?.slug || '';
  check('a meeting made private moves to a private address', new RegExp(`^2031-apr-02-18-00-${code}$`).test(hslug), hslug);
  for (const p of ['/alpha/2031-apr-02-18-00', '/alpha/2031-apr-02-19-00', '/o/alpha/e/2031-apr-02-18-00']) {
    const r = await fetch(`${BASE}${p}`, { redirect: 'manual' });
    check(`its public address ${p} no longer answers`, r.status === 404, String(r.status));
  }
  const shown = await A.api('PUT', `/api/events/${gid}`, { share_enabled: true });
  check('made public again it is back at its date', shown.data?.event?.slug === '2031-apr-02-18-00', shown.data?.event?.slug);
  const fromPrivate = await fetch(`${BASE}/alpha/${hslug}`, { redirect: 'manual' });
  check('and its private address redirects there', fromPrivate.status === 301
    && fromPrivate.headers.get('location') === '/alpha/2031-apr-02-18-00', fromPrivate.headers.get('location'));
}

// --- the bot traps on the open RSVP form -----------------------------------
{
  const made = await A.api('POST', '/api/events', { title: 'Trap Test', date: '2031-05-06', start_time: '18:30' });
  const tid = made.data.event.id;
  await A.api('POST', `/api/events/${tid}/publish`, {});
  const pagePath = '/alpha/2031-may-06-18-30';
  const guests = async () => (await A.api('GET', `/api/events/${tid}/guests`)).data.guests;
  const person = { name: 'Real Person', email: 'real@guest.test', attending: 'yes' };

  const pageHtml = await (await fetch(`${BASE}${pagePath}`)).text();
  check('the form carries a trap field people never see',
    /<div class="pub-trap" aria-hidden="true">[\s\S]*name="website"[\s\S]*tabindex="-1"/.test(pageHtml));

  const trapped = await rsvpByForm(pagePath, { ...person, website: 'http://spam.example' });
  const trappedHtml = await trapped.text();
  check('a filled-in trap is thanked', trapped.status === 200 && trappedHtml.includes('We have your reply'));
  check('and nothing is kept', (await guests()).length === 0);

  const linkName = await rsvpByForm(pagePath, { ...person, name: 'Cheap pills https://spam.example' });
  check('a web address for a name is thanked and dropped', linkName.status === 200 && (await guests()).length === 0);

  const noStamp = await rsvpByForm(pagePath, person, { stamp: '', wait: 0 });
  const noStampHtml = await noStamp.text();
  check('a post that never loaded the form gets the form back',
    noStamp.status === 200 && noStampHtml.includes('has not been sent yet') && noStampHtml.includes('value="real@guest.test"'));
  check('and nothing is kept until it is sent again', (await guests()).length === 0);

  const quick = await rsvpByForm(pagePath, person, { wait: 0 });
  check('a reply sent the moment the page loads gets the form back', (await quick.text()).includes('has not been sent yet'));

  const good = await formStamp(pagePath);
  const forged = good.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
  check('a forged stamp gets the form back', (await (await rsvpByForm(pagePath, person, { stamp: forged })).text()).includes('has not been sent yet'));
  const otherStamp = await formStamp(`/alpha/${eventSlug}`);
  check('a stamp from another meeting’s form gets the form back',
    (await (await rsvpByForm(pagePath, person, { stamp: otherStamp })).text()).includes('has not been sent yet'));

  const ok = await rsvpByForm(pagePath, person);
  check('a person who filled in the form is recorded',
    ok.status === 303 && (await guests()).some((g) => g.email === 'real@guest.test' && g.response === 'yes'));
}

// --- a meeting that is over takes no replies -------------------------------
{
  check('a meeting with an end time is over then', meetingEnd({ date: '2031-01-01', start_time: '18:00', end_time: '21:00' }) === '2031-01-01 21:00');
  check('one without runs two hours', meetingEnd({ date: '2031-01-01', start_time: '18:00' }) === '2031-01-01 20:00');
  check('one ending after midnight ends the next day', meetingEnd({ date: '2031-12-31', start_time: '22:00', end_time: '01:00' }) === '2032-01-01 01:00');
  check('one with no time runs to the end of its day', meetingEnd({ date: '2031-01-01' }) === '2031-01-02 00:00');
  // 7pm Eastern on the day, while a 6pm meeting is running, and 8:01pm after it.
  check('a meeting is not over while it runs', !meetingOver({ date: '2031-01-15', start_time: '18:00' }, new Date('2031-01-16T00:00:00Z')));
  check('and is over once it ends', meetingOver({ date: '2031-01-15', start_time: '18:00' }, new Date('2031-01-16T01:01:00Z')));

  const past = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
  const made = await A.api('POST', '/api/events', { title: 'Last Week', date: past, start_time: '18:00' });
  const oid = made.data.event.id;
  const pagePath = `/alpha/${made.data.event.slug}`;
  await A.api('POST', `/api/events/${oid}/guests`, { contact_ids: [contactIds[0]] });
  await A.api('POST', `/api/events/${oid}/publish`, {});

  const html = await (await fetch(`${BASE}${pagePath}`)).text();
  check('its page says it is over', html.includes('This meeting is over'));
  check('with no form and no calendar links', !html.includes('<form') && !html.includes('Add to Google Calendar'));
  const late = await rsvpByForm(pagePath, { name: 'Too Late', email: 'late2@guest.test', attending: 'yes' }, { stamp: '', wait: 0 });
  check('a reply posted to it is turned away', late.status === 303 && late.headers.get('location') === pagePath);

  const guest = (await A.api('GET', `/api/events/${oid}/guests`)).data.guests[0];
  const accept = await fetch(`${BASE}/alpha/i/${guest.token}/accept`, { redirect: 'manual' });
  check('an Accept button in an invitation changes nothing',
    accept.status === 303 && (accept.headers.get('location') || '').endsWith('?closed=1'));
  const update = await fetch(`${BASE}/alpha/i/${guest.token}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ party_size: '3', note: 'after the fact' }).toString(),
  });
  check('nor does the party-size form', update.status === 303 && (update.headers.get('location') || '').endsWith('?closed=1'));
  const after = (await A.api('GET', `/api/events/${oid}/guests`)).data.guests;
  check('the guest list is as it was', after.length === 1 && after[0].response === null && after[0].note === '');
  const invitePage = await (await fetch(`${BASE}/alpha/i/${guest.token}`)).text();
  check('the invitation page says it is over and offers no buttons',
    invitePage.includes('This meeting is over') && !invitePage.includes('/accept"') && !invitePage.includes('/decline"'));
  check('a personal page is never listed by search engines', invitePage.includes('<meta name="robots" content="noindex">'));
}

// --- events made before date addresses move to them ------------------------
{
  const r = spawnSync('node', ['scripts/create-org.mjs',
    '--slug', 'gamma', '--name', 'Gamma Guild', '--admin-email', 'admin@gamma.test',
    '--admin-name', 'Admin', '--password', 'correct-horse-battery'], { env: ENV, encoding: 'utf8' });
  check('create-org gamma', r.status === 0, r.stderr);
  // Wind gamma's database back to before the move, holding the kinds of
  // event a real one would. The server has not opened it yet.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(DATA_DIR, 'orgs', 'gamma', 'org.db'));
  // Back to version 6: undo migration 7's table, the survey tables
  // migration 9 makes (its email_log rebuild simply runs again), and the
  // delivery log's note column from migration 10.
  db.exec(`DROP TABLE event_slugs; DROP TABLE survey_responses; DROP TABLE survey_invites; DROP TABLE surveys;
    ALTER TABLE website_deliveries DROP COLUMN note;
    PRAGMA user_version = 6;`);
  const add = db.prepare('INSERT INTO events (slug, title, status, date, start_time) VALUES (?, ?, ?, ?, ?)');
  add.run('n3nuw7b5wz', 'Sent Meeting', 'published', '2031-10-27', '17:30');
  add.run('q9fgz2frpt', 'Undated Draft', 'draft', null, null);
  add.run('monthly-meeting', 'Kept Website Address', 'published', '2031-11-03', '18:00');
  add.run('k4m8p2r6t9', 'Private Meeting', 'published', '2031-10-28', '18:00');
  db.exec(`UPDATE events SET share_enabled = 0 WHERE slug = 'k4m8p2r6t9'`);
  db.close();

  const moved = await fetch(`${BASE}/gamma/n3nuw7b5wz`, { redirect: 'manual' });
  check('an existing meeting moves to its date address',
    moved.status === 301 && moved.headers.get('location') === '/gamma/2031-oct-27-17-30', `${moved.status} ${moved.headers.get('location')}`);
  const emailed = await fetch(`${BASE}/o/gamma/e/n3nuw7b5wz`, { redirect: 'manual' });
  check('and the link in invitations already sent still reaches it',
    emailed.status === 301 && emailed.headers.get('location') === '/gamma/2031-oct-27-17-30');
  const ics = await (await fetch(`${BASE}/gamma/2031-oct-27-17-30/ics`)).text();
  check('its calendar identity is unchanged', ics.includes('UID:n3nuw7b5wz@'), ics.match(/UID:.*/)?.[0]);
  const kept = await fetch(`${BASE}/gamma/monthly-meeting`, { redirect: 'manual' });
  check('a meeting on a website address stays on it', kept.status === 200);
  const priv = await fetch(`${BASE}/gamma/k4m8p2r6t9`, { redirect: 'manual' });
  check('a private meeting moves to its date plus its code',
    priv.status === 301 && priv.headers.get('location') === '/gamma/2031-oct-28-18-00-k4m8p2r6t9', priv.headers.get('location'));
  const guessed = await fetch(`${BASE}/gamma/2031-oct-28-18-00`, { redirect: 'manual' });
  check('and is not at its date alone', guessed.status === 404);
}

// --- users admin -----------------------------------------------------------
{
  const nu = await A.api('POST', '/api/users', { name: 'Second Member', email: 'member@alpha.test', role: 'member' });
  check('admin creates user with temp password', nu.status === 201 && nu.data?.temp_password?.length >= 10);
  const memberClient = new Client();
  const login = await memberClient.api('POST', '/api/auth/login', { email: 'member@alpha.test', password: nu.data.temp_password });
  check('new member can sign in', login.status === 200);
  const forbidden = await memberClient.api('GET', '/api/users');
  check('member cannot access user admin', forbidden.status === 403);
  const selfDemote = await A.api('PUT', `/api/users/${(await A.api('GET', '/api/auth/me')).data.user.id}`, { role: 'member' });
  check('cannot demote self', selfDemote.status === 400);

  const memberRename = await memberClient.api('PUT', `/api/users/${nu.data.user.id}`, { name: 'Sneaky' });
  check('member cannot rename anyone', memberRename.status === 403);
  const byAdmin = await A.api('PUT', `/api/users/${nu.data.user.id}`, { name: '  Member Two  ' });
  const listed = (await A.api('GET', '/api/users')).data.users.find((u) => u.id === nu.data.user.id);
  check('admin renames a user', byAdmin.status === 200 && listed?.name === 'Member Two'
    && listed.role === 'member' && listed.active === true, listed);
  const blank = await A.api('PUT', `/api/users/${nu.data.user.id}`, { name: '   ' });
  check('a blank name is refused', blank.status === 400);
  const meBefore = (await A.api('GET', '/api/auth/me')).data.user;
  const selfRename = await A.api('PUT', `/api/users/${meBefore.id}`, { name: 'Renamed Admin' });
  check('admin renames self', selfRename.status === 200
    && (await A.api('GET', '/api/auth/me')).data.user.name === 'Renamed Admin');
  await A.api('PUT', `/api/users/${meBefore.id}`, { name: meBefore.name });
  const relogin = new Client();
  const again = await relogin.api('POST', '/api/auth/login', { email: 'member@alpha.test', password: nu.data.temp_password });
  check('a renamed user signs in as before', again.status === 200);
}

// --- app icon: an admin's image beside "Soapbox" in the header -------------
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const token = (await A.api('POST', '/api/uploads', { name: 'icon.png', data: png })).data.token;
  const path = `/o/alpha/files/${token}`;
  const iconNow = async () => (await A.api('GET', '/api/auth/me')).data.org.icon_url;

  check('no app icon until one is set', (await iconNow()) === '');
  const put = await A.api('PUT', '/api/settings', { app_icon_token: token });
  check('an admin sets the app icon', put.status === 200, JSON.stringify(put.data));
  check('the session reports the icon', (await iconNow()) === path);
  check('settings report the icon',
    (await A.api('GET', '/api/settings')).data.settings.app_icon_url === path);
  const img = await fetch(`${BASE}${path}`);
  check('the icon is served as an image', img.status === 200 && img.headers.get('content-type') === 'image/png');
  const fresh = await new Client().api('POST', '/api/auth/login', { email: 'admin@alpha.test', password: 'correct-horse-battery' });
  check('signing in reports the icon', fresh.data?.org?.icon_url === path);
  check('another organization keeps its own header',
    (await B.api('GET', '/api/auth/me')).data.org.icon_url === '');

  const bogus = await A.api('PUT', '/api/settings', { app_icon_token: 'noSuchUpload123' });
  check('an icon must be an uploaded image', bogus.status === 400 && (await iconNow()) === path);

  const nu = await A.api('POST', '/api/users', { name: 'Icon Member', email: 'icon-member@alpha.test', role: 'member' });
  const member = new Client();
  await member.api('POST', '/api/auth/login', { email: 'icon-member@alpha.test', password: nu.data.temp_password });
  const refused = await member.api('PUT', '/api/settings', { app_icon_token: '' });
  check('a member cannot change the app icon', refused.status === 403 && (await iconNow()) === path);
  check('a member sees the icon too', (await member.api('GET', '/api/auth/me')).data.org.icon_url === path);

  await A.api('PUT', '/api/settings', { app_icon_token: '' });
  check('removing the app icon clears it', (await iconNow()) === '');
}

// --- broadcasts (standalone email blast, no event/RSVP) --------------------
{
  const cr = await A.api('POST', '/api/broadcasts', {
    title: 'Endorsement Announcement',
    subject: 'Our endorsements for {{org_name}}',
    body: 'Hi {{first_name}},\n\nHere are our picks for the primary.\n\n— {{org_name}}',
    web_version: true,
    flyer: { style: 'light', eyebrow: 'Announcement' },
  });
  const bId = cr.data?.broadcast?.id;
  const bSlug = cr.data?.broadcast?.slug;
  check('create broadcast', cr.status === 201 && bId > 0 && /^[a-z0-9]{10}$/.test(bSlug || ''));
  check('broadcast starts as draft', cr.data?.broadcast?.status === 'draft');

  // Draft web version: hidden from the public, visible to a signed-in member.
  const draftPub = await fetch(`${BASE}/o/alpha/b/${bSlug}`);
  check('draft broadcast web version hidden from public', draftPub.status === 404);
  const draftPrev = await A.raw('GET', `/o/alpha/b/${bSlug}`);
  check('draft broadcast preview visible to org member', draftPrev.status === 200);

  // Preview email has the masthead but no RSVP buttons.
  const prev = await A.api('POST', `/api/broadcasts/${bId}/email-preview`, {});
  const prevHtml = String(prev.data?.html || '');
  check('broadcast preview renders without RSVP buttons',
    prev.status === 200 && prevHtml.includes('Endorsement Announcement') && !prevHtml.includes('/accept'));
  const test = await A.api('POST', `/api/broadcasts/${bId}/test-email`, {});
  check('broadcast test email simulated', test.data?.status === 'simulated', JSON.stringify(test.data));

  // "Send a copy": the real message to any address, after sending, with the
  // headers a deliverability checker grades.
  {
    const copy = await A.api('POST', `/api/broadcasts/${bId}/send-copy`, { to: 'checker@example.test' });
    check('a copy can be sent to an address that is not a recipient',
      copy.status === 200 && copy.data?.status === 'simulated', JSON.stringify(copy.data));
    const logged = (await A.api('GET', `/api/emails?broadcast_id=${bId}&per_page=50`)).data.emails
      .find((e) => e.to_email === 'checker@example.test');
    check('the copy is logged but stays out of the recipient count',
      Boolean(logged) && logged.kind === 'test', JSON.stringify(logged?.kind));
    check('a copy carries the real subject, not a [Test] one',
      logged && !logged.subject.startsWith('[Test]'), logged?.subject);
    const full = (await A.api('GET', `/api/emails/${logged.id}`)).data.email;
    check('a copy carries an unsubscribe link',
      String(full.html).includes('/bu/preview') && String(full.body_text).includes('Unsubscribe:'),
      String(full.html).slice(-200));
    const preview = await fetch(`${BASE}/o/alpha/bu/preview`);
    check('the stand-in unsubscribe link resolves to a real page', preview.status === 200);
    const previewText = await preview.text();
    check('the stand-in page says nothing is subscribed',
      previewText.includes('Nothing to unsubscribe'), previewText.slice(0, 120));

    const bad = await A.api('POST', `/api/broadcasts/${bId}/send-copy`, { to: 'not-an-email' });
    check('a copy needs a valid address', bad.status === 400, String(bad.status));
  }

  // Pictures in the message body: the composer inserts {{image:<token>}} and
  // both renderings turn it into an <img> at the uploaded file's URL.
  {
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const up = await A.api('POST', '/api/uploads', { name: 'banner.png', data: `data:image/png;base64,${pngB64}` });
    check('upload accepts a PNG for the message body', up.status === 201 && /^[A-Za-z0-9]{6,64}$/.test(up.data?.token || ''),
      JSON.stringify(up.data));
    const tok = up.data.token;
    await A.api('PUT', `/api/broadcasts/${bId}`, {
      body: `Hi {{first_name}},\n\n{{image:${tok}}}\n\nHere are our picks.\n\n{{image:${tok}|half}}\n\n— {{org_name}}`,
    });
    const withImg = await A.api('POST', `/api/broadcasts/${bId}/email-preview`, {});
    const html = String(withImg.data?.html || '');
    check('email body renders the image marker as a picture',
      html.includes(`/o/alpha/files/${tok}`) && html.includes('<img'), html.slice(0, 200));
    check('image URLs in email are absolute', html.includes(`${BASE}/o/alpha/files/${tok}`));
    check('no raw marker survives into the email', !html.includes('{{image:'));
    check('half-width images are emitted at half width',
      html.includes('width="300"') && html.includes('width="600"'), 'expected both sizes');
    check('the plain-text alternative drops the markers',
      !String(withImg.data?.text || '').includes('{{image:'), String(withImg.data?.text || '').slice(0, 120));

    const page = await A.raw('GET', `/o/alpha/b/${bSlug}`);
    const pageHtml = await page.text();
    check('the web version shows the same pictures',
      pageHtml.includes(`/o/alpha/files/${tok}`) && !pageHtml.includes('{{image:'));

    // Links: [label](url), bare URLs, and the things that must NOT become links.
    await A.api('PUT', `/api/broadcasts/${bId}`, {
      body: 'See [our endorsements](https://example.org/e?a=1&b=2) today.\n\n'
        + 'Or visit https://example.org/plain, then stop.\n\n'
        + `{{image:${tok}}}\n\n`
        + 'Not a link: javascript:alert(1) and ftp://example.org/x\n\n'
        + '[bad](javascript:alert(1))',
    });
    const linked = await A.api('POST', `/api/broadcasts/${bId}/email-preview`, {});
    const lh = String(linked.data?.html || '');
    check('a labelled link renders as an anchor',
      lh.includes('<a href="https://example.org/e?a=1&amp;b=2"') && lh.includes('>our endorsements</a>'),
      lh.slice(lh.indexOf('example.org') - 60, lh.indexOf('example.org') + 80));
    check('a bare URL becomes a link without swallowing the comma',
      lh.includes('<a href="https://example.org/plain"') && lh.includes('</a>, then stop.'),
      lh.slice(lh.indexOf('plain') - 40, lh.indexOf('plain') + 80));
    check('javascript: and other schemes are never linked',
      !lh.includes('href="javascript:') && !lh.includes('href="ftp:') && lh.includes('javascript:alert(1)'));
    check('the image URL is not double-linked inside its own tag',
      !/<a[^>]*><img/.test(lh) && !/src="<a/.test(lh));
    // The preview endpoint returns only the HTML part, so the plain-text
    // alternative is checked at the source.
    const { flattenLinks, stripImageMarkers } = await import('../server/lib/html.js');
    const flat = flattenLinks(stripImageMarkers(
      `See [our endorsements](https://example.org/e?a=1&b=2) today.\n\n{{image:${tok}}}\n\nhttps://example.org/plain`
    ));
    check('the plain-text alternative keeps label and address',
      flat.includes('our endorsements (https://example.org/e?a=1&b=2)'), flat);
    check('the plain-text alternative leaves a bare URL alone',
      flat.includes('https://example.org/plain') && !flat.includes('{{image:'), flat);

    const linkedPage = await A.raw('GET', `/o/alpha/b/${bSlug}`);
    const lp = await linkedPage.text();
    check('links work on the web version too',
      lp.includes('<a href="https://example.org/e?a=1&amp;b=2"') && lp.includes('rel="noopener noreferrer"'));

    // Rich-text bodies from the formatting bar.
    const rich = `<p><b>Bold</b> and <i>italic</i> and <u>under</u>, `
      + `<span class="rt-ff-serif rt-fs-lg">styled</span>.</p>`
      + `<p><a href="https://example.org/x">a link</a> and `
      + `<a href="javascript:alert(1)">not a link</a></p>`
      + `<p><img src="/o/alpha/files/${tok}" class="rt-img-half" alt=""></p>`
      + `<p><img src="https://evil.example/track.gif" alt=""></p>`
      + `<p><script>alert(1)</script><span onclick="alert(1)">click</span></p>`;
    await A.api('PUT', `/api/broadcasts/${bId}`, { body: rich });
    const rp = await A.api('POST', `/api/broadcasts/${bId}/email-preview`, {});
    const rh = String(rp.data?.html || '');
    check('rich text keeps bold, italic and underline',
      rh.includes('<b>Bold</b>') && rh.includes('<i>italic</i>') && rh.includes('<u>under</u>'));
    check('font and size classes become inline styles for email',
      rh.includes('font-family:Georgia') && rh.includes('font-size:19px') && !rh.includes('class="rt-ff-serif'),
      rh.slice(rh.indexOf('styled') - 120, rh.indexOf('styled') + 20));
    check('a rich-text link survives with its target',
      rh.includes('<a href="https://example.org/x" target="_blank" rel="noopener noreferrer"'));
    check('a javascript: href is stripped but its words remain',
      !rh.includes('javascript:') && rh.includes('not a link'));
    check('an image from this organization renders at its chosen width',
      rh.includes(`/o/alpha/files/${tok}`) && rh.includes('width="300"'));
    check('an image from anywhere else is dropped', !rh.includes('evil.example'));
    check('scripts and event handlers never survive',
      !rh.includes('<script') && !rh.includes('onclick'), rh.slice(-260));

    const richPage = await A.raw('GET', `/o/alpha/b/${bSlug}`);
    const rpg = await richPage.text();
    check('the web version keeps the classes its stylesheet knows',
      rpg.includes('class="rt-ff-serif rt-fs-lg"') && rpg.includes('class="rt-img-half"')
      && !rpg.includes('evil.example'));

    // Legacy plain-text bodies still render as paragraphs.
    await A.api('PUT', `/api/broadcasts/${bId}`, { body: 'Line one.\n\nLine two.' });
    const legacy = await A.api('POST', `/api/broadcasts/${bId}/email-preview`, {});
    check('plain-text bodies still render as paragraphs',
      String(legacy.data?.html || '').includes('<p>Line one.</p>'));

    // A marker naming a file that isn't there must vanish, not print itself.
    await A.api('PUT', `/api/broadcasts/${bId}`, {
      body: 'Hi {{first_name}},\n\nHere are our picks for the primary.\n\n— {{org_name}}',
    });
  }

  // Send to every contact: 4 have email, 1 has none, 1 emailed one is unsubscribed.
  const send = await A.api('POST', `/api/broadcasts/${bId}/send`, { contact_ids: contactIds });
  check('broadcast send queues 3 (skips no-email + unsubscribed)',
    send.status === 200 && send.data?.queued === 3
    && send.data?.skipped?.no_email === 1 && send.data?.skipped?.unsubscribed === 1,
    JSON.stringify(send.data));
  check('broadcast marked sent', send.data?.broadcast?.status === 'sent');

  await waitFor(async () => {
    const r = await A.api('GET', `/api/emails?broadcast_id=${bId}&status=simulated`);
    return (r.data?.emails || []).filter((e) => e.kind === 'broadcast').length === 3;
  }, 'queue processes 3 broadcast emails (simulated)');

  // Stats count broadcast recipients only (the test send is excluded).
  const detail = await A.api('GET', `/api/broadcasts/${bId}`);
  check('broadcast stats: 3 recipients, 3 sent',
    detail.data?.broadcast?.stats?.recipients === 3 && detail.data?.broadcast?.stats?.sent === 3,
    JSON.stringify(detail.data?.broadcast?.stats));

  // A sent broadcast's web version is public and shows the flyer title.
  const pub = await fetch(`${BASE}/o/alpha/b/${bSlug}`);
  const pubHtml = await pub.text();
  check('sent broadcast web version is public', pub.status === 200 && pubHtml.includes('Endorsement Announcement'));

  // The email carries a working unsubscribe (/bu/) and view-online (/b/) link,
  // and never an RSVP link.
  const one = (await A.api('GET', `/api/emails?broadcast_id=${bId}`)).data.emails.find((e) => e.kind === 'broadcast');
  const bhtml = (await A.api('GET', `/api/emails/${one.id}`)).data?.email?.html || '';
  check('broadcast email has unsubscribe + view-online, no RSVP',
    bhtml.includes('/bu/') && bhtml.includes('/b/') && !bhtml.includes('/accept'));
  const m = bhtml.match(/\/alpha\/bu\/([^"'<>\s]+)/);
  check('broadcast unsubscribe link present', Boolean(m));
  if (m) {
    const unsubGet = await fetch(`${BASE}/o/alpha/bu/${m[1]}`);
    check('broadcast unsubscribe page renders', unsubGet.status === 200);
    const unsubPost = await fetch(`${BASE}/o/alpha/bu/${m[1]}`, { method: 'POST', redirect: 'manual' });
    check('broadcast unsubscribe works', unsubPost.status === 200);
  }

  // A web_version=false broadcast has no public page.
  const noWeb = await A.api('POST', '/api/broadcasts', { title: 'Email Only Blast', web_version: false });
  await A.api('POST', `/api/broadcasts/${noWeb.data.broadcast.id}/send`, { group_ids: [groupId] });
  const noWebPage = await fetch(`${BASE}/o/alpha/b/${noWeb.data.broadcast.slug}`);
  check('web_version=false broadcast page is 404', noWebPage.status === 404);

  // CSV export + cross-org isolation.
  const csv = await A.raw('GET', '/api/export/broadcasts.csv');
  const ctext = await csv.text();
  check('broadcasts CSV export', csv.status === 200 && ctext.includes('Endorsement Announcement'));
  const bIso = await B.api('GET', `/api/broadcasts/${bId}`);
  check('ISOLATION: B cannot fetch A\'s broadcast', bIso.status === 404);
}

// --- sending a broadcast to additional people ------------------------------
{
  const mk = async (name, email) =>
    (await A.api('POST', '/api/contacts', { name, email })).data.contact.id;
  const m1 = await mk('More One', 'more1@guest.test');
  const m2 = await mk('More Two', 'more2@guest.test');
  const m3 = await mk('More Three', 'more3@guest.test');
  const gid = (await A.api('POST', '/api/groups', { name: 'More Group', contact_ids: [m1, m2, m3] })).data.group.id;
  const bc = (await A.api('POST', '/api/broadcasts', {
    title: 'More People', subject: 'Hello', body: 'Hi {{first_name}}',
  })).data.broadcast;

  const early = await A.api('POST', `/api/broadcasts/${bc.id}/send-more`, { contact_ids: [m1] });
  check('a draft broadcast cannot go to additional people', early.status === 400, JSON.stringify(early.data));

  await A.api('POST', `/api/broadcasts/${bc.id}/send`, { contact_ids: [m1] });
  const sentTo = await A.api('GET', `/api/broadcasts/${bc.id}/sent-to`);
  check('sent-to lists the addresses a broadcast went to',
    JSON.stringify(sentTo.data?.emails) === '["more1@guest.test"]', JSON.stringify(sentTo.data));

  const count = await A.api('POST', '/api/recipients/preview', { group_ids: [gid], broadcast_id: bc.id });
  check('the count for additional people leaves out who already got it',
    count.data?.recipients === 2 && count.data?.already_sent === 1, JSON.stringify(count.data));

  const more = await A.api('POST', `/api/broadcasts/${bc.id}/send-more`, {
    group_ids: [gid], new_contacts: [{ name: 'More Four', email: 'more4@guest.test' }],
  });
  check('sending to additional people skips who already got it',
    more.status === 200 && more.data?.queued === 3 && more.data?.skipped?.already_sent === 1,
    JSON.stringify(more.data));
  check('a new person picked there is saved to the contacts',
    (await A.api('GET', '/api/contacts')).data.contacts.some((c) => c.email === 'more4@guest.test'));

  const again = await A.api('POST', `/api/broadcasts/${bc.id}/send-more`, { contact_ids: [m1, m2] });
  check('sending again to people who already got it is refused', again.status === 400, JSON.stringify(again.data));

  const addrs = (await A.api('GET', `/api/emails?broadcast_id=${bc.id}&per_page=50`)).data.emails
    .filter((e) => e.kind === 'broadcast').map((e) => e.to_email).sort();
  check('every address got the broadcast exactly once',
    JSON.stringify(addrs) === JSON.stringify(['more1@guest.test', 'more2@guest.test', 'more3@guest.test', 'more4@guest.test']),
    JSON.stringify(addrs));

  const theft = await B.api('POST', `/api/broadcasts/${bc.id}/send-more`, { contact_ids: [m2] });
  check('ISOLATION: B cannot send A\'s broadcast to more people', theft.status === 404);
}

// --- recipient preview + unsubscribe side-effects --------------------------
{
  const c1 = (await A.api('POST', '/api/contacts', { name: 'Unsub One', email: 'unsub1@guest.test' })).data.contact.id;
  const c2 = (await A.api('POST', '/api/contacts', { name: 'Unsub Two', email: 'unsub2@guest.test' })).data.contact.id;
  const gid = (await A.api('POST', '/api/groups', { name: 'Preview Group', contact_ids: [c1, c2] })).data.group.id;

  const p1 = await A.api('POST', '/api/recipients/preview', { group_ids: [gid] });
  check('recipient preview counts emailable group members', p1.data?.recipients === 2, JSON.stringify(p1.data));

  const contactsBefore = (await A.api('GET', '/api/dashboard')).data?.counts?.contacts;
  await A.api('POST', `/api/contacts/${c1}/unsubscribe`, { on: true });

  const gAfter = await A.api('GET', `/api/groups/${gid}`);
  check('unsubscribe removes contact from group', !gAfter.data.group.member_ids.includes(c1));
  const p2 = await A.api('POST', '/api/recipients/preview', { group_ids: [gid] });
  check('recipient preview excludes unsubscribed', p2.data?.recipients === 1, JSON.stringify(p2.data));

  const dashB = await A.api('GET', '/api/dashboard');
  check('dashboard contacts count drops after unsubscribe', dashB.data?.counts?.contacts === contactsBefore - 1,
    `${contactsBefore} -> ${dashB.data?.counts?.contacts}`);
  check('dashboard exposes broadcasts list', Array.isArray(dashB.data?.broadcasts));
}

// --- excluding one person from a chosen group ------------------------------
{
  const mk = async (name, email) =>
    (await A.api('POST', '/api/contacts', { name, email })).data.contact.id;
  const x1 = await mk('Excl One', 'excl1@guest.test');
  const x2 = await mk('Excl Two', 'excl2@guest.test');
  const x3 = await mk('Excl Three', 'excl3@guest.test');
  const gid = (await A.api('POST', '/api/groups', { name: 'Excl Group', contact_ids: [x1, x2, x3] })).data.group.id;

  const whole = await A.api('POST', '/api/recipients/preview', { group_ids: [gid] });
  check('preview counts a whole group', whole.data?.recipients === 3, JSON.stringify(whole.data));
  const minusOne = await A.api('POST', '/api/recipients/preview', {
    group_ids: [gid], excluded_contact_ids: [x2],
  });
  check('preview drops someone excluded from a chosen group',
    minusOne.data?.recipients === 2, JSON.stringify(minusOne.data));
  // An exclusion beats an explicit tick as well as a group.
  const both = await A.api('POST', '/api/recipients/preview', {
    group_ids: [gid], contact_ids: [x2], excluded_contact_ids: [x2],
  });
  check('an exclusion outranks being picked individually too',
    both.data?.recipients === 2, JSON.stringify(both.data));

  const ev = await A.api('POST', '/api/events', { title: 'Exclusion Test', date: '2030-01-01' });
  const exEventId = ev.data.event.id;
  const added = await A.api('POST', `/api/events/${exEventId}/guests`, {
    group_ids: [gid], excluded_contact_ids: [x2],
  });
  check('inviting a group minus one adds only the rest', added.data?.added === 2, JSON.stringify(added.data));
  const invited = (await A.api('GET', `/api/events/${exEventId}/guests`)).data.guests.map((g) => g.email);
  check('the excluded person is not on the guest list',
    !invited.includes('excl2@guest.test') && invited.includes('excl1@guest.test'), JSON.stringify(invited));

  // Broadcasts keep exclusions in the stored audience, so re-opening a draft
  // and sending later still leaves the same person out.
  const bc = await A.api('POST', '/api/broadcasts', {
    title: 'Exclusion Broadcast', subject: 'Hello', body: 'Hi {{first_name}}',
    audience: { group_ids: [gid], excluded_contact_ids: [x2] },
  });
  const reopened = (await A.api('GET', `/api/broadcasts/${bc.data.broadcast.id}`)).data.broadcast;
  check('a broadcast remembers who was excluded',
    (reopened.audience?.excluded_contact_ids || []).includes(x2), JSON.stringify(reopened.audience));
  const sent = await A.api('POST', `/api/broadcasts/${bc.data.broadcast.id}/send`, {});
  check('sending a broadcast honours the stored exclusion', sent.data?.queued === 2, JSON.stringify(sent.data));

  await A.api('POST', '/api/contacts/bulk-delete', { contact_ids: [x1, x2, x3] });
  await A.api('DELETE', `/api/events/${exEventId}`);
}

// --- WordPress export ------------------------------------------------------
{
  const doc = (await A.api('POST', `/api/events/${eventId}/export/wordpress`, {})).data;
  check('export declares its format and version',
    doc?.format === 'soapbox-event-export' && doc?.version === 1, JSON.stringify(doc?.format));
  check('export identifies the source organization',
    doc?.source?.org_slug === 'alpha' && typeof doc?.source?.base_url === 'string');
  check('export carries the event identity for re-import matching',
    doc?.event?.soapbox_id === eventId && typeof doc?.event?.slug === 'string');
  check('export converts the party size to WordPress extra-guest counts',
    doc.guests.every((g) => g.party_size >= 1
      && g.extra_guests === (g.response === 'accepted' ? g.party_size - 1 : 0)),
    JSON.stringify(doc.guests.map((g) => [g.response, g.party_size, g.extra_guests])));
  check('only accepted guests count towards the seat total',
    doc.counts.seats === doc.guests.filter((g) => g.response === 'accepted')
      .reduce((n, g) => n + g.party_size, 0), JSON.stringify(doc.counts));
  check('export speaks WordPress response vocabulary',
    doc.guests.every((g) => ['accepted', 'declined', 'pending'].includes(g.response)),
    JSON.stringify(doc.guests.map((g) => g.response)));
  const accepted = doc.guests.find((g) => g.response === 'accepted');
  check('an accepted guest reports when they replied', Boolean(accepted && accepted.responded_at),
    JSON.stringify(accepted));
  check('export splits names into first and last',
    doc.guests.every((g) => !g.name || g.last_name), JSON.stringify(doc.guests.map((g) => g.name)));
  check('export counts match the guest rows',
    doc.counts.guests === doc.guests.length
    && doc.counts.accepted === doc.guests.filter((g) => g.response === 'accepted').length,
    JSON.stringify(doc.counts));
  check('export has no flyer picture when none was rendered', doc.flyer_image === null);

  // A picture posted by the browser's rasterizer is embedded as base64.
  const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const withFlyer = (await A.api('POST', `/api/events/${eventId}/export/wordpress`,
    { flyer_image: `data:image/png;base64,${px}` })).data;
  check('a posted flyer picture is embedded in the document',
    withFlyer.flyer_image?.data_base64 === px && withFlyer.flyer_image?.content_type === 'image/png'
    && withFlyer.flyer_image?.bytes > 0, JSON.stringify(withFlyer.flyer_image));
  const junk = (await A.api('POST', `/api/events/${eventId}/export/wordpress`,
    { flyer_image: 'data:text/html;base64,PHNjcmlwdD4=' })).data;
  check('a non-image data URL is refused rather than embedded', junk.flyer_image === null);

  const other = await B.api('POST', `/api/events/${eventId}/export/wordpress`, {});
  check('export cannot reach across organizations', other.status === 404, String(other.status));
}

// --- bulk delete contacts --------------------------------------------------
{
  const mk = async (name, email) =>
    (await A.api('POST', '/api/contacts', { name, email })).data.contact.id;
  const b1 = await mk('Bulk One', 'bulk1@guest.test');
  const b2 = await mk('Bulk Two', 'bulk2@guest.test');
  const b3 = await mk('Bulk Three', 'bulk3@guest.test');
  const gid = (await A.api('POST', '/api/groups', { name: 'Bulk Group', contact_ids: [b1, b2] })).data.group.id;

  const none = await A.api('POST', '/api/contacts/bulk-delete', { contact_ids: [] });
  check('bulk delete rejects an empty selection', none.status === 400);

  // b3 is deleted twice over: once on its own, then again inside the batch.
  await A.api('DELETE', `/api/contacts/${b3}`);
  const res = await A.api('POST', '/api/contacts/bulk-delete', { contact_ids: [b1, b2, b3] });
  check('bulk delete reports what it actually removed', res.status === 200 && res.data?.deleted === 2,
    JSON.stringify(res.data));

  const left = (await A.api('GET', '/api/contacts')).data.contacts.map((c) => c.id);
  check('bulk-deleted contacts are gone', ![b1, b2, b3].some((id) => left.includes(id)));
  const g = await A.api('GET', `/api/groups/${gid}`);
  check('bulk delete clears group membership too', g.data.group.member_ids.length === 0,
    JSON.stringify(g.data.group.member_ids));
}

// --- sender identity: broadcasts can use a second address ------------------
{
  const put = await A.api('PUT', '/api/settings', {
    sender_name: 'Alpha Society', sender_email: 'meetings@alpha.test', reply_to: 'chair@alpha.test',
    broadcast_sender_split: true, broadcast_sender_email: 'news@alpha.test',
    broadcast_sender_name: '', broadcast_reply_to: '',
  });
  check('split sender settings save', put.status === 200, JSON.stringify(put.data));
  const got = (await A.api('GET', '/api/settings')).data?.settings;
  check('split sender settings round-trip',
    got?.broadcast_sender_split === true && got?.broadcast_sender_email === 'news@alpha.test',
    JSON.stringify(got));

  // The routing itself, exercised directly — in simulation mode no From
  // header reaches the wire, so this is the only place it can be observed.
  process.env.DATA_DIR = DATA_DIR; // keep the module's data dir inside the sandbox
  const { senderFor } = await import('../server/lib/email.js');
  const stub = (settings) => ({ prepare: () => ({ get: (key) => ({ value: settings[key] ?? '' }) }) });
  const live = stub({
    sender_email: 'meetings@alpha.test', sender_name: 'Alpha Society', reply_to: 'chair@alpha.test',
    broadcast_sender_split: '1', broadcast_sender_email: 'news@alpha.test', broadcast_reply_to: '',
  });
  const ev = senderFor(live, 'Alpha Society', 'event');
  check('events keep the default sender',
    ev.sender.email === 'meetings@alpha.test' && ev.replyTo === 'chair@alpha.test', JSON.stringify(ev));
  const bc = senderFor(live, 'Alpha Society', 'broadcast');
  check('broadcasts use the split sender', bc.sender.email === 'news@alpha.test', JSON.stringify(bc));
  check('broadcast name falls back to the default sender name', bc.sender.name === 'Alpha Society');
  check('broadcast reply-to does not inherit the event reply-to', bc.replyTo === '');

  const halfDone = stub({ sender_email: 'meetings@alpha.test', broadcast_sender_split: '1' });
  check('split with no address falls back to the default sender',
    senderFor(halfDone, 'Alpha', 'broadcast').sender.email === 'meetings@alpha.test');
  const off = stub({ sender_email: 'meetings@alpha.test', broadcast_sender_email: 'news@alpha.test' });
  check('a saved broadcast address is ignored while the split is off',
    senderFor(off, 'Alpha', 'broadcast').sender.email === 'meetings@alpha.test');

  await A.api('PUT', '/api/settings', { broadcast_sender_split: false });
}

// --- topping up an event that has already been invited ---------------------
{
  const mk = async (name, email) =>
    (await A.api('POST', '/api/contacts', { name, email })).data.contact.id;
  const first = await mk('Topup First', 'topup1@guest.test');
  const second = await mk('Topup Second', 'topup2@guest.test');
  const late = await mk('Topup Late', 'topup3@guest.test');

  const evId = (await A.api('POST', '/api/events', {
    title: 'Topup Supper', date: '2030-04-04', time: '18:00',
  })).data.event.id;
  await A.api('POST', `/api/events/${evId}/guests`, { contact_ids: [first, second] });
  const push = await A.api('POST', `/api/events/${evId}/send`, {});
  check('the first push invites everyone on the list', push.data?.queued === 2, JSON.stringify(push.data));

  // The whole point: revisit the guest list later, add someone who was left
  // out, and send to just them.
  const add = await A.api('POST', `/api/events/${evId}/guests`, { contact_ids: [first, second, late] });
  check('re-adding people already invited adds only the new one',
    add.data?.added === 1 && add.data?.skipped === 2, JSON.stringify(add.data));

  const topup = await A.api('POST', `/api/events/${evId}/send`, {});
  check('a second send reaches only the guest added since', topup.data?.queued === 1, JSON.stringify(topup.data));

  const guests = (await A.api('GET', `/api/events/${evId}/guests`)).data.guests;
  const byEmail = Object.fromEntries(guests.map((g) => [g.email, g]));
  check('nobody already invited was emailed twice',
    (await A.api('GET', `/api/emails?event_id=${evId}`)).data.emails
      .filter((e) => e.kind === 'invitation' && e.to_email === 'topup1@guest.test').length === 1);
  check('the late guest is now queued too', byEmail['topup3@guest.test']?.email_status !== 'not_sent',
    JSON.stringify(byEmail['topup3@guest.test']));

  const empty = await A.api('POST', `/api/events/${evId}/send`, {});
  check('sending again with nobody new is refused', empty.status === 400, String(empty.status));

  // The button's wording, over the guest shapes it has to describe.
  const G = (email_status, extra = {}) => ({ email_status, email: 'x@y.test', response: null, ...extra });
  const fresh = sendQueue([G('not_sent'), G('not_sent')]);
  check('a first push counts the whole list', fresh.firstPush && fresh.sendable === 2);
  check('a first push keeps the plain wording', sendLabel(fresh) === 'Send invitations (2)');

  const topUp = sendQueue([G('sent'), G('sent'), G('not_sent')]);
  check('a top-up is not a first push', !topUp.firstPush && topUp.added === 1);
  check('a top-up names its audience', sendLabel(topUp) === 'Send invitation to 1 new guest',
    sendLabel(topUp));
  check('a top-up of several reads as plural',
    sendLabel(sendQueue([G('sent'), G('not_sent'), G('not_sent')])) === 'Send invitations to 2 new guests');
  check('a top-up explains that nobody gets a second copy',
    sendSummary(topUp).includes('added since the last send')
      && sendSummary(topUp).includes('second copy'), sendSummary(topUp));

  const done = sendQueue([G('sent'), G('sent')]);
  check('an event with nothing pending has nothing to send', done.sendable === 0);
  check('the button still names itself when there is nothing to send',
    sendLabel(done) === 'Send invitations to new guests');

  // A failed delivery is a retry, not a new guest — saying "new" would lie.
  check('failures read as a retry rather than a new guest',
    sendLabel(sendQueue([G('sent'), G('failed')])) === 'Retry 1 failed invitation');
  check('new guests and retries together drop to a neutral count',
    sendLabel(sendQueue([G('sent'), G('failed'), G('not_sent')])) === 'Send 2 pending invitations');

  // People who can't be reached are counted out of the total, and said so.
  const blocked = sendQueue([
    G('sent'), G('not_sent'), G('not_sent', { email: '' }), G('not_sent', { unsubscribed: true }),
  ]);
  check('unreachable guests are left out of the count', blocked.sendable === 1, JSON.stringify(blocked));
  check('the summary says who is being skipped and why',
    sendSummary(blocked).includes('1 with no email address') && sendSummary(blocked).includes('1 unsubscribed'),
    sendSummary(blocked));
  check('someone who already replied is never re-invited',
    sendQueue([G('failed', { response: 'yes' })]).sendable === 0);
}

// --- contacts keep a first and last name ------------------------------------
{
  // The parts are what the form posts, and `name` is composed from them.
  const made = await A.api('POST', '/api/contacts', {
    first_name: 'Ada', last_name: 'Lovelace', email: 'ada@names.test',
  });
  const ada = made.data?.contact;
  check('a contact saves the name parts it was given',
    ada?.first_name === 'Ada' && ada?.last_name === 'Lovelace', JSON.stringify(ada));
  check('the display name is composed from the parts', ada?.name === 'Ada Lovelace', ada?.name);

  // A single word is a first name, not a surname — "Hi {{first_name}}" has to
  // greet someone.
  const solo = (await A.api('POST', '/api/contacts', { first_name: 'Reception' })).data?.contact;
  check('one part on its own is enough', solo?.name === 'Reception' && solo?.last_name === '');
  const neither = await A.api('POST', '/api/contacts', { first_name: '', last_name: '' });
  check('a contact with no name at all is refused', neither.status === 400, String(neither.status));

  // Callers that only know about a single name still work, and get split.
  const legacy = (await A.api('POST', '/api/contacts', {
    name: 'Mary Anne Fitzgerald', email: 'maf@names.test',
  })).data?.contact;
  check('a single name is split into parts on the way in',
    legacy?.first_name === 'Mary' && legacy?.last_name === 'Anne Fitzgerald', JSON.stringify(legacy));

  // Editing one part recomposes the display name rather than leaving it stale.
  await A.api('PUT', `/api/contacts/${ada.id}`, { last_name: 'Byron King' });
  const edited = (await A.api('GET', '/api/contacts?q=ada@names.test')).data.contacts[0];
  check('editing a part recomposes the display name', edited?.name === 'Ada Byron King', edited?.name);
  check('the untouched part survives the edit', edited?.first_name === 'Ada');

  // A partial update that says nothing about the name must not erase it.
  await A.api('PUT', `/api/contacts/${ada.id}`, { phone: '555-0000' });
  const kept = (await A.api('GET', '/api/contacts?q=ada@names.test')).data.contacts[0];
  check('an update that omits the name leaves it alone',
    kept?.name === 'Ada Byron King' && kept?.first_name === 'Ada', JSON.stringify(kept));

  // Searching by surname finds people whose display name starts elsewhere.
  const found = await A.api('GET', '/api/contacts?q=Byron');
  check('contacts are searchable by last name', found.data.contacts.some((c) => c.id === ada.id));

  // CSV round-trip: separate columns stay separate, a lone name gets split.
  const imported = await A.api('POST', '/api/contacts/import', {
    csv: 'First Name,Last Name,Email\nGrace,Hopper,grace@names.test\n',
  });
  check('a CSV with first/last columns imports them apart', imported.data?.added === 1);
  const grace = (await A.api('GET', '/api/contacts?q=grace@names.test')).data.contacts[0];
  check('imported parts are stored as given',
    grace?.first_name === 'Grace' && grace?.last_name === 'Hopper', JSON.stringify(grace));

  const csvOut = await (await A.raw('GET', '/api/export/contacts.csv')).text();
  check('the CSV export has first_name and last_name columns',
    csvOut.includes('first_name,last_name,name,email'), csvOut.slice(0, 120));
  check('the CSV export writes the parts', csvOut.includes('Grace,Hopper,Grace Hopper'));

  // Guests added straight to an event land in contacts with parts too.
  const evId = (await A.api('POST', '/api/events', { title: 'Name Party', date: '2030-06-06' })).data.event.id;
  await A.api('POST', `/api/events/${evId}/guests`, {
    new_contacts: [{ name: 'Katherine Johnson', email: 'kj@names.test' }],
  });
  const kj = (await A.api('GET', '/api/contacts?q=kj@names.test')).data.contacts[0];
  check('a guest saved from an event gets name parts too',
    kj?.first_name === 'Katherine' && kj?.last_name === 'Johnson', JSON.stringify(kj));

  // The WordPress export prefers what the contact actually stores.
  const doc = (await A.api('POST', `/api/events/${evId}/export/wordpress`, {})).data;
  const row = doc.guests.find((g) => g.email === 'kj@names.test');
  check('the WordPress export uses the stored parts',
    row?.first_name === 'Katherine' && row?.last_name === 'Johnson', JSON.stringify(row));

  // {{first_name}} must render exactly what it always did.
  check('a split name still greets by the first word',
    personName({ name: 'Mary Anne Fitzgerald' }).first_name === 'Mary');
  check('a one-word name is a first name, not a surname',
    splitPersonName('Mom').first_name === 'Mom' && splitPersonName('Mom').last_name === '');
  check('explicit parts beat any guess from a name',
    personName({ name: 'Ignore Me', first_name: 'Ada', last_name: 'Lovelace' }).name === 'Ada Lovelace');
  check('runs of whitespace collapse before splitting',
    personName({ name: '  Ada   Lovelace ' }).name === 'Ada Lovelace');

  for (const c of [ada, solo, legacy, grace, kj]) if (c) await A.api('DELETE', `/api/contacts/${c.id}`);
  await A.api('DELETE', `/api/events/${evId}`);
}

// --- publishing meetings to a website ---------------------------------------
//
// The feature is off until an organization fills in an address and a token,
// and the first thing to protect is the organizations that never do. A stub
// receiver stands in for the county website: it checks the token and the
// document shape, and records what it was sent.
{
  const HOOK_PORT = PORT + 500;
  const HOOK = `http://127.0.0.1:${HOOK_PORT}/soapbox-hook.php`;
  const TOKEN = 'smoke-token-abcdefghij';
  const received = [];
  // The largest body the stub's "web server" lets through, as shared hosting
  // does in front of the real receiver. Refusals come back as Apache's page.
  let ceiling = Infinity;
  const refused = [];
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (Buffer.byteLength(body) >= ceiling) {
        refused.push(Buffer.byteLength(body));
        res.writeHead(413, { 'content-type': 'text/html; charset=iso-8859-1' });
        return res.end('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">\n'
          + '<html><head>\n<title>413 Request Entity Too Large</title>\n</head><body>\n'
          + '<h1>Request Entity Too Large</h1>\n</body></html>\n');
      }
      if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
      if (req.headers['x-soapbox-token'] !== TOKEN) return json(401, { error: 'Unauthorized.' });
      let doc;
      try { doc = JSON.parse(body); } catch { return json(400, { error: 'Body is not JSON.' }); }
      if (doc.format !== 'soapbox-website-push' || doc.version !== 1) {
        return json(422, { error: 'Unexpected format.' });
      }
      received.push({ doc, raw: body });
      json(200, { ok: true, stored: doc.events.length, kept_local: 0 });
    });
  });
  await new Promise((r) => hook.listen(HOOK_PORT, '127.0.0.1', r));
  const settle = () => new Promise((r) => setTimeout(r, 600));
  const log = async () => (await A.api('GET', '/api/settings/website/deliveries')).data;

  // 1. An organization with no website configured notices no change at all.
  const quiet = await A.api('POST', '/api/events', { title: 'Quiet Meeting', date: '2026-11-04' });
  const quietId = quiet.data.event.id;
  await A.api('POST', `/api/events/${quietId}/publish`, {});
  await A.api('PUT', `/api/events/${quietId}`, { description: 'edited with no website' });
  await settle();
  check('no website configured sends nothing', received.length === 0);
  check('no website configured writes no delivery row', (await log()).deliveries.length === 0);
  check('the settings report no website', (await A.api('GET', '/api/settings')).data.settings.website_push_url === '');
  await A.api('DELETE', `/api/events/${quietId}`);

  // 2. Connecting proves itself, and the token never comes back to the browser.
  await A.api('PUT', '/api/settings', { website_push_url: HOOK, website_push_token: TOKEN });
  await settle();
  check('saving a website address delivers straight away', received.length === 1);
  check('and logs it as a settings save', (await log()).deliveries[0]?.reason === 'settings');
  {
    const settings = (await A.api('GET', '/api/settings')).data.settings;
    check('a stored token is reported', settings.website_push_token_set === true);
    check('but never sent back', !JSON.stringify(settings).includes(TOKEN));
  }

  // 3. Only the transitions a visitor would notice.
  const ev = await A.api('POST', '/api/events', {
    title: 'County Meeting', date: '2026-10-27', start_time: '18:00',
    venue_name: 'Library', venue_address: '1960 N Ponce de Leon Blvd',
  });
  const id = ev.data.event.id;
  const slug = ev.data.event.slug;
  {
    const before = received.length;
    await A.api('PUT', `/api/events/${id}`, { description: 'still a draft' });
    await settle();
    check('editing a draft sends nothing', received.length === before);
  }
  await A.api('POST', `/api/events/${id}/publish`, {});
  await settle();
  check('publishing sends', (await log()).deliveries[0]?.reason === 'publish');
  check('the meeting is in the payload', received.at(-1).doc.events.some((e) => e.slug === slug));
  check('with the venue nested the way the website reads it',
    received.at(-1).doc.events.find((e) => e.slug === slug)?.venue?.name === 'Library');
  check('and an RSVP link back to Soapbox',
    received.at(-1).doc.events.find((e) => e.slug === slug)?.public_url === `${BASE}/alpha/${slug}`);

  await A.api('PUT', `/api/events/${id}`, { description: 'Impact fees' });
  await settle();
  check('editing a published meeting sends', (await log()).deliveries[0]?.reason === 'edit');

  // The wizard saves on every step. A run of saves is one delivery, and a
  // save the website would not notice is none.
  {
    const before = received.length;
    for (const description of ['Impact fees and roads', 'Impact fees, roads', 'Impact fees, roads and parks']) {
      await A.api('PUT', `/api/events/${id}`, { description });
    }
    await settle();
    check('a run of edits makes one delivery', received.length === before + 1, `${received.length - before} deliveries`);
    check('carrying the last of them',
      received.at(-1).doc.events.find((e) => e.slug === slug)?.description === 'Impact fees, roads and parks');

    await A.api('PUT', `/api/events/${id}`, { description: 'Impact fees, roads and parks' });
    await A.api('PUT', `/api/events/${id}`, { email_subject: 'The website never sees this' });
    await settle();
    check('a save that changes nothing on the website sends nothing', received.length === before + 1);
  }

  // A private meeting is not for the public website.
  await A.api('PUT', `/api/events/${id}`, { share_enabled: false });
  await settle();
  check('a meeting made private drops out of the payload',
    !received.at(-1).doc.events.some((e) => e.title === 'County Meeting'));
  const again = await A.api('PUT', `/api/events/${id}`, { share_enabled: true });
  await settle();
  check('and comes back at its date address when it is public again', again.data?.event?.slug === slug
    && received.at(-1).doc.events.some((e) => e.slug === slug), again.data?.event?.slug);

  await A.api('POST', `/api/events/${id}/cancel`, { notify: false });
  await settle();
  check('cancelling sends', (await log()).deliveries[0]?.reason === 'cancel');
  check('a cancelled meeting drops out of the payload',
    !received.at(-1).doc.events.some((e) => e.slug === slug));
  await A.api('DELETE', `/api/events/${id}`);

  // 4. Sending invitations publishes a draft on the way past, which the
  //    website has to hear about — otherwise a meeting goes out to the whole
  //    contact list and never appears on the calendar.
  {
    const draft = await A.api('POST', '/api/events', { title: 'December Meeting', date: '2026-12-15' });
    const draftId = draft.data.event.id;
    await A.api('POST', `/api/events/${draftId}/guests`, { contact_ids: [contactIds[0]] });
    const before = received.length;
    await A.api('POST', `/api/events/${draftId}/send`, {});
    await settle();
    check('sending invitations for a draft publishes it to the website', received.length === before + 1);
    check('and logs that as a publish', (await log()).deliveries[0]?.reason === 'publish');
    await A.api('DELETE', `/api/events/${draftId}`);
    await settle();
    check('deleting a published meeting sends', (await log()).deliveries[0]?.reason === 'delete');
    check('and it is gone from the payload',
      !received.at(-1).doc.events.some((e) => e.title === 'December Meeting'));
  }

  // 5. The website is public. It never receives the guest list.
  {
    const raw = received.map((r) => r.raw).join('\n');
    check('no email address appears in any payload', !raw.includes('@'), raw.match(/\S*@\S*/)?.[0] || '');
    const keys = new Set(received.flatMap((r) => r.doc.events.flatMap(Object.keys)));
    check('no guest or email fields are in the event shape',
      !keys.has('guests') && !keys.has('invites') && !keys.has('email_subject') && !keys.has('email_body'),
      [...keys].join(','));
  }

  // 5b. Meetings that exist only on the website come in through an import,
  //     keep their web address and picture, and go straight back out.
  {
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    // The smallest PNG there is: one transparent pixel.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const file = {
      format: 'rlc-meetings-export',
      version: 1,
      events: [
        {
          slug: 'monthly-meeting-with-a-speaker', title: 'Monthly Meeting with a Speaker',
          description: '<p>We heard from a speaker.</p>', status: 'published', date: daysAgo(30),
          start_time: '18:30', end_time: '20:00', timezone_note: '',
          venue: { name: 'Caddyshack', address: '455 S Legacy Trail', phone: '', map_url: '' },
          rsvp_mode: 'rsvp', picture: { name: 'speaker.png', data: png },
        },
        {
          slug: 'Not A Valid Address!', title: 'A Meeting With An Odd Address', description: '',
          status: 'published', date: daysAgo(10), start_time: '', end_time: '', timezone_note: '',
          venue: { name: '', address: '', phone: '', map_url: '' }, rsvp_mode: 'rsvp', picture: null,
        },
      ],
    };
    const member = new Client();
    await A.api('POST', '/api/users', { name: 'Import Member', email: 'import-member@alpha.test', role: 'member' });
    check('importing meetings is admin-only',
      (await member.api('POST', '/api/events/import', { file })).status === 401);
    check('a file that is not a meetings export is refused',
      (await A.api('POST', '/api/events/import', { file: { format: 'something-else', events: [] } })).status === 400);

    const before = received.length;
    const r = await A.api('POST', '/api/events/import', { file });
    check('an import adds every meeting in the file', r.status === 200 && r.data.added === 2, JSON.stringify(r.data));
    await settle();
    check('an import delivers to the website', received.length === before + 1);
    check('and the log says why', (await log()).deliveries[0]?.reason === 'import');
    const sent = received.at(-1).doc;
    check('an imported meeting keeps its web address',
      sent.events.some((e) => e.slug === 'monthly-meeting-with-a-speaker'));
    check('so its picture goes back to the website under that address',
      sent.flyers?.['monthly-meeting-with-a-speaker']?.content_type === 'image/png');
    const odd = sent.events.find((e) => e.title === 'A Meeting With An Odd Address');
    check('an address Soapbox cannot use is replaced by its date', odd && /^\d{4}-[a-z]{3}-\d{2}$/.test(odd.slug), odd?.slug);

    const list = (await A.api('GET', '/api/events')).data.events;
    const speaker = list.find((e) => e.slug === 'monthly-meeting-with-a-speaker');
    check('a past meeting takes no new RSVPs', speaker?.rsvp_deadline === speaker?.date);
    check('and is published', speaker?.status === 'published');

    const again = await A.api('POST', '/api/events/import', { file });
    check('importing the same file again adds only what is new',
      again.data.added === 1 && again.data.skipped.some((x) => x.includes('already here')), JSON.stringify(again.data));
    for (const e of (await A.api('GET', '/api/events')).data.events) {
      if (e.title.startsWith('Monthly Meeting with a Speaker') || e.title.startsWith('A Meeting With An Odd')) {
        await A.api('DELETE', `/api/events/${e.id}`);
      }
    }
    await settle(); // let those deletions' deliveries land before the next test
  }

  // 5c. Shared hosting refuses a body of 1 MiB or more before the website's
  //     own script sees it. Flyers give way, oldest meeting first, so the
  //     meetings still land.
  {
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    // A PNG signature and enough after it to weigh 220 KB, about 290 KB once
    // encoded. Three fit under Soapbox's limit, and four are over the host's.
    const heavy = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(220_000)]).toString('base64');
    const meeting = (slug, date) => ({
      slug, title: `Heavy ${slug}`, description: '', status: 'published', date,
      start_time: '18:30', end_time: '', timezone_note: '',
      venue: { name: '', address: '', phone: '', map_url: '' }, rsvp_mode: 'rsvp',
      picture: { name: `${slug}.png`, data: heavy },
    });
    const file = {
      format: 'rlc-meetings-export',
      version: 1,
      events: [
        meeting('heavy-last-year', day(-300)),
        meeting('heavy-last-month', day(-20)),
        meeting('heavy-next-week', day(7)),
        meeting('heavy-next-month', day(35)),
      ],
    };
    ceiling = 1024 * 1024;
    const before = received.length;
    const r = await A.api('POST', '/api/events/import', { file });
    check('four meetings with heavy flyers import', r.status === 200 && r.data.added === 4, JSON.stringify(r.data));
    await settle();
    const row = (await log()).deliveries[0];
    check('a delivery too big for the host still lands', received.length === before + 1 && row?.ok === true,
      JSON.stringify(row));
    check('under the host\'s ceiling, with the hook never refusing it', refused.length === 0, refused.join(','));
    const flyers = Object.keys(received.at(-1).doc.flyers || {});
    check('upcoming meetings keep their flyers',
      flyers.includes('heavy-next-week') && flyers.includes('heavy-next-month'), flyers.join(','));
    check('the oldest meeting is the one that goes without',
      !flyers.includes('heavy-last-year') && flyers.includes('heavy-last-month'), flyers.join(','));
    check('and every meeting still goes', received.at(-1).doc.events.some((e) => e.slug === 'heavy-last-year'));
    check('the log says a flyer was left out', row?.flyers === 3 && /Left out 1 flyer\b/.test(row?.note || ''),
      JSON.stringify(row));

    // A host stricter still refuses even that. The meetings go again without
    // their flyers rather than not at all.
    ceiling = 200_000;
    const resend = await A.api('POST', '/api/settings/website/resend');
    check('a refusal from a stricter host is followed by the meetings alone',
      resend.data?.result?.ok === true && refused.length === 1 && !received.at(-1).doc.flyers,
      JSON.stringify(resend.data?.result));
    check('and the log says every flyer was left out', (await log()).deliveries[0]?.note.startsWith('Left out 4 flyers'));

    // A refusal that stands is logged in words, not as a page of HTML.
    ceiling = 100;
    await A.api('POST', '/api/settings/website/resend');
    const failed = (await log()).deliveries[0];
    check('a host refusal is logged by its title',
      failed?.status === 413 && failed.error.includes('413 Request Entity Too Large') && !failed.error.includes('<'),
      failed?.error);

    ceiling = Infinity;
    for (const e of (await A.api('GET', '/api/events')).data.events) {
      if (e.title.startsWith('Heavy ')) await A.api('DELETE', `/api/events/${e.id}`);
    }
    await settle();
  }

  // 6. A website that stops answering must never break Soapbox.
  await A.api('PUT', '/api/settings', { website_push_token: 'wrong-token' });
  await settle();
  {
    const row = (await log()).deliveries[0];
    check('a wrong token is logged as 401', row?.status === 401, JSON.stringify(row));
    check('and marked as not worth retrying', row?.retryable === false);
  }
  await A.api('PUT', '/api/settings', { website_push_token: TOKEN });
  await settle();
  await new Promise((r) => hook.close(r));
  {
    const resend = await A.api('POST', '/api/settings/website/resend');
    const row = (await log()).deliveries[0];
    check('a website that is down is logged with no status', row?.status === 0, JSON.stringify(row));
    check('and marked as worth retrying', row?.retryable === true);
    check('the resend says so rather than throwing', resend.status === 200 && resend.data?.result?.ok === false);
    const still = await A.api('POST', '/api/events', { title: 'Unblocked', date: '2026-12-01' });
    check('publishing still works while the website is down',
      (await A.api('POST', `/api/events/${still.data.event.id}/publish`, {})).status === 200);
    await A.api('DELETE', `/api/events/${still.data.event.id}`);
  }

  // 7. Turning it off is one click and loses nothing.
  await A.api('PUT', '/api/settings', { website_push_url: '', website_push_token: '' });
  {
    const rows = (await log()).deliveries.length;
    const last = await A.api('POST', '/api/events', { title: 'After Disconnecting', date: '2026-12-08' });
    await A.api('POST', `/api/events/${last.data.event.id}/publish`, {});
    await settle();
    const l = await log();
    check('disconnecting stops delivery', l.deliveries.length === rows);
    check('and reports the organization as unconnected', l.configured === false);
    check('the delivery history survives', l.deliveries.length > 0);
    check('resend refuses when nothing is configured',
      (await A.api('POST', '/api/settings/website/resend')).status === 400);
    await A.api('DELETE', `/api/events/${last.data.event.id}`);
  }

  // 8. A member cannot read or change any of it.
  {
    const member = new Client();
    await A.api('POST', '/api/users', { name: 'Push Member', email: 'member@alpha.test', role: 'member' });
    check('the delivery log is admin-only',
      (await member.api('GET', '/api/settings/website/deliveries')).status === 401);
  }
}

// --- a broadcast's attached file --------------------------------------------
{
  const asData = (buf, type = 'application/octet-stream') => `data:${type};base64,${buf.toString('base64')}`;
  const attach = (name, buf, type) => A.api('POST', '/api/uploads', { name, data: asData(buf, type), kind: 'attachment' });
  // A zip holding empty files with these names: enough for the contents check,
  // which reads only the zip's directory.
  const zip = (names) => {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const name of names) {
      const n = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(n.length, 26);
      locals.push(local, n);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(n.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, n);
      offset += 30 + n.length;
    }
    const dir = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(names.length, 8);
    end.writeUInt16LE(names.length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, dir, end]);
  };
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');

  const up = await attach('Agenda.pdf', pdf, 'application/pdf');
  check('a PDF can be attached', up.status === 201 && up.data?.mime === 'application/pdf' && up.data?.name === 'Agenda.pdf',
    JSON.stringify(up.data));
  const bare = await attach('minutes', pdf, '');
  check('an attachment without an extension gets one', bare.data?.name === 'minutes.pdf', JSON.stringify(bare.data));
  const misnamed = await attach('report.docx', pdf);
  check('an attachment is named for what it is', misnamed.data?.name === 'report.pdf', JSON.stringify(misnamed.data));
  const docx = await attach('Notes.docx', zip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']));
  check('a Word file can be attached',
    docx.status === 201 && docx.data?.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    JSON.stringify(docx.data));
  const macro = await attach('Notes.docm', zip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']));
  check('an Office file with macros is refused', macro.status === 400);
  const page = await attach('evil.pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf');
  check('a web page named as a PDF is refused', page.status === 400);
  const program = await attach('setup.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]));
  check('a program is refused', program.status === 400);
  const big = await attach('big.pdf', Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024 + 1 - pdf.length)]));
  check('an attachment over 5 MB is refused', big.status === 400 && /5 MB/.test(big.data?.error || ''), JSON.stringify(big.data));
  const asPicture = await A.api('POST', '/api/uploads', { name: 'Agenda.pdf', data: asData(pdf) });
  check('a picture upload still takes only pictures', asPicture.status === 400);

  const served = await fetch(`${BASE}/o/alpha/files/${up.data.token}`);
  check('an attached file downloads under its own name',
    served.status === 200 && served.headers.get('content-type') === 'application/pdf'
    && /^attachment; filename="Agenda\.pdf"/.test(served.headers.get('content-disposition') || ''),
    served.headers.get('content-disposition'));

  const cr = await A.api('POST', '/api/broadcasts', {
    title: 'Agenda Notice', subject: 'The October agenda', body: 'The agenda is attached.', attachment: up.data.token,
  });
  const bId = cr.data?.broadcast?.id;
  check('a broadcast keeps its attachment',
    cr.status === 201 && cr.data.broadcast.attachment?.name === 'Agenda.pdf'
    && cr.data.broadcast.attachment?.bytes === pdf.length && /\/o\/alpha\/files\//.test(cr.data.broadcast.attachment?.url || ''),
    JSON.stringify(cr.data?.broadcast?.attachment));
  const wrong = await A.api('PUT', `/api/broadcasts/${bId}`, { attachment: 'noSuchUpload123' });
  check('only an uploaded file can be attached', wrong.status === 400);
  check('another organization cannot attach this one\'s file',
    (await B.api('POST', '/api/broadcasts', { title: 'Theft', attachment: up.data.token })).status === 400);

  // Real sends from here on, to the stand-in, once earlier sends have drained.
  await waitFor(async () => ((await A.api('GET', '/api/emails?status=queued')).data?.emails || []).length === 0,
    'the queue is empty before sending for real');
  const sends = [];
  const smtp = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (!req.url.endsWith('/email/send')) return res.end('{"data":{}}');
      sends.push({ key: req.headers['x-smtp2go-api-key'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.end(JSON.stringify({ data: { succeeded: 1, failed: 0, email_id: `stand-in-${sends.length}` } }));
    });
  });
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  await A.api('PUT', '/api/settings', { sender_email: 'meetings@alpha.test', smtp2go_api_key: 'smoke-key' });
  const carries = (mail) => mail?.body?.attachments?.length === 1
    && mail.body.attachments[0].filename === 'Agenda.pdf'
    && mail.body.attachments[0].mimetype === 'application/pdf'
    && Buffer.from(mail.body.attachments[0].fileblob, 'base64').equals(pdf);

  const test = await A.api('POST', `/api/broadcasts/${bId}/test-email`, { to: 'tester@alpha.test' });
  const testMail = sends.find((m) => (m.body.to || []).some((t) => t.includes('tester@alpha.test')));
  check('a test email carries the attachment', test.data?.status === 'sent' && carries(testMail), JSON.stringify(testMail?.body?.attachments?.map((a) => a.filename)));
  check('the API key reaches SMTP2GO', testMail?.key === 'smoke-key');
  await A.api('POST', `/api/broadcasts/${bId}/send-copy`, { to: 'copy@alpha.test' });
  check('a copy carries the attachment', carries(sends.find((m) => (m.body.to || []).some((t) => t.includes('copy@alpha.test')))));

  const people = [];
  for (const [name, email] of [['Attach One', 'attach1@guest.test'], ['Attach Two', 'attach2@guest.test']]) {
    people.push((await A.api('POST', '/api/contacts', { name, email })).data.contact.id);
  }
  const send = await A.api('POST', `/api/broadcasts/${bId}/send`, { contact_ids: people });
  check('a broadcast with an attachment sends', send.data?.queued === 2, JSON.stringify(send.data));
  // The copy has the same subject, so the two are told apart by address.
  const toGuests = () => sends.filter((m) => (m.body.to || []).some((t) => /attach[12]@guest\.test/.test(t)));
  await waitFor(() => toGuests().length === 2, 'the queue hands both emails to SMTP2GO');
  const real = toGuests();
  check('every email carries the attachment', real.length === 2 && real.every(carries));
  await waitFor(async () => ((await A.api('GET', `/api/emails?broadcast_id=${bId}&kind=broadcast&status=sent`)).data?.emails || []).length === 2,
    'both emails are marked sent');

  const dup = await A.api('POST', `/api/broadcasts/${bId}/duplicate`);
  check('a duplicate keeps the attachment', dup.data?.broadcast?.attachment?.name === 'Agenda.pdf');

  await A.api('PUT', `/api/broadcasts/${bId}`, { attachment: '' });
  check('removing the attachment clears it', (await A.api('GET', `/api/broadcasts/${bId}`)).data?.broadcast?.attachment === null);
  const before = sends.length;
  await A.api('POST', `/api/broadcasts/${bId}/test-email`, { to: 'tester@alpha.test' });
  check('without an attachment an email has none', sends.length === before + 1 && !('attachments' in sends[before].body));

  // A file that has gone missing stops the send instead of going out without it.
  const dupId = dup.data.broadcast.id;
  fs.rmSync(path.join(DATA_DIR, 'orgs', 'alpha', 'uploads', up.data.token));
  const lost = await A.api('POST', `/api/broadcasts/${dupId}/send`, { contact_ids: people });
  check('a missing attachment stops the send', lost.status === 400 && /missing/.test(lost.data?.error || ''), JSON.stringify(lost.data));
  check('a missing attachment stops a test email',
    (await A.api('POST', `/api/broadcasts/${dupId}/test-email`, {})).status === 400);

  await A.api('PUT', '/api/settings', { smtp2go_api_key: '' });
  check('sending is simulated again', (await A.api('GET', '/api/settings')).data?.settings?.smtp2go_key_set === false);
  smtp.close();
}

// --- surveys: the questions and answers, checked directly ------------------
{
  const qs = normalizeQuestions([
    { kind: 'yes_no', prompt: 'Should we meet monthly?' },
    { kind: 'single', prompt: 'Best night?', options: [{ label: 'Monday' }, { label: 'Tuesday' }, { label: '' }], other: true },
    { kind: 'multi', prompt: 'Which topics?', options: [{ label: 'Taxes' }, { label: 'Schools' }, { label: 'Roads' }], max: 2 },
    { kind: 'ranking', prompt: 'Rank the speakers', options: [{ label: 'Ann' }, { label: 'Bo' }, { label: 'Cy' }] },
    { kind: 'scale', prompt: 'How interested are you?', points: 5, low: 'Not interested at all', high: 'Very interested' },
    { kind: 'text', prompt: 'Anything else?', long: true, required: false },
  ]);
  check('questions get ids in order', qs.map((q) => q.id).join() === 'q1,q2,q3,q4,q5,q6');
  check('choices get ids, and blank ones are dropped', qs[1].options.map((o) => o.id).join() === 'o1,o2');
  check('every question is required unless it says not', qs[0].required && !qs[5].required);
  const refuses = (input) => { try { normalizeQuestions(input); return false; } catch (e) { return e.status === 400; } };
  check('a choice question needs two choices', refuses([{ kind: 'single', prompt: 'One?', options: [{ label: 'Only' }] }]));
  check('a question needs wording', refuses([{ kind: 'yes_no', prompt: '   ' }]));
  check('an unknown type is refused', refuses([{ kind: 'essay', prompt: 'Hi' }]));
  check('the same choice twice is refused', refuses([{ kind: 'single', prompt: 'X', options: [{ label: 'A' }, { label: 'a' }] }]));
  check('a scale is kept between 3 and 10 points',
    normalizeQuestions([{ kind: 'scale', prompt: 'S', points: 40 }])[0].points === 10);

  const full = {
    q1: 'yes', q2: 'other', q2_other: 'Thursday', q3: ['o1', 'o3'],
    q4_o1: '2', q4_o2: '1', q4_o3: '3', q5: '4', q6: 'Line one\r\nLine two',
  };
  const good = parseAnswers(qs, full);
  check('a full set of answers has no errors', Object.keys(good.errors).length === 0, JSON.stringify(good.errors));
  check('answers are stored in their shapes',
    good.answers.q1 === 'yes' && good.answers.q2.pick === 'other' && good.answers.q2.other === 'Thursday'
    && good.answers.q3.picks.join() === 'o1,o3' && good.answers.q4.join() === 'o2,o1,o3'
    && good.answers.q5 === 4 && good.answers.q6 === 'Line one\nLine two', JSON.stringify(good.answers));
  const empty = parseAnswers(qs, {});
  check('a required question left out is an error', Boolean(empty.errors.q1 && empty.errors.q5) && !empty.errors.q6);
  check('too many picks is an error', Boolean(parseAnswers(qs, { ...full, q3: ['o1', 'o2', 'o3'] }).errors.q3));
  check('two choices with the same place is an error', Boolean(parseAnswers(qs, { ...full, q4_o3: '1' }).errors.q4));
  check('a required ranking needs every choice placed', Boolean(parseAnswers(qs, { ...full, q4_o3: '' }).errors.q4));
  check('Other with nothing typed is an error', Boolean(parseAnswers(qs, { ...full, q2_other: ' ' }).errors.q2));
  check('a point off the scale is not an answer', Boolean(parseAnswers(qs, { ...full, q5: '9' }).errors.q5));
  check('a choice the question never had is not an answer', Boolean(parseAnswers(qs, { ...full, q2: 'o9' }).errors.q2));

  const results = tally(qs, [
    { answers: good.answers },
    { answers: { q1: 'no', q2: { pick: 'o1' }, q3: { picks: ['o1'] }, q4: ['o1', 'o2', 'o3'], q5: 2 } },
    { answers: { q1: 'yes', q2: { pick: 'o1' }, q4: ['o1', 'o3', 'o2'], q5: 5 } },
  ]);
  check('yes/no is counted', results[0].options[0].count === 2 && results[0].options[1].count === 1 && results[0].answered === 3);
  check('single choice counts Other apart, with what was typed',
    results[1].options[0].count === 2 && results[1].other.count === 1 && results[1].other.answers[0].text === 'Thursday');
  check('multiple choice is a share of those who answered it',
    results[2].answered === 2 && results[2].options[0].count === 2 && results[2].options[0].pct === 100);
  check('a ranking is ordered by points',
    results[3].options.map((o) => o.label).join() === 'Ann,Bo,Cy' && results[3].options[0].firsts === 2
    && results[3].options[0].points === 8, JSON.stringify(results[3].options));
  check('a scale has its spread, average and median',
    results[4].counts.map((c) => c.count).join() === '0,1,0,1,1' && results[4].average === 3.7 && results[4].median === 4);
  check('written answers are listed', results[5].answers.length === 1 && results[5].answers[0].text.startsWith('Line one'));
  check('an answer reads back in words', answerText(qs[3], good.answers.q4) === '1. Bo; 2. Ann; 3. Cy'
    && answerText(qs[4], 1) === '1 of 5 (Not interested at all)');

  const reworded = qs.map((q) => (q.id === 'q1' ? { ...q, prompt: 'Meet every month?' } : q));
  check('a locked survey can be reworded',
    normalizeQuestions(reworded, { previous: qs, locked: true })[0].prompt === 'Meet every month?');
  const lockedRefuses = (input) => { try { normalizeQuestions(input, { previous: qs, locked: true }); return false; } catch (e) { return e.status === 409; } };
  check('a locked survey keeps its types', lockedRefuses(qs.map((q) => (q.id === 'q1' ? { ...q, kind: 'single', options: [{ label: 'A' }, { label: 'B' }] } : q))));
  check('a locked survey keeps its choices', lockedRefuses(qs.map((q) => (q.id === 'q2' ? { ...q, options: [...q.options, { label: 'Friday' }] } : q))));
  check('a locked survey keeps its questions', lockedRefuses(qs.slice(1)) && lockedRefuses([...qs, { kind: 'yes_no', prompt: 'New?' }]));
}

// --- surveys: asking, answering and counting -------------------------------
const SURVEY_QUESTIONS = [
  { kind: 'yes_no', prompt: 'Should we meet monthly?' },
  { kind: 'single', prompt: 'Best night?', options: [{ label: 'Monday' }, { label: 'Tuesday' }], other: true },
  { kind: 'multi', prompt: 'Which topics?', options: [{ label: 'Taxes' }, { label: 'Schools' }, { label: 'Roads' }], max: 2 },
  { kind: 'ranking', prompt: 'Rank the speakers', options: [{ label: 'Ann' }, { label: 'Bo' }, { label: 'Cy' }] },
  { kind: 'scale', prompt: 'How interested are you?', points: 5, low: 'Not interested at all', high: 'Very interested' },
  { kind: 'text', prompt: 'Anything else?', long: true, required: false },
];
const SURVEY_ANSWERS = {
  q1: 'yes', q2: 'o2', q3: ['o1', 'o2'], q4_o1: '1', q4_o2: '3', q4_o3: '2', q5: '5', q6: 'More coffee',
};
function postAnswers(pagePath, fields) {
  const body = new URLSearchParams();
  for (const [k, val] of Object.entries(fields)) {
    for (const one of Array.isArray(val) ? val : [val]) body.append(k, one);
  }
  return fetch(`${BASE}${pagePath}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
}
async function surveyStamp(pagePath) {
  const html = await (await fetch(`${BASE}${pagePath}`)).text();
  return html.match(/name="t" value="([^"]+)"/)?.[1] || '';
}
let surveyId = null;
let surveySlug = '';
{
  const made = await A.api('POST', '/api/surveys', {
    title: 'Fall priorities', description: '<p>Tell us <strong>what matters</strong>.</p>',
    share_enabled: true, questions: SURVEY_QUESTIONS,
  });
  check('create a survey', made.status === 201 && made.data?.survey?.state === 'draft', JSON.stringify(made.data));
  surveyId = made.data.survey.id;
  surveySlug = made.data.survey.slug;
  check('its questions come back with ids', made.data.survey.questions.length === 6 && made.data.survey.questions[3].id === 'q4');
  check('a survey with no answers is not locked', made.data.survey.locked === false);
  const bad = await A.api('PUT', `/api/surveys/${surveyId}`, { questions: [{ kind: 'single', prompt: 'One', options: [{ label: 'A' }] }] });
  check('a bad question is refused with a reason', bad.status === 400 && /two choices/.test(bad.data?.error || ''));

  const emptyOne = await A.api('POST', '/api/surveys', { title: 'No questions yet' });
  const sendEmpty = await A.api('POST', `/api/surveys/${emptyOne.data.survey.id}/send`, {});
  check('a survey with no questions can’t be sent', sendEmpty.status === 400 && /question/.test(sendEmpty.data?.error || ''));
  await A.api('DELETE', `/api/surveys/${emptyOne.data.survey.id}`);

  check('the shared page of a draft is hidden', (await fetch(`${BASE}/alpha/s/${surveySlug}`)).status === 404);
  const preview = await A.raw('GET', `/alpha/s/${surveySlug}`);
  const previewHtml = await preview.text();
  check('a member sees the draft, with the button off',
    preview.status === 200 && previewHtml.includes('Draft preview') && /class="pub-btn pub-btn-plain sv-submit" type="submit" disabled/.test(previewHtml));

  const people = await A.api('POST', `/api/surveys/${surveyId}/people`, {
    new_contacts: [
      { name: 'Sam Survey', email: 'sam@survey.test' },
      { name: 'Tia Survey', email: 'tia@survey.test' },
      { name: 'Uma Survey', email: 'uma@survey.test' },
    ],
    save_new: true,
  });
  check('add people to a survey', people.data?.added === 3 && people.data?.contacts_created === 3, JSON.stringify(people.data));
  const again = await A.api('POST', `/api/surveys/${surveyId}/people`, { new_contacts: [{ name: 'Sam', email: 'sam@survey.test' }] });
  check('nobody is added twice', again.data?.added === 0 && again.data?.skipped === 1);

  const sent = await A.api('POST', `/api/surveys/${surveyId}/send`, {});
  check('sending queues one email each', sent.data?.queued === 3, JSON.stringify(sent.data));
  check('sending opens the survey', (await A.api('GET', `/api/surveys/${surveyId}`)).data?.survey?.state === 'open');
  await waitFor(async () => {
    const r = await A.api('GET', `/api/emails?survey_id=${surveyId}&status=simulated`);
    return r.data?.emails?.length === 3;
  }, 'the queue sends the three survey emails');
  const log = await A.api('GET', `/api/emails?survey_id=${surveyId}`);
  check('the email log names the survey', log.data.emails.every((e) => e.kind === 'survey' && e.survey_title === 'Fall priorities'));
  const listed = (await A.api('GET', `/api/surveys/${surveyId}/people`)).data;
  check('each person is marked emailed', listed.people.every((p) => p.email_status === 'sent') && listed.stats.awaiting === 3);
  const one = await A.api('GET', `/api/emails/${log.data.emails[0].id}`);
  check('the email carries the person’s own link', one.data.email.html.includes('/alpha/q/') && one.data.email.html.includes('Take the survey'));

  const sam = listed.people.find((p) => p.email === 'sam@survey.test');
  const samPath = `/alpha/q/${sam.token}`;
  const pageHtml = await (await fetch(`${BASE}${samPath}`)).text();
  check('the personal page shows every question',
    SURVEY_QUESTIONS.every((q) => pageHtml.includes(q.prompt)) && pageHtml.includes('Not interested at all'));
  check('the personal page loads the form helper', pageHtml.includes('<script src="/assets/survey.js?v='));
  check('the introduction is shown', pageHtml.includes('<strong>what matters</strong>'));
  const helper = await fetch(`${BASE}/assets/survey.js`);
  check('the form helper is served', helper.status === 200 && (helper.headers.get('content-type') || '').includes('javascript'));

  const missing = await postAnswers(samPath, { q1: 'yes' });
  const missingHtml = await missing.text();
  check('leaving out required answers draws the form again', missing.status === 400
    && missingHtml.includes('answers need') && missingHtml.includes('Choose a point on the scale.') && missingHtml.includes('value="yes" checked'));
  check('and keeps nothing', (await A.api('GET', `/api/surveys/${surveyId}`)).data.stats.responses === 0);

  const ok = await postAnswers(samPath, SURVEY_ANSWERS);
  check('answers are taken', ok.status === 303 && ok.headers.get('location') === `${samPath}?thanks=1`);
  const after = await (await fetch(`${BASE}${samPath}`)).text();
  check('the page then offers to change them, filled in',
    after.includes('Save my changes') && after.includes('More coffee') && /value="o2" checked/.test(after));
  const changed = await postAnswers(samPath, { ...SURVEY_ANSWERS, q1: 'no', q6: '' });
  check('answers can be changed', changed.status === 303 && changed.headers.get('location') === `${samPath}?updated=1`);
  const stats = (await A.api('GET', `/api/surveys/${surveyId}`)).data;
  check('one person is still one response', stats.stats.responses === 1 && stats.stats.answered === 1 && stats.stats.awaiting === 2);
  check('a survey with answers is locked', stats.survey.locked === true);

  const res = (await A.api('GET', `/api/surveys/${surveyId}/results`)).data;
  check('results count the changed answers', res.responses === 1 && res.questions[0].options[1].count === 1
    && res.questions[0].options[0].count === 0 && res.questions[5].answered === 0);
  check('results rank the speakers', res.questions[3].options.map((o) => o.label).join() === 'Ann,Cy,Bo');
  const rows = (await A.api('GET', `/api/surveys/${surveyId}/responses`)).data;
  check('responses say whose they are', rows.responses[0].name === 'Sam Survey' && rows.responses[0].answers.q2 === 'Tuesday');
  const csv = await (await A.raw('GET', `/api/export/surveys/${surveyId}/responses.csv`)).text();
  check('the responses spreadsheet', csv.includes('Sam Survey') && csv.includes('Q4. Rank the speakers') && csv.includes('1. Ann; 2. Cy; 3. Bo'));

  const reword = stats.survey.questions.map((q) => (q.id === 'q1' ? { ...q, prompt: 'Meet every month?' } : q));
  check('a locked survey can still be reworded', (await A.api('PUT', `/api/surveys/${surveyId}`, { questions: reword })).status === 200);
  const restructure = await A.api('PUT', `/api/surveys/${surveyId}`, { questions: reword.slice(1) });
  check('but its questions can’t be taken away', restructure.status === 409);
  check('and it can’t turn anonymous', (await A.api('PUT', `/api/surveys/${surveyId}`, { anonymous: true })).status === 409);

  const remind = await A.api('POST', `/api/surveys/${surveyId}/remind`, { body: 'Hi {{first_name}}, a reminder about {{survey_title}}.' });
  check('a reminder goes to those who haven’t answered', remind.data?.queued === 2, JSON.stringify(remind.data));

  // The shared page.
  const shared = `/alpha/s/${surveySlug}`;
  const sharedHtml = await (await fetch(`${BASE}${shared}`)).text();
  check('a public survey’s page asks for a name and email', sharedHtml.includes('name="email"') && sharedHtml.includes('name="website"'));
  const trapped = await postAnswers(shared, { ...SURVEY_ANSWERS, name: 'Bot', email: 'bot@spam.test', website: 'x', t: await surveyStamp(shared) });
  check('a filled-in trap is thanked and kept nowhere',
    trapped.status === 200 && (await A.api('GET', `/api/surveys/${surveyId}`)).data.stats.responses === 1);
  const rsvpStamp = await formStamp('/alpha/2031-may-06-18-30');
  await pause(FILL_MS);
  const wrongStamp = await postAnswers(shared, { ...SURVEY_ANSWERS, name: 'Val', email: 'val@survey.test', t: rsvpStamp });
  check('an RSVP form’s stamp doesn’t pass for the survey’s',
    Boolean(rsvpStamp) && (await wrongStamp.text()).includes('have not been sent yet'));

  let t = await surveyStamp(shared);
  await pause(FILL_MS);
  const fresh = await postAnswers(shared, { ...SURVEY_ANSWERS, name: 'Val Visitor', email: 'val@survey.test', t });
  check('a visitor’s answers make them a personal link', fresh.status === 303 && /^\/alpha\/q\/\w+\?thanks=1$/.test(fresh.headers.get('location') || ''));
  t = await surveyStamp(shared);
  await pause(FILL_MS);
  const dupe = await postAnswers(shared, { ...SURVEY_ANSWERS, name: 'Someone', email: 'SAM@survey.test', t });
  check('an address that already answered is turned away', dupe.status === 409 && (await dupe.text()).includes('already answered'));
  t = await surveyStamp(shared);
  await pause(FILL_MS);
  const invited = await postAnswers(shared, { ...SURVEY_ANSWERS, name: 'Tia', email: 'tia@survey.test', t });
  check('an invited address is thanked without its personal link', invited.status === 303 && invited.headers.get('location') === `${shared}?thanks=1`);
  const now = (await A.api('GET', `/api/surveys/${surveyId}`)).data.stats;
  check('both count', now.responses === 3 && now.answered === 3 && now.invited === 4);

  const closed = await A.api('POST', `/api/surveys/${surveyId}/close`, {});
  check('a survey can be closed', closed.data?.survey?.state === 'closed');
  const closedHtml = await (await fetch(`${BASE}${samPath}`)).text();
  check('a closed survey shows the person their answers', closedHtml.includes('This survey is closed') && closedHtml.includes('Your answers'));
  const late = await postAnswers(samPath, { ...SURVEY_ANSWERS, q1: 'yes' });
  check('and takes no more', late.status === 303
    && (await A.api('GET', `/api/surveys/${surveyId}/results`)).data.questions[0].options[0].count === 2);
  check('reopening with a date that has passed is refused',
    (await A.api('POST', `/api/surveys/${surveyId}/reopen`, { closes_on: '2020-01-01' })).status === 400);
  check('a survey can be reopened', (await A.api('POST', `/api/surveys/${surveyId}/reopen`, {})).data?.survey?.state === 'open');
  const past = await A.api('PUT', `/api/surveys/${surveyId}`, { closes_on: '2020-01-01' });
  check('a closing date that has passed closes it', past.data?.survey?.state === 'closed');
  check('so the shared page says so', (await (await fetch(`${BASE}${shared}`)).text()).includes('This survey is closed'));
  await A.api('POST', `/api/surveys/${surveyId}/reopen`, {});

  const uma = listed.people.find((p) => p.email === 'uma@survey.test');
  const unsub = await fetch(`${BASE}/alpha/u/${uma.token}`, { method: 'POST' });
  check('a survey email’s unsubscribe link works', unsub.status === 200 && (await unsub.text()).includes('uma@survey.test'));
  const reminded = await A.api('POST', `/api/surveys/${surveyId}/remind`, { body: 'Again' });
  check('and the next reminder skips them', reminded.data?.skipped?.unsubscribed === 1, JSON.stringify(reminded.data));

  const del = await A.api('DELETE', `/api/surveys/${surveyId}/responses/${rows.responses[0].id}`);
  check('a response can be taken out', del.status === 200 && del.data.stats.responses === 2 && del.data.stats.answered === 2);
  const copy = await A.api('POST', `/api/surveys/${surveyId}/duplicate`, {});
  check('a copy is a draft with the same questions',
    copy.status === 201 && copy.data.survey.state === 'draft' && copy.data.survey.questions.length === 6 && copy.data.survey.locked === false);
  check('the copy has nobody on it', (await A.api('GET', `/api/surveys/${copy.data.survey.id}/people`)).data.people.length === 0);
}

// --- surveys: anonymous ----------------------------------------------------
{
  const made = await A.api('POST', '/api/surveys', {
    title: 'Honest feedback', anonymous: true, share_enabled: true,
    questions: [{ kind: 'scale', prompt: 'How did we do?', points: 5 }, { kind: 'text', prompt: 'Tell us more', required: false }],
  });
  const id = made.data.survey.id;
  await A.api('POST', `/api/surveys/${id}/people`, { new_contacts: [{ name: 'Wes Anon', email: 'wes@survey.test' }] });
  await A.api('POST', `/api/surveys/${id}/send`, {});
  const wes = (await A.api('GET', `/api/surveys/${id}/people`)).data.people[0];
  const wesPath = `/alpha/q/${wes.token}`;
  const first = await postAnswers(wesPath, { q1: '2', q2: 'The chairs' });
  check('an anonymous answer is taken', first.status === 303);
  const page2 = await (await fetch(`${BASE}${wesPath}`)).text();
  check('and can’t be shown again', page2.includes('You have answered') && !page2.includes('The chairs'));
  const second = await postAnswers(wesPath, { q1: '5' });
  check('or changed', second.status === 303
    && (await A.api('GET', `/api/surveys/${id}/results`)).data.questions[0].counts[1].count === 1);
  const people = (await A.api('GET', `/api/surveys/${id}/people`)).data;
  check('the person still shows as answered', Boolean(people.people[0].responded_at) && people.stats.awaiting === 0);
  const rows = (await A.api('GET', `/api/surveys/${id}/responses`)).data;
  check('the responses carry no name', rows.anonymous === true && rows.responses[0].name === '' && rows.responses[0].email === '');
  const backup = (await A.api('GET', '/api/export/backup.json')).data;
  const stored = backup.survey_responses.filter((r) => r.survey_id === id);
  check('nothing stored links the answers to the person', stored.length === 1 && stored[0].invite_id === null
    && stored[0].submitted_at.endsWith('00:00:00') && stored[0].id > 1000000);
  check('the backup holds the surveys', backup.surveys.length >= 3 && backup.survey_invites.length >= 5);
  const csv = await (await A.raw('GET', `/api/export/surveys/${id}/responses.csv`)).text();
  check('the anonymous spreadsheet has no names', !csv.includes('Wes') && csv.includes('The chairs'));

  const shared = `/alpha/s/${made.data.survey.slug}`;
  const sharedHtml = await (await fetch(`${BASE}${shared}`)).text();
  check('an anonymous public survey asks for no name', !sharedHtml.includes('name="email"') && sharedHtml.includes('anonymous'));
  const t = await surveyStamp(shared);
  await pause(FILL_MS);
  const visit = await postAnswers(shared, { q1: '4', t });
  check('a visitor answers anonymously', visit.status === 303 && visit.headers.get('location') === `${shared}?thanks=1`);
  const cookie = (visit.headers.get('set-cookie') || '').split(';')[0];
  const back = await (await fetch(`${BASE}${shared}`, { headers: { cookie } })).text();
  check('the same browser is thanked rather than asked again', back.includes('We have your answers') && !back.includes('<form'));
  check('two responses, one person', (await A.api('GET', `/api/surveys/${id}`)).data.stats.responses === 2);
}

// --- surveys: a private one, and another organization ----------------------
{
  const made = await A.api('POST', '/api/surveys', { title: 'Board only', questions: [{ kind: 'yes_no', prompt: 'Approve?' }] });
  const { id, slug } = made.data.survey;
  await A.api('POST', `/api/surveys/${id}/open`, {});
  const html = await (await fetch(`${BASE}/alpha/s/${slug}`)).text();
  check('a private survey’s page sends people to their email', html.includes('By invitation') && !html.includes('<form'));
  const posted = await postAnswers(`/alpha/s/${slug}`, { q1: 'yes', name: 'X', email: 'x@survey.test' });
  check('and takes no answers', posted.status === 404);

  check('another organization can’t see a survey', (await B.api('GET', `/api/surveys/${surveyId}`)).status === 404);
  check('or list it', (await B.api('GET', '/api/surveys')).data?.surveys?.length === 0);
  check('or reach its page under its own name', (await fetch(`${BASE}/beta/s/${surveySlug}`)).status === 404);
  const sam = (await A.api('GET', `/api/surveys/${surveyId}/people`)).data.people[0];
  check('or a personal link', (await fetch(`${BASE}/beta/q/${sam.token}`)).status === 404);
  check('the old /o/ address forwards', (await fetch(`${BASE}/o/alpha/s/${surveySlug}`, { redirect: 'manual' })).status === 301);
}

// --- help: every page has help, and every picture it names exists ----------
{
  const app = fs.readFileSync(new URL('../web/src/App.jsx', import.meta.url), 'utf8');
  // A route that only forwards to another address has no page of its own.
  const routes = [...app.matchAll(/<Route path="([^"]+)" element={<(\w+)/g)]
    .filter((m) => !['Navigate', 'Moved'].includes(m[2])).map((m) => m[1]);
  check('the app has routes to look for help on', routes.length >= 15, `found ${routes.length}`);
  const missing = routes.filter((r) => !helpFor(r.replace(/:\w+/g, '12')));
  check('every page has help', missing.length === 0, missing.join(', '));
  check('a new event gets the wizard help, not an event page’s',
    helpFor('/events/new') === helpFor('/events/12/edit') && helpFor('/events/new') !== helpFor('/events/12'));
  check('an unknown address has no help', helpFor('/nowhere') === null);

  const files = fs.readdirSync(new URL('../web/src/help/scenes/', import.meta.url))
    .filter((f) => f.endsWith('.jsx')).map((f) => f.slice(0, -'.jsx'.length));
  const named = allScenes();
  const absent = named.filter((n) => !files.includes(n));
  const unused = files.filter((f) => !named.includes(f));
  check('every picture the help names exists', absent.length === 0, absent.join(', '));
  check('every picture is used by the help', unused.length === 0, unused.join(', '));

  const settings = (role) => sectionsFor(helpFor('/settings'), role).map((s) => s.heading);
  check('admins get help on team members', settings('admin').includes('Team members'));
  check('members do not', !settings('member').includes('Team members'));
}

// ---------------------------------------------------------------------------
console.log('');
if (failures.length === 0) {
  console.log(`ALL ${passed} CHECKS PASSED`);
  cleanup(0);
} else {
  console.error(`${failures.length} FAILED (of ${passed + failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  cleanup(1);
}
