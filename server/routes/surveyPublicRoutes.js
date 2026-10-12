// Survey pages for the people answering. Mounted inside publicRouter, which
// has already found the organization (req.pub).
//
//   /<org>/s/<code>     the survey's shared page. A public survey takes
//                       answers here; a private one says to use the email.
//   /<org>/q/<token>    one person's own page: answer, or change answers
//
// Answers are taken only while the survey is open (surveys.js). The shared
// page's form carries the same bot traps as the open RSVP form.
//
// The shared page never hands out someone else's personal link. Typing an
// address that was already invited saves the answers but shows only a thank
// you, and an address that has already answered is turned away, so nobody
// can read or change another person's answers by knowing their email.
import { Router } from 'express';
import { insertId, withTx } from '../lib/db.js';
import { resolveSession } from '../lib/auth.js';
import { config } from '../lib/env.js';
import { esc, textToHtml, publicPage } from '../lib/html.js';
import { sanitizeRichText, looksLikeHtml } from '../lib/sanitizeHtml.js';
import { trapFields, checkSubmission } from '../lib/botGuard.js';
import { take } from '../lib/ratelimit.js';
import { isValidEmail } from '../lib/validate.js';
import { randomToken } from '../lib/tokens.js';
import { formatDate, firstName } from '../lib/format.js';
import { parseQuestions, parseAnswers } from '../lib/surveyQuestions.js';
import { surveyFormHtml, answersHtml } from '../lib/surveyForm.js';
import {
  SURVEY_SLUG_RE, surveyState, closingPassed, responseFor, saveResponse, personName,
} from '../lib/surveys.js';

export const surveyPublicRouter = Router();

// The build number makes a new release fetch the new script.
const SCRIPTS = [`/assets/survey.js?v=${config.build}`];

function page(req, res, { title, bodyHtml, status = 200, scripts = [] }) {
  return res.status(status).send(publicPage({ title, bodyHtml, footerHtml: esc(req.pub.org.name), scripts }));
}

function notFound(req, res) {
  return page(req, res, {
    title: 'Not found', status: 404,
    bodyHtml: `<div class="pub-card"><h2>Page not found</h2><p class="pub-muted">This link doesn't point to anything.</p></div>`,
  });
}

function tooMany(req, res) {
  return page(req, res, {
    title: 'Slow down', status: 429,
    bodyHtml: `<div class="pub-card"><h2>Too many requests</h2><p class="pub-muted">Please wait a little while and try again.</p></div>`,
  });
}

function banner(text, kind = 'ok') {
  return `<div class="pub-banner pub-banner-${kind}">${text}</div>`;
}

function surveyBySlug(db, slug) {
  if (!SURVEY_SLUG_RE.test(String(slug))) return null;
  return db.prepare('SELECT * FROM surveys WHERE slug = ?').get(slug) || null;
}

function inviteByToken(db, token) {
  if (!/^[A-Za-z0-9]{10,64}$/.test(String(token))) return null;
  return db.prepare('SELECT * FROM survey_invites WHERE token = ?').get(token) || null;
}

// The title and introduction, with the closing date and whether answers are
// anonymous under them.
function introCard(survey) {
  const desc = survey.description
    ? (looksLikeHtml(survey.description) ? sanitizeRichText(survey.description) : textToHtml(survey.description))
    : '';
  const facts = [
    survey.closes_on && surveyState(survey) !== 'closed' ? `Open until ${formatDate(survey.closes_on)}.` : '',
    survey.anonymous ? 'Your answers are anonymous: nobody can see which answers are yours.' : '',
  ].filter(Boolean);
  return `<div class="pub-card">
    <h1 class="sv-title">${esc(survey.title)}</h1>
    ${desc ? `<div class="rt-content" style="font-size:15.5px; margin-top:10px;">${desc}</div>` : ''}
    ${facts.length ? `<p class="pub-muted" style="margin-top:12px;">${facts.map(esc).join(' ')}</p>` : ''}
  </div>`;
}

function closedCard(survey) {
  const when = survey.status !== 'closed' && closingPassed(survey) ? ` on ${esc(formatDate(survey.closes_on))}` : '';
  return `<div class="pub-card"><h2>This survey is closed</h2>
    <p class="pub-muted">It stopped taking answers${when}. Thank you for your interest.</p></div>`;
}

// --- the shared page -------------------------------------------------------

// An anonymous public survey can't tell one visitor from another, so a
// cookie on the browser that answered keeps the form from coming straight
// back. It is a courtesy, not a guard.
function doneCookie(survey) {
  return `svdone_${survey.slug}`;
}

