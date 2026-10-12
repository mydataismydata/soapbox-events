// Surveys: sent like a meeting invitation, answered instead of RSVPed. See
// lib/surveys.js for how a survey opens and closes, and lib/surveyQuestions.js
// for the questions and how answers are counted.
import { Router } from 'express';
import { insertId, withTx } from '../lib/db.js';
import { wrap, v, ApiError } from '../lib/validate.js';
import { randomSlug, randomToken } from '../lib/tokens.js';
import { sanitizeRichText } from '../lib/sanitizeHtml.js';
import { contactInserter } from '../lib/contacts.js';
import { orgApiKey, senderFor, sendEmail } from '../lib/email.js';
import { toCsv } from '../lib/csv.js';
import { publicUrl } from '../lib/sending.js';
import { normalizeQuestions, parseQuestions, tally, answerText } from '../lib/surveyQuestions.js';
import {
  surveyState, surveyUrl, surveyStats, getSurveyInvites, personName, personEmail,
  responsesFor, hasResponses, renderSurveyEmailFor, queueSurveyEmails, logSurveyTestEmail, surveyPreviewLinks,
  DEFAULT_SURVEY_BODY, DEFAULT_SURVEY_REMINDER_BODY, DEFAULT_SURVEY_SUBJECT, DEFAULT_SURVEY_REMINDER_SUBJECT,
} from '../lib/surveys.js';

export const surveyRouter = Router();

function getSurvey(db, id) {
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(v.int(id, { label: 'survey id', min: 1 }));
  if (!survey) throw new ApiError(404, 'Survey not found.');
  return survey;
}

function serializeSurvey(req, s) {
  return {
    ...s,
    questions: parseQuestions(s),
    share_enabled: Boolean(s.share_enabled),
    anonymous: Boolean(s.anonymous),
    state: surveyState(s),
    // The questions are locked once anyone has answered.
    locked: hasResponses(req.db, s.id),
    share_url: surveyUrl(req.org.slug, s),
  };
}

function serializePerson(req, row) {
  return {
    id: row.id,
    contact_id: row.contact_id,
    name: personName(row),
    email: personEmail(row),
    phone: row.contact_phone || '',
    unsubscribed: Boolean(row.contact_unsubscribed_at),
    source: row.source,
    email_status: row.email_status,
    responded_at: row.responded_at,
    created_at: row.created_at,
    token: row.token,
    link: publicUrl(req.org.slug, `/q/${row.token}`),
  };
}

const SURVEY_FIELDS = {
  title: (x) => v.str(x, { label: 'Title', max: 200 }),
  description: (x) => sanitizeRichText(v.optStr(x, { label: 'Introduction', max: 20000 })),
  share_enabled: (x) => (v.bool(x, false) ? 1 : 0),
  anonymous: (x) => (v.bool(x, false) ? 1 : 0),
  closes_on: (x) => v.date(x, { label: 'Closing date', required: false }) || null,
  email_subject: (x) => v.optStr(x, { label: 'Email subject', max: 300 }),
  email_body: (x) => v.optStr(x, { label: 'Email message', max: 20000 }),
};

// The fields an edit may set, with the questions checked against what is
// stored. Anonymity can't change once there are answers: the answers already
// given were promised one or the other.
function pickSurveyFields(db, body, survey = null) {
  const out = {};
  for (const [key, validate] of Object.entries(SURVEY_FIELDS)) {
    if (body[key] !== undefined) out[key] = validate(body[key]);
  }
  const locked = survey ? hasResponses(db, survey.id) : false;
  if (body.questions !== undefined) {
    out.questions = JSON.stringify(normalizeQuestions(body.questions, {
      previous: survey ? parseQuestions(survey) : [], locked,
    }));
  }
  if (locked && out.anonymous !== undefined && out.anonymous !== survey.anonymous) {
    throw new ApiError(409, survey.anonymous
      ? 'People answered this survey anonymously, so it has to stay anonymous.'
      : 'People answered this survey with their names, so it can’t become anonymous now.');
  }
  return out;
}

// --- CRUD ------------------------------------------------------------------

surveyRouter.get('/surveys', wrap(async (req, res) => {
  const rows = req.db.prepare('SELECT * FROM surveys ORDER BY COALESCE(opened_at, updated_at) DESC, id DESC').all();
  res.json({ surveys: rows.map((s) => ({ ...serializeSurvey(req, s), stats: surveyStats(req.db, s.id) })) });
}));

