import React from 'react';
import Scene from '../Scene.jsx';
import { LogCard, PageHead, Screen, Toast } from '../mock.jsx';
import { Badge, Icon, Stat, StatGrid } from '../../ui.jsx';
import { PEOPLE } from '../data.js';

const start = { retried: false, delivered: false, toast: '' };
const steps = [
  { at: 600, point: 'stats', say: 'How the sending went' },
  { at: 2400, point: 'row-sean', say: 'This one failed, with the reason under it', side: 'above' },
  { at: 4300, tap: 'retry-sean', say: 'Try it again', side: 'left', set: { retried: true, toast: 'Retrying' } },
  { at: 5700, set: { delivered: true } },
  { at: 5800, point: 'stats', say: 'All seven sent', side: 'below' },
  { at: 7500, point: 'dup', say: 'Duplicate starts the next one from this', side: 'left' },
];

export default function BroadcastDetail() {
  return (
    <Scene width={560} height={470} length={10000} start={start} steps={steps}
      label="The page of the sent broadcast Election Info. Its numbers show 7 recipients, 6 sent and 1 failed. In the email log, the email to Sean C. failed with the reason underneath. Clicking its retry button sends it again, and Sent becomes 7. Duplicate at the top starts a new broadcast from this one.">
      {(s) => {
        const seanStatus = s.delivered ? 'sent' : s.retried ? 'queued' : 'failed';
        const rows = [...PEOPLE].reverse().slice(0, 5).map((p) => ({
          id: p.id,
          when: '2026-08-16',
          name: p.name,
          email: p.email,
          status: p.id === 'sean' ? seanStatus : 'sent',
          error: p.id === 'sean' && seanStatus === 'failed' ? 'Recipient mailbox full' : '',
        }));
        return (
          <Screen bare>
            <PageHead title="Election Info" badge={<Badge tone="green" dot>Sent</Badge>} sub="Election Info"
              actions={(
                <>
                  <span className="btn"><Icon name="eye" size={14} /> Preview</span>
                  <span className="btn" data-t="dup"><Icon name="copy" size={14} /> Duplicate</span>
                </>
              )} />
            <div data-t="stats">
              <StatGrid>
                <Stat label="Recipients" value={7} sub="emailed this broadcast" />
                <Stat label="Sent" value={s.delivered ? 7 : 6} tone="ok" sub="delivered / simulated" />
                <Stat label="Queued" value={s.retried && !s.delivered ? 1 : 0} tone="warn" sub="waiting to send" />
                <Stat label="Failed" value={s.retried ? 0 : 1} tone="bad" sub={s.retried ? 'none' : 'retry from the log below'} />
              </StatGrid>
            </div>
            <LogCard title="Email log" rows={rows} total={7} />
            <Toast text={s.toast} />
          </Screen>
        );
      }}
    </Scene>
  );
}