function nameFields(values = {}) {
  return `<div class="pub-card"><h2>About you</h2>
    <div class="pub-field"><label for="sv-name">Your name</label>
      <input id="sv-name" name="name" required maxlength="200" autocomplete="name" value="${esc(values.name || '')}"></div>
    <div class="pub-field" style="margin-bottom:0;"><label for="sv-email">Your email</label>
      <input id="sv-email" name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(values.email || '')}"></div>
  </div>`;
}

function sharedForm(req, survey, { values = {}, answers = {}, errors = {}, preview = false, intro = '' } = {}) {
  const action = `/${req.pub.org.slug}/s/${survey.slug}`;
  return `${intro ? banner(esc(intro), 'warn') : ''}${surveyFormHtml({
    action, questions: parseQuestions(survey), values: answers, errors,
    before: survey.anonymous ? '' : nameFields(values),
    after: trapFields(`survey-${survey.id}`),
    disabled: preview,
  })}`;
}

surveyPublicRouter.get('/s/:slug', (req, res) => {
  const survey = surveyBySlug(req.pub.db, req.params.slug);
  if (!survey) return notFound(req, res);

  let previewBanner = '';
  if (survey.status === 'draft') {
    const session = resolveSession(req);
    if (!session || session.org.slug !== req.pub.org.slug) return notFound(req, res);
    previewBanner = banner('Draft preview: nobody else can see this page yet, and the button is turned off.', 'warn');
  }
  // Always the address under /<org>/, never the old /o/<org>/ one.
  const own = `/${req.pub.org.slug}/s/${survey.slug}`;
  if (req.originalUrl.split('?')[0] !== own) return res.redirect(301, own);

  const state = surveyState(survey);
  let body;
  if (state === 'closed') body = closedCard(survey);
  else if (!survey.share_enabled && state === 'open') {
    body = `<div class="pub-card"><h2>By invitation</h2>
      <p class="pub-muted">This survey is answered by personal invitation. Use the link in your invitation email.</p></div>`;
  } else if (req.query.thanks !== undefined || (survey.anonymous && req.cookies?.[doneCookie(survey)])) {
    body = `<div class="pub-card"><h2>Thank you</h2><p class="pub-muted">We have your answers.</p></div>`;
  } else {
    body = sharedForm(req, survey, { preview: state === 'draft' });
  }
  return page(req, res, { title: survey.title, bodyHtml: `${previewBanner}${introCard(survey)}${body}`, scripts: SCRIPTS });
});