surveyRouter.post('/surveys', wrap(async (req, res) => {
  const fields = pickSurveyFields(req.db, req.body);
  if (!fields.title) throw new ApiError(400, 'Title is required.');
  const keys = Object.keys(fields);
  const info = req.db.prepare(
    `INSERT INTO surveys (slug, created_by${keys.map((k) => `, ${k}`).join('')})
     VALUES (?, ?${keys.map(() => ', ?').join('')})`
  ).run(randomSlug(10), req.user.id, ...keys.map((k) => fields[k]));
  const survey = req.db.prepare('SELECT * FROM surveys WHERE id = ?').get(insertId(info));
  res.status(201).json({ survey: serializeSurvey(req, survey) });
}));

surveyRouter.get('/surveys/:id', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  res.json({ survey: serializeSurvey(req, survey), stats: surveyStats(req.db, survey.id) });
}));

surveyRouter.put('/surveys/:id', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const fields = pickSurveyFields(req.db, req.body, survey);
  const keys = Object.keys(fields);
  if (keys.length) {
    req.db.prepare(
      `UPDATE surveys SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).run(...keys.map((k) => fields[k]), survey.id);
  }
  const updated = req.db.prepare('SELECT * FROM surveys WHERE id = ?').get(survey.id);
  res.json({ survey: serializeSurvey(req, updated), stats: surveyStats(req.db, survey.id) });
}));

surveyRouter.delete('/surveys/:id', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  req.db.prepare('DELETE FROM surveys WHERE id = ?').run(survey.id);
  res.json({ ok: true });
}));

// A copy with the same questions and message, as a fresh draft with nobody
// asked yet.
surveyRouter.post('/surveys/:id/duplicate', wrap(async (req, res) => {
  const s = getSurvey(req.db, req.params.id);
  const info = req.db.prepare(`
    INSERT INTO surveys (slug, title, description, questions, share_enabled, anonymous, email_subject, email_body, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomSlug(10), `${s.title} (copy)`.slice(0, 200), s.description, s.questions, s.share_enabled,
    s.anonymous, s.email_subject, s.email_body, req.user.id);
  const copy = req.db.prepare('SELECT * FROM surveys WHERE id = ?').get(insertId(info));
  res.status(201).json({ survey: serializeSurvey(req, copy) });
}));

// --- opening and closing ---------------------------------------------------

function assertAskable(survey) {
  if (!parseQuestions(survey).length) throw new ApiError(400, 'Add at least one question first.');
}

