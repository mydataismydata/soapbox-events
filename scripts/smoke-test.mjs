#!/usr/bin/env node
// End-to-end smoke test. Boots the real server against a throwaway data
// directory and exercises the whole flow over HTTP: organizations, login,
// contacts, groups, events, sending (simulated), accept/decline links,
// share-link RSVPs, nudges, exports — plus cross-organization isolation.
//
//   npm run smoke
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendQueue, sendLabel, sendSummary } from '../web/src/components/sendQueue.js';
import { personName, splitPersonName } from '../server/lib/contacts.js';

const PORT = 3870 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'soapbox-smoke-'));
const ENV = { ...process.env, PORT: String(PORT), BASE_URL: BASE, DATA_DIR, NODE_ENV: 'test', SMTP2GO_API_KEY: '' };

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
  check('create event', r.status === 201 && eventId > 0 && /^[a-z0-9]{10}$/.test(eventSlug || ''));

  const upd = await A.api('PUT', `/api/events/${eventId}`, {
    flyer: { style: 'blue', font: 'sans', scale: 'l', eyebrow: 'Save the date', tagline: 'Dinner & dancing',
      contact: 'Questions? Call Jane', showAddress: true,
      imageColumns: 3, imageTokens: ['imgAAAAAA', 'imgBBBBBB', 'imgCCCCCC'], imageCaptions: ['Ada Speaker', 'Grace Speaker', 'Alan Speaker'] },
    email_subject: "You're invited: {{event_title}}",
    email_body: 'Hi {{first_name}},\n\nJoin us at {{venue_name}} on {{event_date}}.\n\nRSVP: {{rsvp_link}}',
  });
  const uflyer = upd.data?.event?.flyer || {};
  check('update event + flyer', upd.status === 200 && uflyer.style === 'blue');
  check('flyer stores 3 image columns', uflyer.imageColumns === 3 && Array.isArray(uflyer.imageTokens) && uflyer.imageTokens.length === 3);
  check('flyer image tokens + captions stored', uflyer.imageTokens?.[2] === 'imgCCCCCC' && uflyer.imageCaptions?.[1] === 'Grace Speaker');
  check('flyer mirrors first image for legacy readers', uflyer.imageToken === 'imgAAAAAA' && uflyer.imageCaption === 'Ada Speaker');
  check('flyer stores contact + showAddress', uflyer.contact === 'Questions? Call Jane' && uflyer.showAddress === true);

  // Rich-text description is sanitized: safe tags kept, scripts + junk dropped.
  const rich = await A.api('PUT', `/api/events/${eventId}`, {
    description: '<b>Bold</b> and <span class="rt-fs-lg danger">big</span><script>alert(1)</script>',
  });
  const desc = rich.data?.event?.description || '';
  check('description keeps safe formatting', desc.includes('<b>Bold</b>') && desc.includes('class="rt-fs-lg"'));
  check('description strips scripts + unknown classes',
    !/<script/i.test(desc) && !desc.includes('danger'));

  const draftHidden = await fetch(`${BASE}/o/alpha/e/${eventSlug}`);
  check('draft landing hidden from public', draftHidden.status === 404);
  const draftPreview = await A.raw('GET', `/o/alpha/e/${eventSlug}`);
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
  const res = await fetch(`${BASE}/o/alpha/e/${eventSlug}/rsvp`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Walk In', email: 'walkin@guest.test', attending: 'yes', party_size: '2', note: 'Found the link!' }).toString(),
    redirect: 'manual',
  });
  check('share-link RSVP redirects to personal page', res.status === 303 && (res.headers.get('location') || '').includes('/o/alpha/i/'));
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
      flyer: { style: 'white', imageColumns: 2, imageTokens: ['prevIMGone', 'prevIMGtwo'], imageCaptions: ['One', 'Two'] } },
  });
  const fpHtml = await fp.text();
  check('flyer preview renders', fp.status === 200 && fpHtml.includes('Preview Party'));
  check('flyer preview renders multiple images',
    fpHtml.includes('/files/prevIMGone') && fpHtml.includes('/files/prevIMGtwo'));

  const pres = await A.api('GET', '/api/flyer/presets');
  const ids = (pres.data?.styles || []).map((s) => s.id);
  check('six templates, four portrait then two wide',
    ids.join(',') === 'blue,white,red,retro,spotlight,panel', ids.join(','));
  const wideIds = (pres.data?.styles || []).filter((s) => s.landscape).map((s) => s.id);
  check('wide templates flagged for the designer', wideIds.join(',') === 'spotlight,panel', wideIds.join(','));

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

  // Snapshot mode is what the designer rasterizes into the email's JPEG: a
  // plain rectangle, no page breakout, no shadow, no page background.
  const snap = await A.raw('POST', '/api/flyer/preview', {
    body: { event: { title: 'Preview Party', date: future }, flyer: { style: 'spotlight' }, snapshot: true },
  });
  const snapHtml = await snap.text();
  check('snapshot flyer drops the page furniture',
    snapHtml.includes('Preview Party') && !snapHtml.includes('box-shadow') && !snapHtml.includes('translateX(-50%)'));
  check('snapshot flyer is laid out at a fixed width', snapHtml.includes('max-width:920px'));
}

// --- public pages ----------------------------------------------------------
{
  const landing = await fetch(`${BASE}/o/alpha/e/${eventSlug}`);
  const html = await landing.text();
  check('landing page renders with RSVP form + guest list', landing.status === 200
    && html.includes('Test Gala') && html.includes('Will you be there?') && html.includes("Who's coming"));
  check('landing page shows venue phone + directions link', landing.status === 200
    && html.includes('(555) 100-2000') && html.includes('Get directions')
    && html.includes('https://maps.example.com/grandhall'));
  const ics = await fetch(`${BASE}/o/alpha/e/${eventSlug}/ics`);
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
  const page = await fetch(`${BASE}/o/alpha/e/${open.data.event.slug}`);
  const html = await page.text();
  check('open event landing shows no-RSVP message', html.includes('No RSVP needed'));

  const dup = await A.api('POST', `/api/events/${eventId}/duplicate`, {});
  check('duplicate event', dup.status === 201 && dup.data?.event?.title === 'Copy of Test Gala' && dup.data?.event?.status === 'draft');

  const cancel = await A.api('POST', `/api/events/${eventId}/cancel`, { notify: true });
  check('cancel notifies responded+contacted guests', cancel.status === 200 && cancel.data?.notified >= 3, JSON.stringify(cancel.data));
  const cancelledLanding = await fetch(`${BASE}/o/alpha/e/${eventSlug}`);
  const cHtml = await cancelledLanding.text();
  check('cancelled landing shows banner, no RSVP form', cHtml.includes('cancelled') && !cHtml.includes('Will you be there?'));
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
}

// --- broadcasts (standalone email blast, no event/RSVP) --------------------
{
  const cr = await A.api('POST', '/api/broadcasts', {
    title: 'Endorsement Announcement',
    subject: 'Our endorsements for {{org_name}}',
    body: 'Hi {{first_name}},\n\nHere are our picks for the primary.\n\n— {{org_name}}',
    web_version: true,
    flyer: { style: 'red', eyebrow: 'Announcement' },
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
  const m = bhtml.match(/\/o\/alpha\/bu\/([^"'<>\s]+)/);
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
