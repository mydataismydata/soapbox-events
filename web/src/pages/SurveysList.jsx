import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDateShort, timeAgo } from '../api.js';
import { Spinner, Empty, Badge, Banner, Card, Icon } from '../ui.jsx';

export function SurveyBadge({ state }) {
  if (state === 'open') return <Badge tone="green" dot>Open</Badge>;
  if (state === 'closed') return <Badge tone="gray" dot>Closed</Badge>;
  return <Badge tone="amber" dot>Draft</Badge>;
}

// Public or by invitation, and named or anonymous: the two choices that
// decide who can answer and what you can see.
export function surveyTraits(s) {
  return [
    s.share_enabled ? 'Public' : 'By invitation',
    s.anonymous ? 'Anonymous' : 'Named',
    `${s.questions.length} question${s.questions.length === 1 ? '' : 's'}`,
  ].join(' · ');
}

function Row({ s }) {
  const st = s.stats;
  return (
    <tr className="row-link">
      <td>
        <Link to={`/surveys/${s.id}`} className="t-main row-link-target">{s.title}</Link>
        <div className="t-sub">{surveyTraits(s)}</div>
      </td>
      <td><SurveyBadge state={s.state} /></td>
      <td className="t-sub nowrap">
        {s.state === 'draft' ? 'Not sent' : (
          <>
            <span><strong style={{ color: 'var(--c-ok)' }}>{st.responses}</strong> response{st.responses === 1 ? '' : 's'}</span>
            {st.invited ? <div>{st.answered} of {st.invited} asked</div> : null}
          </>
        )}
      </td>
      <td className="t-sub nowrap">
        {s.closes_on && s.state === 'open' ? `Closes ${formatDateShort(s.closes_on)}` : timeAgo(s.opened_at || s.updated_at)}
      </td>
      <td style={{ textAlign: 'right', width: 24 }}>
        <Icon name="chevronRight" size={16} className="row-chevron" />
      </td>
    </tr>
  );
}

function Section({ title, rows }) {
  if (rows.length === 0) return null;
  return (
    <Card flush title={title} sub={`${rows.length} survey${rows.length === 1 ? '' : 's'}`} style={{ marginBottom: 16 }}>
      <div className="table-wrap">
        <table className="table"><tbody>{rows.map((s) => <Row key={s.id} s={s} />)}</tbody></table>
      </div>
    </Card>
  );
}

export default function SurveysList() {
  const [surveys, setSurveys] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/surveys').then((d) => setSurveys(d.surveys)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="page"><Banner tone="bad">{error}</Banner></div>;
  if (!surveys) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Surveys</h1>
          <p className="page-sub">Ask your contacts questions and see what they think.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => navigate('/surveys/new')}>
            <Icon name="plus" size={15} /> New survey
          </button>
        </div>
      </div>

      {surveys.length === 0 ? (
        <Card flush>
          <Empty icon="clipboard" title="No surveys yet" action={
            <button className="btn btn-primary" onClick={() => navigate('/surveys/new')}>Create your first survey</button>
          }>
            A survey is emailed like an invitation, but asks questions: yes or no, pick one, pick several, put in
            order, a scale, or a written answer. Everyone gets their own link, and the results add up as they answer.
          </Empty>
        </Card>
      ) : (
        <>
          <Section title="Open" rows={surveys.filter((s) => s.state === 'open')} />
          <Section title="Drafts" rows={surveys.filter((s) => s.state === 'draft')} />
          <Section title="Closed" rows={surveys.filter((s) => s.state === 'closed')} />
        </>
      )}
    </div>
  );
}
