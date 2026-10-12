// The survey's questions, as a list of cards to write and arrange. The server
// checks them again on save (server/lib/surveyQuestions.js) and gives each
// question and choice its id; until then a new one has only a local key.
//
// Once a survey has answers it is `locked`: the wording stays editable, and
// everything that would change what an answer means is turned off.
import React, { useRef } from 'react';
import { Banner, Icon, IconButton } from '../ui.jsx';

export const KINDS = [
  { kind: 'yes_no', label: 'Yes / No', sub: 'Two buttons' },
  { kind: 'single', label: 'Single choice', sub: 'Pick one' },
  { kind: 'multi', label: 'Multiple choice', sub: 'Pick any' },
  { kind: 'ranking', label: 'Ranking', sub: 'Put in order' },
  { kind: 'scale', label: 'Preference scale', sub: 'From low to high' },
  { kind: 'text', label: 'Written answer', sub: 'Free text' },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label]));
const CHOICE_KINDS = new Set(['single', 'multi', 'ranking']);

let seq = 0;
const newKey = () => `k${++seq}`;

// Keys the editor needs on everything it lists. Ids from the server double
// as keys, so a saved survey reloads without its cards jumping.
export function withKeys(questions) {
  return (questions || []).map((q) => ({
    ...q,
    _key: q.id || newKey(),
    options: (q.options || []).map((o) => ({ ...o, _key: o.id || newKey() })),
  }));
}

function blank(kind) {
  const q = { _key: newKey(), kind, prompt: '', help: '', required: true };
  if (CHOICE_KINDS.has(kind)) q.options = [{ _key: newKey(), label: '' }, { _key: newKey(), label: '' }];
  if (kind === 'single' || kind === 'multi') q.other = false;
  if (kind === 'multi') q.max = 0;
  if (kind === 'scale') Object.assign(q, { points: 5, low: 'Not interested at all', high: 'Very interested' });
  if (kind === 'text') q.long = false;
  return q;
}

// A question changed to another type keeps its wording, and its choices
// when the new type has choices too.
function retype(q, kind) {
  const next = blank(kind);
  next._key = q._key;
  next.id = q.id;
  next.prompt = q.prompt;
  next.help = q.help;
  next.required = q.required;
  if (CHOICE_KINDS.has(kind) && q.options?.length) next.options = q.options;
  return next;
}

