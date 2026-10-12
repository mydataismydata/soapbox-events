// A survey's results, one card per question, from GET /surveys/:id/results.
// The counting is done on the server (surveyQuestions.js tally()).
import React, { useState } from 'react';
import { Card, Empty } from '../ui.jsx';
import { KIND_LABEL } from './QuestionEditor.jsx';

function Bar({ label, count, pct, sub, lead }) {
  return (
    <div className="svr-row">
      <div className="svr-label">
        {lead ? <span className="svr-lead">{lead}</span> : null}
        <span>{label}</span>
        {sub ? <span className="svr-sub">{sub}</span> : null}
      </div>
      <div className="svr-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="svr-num"><strong>{count}</strong> <span>{pct}%</span></div>
    </div>
  );
}

// What people typed, a few at a time.
function Written({ answers, named }) {
  const [all, setAll] = useState(false);
  const shown = all ? answers : answers.slice(0, 8);
  return (
    <>
      <ul className="svr-text">
        {shown.map((a, i) => (
          <li key={i}>
            <div className="svr-quote">{a.text}</div>
            {named && a.name ? <div className="t-sub">{a.name}</div> : null}
          </li>
        ))}
      </ul>
      {answers.length > shown.length ? (
        <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>Show all {answers.length}</button>
      ) : null}
    </>
  );
}

function Choices({ q, named }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {q.options.map((o) => <Bar key={o.id} label={o.label} count={o.count} pct={o.pct} />)}
      {q.other ? (
        <>
          <Bar label="Other" count={q.other.count} pct={q.other.pct} />
          {q.other.count ? (
            <div className="svr-other">
              <button type="button" className="btn btn-sm btn-ghost" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
                {open ? 'Hide' : 'Show'} what people typed for Other ({q.other.count})
              </button>
              {open ? <Written answers={q.other.answers} named={named} /> : null}
            </div>
          ) : null}
        </>
      ) : null}
      {q.kind === 'multi' ? <p className="small muted svr-note">People could pick more than one, so the shares add up to more than 100%.</p> : null}
    </>
  );
}

function Ranking({ q }) {
  const n = q.options.length;
  return (
    <>
      {q.options.map((o, i) => (
        <Bar key={o.id} lead={`#${i + 1}`} label={o.label} count={o.points} pct={o.pct}
          sub={o.placed ? `Average place ${o.average} · first ${o.firsts} time${o.firsts === 1 ? '' : 's'}` : 'Nobody placed it'} />
      ))}
      <p className="small muted svr-note">
        Points: first place earns {n}, second {n - 1}, and so on. The share is of the most points possible.
      </p>
    </>
  );
}

function Scale({ q }) {
  const most = Math.max(1, ...q.counts.map((c) => c.count));
  return (
    <>
      <div className="svr-scale" style={{ '--points': q.points }}>
        {q.counts.map((c) => (
          <div key={c.point} className="svr-col" title={`${c.point}: ${c.count} (${c.pct}%)`}>
            <span className="svr-col-n">{c.count}</span>
            <div className="svr-col-bar"><span style={{ height: `${(c.count / most) * 100}%` }} /></div>
            <span className="svr-col-p">{c.point}</span>
          </div>
        ))}
      </div>
      {q.low || q.high ? <div className="svr-ends"><span>{q.low}</span><span>{q.high}</span></div> : null}
      <div className="svr-facts">
        <span>Average <strong>{q.average ?? '—'}</strong> of {q.points}</span>
        <span>Median <strong>{q.median ?? '—'}</strong></span>
      </div>
    </>
  );
}

export default function SurveyResults({ results }) {
  if (!results) return null;
  if (!results.questions.length) {
    return <Card><Empty icon="clipboard" title="No questions">Add questions to the survey to see results here.</Empty></Card>;
  }
  const named = !results.anonymous;
  return (
    <div className="svr">
      {results.questions.map((q, i) => (
        <Card key={q.id} title={`${i + 1}. ${q.prompt}`}
          sub={`${KIND_LABEL[q.kind]} · ${q.answered} answer${q.answered === 1 ? '' : 's'}${q.required ? '' : ' · optional'}`}>
          {q.answered === 0 ? <p className="muted" style={{ margin: 0 }}>Nobody has answered this yet.</p>
            : q.kind === 'ranking' ? <Ranking q={q} />
              : q.kind === 'scale' ? <Scale q={q} />
                : q.kind === 'text' ? <Written answers={q.answers} named={named} />
                  : <Choices q={q} named={named} />}
        </Card>
      ))}
    </div>
  );
}