function openSurvey(db, survey) {
  db.prepare(`UPDATE surveys SET status = 'open', opened_at = COALESCE(opened_at, datetime('now')),
    closed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(survey.id);
}

// Open with no invitations: a public survey shared by its link alone.
surveyRouter.post('/surveys/:id/open', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  assertAskable(survey);
  if (survey.status !== 'draft') throw new ApiError(400, 'This survey is already open.');
  openSurvey(req.db, survey);
  const updated = req.db.prepare('SELECT * FROM surveys WHERE id = ?').get(survey.id);
  res.json({ survey: serializeSurvey(req, updated), stats: surveyStats(req.db, survey.id) });
}));

surveyRouter.post('/surveys/:id/close', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  if (survey.status === 'draft') throw new ApiError(400, 'A draft has nothing to close.');
  req.db.prepare(`UPDATE surveys SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?`).run(survey.id);
  const updated = req.db.prepare('SELECT * FROM surveys WHERE id = ?').get(survey.id);
  res.json({ survey: serializeSurvey(req, updated), stats: surveyStats(req.db, survey.id) });
}));

// Reopening takes a new closing date, or none. A date that has passed would
// close it again straight away.
surveyRouter.post('/surveys/:id/reopen', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  if (survey.status === 'draft') throw new ApiError(400, 'This survey has not been opened yet.');
  const closesOn = v.date(req.body.closes_on, { label: 'Closing date', required: false }) || null;
  if (closesOn && surveyState({ ...survey, status: 'open', closes_on: closesOn }) !== 'open') {
    throw new ApiError(400, 'Pick a closing date that has not passed yet.');
  }
  req.db.prepare('UPDATE surveys SET closes_on = ? WHERE id = ?').run(closesOn, survey.id);
  openSurvey(req.db, survey);
  const updated = req.db.prepare('SELECT * FROM surveys WHERE id = ?').get(survey.id);
  res.json({ survey: serializeSurvey(req, updated), stats: surveyStats(req.db, survey.id) });
}));

// --- the people asked ------------------------------------------------------

surveyRouter.get('/surveys/:id/people', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  res.json({ people: getSurveyInvites(req.db, survey.id).map((row) => serializePerson(req, row)), stats: surveyStats(req.db, survey.id) });
}));

// Add people from contacts, groups and brand-new people, as an event adds
// guests. Nobody is added twice.
surveyRouter.post('/surveys/:id/people', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const contactIds = new Set(v.intArray(req.body.contact_ids, { label: 'contact_ids' }));
  const groupIds = v.intArray(req.body.group_ids, { label: 'group_ids' });
  const excludedIds = v.intArray(req.body.excluded_contact_ids, { label: 'excluded_contact_ids' });
  const saveNew = v.bool(req.body.save_new, true);
  const newContacts = Array.isArray(req.body.new_contacts) ? req.body.new_contacts.slice(0, 500) : [];

  for (const gid of groupIds) {
    for (const m of req.db.prepare('SELECT contact_id FROM group_members WHERE group_id = ?').all(gid)) {
      contactIds.add(Number(m.contact_id));
    }
  }
  for (const id of excludedIds) contactIds.delete(Number(id));

  const existing = getSurveyInvites(req.db, survey.id);
  const byContact = new Set(existing.filter((i) => i.contact_id).map((i) => Number(i.contact_id)));
  const emails = new Set(existing.map(personEmail).filter(Boolean));

  let added = 0;
  let skipped = 0;
  let contactsCreated = 0;
  withTx(req.db, () => {
    const insert = req.db.prepare(
      `INSERT INTO survey_invites (survey_id, contact_id, guest_name, guest_email, token, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const getContact = req.db.prepare('SELECT * FROM contacts WHERE id = ?');
    const contactByEmail = req.db.prepare('SELECT * FROM contacts WHERE email = ?');
    const insertContact = contactInserter(req.db);

    for (const cid of contactIds) {
      const contact = getContact.get(cid);
      if (!contact) continue;
      const email = (contact.email || '').toLowerCase();
      if (byContact.has(contact.id) || (email && emails.has(email))) { skipped++; continue; }
      insert.run(survey.id, contact.id, contact.name, contact.email || null, randomToken(24), 'email');
      byContact.add(contact.id);
      if (email) emails.add(email);
      added++;
    }
    for (const raw of newContacts) {
      const name = v.str(raw?.name, { label: 'Name', max: 200 });
      const email = v.optEmail(raw?.email, { label: 'Email' });
      const phone = v.optStr(raw?.phone, { label: 'Phone', max: 50 });
      if (email && emails.has(email)) { skipped++; continue; }
      let contactId = null;
      if (email) {
        const found = contactByEmail.get(email);
        if (found) contactId = found.id;
        else if (saveNew) { contactId = insertContact({ name, email, phone }); contactsCreated++; }
      } else if (saveNew) {
        contactId = insertContact({ name, phone });
        contactsCreated++;
      }
      if (contactId && byContact.has(contactId)) { skipped++; continue; }
      insert.run(survey.id, contactId, name, email || null, randomToken(24), 'manual');
      if (contactId) byContact.add(contactId);
      if (email) emails.add(email);
      added++;
    }
  });
  res.json({ added, skipped, contacts_created: contactsCreated, stats: surveyStats(req.db, survey.id) });
}));

// Taking someone off the list stops their link working. Answers they gave
// stay in the results.
surveyRouter.delete('/surveys/:id/people/:inviteId', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const inviteId = v.int(req.params.inviteId, { label: 'person id', min: 1 });
  const info = req.db.prepare('DELETE FROM survey_invites WHERE id = ? AND survey_id = ?').run(inviteId, survey.id);
  if (Number(info.changes) === 0) throw new ApiError(404, 'Person not found.');
  res.json({ ok: true, stats: surveyStats(req.db, survey.id) });
}));

// --- sending ---------------------------------------------------------------

