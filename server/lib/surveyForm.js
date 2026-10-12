// The survey form on the guest pages. Server-rendered HTML that works with
// no JavaScript, like the RSVP form; /assets/survey.js only makes the
// ranking questions easier on a phone and caps a multiple choice as you tick.
//
// Field names follow parseAnswers() in surveyQuestions.js.
import { esc } from './html.js';
import { choicesOf, answerText } from './surveyQuestions.js';

function errorLine(error) {
  return error ? `<p class="sv-err" role="alert">${esc(error)}</p>` : '';
}

function heading(q, n, tag = 'legend', forId = '') {
  const optional = q.required ? '' : ' <span class="sv-optional">Optional</span>';
  const attr = tag === 'label' ? ` for="${esc(forId)}"` : '';
  return `<${tag} class="sv-prompt"${attr}><span class="sv-n">${n}</span><span>${esc(q.prompt)}${optional}</span></${tag}>
    ${q.help ? `<p class="sv-help">${esc(q.help)}</p>` : ''}`;
}

function otherBox(q, checked, text, type) {
  return `<label class="sv-choice sv-other">
      <input type="${type}" name="${esc(q.id)}" value="other"${checked ? ' checked' : ''}>
      <span>Other:</span>
      <input type="text" class="sv-other-text" name="${esc(q.id)}_other" maxlength="200"
        aria-label="Your other answer" value="${esc(text || '')}">
    </label>`;
}

function choiceList(q, value, type) {
  const picked = new Set(type === 'radio'
    ? [q.kind === 'yes_no' ? value : value?.pick]
    : (value?.picks || []));
  const rows = choicesOf(q).map((o) => `<label class="sv-choice">
      <input type="${type}" name="${esc(q.id)}" value="${esc(o.id)}"${picked.has(o.id) ? ' checked' : ''}>
      <span>${esc(o.label)}</span>
    </label>`).join('');
  const other = q.other ? otherBox(q, picked.has('other'), value?.other, type) : '';
  const max = q.kind === 'multi' && q.max ? ` data-max="${q.max}"` : '';
  return `<div class="sv-choices${q.kind === 'yes_no' ? ' sv-yesno' : ''}"${max}>${rows}${other}</div>`;
}

function rankingList(q, value) {
  const order = Array.isArray(value) ? value : [];
  const n = q.options.length;
  const items = q.options.map((o) => {
    const rank = order.indexOf(o.id) + 1;
    const opts = ['<option value="">–</option>',
      ...Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${rank === i + 1 ? ' selected' : ''}>${i + 1}</option>`)].join('');
    return `<li class="sv-rank-item">
        <select name="${esc(q.id)}_${esc(o.id)}" aria-label="Place for ${esc(o.label)}">${opts}</select>
        <span class="sv-rank-label">${esc(o.label)}</span>
      </li>`;
  }).join('');
  return `<p class="sv-hint" data-js-hint="Tap the choices in order, starting with your favourite. Tap one again to take it out.">
      Number the choices: 1 for your favourite, 2 for the next, and so on.</p>
    <ol class="sv-rank" data-rank>${items}</ol>`;
}

function scale(q, value) {
  const stops = Array.from({ length: q.points }, (_, i) => {
    const point = i + 1;
    const end = point === 1 ? q.low : point === q.points ? q.high : '';
    return `<label class="sv-stop">
        <input type="radio" name="${esc(q.id)}" value="${point}"${value === point ? ' checked' : ''}
          aria-label="${esc(end ? `${point}, ${end}` : String(point))}">
        <span class="sv-dot" aria-hidden="true"></span>
        <span class="sv-stop-n" aria-hidden="true">${point}</span>
      </label>`;
  }).join('');
  const ends = q.low || q.high
    ? `<div class="sv-ends" aria-hidden="true"><span>${esc(q.low || '')}</span><span>${esc(q.high || '')}</span></div>` : '';
  return `<div class="sv-scale" style="--points:${q.points}"><div class="sv-stops">${stops}</div>${ends}</div>`;
}

function written(q, value, fieldId) {
  return q.long
    ? `<textarea id="${esc(fieldId)}" name="${esc(q.id)}" rows="5" maxlength="3000">${esc(value || '')}</textarea>`
    : `<input id="${esc(fieldId)}" name="${esc(q.id)}" maxlength="300" value="${esc(value || '')}">`;
}

function question(q, n, value, error) {
  const bad = error ? ' sv-q-bad' : '';
  if (q.kind === 'text') {
    const fieldId = `f-${q.id}`;
    return `<div class="sv-q${bad}" id="${esc(q.id)}">${heading(q, n, 'label', fieldId)}${errorLine(error)}
      <div class="pub-field">${written(q, value, fieldId)}</div></div>`;
  }
  let body = '';
  if (q.kind === 'yes_no' || q.kind === 'single') body = choiceList(q, value, 'radio');
  else if (q.kind === 'multi') {
    body = `${q.max ? `<p class="sv-hint">Choose up to ${q.max}.</p>` : '<p class="sv-hint">Choose all that apply.</p>'}
      ${choiceList(q, value, 'checkbox')}`;
  } else if (q.kind === 'ranking') body = rankingList(q, value);
  else if (q.kind === 'scale') body = scale(q, value);
  return `<fieldset class="sv-q${bad}" id="${esc(q.id)}">${heading(q, n)}${errorLine(error)}${body}</fieldset>`;
}

// The whole form. `before` goes inside the form ahead of the questions (the
// name and email fields of a public survey), and `after` just before the
// button (the bot traps).
export function surveyFormHtml({
  action, questions, values = {}, errors = {}, before = '', after = '', submitLabel = 'Send my answers', disabled = false,
}) {
  const wrong = questions.filter((q) => errors[q.id]);
  const summary = wrong.length
    ? `<div class="pub-banner pub-banner-no" role="alert">${wrong.length === 1 ? 'One answer needs' : `${wrong.length} answers need`}
        another look: ${wrong.map((q) => `<a href="#${esc(q.id)}">question ${questions.indexOf(q) + 1}</a>`).join(', ')}.</div>`
    : '';
  return `${summary}<form method="post" action="${esc(action)}" class="sv-form" novalidate>
    ${before}
    ${questions.map((q, i) => `<div class="pub-card">${question(q, i + 1, values[q.id], errors[q.id])}</div>`).join('')}
    ${after}
    <div class="pub-card"><div class="pub-actions" style="margin-top:0;">
      <button class="pub-btn pub-btn-plain sv-submit" type="submit"${disabled ? ' disabled' : ''}>${esc(submitLabel)}</button>
    </div></div>
  </form>`;
}

// Someone's answers, read back. For a closed survey's personal page.
export function answersHtml(questions, answers) {
  const rows = questions.map((q, i) => {
    const said = answerText(q, answers[q.id]);
    return `<div class="pub-detail"><div class="k">Q${i + 1}</div><div>
      <div class="sv-read-q">${esc(q.prompt)}</div>
      <div class="${said ? '' : 'pub-muted'}">${said ? esc(said).replace(/\n/g, '<br>') : 'No answer'}</div>
    </div></div>`;
  }).join('');
  return `<div class="pub-card"><h2>Your answers</h2>${rows}</div>`;
}
