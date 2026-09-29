import React from 'react';
import Scene from '../Scene.jsx';
import { PageHead, Screen } from '../mock.jsx';
import { Badge, Card, Icon } from '../../ui.jsx';
import { BOCC, SENT_BROADCASTS } from '../data.js';

const start = {};
const steps = [
  { at: 600, point: 'drafts', say: 'Drafts wait here until you send them' },
  { at: 2400, point: 'counts-election', say: 'Sent broadcasts, with how many went out', side: 'below' },
  { at: 4300, tap: 'row-election', say: 'Click one to see who it went to' },
  { at: 6200, tap: 'new', say: 'New broadcast starts the wizard', side: 'left' },
];

function Row({ id, title, subject, draft, when }) {
  return (
    <tr data-t={`row-${id}`}>
      <td><span className="t-main">{title}</span><div className="t-sub">{subject}</div></td>
      <td>{draft ? <Badge tone="amber" dot>Draft</Badge> : <Badge tone="green" dot>Sent</Badge>}</td>
      <td className="t-sub" style={{ width: 96 }} data-t={`counts-${id}`}>
        {draft ? 'Not sent' : <span><strong style={{ color: 'var(--c-ok)' }}>7</strong> sent · 7 recipients</span>}
      </td>
      <td className="t-sub nowrap">{when}</td>
      <td style={{ width: 20 }}><Icon name="chevronRight" size={16} className="row-chevron" /></td>
    </tr>
  );
}

export default function BroadcastsList() {
  return (
    <Scene width={560} height={484} length={8800} start={start} steps={steps}
      label="The Broadcasts page. Drafts holds the Board of County Commissioners special meeting notice, not sent yet. Sent holds Election Info from August 16 and County Endorsements from August 2, each sent to 7 recipients. New broadcast at the top right starts the wizard.">
      {() => (
        <Screen tab="Broadcasts">
          <PageHead title="Broadcasts" sub="Email blasts to your contacts and groups — no event, no RSVP."
            actions={<span className="btn btn-primary" data-t="new"><Icon name="plus" size={15} /> New broadcast</span>} />
          <div data-t="drafts">
            <Card flush title="Drafts" sub="1 broadcast">
              <table className="table hs-tight">
                <tbody><Row id="bocc" title={BOCC.title} subject={BOCC.subject} draft when="2h ago" /></tbody>
              </table>
            </Card>
          </div>
          <div data-t="sent" style={{ marginTop: 12 }}>
            <Card flush title="Sent" sub="2 broadcasts">
              <table className="table hs-tight">
                <tbody>
                  {SENT_BROADCASTS.map((b) => <Row key={b.id} id={b.id} title={b.title} subject={b.title} when={b.sent} />)}
                </tbody>
              </table>
            </Card>
          </div>
        </Screen>
      )}
    </Scene>
  );
}