// The invitation goes to everyone not yet emailed (or whose email failed)
// who hasn't answered, or to the people named. A draft opens as it goes.
surveyRouter.post('/surveys/:id/send', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  assertAskable(survey);
  if (survey.status !== 'draft' && surveyState(survey) !== 'open') {
    throw new ApiError(400, 'This survey is closed. Reopen it before sending.');
  }
  const ids = v.intArray(req.body.invite_ids, { label: 'invite_ids' });
  let invites = getSurveyInvites(req.db, survey.id);
  if (ids.length) {
    const wanted = new Set(ids);
    invites = invites.filter((i) => wanted.has(i.id));
  } else {
    invites = invites.filter((i) => ['not_sent', 'failed'].includes(i.email_status) && !i.responded_at);
  }
  if (!invites.length) throw new ApiError(400, 'Nobody to email: everyone has been sent the survey or has answered.');

  if (survey.status === 'draft') openSurvey(req.db, survey);
  const result = queueSurveyEmails(req.db, {
    org: req.org, survey, invites, kind: 'survey',
    subjectTemplate: survey.email_subject || DEFAULT_SURVEY_SUBJECT,
    bodyTemplate: survey.email_body || DEFAULT_SURVEY_BODY,
    markInvitation: true,
  });
  res.json({ ...result, stats: surveyStats(req.db, survey.id) });
}));

// A reminder to everyone emailed who hasn't answered yet.
surveyRouter.post('/surveys/:id/remind', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  if (surveyState(survey) !== 'open') throw new ApiError(400, 'Reminders go out only while the survey is open.');
  const subject = v.optStr(req.body.subject, { label: 'Subject', max: 300 }) || DEFAULT_SURVEY_REMINDER_SUBJECT;
  const body = v.str(req.body.body, { label: 'Message', max: 20000 });
  const invites = getSurveyInvites(req.db, survey.id).filter((i) => !i.responded_at && i.email_status === 'sent');
  if (!invites.length) throw new ApiError(400, 'Everyone who was emailed has answered.');
  const result = queueSurveyEmails(req.db, {
    org: req.org, survey, invites, kind: 'survey_reminder',
    subjectTemplate: subject, bodyTemplate: body, markInvitation: false,
  });
  res.json(result);
}));

surveyRouter.post('/surveys/:id/email-preview', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const kind = v.oneOf(req.body.kind, ['survey', 'survey_reminder'], { label: 'kind', fallback: 'survey' });
  const sample = getSurveyInvites(req.db, survey.id).find((i) => personEmail(i))
    || { guest_name: 'Alex Rivera', guest_email: 'alex@example.com', token: 'preview' };
  const given = (x) => x !== undefined && String(x).trim() !== '';
  const subjectTemplate = given(req.body.subject) ? v.str(req.body.subject, { label: 'Subject', max: 300 })
    : kind === 'survey' ? (survey.email_subject || DEFAULT_SURVEY_SUBJECT) : DEFAULT_SURVEY_REMINDER_SUBJECT;
  const bodyTemplate = given(req.body.body) ? v.str(req.body.body, { label: 'Body', max: 20000 })
    : kind === 'survey' ? (survey.email_body || DEFAULT_SURVEY_BODY) : DEFAULT_SURVEY_REMINDER_BODY;
  const msg = renderSurveyEmailFor({
    org: req.org, survey, invite: sample, kind, subjectTemplate, bodyTemplate,
    linksOverride: surveyPreviewLinks(req.org.slug, survey),
  });
  res.json({ subject: msg.subject, html: msg.html, to: personEmail(sample) || 'alex@example.com' });
}));

surveyRouter.post('/surveys/:id/test-email', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const to = req.body.to ? v.email(req.body.to, { label: 'Recipient' }) : req.user.email;
  const msg = renderSurveyEmailFor({
    org: req.org, survey, invite: { guest_name: req.user.name, guest_email: to, token: 'preview' }, kind: 'survey',
    subjectTemplate: `[Test] ${survey.email_subject || DEFAULT_SURVEY_SUBJECT}`,
    bodyTemplate: survey.email_body || DEFAULT_SURVEY_BODY,
    linksOverride: surveyPreviewLinks(req.org.slug, survey),
  });
  const { sender, replyTo } = senderFor(req.db, req.org.name, 'event');
  const result = await sendEmail({
    apiKey: orgApiKey(req.db), sender, replyTo,
    toName: req.user.name, toEmail: to, subject: msg.subject, html: msg.html, text: msg.text,
  });
  const status = result.ok ? (result.simulated ? 'simulated' : 'sent') : 'failed';
  logSurveyTestEmail(req.db, { survey, toEmail: to, subject: msg.subject, html: msg.html, text: msg.text, status, error: result.error });
  if (!result.ok) throw new ApiError(502, `Test email failed: ${result.error}`);
  res.json({ status });
}));