surveyPublicRouter.post('/s/:slug', (req, res) => {
  const db = req.pub.db;
  const survey = surveyBySlug(db, req.params.slug);
  if (!survey || survey.status === 'draft' || !survey.share_enabled) return notFound(req, res);
  const back = `/${req.pub.org.slug}/s/${survey.slug}`;
  if (surveyState(survey) !== 'open') return res.redirect(303, back);
  // Generous, since a room full of people at a meeting share one address.
  // The bot traps, not this, are what keep machines out.
  if (!take(`survey:${req.ip}`, 200, 60 * 60 * 1000)) return tooMany(req, res);

  const verdict = checkSubmission(`survey-${survey.id}`, req.body);
  if (verdict === 'bot') {
    console.log(`survey: kept nothing from a likely bot on /${req.pub.org.slug}/s/${survey.slug}`);
    return page(req, res, {
      title: 'Thank you', bodyHtml: `<div class="pub-card"><h2>Thank you</h2><p class="pub-muted">We have your answers.</p></div>`,
    });
  }

  const questions = parseQuestions(survey);
  const { answers, errors } = parseAnswers(questions, req.body);
  const values = { name: String(req.body.name || '').trim().slice(0, 200), email: String(req.body.email || '').trim().toLowerCase().slice(0, 254) };
  const redraw = (status, intro = '') => page(req, res, {
    title: survey.title, status, scripts: SCRIPTS,
    bodyHtml: `${introCard(survey)}${sharedForm(req, survey, { values, answers, errors, intro })}`,
  });
  if (verdict === 'retry') return redraw(200, 'Your answers have not been sent yet. Check them, then press the button again.');
  if (!survey.anonymous && (!values.name || !isValidEmail(values.email))) {
    return redraw(400, 'Please enter your name and a valid email address.');
  }
  if (Object.keys(errors).length) return redraw(400);

  if (survey.anonymous) {
    withTx(db, () => saveResponse(db, survey, null, answers));
    const secure = config.isProd && config.baseUrl.startsWith('https') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${doneCookie(survey)}=1; Path=${back}; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${secure}`);
    return res.redirect(303, `${back}?thanks=1`);
  }

  // A named survey keeps one set of answers per address.
  const existing = db.prepare(`
    SELECT i.* FROM survey_invites i LEFT JOIN contacts c ON c.id = i.contact_id
    WHERE i.survey_id = ? AND (i.guest_email = ? OR c.email = ?) ORDER BY i.id LIMIT 1
  `).get(survey.id, values.email, values.email);
  if (existing && responseFor(db, survey, existing)) {
    return page(req, res, {
      title: survey.title, status: 409,
      bodyHtml: `${introCard(survey)}<div class="pub-card"><h2>Already answered</h2>
        <p class="pub-muted">${esc(values.email)} has already answered this survey. To change those answers,
        use the link you were sent or were shown after answering.</p></div>`,
    });
  }
  let created = null;
  withTx(db, () => {
    let invite = existing;
    if (!invite) {
      const contact = db.prepare('SELECT id FROM contacts WHERE email = ?').get(values.email);
      const info = db.prepare(`
        INSERT INTO survey_invites (survey_id, contact_id, guest_name, guest_email, token, source)
        VALUES (?, ?, ?, ?, ?, 'link')
      `).run(survey.id, contact?.id ?? null, values.name, values.email, randomToken(24));
      invite = db.prepare('SELECT * FROM survey_invites WHERE id = ?').get(insertId(info));
      created = invite;
    }
    saveResponse(db, survey, invite, answers);
  });
  // Whoever made this invite may have its link. One made by an invitation
  // belongs to whoever reads that email, so this browser gets a thank you.
  if (created) return res.redirect(303, `/${req.pub.org.slug}/q/${created.token}?thanks=1`);
  return res.redirect(303, `${back}?thanks=1`);
});

// --- one person's page -----------------------------------------------------

function personalPage(req, res, survey, invite, { answers, errors = {}, status = 200 } = {}) {
  const db = req.pub.db;
  const q = req.query;
  const name = firstName(personName(invite)) || 'there';
  const state = surveyState(survey);
  const saved = responseFor(db, survey, invite);
  const questions = parseQuestions(survey);
  let top = '';
  let body;

  if (state === 'closed') {
    body = closedCard(survey) + (saved ? answersHtml(questions, saved.answers) : '');
  } else if (survey.anonymous && invite.responded_at) {
    top = q.thanks !== undefined ? banner(`Thank you, ${esc(name)}. We have your answers.`) : '';
    body = `<div class="pub-card"><h2>You have answered</h2>
      <p class="pub-muted">This survey is anonymous, so your answers are kept with no link to you.
      That also means they can't be shown to you again or changed.</p></div>`;
  } else {
    if (q.thanks !== undefined) top = banner(`Thank you, ${esc(name)}. We have your answers. You can change them here until the survey closes.`);
    else if (q.updated !== undefined) top = banner('Your answers have been updated.');
    else if (saved) top = banner('You have answered. Change anything below and press Save my changes.', 'ok');
    body = surveyFormHtml({
      action: `/${req.pub.org.slug}/q/${invite.token}`,
      questions, values: answers ?? saved?.answers ?? {}, errors,
      submitLabel: saved ? 'Save my changes' : 'Send my answers',
    });
  }
  return page(req, res, { title: survey.title, status, scripts: SCRIPTS, bodyHtml: `${top}${introCard(survey)}${body}` });
}

surveyPublicRouter.get('/q/:token', (req, res) => {
  const invite = inviteByToken(req.pub.db, req.params.token);
  if (!invite) return notFound(req, res);
  const survey = req.pub.db.prepare('SELECT * FROM surveys WHERE id = ?').get(invite.survey_id);
  if (!survey || survey.status === 'draft') return notFound(req, res);
  return personalPage(req, res, survey, invite);
});

surveyPublicRouter.post('/q/:token', (req, res) => {
  const db = req.pub.db;
  if (!take(`qans:${req.ip}`, 200, 60 * 60 * 1000)) return tooMany(req, res);
  const invite = inviteByToken(db, req.params.token);
  if (!invite) return notFound(req, res);
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(invite.survey_id);
  if (!survey || survey.status === 'draft') return notFound(req, res);
  const own = `/${req.pub.org.slug}/q/${invite.token}`;
  if (surveyState(survey) !== 'open' || (survey.anonymous && invite.responded_at)) return res.redirect(303, own);

  const { answers, errors } = parseAnswers(parseQuestions(survey), req.body);
  if (Object.keys(errors).length) return personalPage(req, res, survey, invite, { answers, errors, status: 400 });
  const before = Boolean(invite.responded_at);
  withTx(db, () => saveResponse(db, survey, invite, answers));
  return res.redirect(303, `${own}?${before ? 'updated' : 'thanks'}=1`);
});
