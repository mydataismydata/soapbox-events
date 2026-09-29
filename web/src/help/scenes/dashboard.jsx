import React from 'react';
import Scene from '../Scene.jsx';
import { PageHead, Screen } from '../mock.jsx';
import { Card, Icon, ResponseBadge, Stat, StatGrid } from '../../ui.jsx';
import { OCTOBER, ORG, VENUE } from '../data.js';

const start = { reply: false };
const steps = [
  { at: 600, point: 'stats', say: 'Each number opens the page it counts' },
  { at: 2400, point: 'ev-tiles', say: 'Replies so far for your next event', side: 'below' },
  { at: 4400, set: { reply: true } },
  { at: 4500, point: 'reply-new', say: 'Eric A. just clicked Accept', side: 'above' },
  { at: 6300, point: 'ev-tiles', say: 'The counts keep up', side: 'below' },
  { at: 8000, tap: 'ev-title', say: 'Click an event to open it', side: 'below' },
  { at: 9800, tap: 'new-event', say: 'New event starts the wizard', side: 'left' },
];

function Tile({ label, value, tone }) {
  return (
    <div className={`mini-tile${tone ? ` tone-${tone}` : ''}`}>
      <div className="mt-value">{value}</div>
      <div className="mt-label">{label}</div>
    </div>
  );
}

const REPLIES = [
  { name: 'Gloria N.', ago: '5h ago', response: 'yes' },
  { name: 'Michelle M.', ago: '1d ago', response: 'no' },
  { name: 'Fred P.', plus: 1, ago: '2d ago', response: 'yes' },
];

export default function Dashboard() {
  return (
    <Scene width={560} height={532} length={12000} start={start} steps={steps}
      label="The dashboard. Four numbers along the top count upcoming events, contacts, emails this month and the email quota left. Under them, the October meeting shows 6 invited, 4 coming, 1 declined and 2 waiting. A new reply from Eric A. arrives in Recent responses, and the October counts change to 5 coming and 1 waiting.">
      {(s) => {
        const replies = s.reply ? [{ name: 'Eric A.', ago: 'just now', response: 'yes', fresh: true }, ...REPLIES] : REPLIES;
        return (
          <Screen tab="Dashboard">
            <PageHead title="Welcome back, Joe" sub={`Here's what's happening at ${ORG}.`}
              actions={<span className="btn btn-primary" data-t="new-event"><Icon name="plus" size={15} /> New event</span>} />
            <div data-t="stats">
              <StatGrid>
                <Stat label="Upcoming events" value="1" sub="0 drafts" />
                <Stat label="Contacts" value="7" sub="2 groups" />
                <Stat label="Emails this month" value="21" sub="via SMTP2GO" />
                <Stat label="Email quota left" value="979" sub="21 of 1000 used" />
              </StatGrid>
            </div>
            <Card flush title="Upcoming events"
              actions={<span className="btn btn-sm">All events <Icon name="chevronRight" size={13} /></span>}>
              <table className="table">
                <tbody>
                  <tr>
                    <td>
                      <span className="t-main" data-t="ev-title">{OCTOBER.title}</span>
                      <div className="t-sub">{OCTOBER.when} · {VENUE.name}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="mini-tiles" data-t="ev-tiles">
                        <Tile label="Invited" value={6} />
                        <Tile label="Coming" value={s.reply ? 5 : 4} tone="ok" />
                        <Tile label="Declined" value={1} tone="bad" />
                        <Tile label="Waiting" value={s.reply ? 1 : 2} tone="warn" />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
            <Card flush title="Recent responses">
              <table className="table">
                <tbody>
                  {replies.map((r) => (
                    <tr key={r.name} className={r.fresh ? 'hs-new' : undefined} data-t={r.fresh ? 'reply-new' : undefined}>
                      <td>
                        <span className="t-main">{r.name}</span>
                        {r.plus ? <span className="muted"> +{r.plus}</span> : null}
                        <div className="t-sub">
                          <span style={{ color: 'var(--c-accent-text)' }}>{OCTOBER.title}</span> · {r.ago}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}><ResponseBadge response={r.response} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Screen>
        );
      }}
    </Scene>
  );
}