// --- results ---------------------------------------------------------------

surveyRouter.get('/surveys/:id/results', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const questions = parseQuestions(survey);
  const responses = responsesFor(req.db, survey);
  res.json({
    responses: responses.length,
    anonymous: Boolean(survey.anonymous),
    questions: tally(questions, responses),
  });
}));

// Each set of answers in words. A named survey says whose they are.
surveyRouter.get('/surveys/:id/responses', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const questions = parseQuestions(survey);
  res.json({
    anonymous: Boolean(survey.anonymous),
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind })),
    responses: responsesFor(req.db, survey).map((r) => ({
      id: r.id, name: r.name, email: r.email, submitted_at: r.submitted_at, updated_at: r.updated_at,
      answers: Object.fromEntries(questions.map((q) => [q.id, answerText(q, r.answers[q.id])])),
    })),
  });
}));

// Takes one set of answers out of the results, such as a joke entry on a
// public survey. The person, if there was one, can answer again.
surveyRouter.delete('/surveys/:id/responses/:responseId', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const responseId = v.int(req.params.responseId, { label: 'response id', min: 1, max: 2 ** 53 });
  withTx(req.db, () => {
    const row = req.db.prepare('SELECT * FROM survey_responses WHERE id = ? AND survey_id = ?').get(responseId, survey.id);
    if (!row) throw new ApiError(404, 'Response not found.');
    req.db.prepare('DELETE FROM survey_responses WHERE id = ?').run(row.id);
    if (row.invite_id) req.db.prepare('UPDATE survey_invites SET responded_at = NULL WHERE id = ?').run(row.invite_id);
  });
  res.json({ ok: true, stats: surveyStats(req.db, survey.id) });
}));

// One row per set of answers, one column per question.
surveyRouter.get('/export/surveys/:id/responses.csv', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const questions = parseQuestions(survey);
  const rows = responsesFor(req.db, survey);
  const columns = [
    ...(survey.anonymous ? [] : [
      { key: 'name', label: 'name' },
      { key: 'email', label: 'email' },
    ]),
    { key: 'submitted_at', label: survey.anonymous ? 'submitted_on' : 'submitted_at' },
    ...questions.map((q, i) => ({ label: `Q${i + 1}. ${q.prompt}`, get: (r) => answerText(q, r.answers[q.id]) })),
  ];
  const safeTitle = survey.title.replace(/[^\w-]+/g, '_').slice(0, 60) || 'survey';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="responses_${safeTitle}.csv"`);
  res.send(toCsv(rows.map((r) => ({ ...r, submitted_at: survey.anonymous ? r.submitted_at.slice(0, 10) : r.submitted_at })), columns));
}));

// The people asked and whether each has answered. Never what they answered,
// so it is the same list for an anonymous survey.
surveyRouter.get('/export/surveys/:id/people.csv', wrap(async (req, res) => {
  const survey = getSurvey(req.db, req.params.id);
  const rows = getSurveyInvites(req.db, survey.id);
  const safeTitle = survey.title.replace(/[^\w-]+/g, '_').slice(0, 60) || 'survey';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="people_${safeTitle}.csv"`);
  res.send(toCsv(rows, [
    { label: 'name', get: (r) => personName(r) },
    { label: 'email', get: (r) => personEmail(r) },
    { key: 'source', label: 'source' },
    { key: 'email_status', label: 'email_status' },
    { label: 'answered', get: (r) => (r.responded_at ? 'yes' : '') },
    { label: 'answered_at', get: (r) => (survey.anonymous ? (r.responded_at || '').slice(0, 10) : r.responded_at || '') },
    { key: 'created_at', label: 'invited_at' },
  ]));
}));