function move(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

function ChoiceEditor({ q, n, locked, onChange }) {
  const lastRef = useRef(null);
  const options = q.options || [];
  const setOptions = (next) => onChange({ ...q, options: next });
  const offered = options.length + (q.other ? 1 : 0);
  return (
    <div className="qe-choices">
      <div className="qe-label">Choices</div>
      {options.map((o, i) => (
        <div className="qe-choice" key={o._key}>
          <span className="qe-mark" aria-hidden="true">
            {q.kind === 'ranking' ? i + 1 : <span className={q.kind === 'multi' ? 'qe-box' : 'qe-dot'} />}
          </span>
          <input className="input" value={o.label} maxLength={200}
            ref={i === options.length - 1 ? lastRef : undefined}
            placeholder={`Choice ${i + 1}`} aria-label={`Question ${n}, choice ${i + 1}`}
            onChange={(e) => setOptions(options.map((x) => (x._key === o._key ? { ...x, label: e.target.value } : x)))}
            onKeyDown={(e) => {
              // Enter on the last choice starts the next one.
              if (e.key === 'Enter' && !locked && i === options.length - 1) {
                e.preventDefault();
                setOptions([...options, { _key: newKey(), label: '' }]);
                setTimeout(() => lastRef.current?.focus(), 0);
              }
            }} />
          {!locked ? (
            <div className="qe-choice-tools">
              <IconButton icon="arrowUp" label="Move choice up" disabled={i === 0}
                onClick={() => setOptions(move(options, i, i - 1))} />
              <IconButton icon="arrowDown" label="Move choice down" disabled={i === options.length - 1}
                onClick={() => setOptions(move(options, i, i + 1))} />
              <IconButton icon="x" label="Remove choice" tone="ghost" disabled={options.length <= 2}
                onClick={() => setOptions(options.filter((x) => x._key !== o._key))} />
            </div>
          ) : null}
        </div>
      ))}
      {!locked ? (
        <button type="button" className="btn btn-sm qe-add-choice"
          onClick={() => { setOptions([...options, { _key: newKey(), label: '' }]); setTimeout(() => lastRef.current?.focus(), 0); }}>
          <Icon name="plus" size={13} /> Add a choice
        </button>
      ) : null}
      {q.kind !== 'ranking' ? (
        <label className="checkbox">
          <input type="checkbox" checked={Boolean(q.other)} disabled={locked}
            onChange={(e) => onChange({ ...q, other: e.target.checked })} />
          <span><span className="cb-label">Offer “Other”</span>
            <div className="cb-sub">Adds a last choice with a box to type an answer in.</div></span>
        </label>
      ) : null}
      {q.kind === 'multi' ? (
        <div className="qe-inline">
          <label htmlFor={`max-${q._key}`}>Most a person can pick</label>
          <select id={`max-${q._key}`} className="input" style={{ width: 150 }} value={q.max || 0} disabled={locked}
            onChange={(e) => onChange({ ...q, max: Number(e.target.value) })}>
            <option value={0}>Any number</option>
            {Array.from({ length: Math.max(0, offered - 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

function ScaleEditor({ q, locked, onChange }) {
  return (
    <div className="qe-scale">
      <div className="field-row3">
        <div className="field">
          <label htmlFor={`pts-${q._key}`}>Points on the scale</label>
          <select id={`pts-${q._key}`} value={q.points} disabled={locked}
            onChange={(e) => onChange({ ...q, points: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`low-${q._key}`}>Label at 1</label>
          <input id={`low-${q._key}`} value={q.low || ''} maxLength={60} placeholder="Not interested at all"
            onChange={(e) => onChange({ ...q, low: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`high-${q._key}`}>Label at {q.points}</label>
          <input id={`high-${q._key}`} value={q.high || ''} maxLength={60} placeholder="Very interested"
            onChange={(e) => onChange({ ...q, high: e.target.value })} />
        </div>
      </div>
      <div className="qe-scale-preview" aria-hidden="true" style={{ '--points': q.points }}>
        <div className="qe-stops">
          {Array.from({ length: q.points }, (_, i) => <span key={i}><i />{i + 1}</span>)}
        </div>
        <div className="qe-ends"><span>{q.low}</span><span>{q.high}</span></div>
      </div>
    </div>
  );
}

function QuestionCard({ q, n, count, locked, onChange, onMove, onCopy, onRemove }) {
  return (
    <div className="qe-q">
      <div className="qe-head">
        <span className="qe-n">Q{n}</span>
        <select className="input qe-kind" value={q.kind} disabled={locked} aria-label={`Type of question ${n}`}
          onChange={(e) => onChange(retype(q, e.target.value))}>
          {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        <label className="qe-required">
          <input type="checkbox" checked={q.required !== false}
            onChange={(e) => onChange({ ...q, required: e.target.checked })} /> Required
        </label>
        {!locked ? (
          <div className="qe-tools">
            <IconButton icon="arrowUp" label="Move question up" disabled={n === 1} onClick={() => onMove(-1)} />
            <IconButton icon="arrowDown" label="Move question down" disabled={n === count} onClick={() => onMove(1)} />
            <IconButton icon="copy" label="Duplicate question" onClick={onCopy} />
            <IconButton icon="trash" label="Delete question" tone="ghost" onClick={onRemove} />
          </div>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor={`p-${q._key}`}>Question</label>
        <textarea id={`p-${q._key}`} rows={2} value={q.prompt} maxLength={500} style={{ minHeight: 0 }}
          placeholder={PLACEHOLDERS[q.kind]}
          onChange={(e) => onChange({ ...q, prompt: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`h-${q._key}`}>Note under the question <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input id={`h-${q._key}`} value={q.help || ''} maxLength={1000}
          placeholder="Anything that helps people answer"
          onChange={(e) => onChange({ ...q, help: e.target.value })} />
      </div>
      {CHOICE_KINDS.has(q.kind) ? <ChoiceEditor q={q} n={n} locked={locked} onChange={onChange} /> : null}
      {q.kind === 'scale' ? <ScaleEditor q={q} locked={locked} onChange={onChange} /> : null}
      {q.kind === 'text' ? (
        <div className="qe-inline">
          <label className="qe-radio"><input type="radio" checked={!q.long} disabled={locked}
            onChange={() => onChange({ ...q, long: false })} /> One line</label>
          <label className="qe-radio"><input type="radio" checked={Boolean(q.long)} disabled={locked}
            onChange={() => onChange({ ...q, long: true })} /> A paragraph</label>
        </div>
      ) : null}
      {q.kind === 'yes_no' ? <p className="small muted" style={{ margin: 0 }}>Answered with a Yes or a No button.</p> : null}
    </div>
  );
}

const PLACEHOLDERS = {
  yes_no: 'Should we hold the meeting monthly?',
  single: 'Which night suits you best?',
  multi: 'Which topics should we cover this year?',
  ranking: 'Put these speakers in order of preference',
  scale: 'How interested are you in a fall fundraiser?',
  text: 'Anything else you would like us to know?',
};

export default function QuestionEditor({ questions, onChange, locked = false }) {
  const set = (i, q) => onChange(questions.map((x, j) => (j === i ? q : x)));
  const add = (kind) => onChange([...questions, blank(kind)]);
  return (
    <div className="qe">
      {locked ? (
        <Banner tone="info">
          People have answered, so the questions are locked. You can still fix the wording of questions,
          notes and choices. To ask something different, duplicate the survey.
        </Banner>
      ) : null}
      {questions.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>No questions yet. Pick a type below to add the first one.</p>
      ) : null}
      {questions.map((q, i) => (
        <QuestionCard key={q._key} q={q} n={i + 1} count={questions.length} locked={locked}
          onChange={(next) => set(i, next)}
          onMove={(by) => onChange(move(questions, i, i + by))}
          onCopy={() => {
            const copy = withKeys([{ ...q, id: undefined, options: (q.options || []).map((o) => ({ label: o.label })) }])[0];
            onChange([...questions.slice(0, i + 1), copy, ...questions.slice(i + 1)]);
          }}
          onRemove={() => onChange(questions.filter((_, j) => j !== i))} />
      ))}
      {!locked ? (
        <div className="qe-add">
          <div className="qe-label">Add a question</div>
          <div className="qe-add-grid">
            {KINDS.map((k) => (
              <button key={k.kind} type="button" className="qe-add-btn" onClick={() => add(k.kind)}>
                <span className="t">{k.label}</span><span className="s">{k.sub}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// What goes to the server: the questions without the editor's keys.
export function questionsPayload(questions) {
  return questions.map(({ _key, options, ...q }) => ({
    ...q,
    ...(options ? { options: options.map(({ _key: k, ...o }) => o) } : {}),
  }));
}
