import React from 'react';
import Scene from '../Scene.jsx';
import { PageHead, Screen } from '../mock.jsx';
import { Badge, Card, Icon, Stat, StatGrid } from '../../ui.jsx';
import { SURVEY } from '../data.js';

const start = {};
const steps = [
  { at: 600, point: 'stats', say: 'Who has answered, out of everyone asked' },
  { at: 2500, point: 'bar-Monday', say: 'How many picked each choice', side: 'below' },
  { at: 4400, point: 'rank-0', say: 'A ranking is listed by points: first place earns the most', side: 'above' },
  { at: 6600, tap: 'export', say: 'A spreadsheet with every set of answers', side: 'left' },
];

function Bar({ t, label, count, pct, lead, sub }) {
  return (
    <div className="svr-row" data-t={t}>
      <div className="svr-label">
        {lead ? <span className="svr-lead">{lead}</span> : null}
        <span>{label}</span>
        {sub ? <span className="svr-sub">{sub}</span> : null}
      </div>
      <div className="svr-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="svr-num"><strong>{count}</strong> <span>{pct}%</span></div>
    </div>
  );
}

export default function SurveyResults() {
  return (
    <Scene width={560} height={790} length={9000} start={start} steps={steps}
      label="The results of the survey Fall priorities. Its numbers show 9 asked, 7 answered, 2 still to answer and a 78% response rate. Monday was picked by 4 of the 7, Tuesday by 2 and Thursday by 1. In the ranking of speakers, Sean G. comes first with 18 points, then Sandra F. with 14 and Congressman JR with 10. Export responses downloads a spreadsheet.">
      {() => (
        <Screen bare>
          <PageHead title={SURVEY.title} badge={<Badge tone="green" dot>Open</Badge>}
            sub="By invitation · Named · 3 questions · Closes Friday, October 30, 2026" />
          <div data-t="stats">
            <StatGrid>
              <Stat label="Asked" value={9} sub="9 emailed · 0 queued" />
              <Stat label="Answered" value={7} tone="ok" sub="7 responses in all" />
              <Stat label="Awaiting answers" value={2} tone="warn" sub="0 not yet emailed" />
              <Stat label="Response rate" value="78%" sub="of the 9 asked" />
            </StatGrid>
          </div>
          <div className="tabs">
            <span className="tab active">Results</span>
            <span className="tab">Responses (7)</span>
            <span className="tab">People (9)</span>
            <span className="tab">Reminders</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="small muted">From 7 responses.</span>
            <span className="btn btn-sm" data-t="export"><Icon name="download" size={14} /> Export responses</span>
          </div>
          <div className="svr">
            <Card title={`1. ${SURVEY.night}`} sub="Single choice · 7 answers">
              {SURVEY.nights.map(([label, n]) => (
                <Bar key={label} t={`bar-${label}`} label={label} count={n} pct={Math.round((n * 1000) / 7) / 10} />
              ))}
            </Card>
            <Card title={`2. ${SURVEY.speakers}`} sub="Ranking · 7 answers">
              {SURVEY.ranked.map(([label, points, avg, firsts], i) => (
                <Bar key={label} t={`rank-${i}`} lead={`#${i + 1}`} label={label} count={points}
                  pct={Math.round((points * 1000) / 21) / 10}
                  sub={`Average place ${avg} · first ${firsts} time${firsts === 1 ? '' : 's'}`} />
              ))}
            </Card>
          </div>
        </Screen>
      )}
    </Scene>
  );
}
