// Surveys: everything the admin routes and the guest pages share.
//
// A survey goes from draft to open to closed. It is open from the moment it
// is first sent (or opened without sending) until someone closes it or its
// closing date has passed. The closing date is a day where the meetings are,
// as an RSVP deadline is, and answers stop when it ends.
//
// Each person asked has a survey_invites row holding their personal link,
// /<org>/q/<token>. A public survey also takes answers at its shared page,
// /<org>/s/<code>: a named one asks for a name and email and makes an invite
// for whoever answers, and an anonymous one asks nothing.
import crypto from 'node:crypto';
import { insertId } from './db.js';
import { localToday } from './clock.js';
import { publicUrl, isUnsubscribed, orgImageUrl } from './sending.js';
import { buildSurveyTagContext, renderTags } from './mergeTags.js';
import { renderSurveyEmail, DEFAULT_SURVEY_BODY, DEFAULT_SURVEY_REMINDER_BODY } from './emailTemplates.js';
import { parseQuestions } from './surveyQuestions.js';

export { DEFAULT_SURVEY_BODY, DEFAULT_SURVEY_REMINDER_BODY };

export const SURVEY_SLUG_RE = /^[a-z0-9]{6,20}$/;
export const DEFAULT_SURVEY_SUBJECT = 'Your opinion, please: {{survey_title}}';
export const DEFAULT_SURVEY_REMINDER_SUBJECT = 'Reminder: {{survey_title}}';

export function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// --- state -----------------------------------------------------------------

// Whether the closing date has passed.
export function closingPassed(survey) {
  return Boolean(survey.closes_on && survey.closes_on < localToday());
}

// draft, open or closed, counting a closing date that has passed.
export function surveyState(survey) {
  if (survey.status === 'draft') return 'draft';
  if (survey.status === 'closed' || closingPassed(survey)) return 'closed';
  return 'open';
}

export function takesAnswers(survey) {
  return surveyState(survey) === 'open';
}

// --- addresses -------------------------------------------------------------

export function surveyUrl(orgSlug, survey) {
  return publicUrl(orgSlug, `/s/${survey.slug}`);
}

export function surveyLinks(orgSlug, survey, invite = null) {
  const links = { survey: surveyUrl(orgSlug, survey) };
  if (invite) {
    links.answer = publicUrl(orgSlug, `/q/${invite.token}`);
    links.unsub = publicUrl(orgSlug, `/u/${invite.token}`);
  }
  return links;
}

// Previews and tests point the button at the shared page, so nobody's real
// answers can be changed from them.
export function surveyPreviewLinks(orgSlug, survey) {
  const url = surveyUrl(orgSlug, survey);
  return { survey: url, answer: url, unsub: '' };
}

// --- the people asked ------------------------------------------------------

// The same join as invites: live contact details win over the snapshot.
export const SURVEY_INVITE_SELECT = `
  SELECT i.*, c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone,
         c.unsubscribed_at AS contact_unsubscribed_at
  FROM survey_invites i LEFT JOIN contacts c ON c.id = i.contact_id
`;

export function getSurveyInvites(db, surveyId) {
  return db.prepare(`${SURVEY_INVITE_SELECT} WHERE i.survey_id = ? ORDER BY i.created_at, i.id`).all(surveyId);
}

export function personName(invite) {
  return invite.contact_name || invite.guest_name || '';
}

export function personEmail(invite) {
  return (invite.contact_email || invite.guest_email || '').toLowerCase();
}

export function surveyStats(db, surveyId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS invited,
      SUM(CASE WHEN responded_at IS NOT NULL THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN responded_at IS NULL AND email_status = 'sent' THEN 1 ELSE 0 END) AS awaiting,
      SUM(CASE WHEN responded_at IS NULL AND email_status IN ('not_sent', 'failed') THEN 1 ELSE 0 END) AS not_reached,
      SUM(CASE WHEN email_status = 'sent' THEN 1 ELSE 0 END) AS emails_sent,
      SUM(CASE WHEN email_status = 'queued' THEN 1 ELSE 0 END) AS emails_queued,
      SUM(CASE WHEN email_status = 'failed' THEN 1 ELSE 0 END) AS emails_failed
    FROM survey_invites WHERE survey_id = ?
  `).get(surveyId);
  const stats = {};
  for (const [k, val] of Object.entries(row)) stats[k] = Number(val || 0);
  // Every set of answers, including those from the shared page that no
  // invite stands for.
  stats.responses = Number(db.prepare('SELECT COUNT(*) AS n FROM survey_responses WHERE survey_id = ?').get(surveyId).n);
  stats.emails_logged = Number(db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE survey_id = ?').get(surveyId).n);
  return stats;
}

// --- answers ---------------------------------------------------------------

function parseAnswerJson(row) {
  try { return JSON.parse(row.answers || '{}'); } catch { return {}; }
}

// The answers one person gave, or null. An anonymous survey keeps no link
// from a person to their answers, so it is always null there.
export function responseFor(db, survey, invite) {
  if (survey.anonymous || !invite) return null;
  const row = db.prepare('SELECT * FROM survey_responses WHERE invite_id = ?').get(invite.id);
  return row ? { ...row, answers: parseAnswerJson(row) } : null;
}

// Every response, with the name and email of whoever gave it when the survey
// is named. An anonymous survey's come in the order of their random ids,
// which is no order at all.
export function responsesFor(db, survey) {
  const rows = db.prepare(`
    SELECT r.*, i.guest_name, i.guest_email, c.name AS contact_name, c.email AS contact_email
    FROM survey_responses r
    LEFT JOIN survey_invites i ON i.id = r.invite_id
    LEFT JOIN contacts c ON c.id = i.contact_id
    WHERE r.survey_id = ?
    ORDER BY ${survey.anonymous ? 'r.id' : 'r.submitted_at, r.id'}
  `).all(survey.id);
  return rows.map((r) => ({
    id: r.id,
    invite_id: survey.anonymous ? null : r.invite_id,
    name: survey.anonymous ? '' : (r.contact_name || r.guest_name || ''),
    email: survey.anonymous ? '' : (r.contact_email || r.guest_email || '').toLowerCase(),
    submitted_at: r.submitted_at,
    updated_at: r.updated_at,
    answers: parseAnswerJson(r),
  }));
}

// Today, at midnight. An anonymous survey's times go no finer than this.
function daySql() {
  return `${new Date().toISOString().slice(0, 10)} 00:00:00`;
}

// A random id for an anonymous response, well inside what SQLite and
// JavaScript both count exactly.
function randomRowId(db) {
  for (;;) {
    const id = crypto.randomInt(1, 2 ** 47);
    if (!db.prepare('SELECT 1 FROM survey_responses WHERE id = ?').get(id)) return id;
  }
}

// Keeps one person's answers. `invite` is who answered, or null for the
// shared page of an anonymous survey. Named answers replace what that person
// gave before. Run inside a transaction.
export function saveResponse(db, survey, invite, answers) {
  const json = JSON.stringify(answers);
  if (survey.anonymous) {
    const day = daySql();
    db.prepare(
      'INSERT INTO survey_responses (id, survey_id, invite_id, answers, submitted_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)'
    ).run(randomRowId(db), survey.id, json, day, day);
    if (invite) db.prepare('UPDATE survey_invites SET responded_at = ? WHERE id = ?').run(day, invite.id);
    return;
  }
  const now = nowSql();
  const existing = db.prepare('SELECT id FROM survey_responses WHERE invite_id = ?').get(invite.id);
  if (existing) {
    db.prepare('UPDATE survey_responses SET answers = ?, updated_at = ? WHERE id = ?').run(json, now, existing.id);
  } else {
    db.prepare(
      'INSERT INTO survey_responses (survey_id, invite_id, answers, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(survey.id, invite.id, json, now, now);
  }
  db.prepare('UPDATE survey_invites SET responded_at = COALESCE(responded_at, ?) WHERE id = ?').run(now, invite.id);
}

export function hasResponses(db, surveyId) {
  return Boolean(db.prepare('SELECT 1 FROM survey_responses WHERE survey_id = ? LIMIT 1').get(surveyId));
}

// --- email -----------------------------------------------------------------

export function renderSurveyEmailFor({ org, survey, invite, kind, subjectTemplate, bodyTemplate, linksOverride }) {
  const name = personName(invite);
  const email = personEmail(invite);
  const links = linksOverride || surveyLinks(org.slug, survey, invite);
  const ctx = buildSurveyTagContext({ org, survey, recipientName: name, links });
  const subject = renderTags(subjectTemplate, ctx).trim() || survey.title;
  const bodyText = renderTags(bodyTemplate, ctx);
  const rendered = renderSurveyEmail({
    kind, org, survey, toEmail: email, bodyText, links,
    unsubUrl: links.unsub, imageUrl: orgImageUrl(org.slug),
  });
  return { subject, html: rendered.html, text: rendered.text, toName: name, toEmail: email };
}

// Queues one kind of survey email to a set of invites, with the same skip
// rules as invitations. `markInvitation` records the send on each invite.
export function queueSurveyEmails(db, { org, survey, invites, kind, subjectTemplate, bodyTemplate, markInvitation }) {
  let queued = 0;
  const skipped = { no_email: 0, unsubscribed: 0, already_queued: 0 };
  const insert = db.prepare(
    `INSERT INTO email_log (survey_id, survey_invite_id, kind, to_name, to_email, subject, html, body_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const invite of invites) {
    const email = personEmail(invite);
    if (!email) { skipped.no_email++; continue; }
    if (invite.contact_unsubscribed_at || isUnsubscribed(db, email)) { skipped.unsubscribed++; continue; }
    if (markInvitation && invite.email_status === 'queued') { skipped.already_queued++; continue; }
    const msg = renderSurveyEmailFor({ org, survey, invite, kind, subjectTemplate, bodyTemplate });
    insert.run(survey.id, invite.id, kind, msg.toName || '', email, msg.subject, msg.html, msg.text);
    if (markInvitation) db.prepare("UPDATE survey_invites SET email_status = 'queued' WHERE id = ?").run(invite.id);
    queued++;
  }
  return { queued, skipped };
}

export function logSurveyTestEmail(db, { survey, toEmail, subject, html, text, status, error }) {
  const info = db.prepare(
    `INSERT INTO email_log (survey_id, kind, to_name, to_email, subject, html, body_text, status, error, sent_at)
     VALUES (?, 'test', '', ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(survey.id, toEmail, subject, html, text, status, error || null);
  return insertId(info);
}

// The questions a survey has, for callers that only need them read.
export { parseQuestions };
