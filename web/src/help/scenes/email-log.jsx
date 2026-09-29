import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Email, Input, Modal, PageHead, Screen, Select } from '../mock.jsx';
import { Card, EmailStatusBadge, Icon } from '../../ui.jsx';
import { OCTOBER, ORG, SENT_BROADCASTS, VENUE, person } from '../data.js';

// Every email the organization sent, newest first. Filtering by "gloria"
// keeps the three that went to Gloria N.
const ROWS = [
  { id: 'inv-gloria', when: '3d ago', kind: 'Invitation', from: OCTOBER.title, to: 'gloria' },
  { id: 'inv-fred', when: '3d ago', kind: 'Invitation', from: OCTOBER.title, to: 'fred' },
  { id: 'b1-gloria', when: SENT_BROADCASTS[0].sent, kind: 'Broadcast', from: SENT_BROADCASTS[0].title, to: 'gloria' },
  { id: 'b1-fred', when: SENT_BROADCASTS[0].sent, kind: 'Broadcast', from: SENT_BROADCASTS[0].title, to: 'fred' },
  { id: 'b2-gloria', when: SENT_BROADCASTS[1].sent, kind: 'Broadcast', from: SENT_BROADCASTS[1].title, to: 'gloria' },
];

const start = { q: '', focus: false, view: false };
const steps = [
  { at: 600, tap: 'filter', say: 'Find someone’s emails', set: { focus: true } },
  ...typing(1300, 'q', 'gloria', 90),
  { at: 2400, point: 'rows', say: 'Invitations and broadcasts alike', side: 'above' },
  { at: 4100, tap: 'view-inv-gloria', say: null, set: { view: true, focus: false } },
  { at: 5100, point: 'email', say: 'The email exactly as it was sent', side: 'above' },
];

export default function EmailLog() {
  return (
    <Scene width={660} height={470} length={8800} start={start} steps={steps}
      label="The Email log. Typing gloria into Filter by recipient leaves the three emails sent to Gloria N.: the October invitation and two broadcasts. View on the invitation opens it exactly as it was sent.">
      {(s) => {
        const rows = ROWS.filter((r) => !s.q || person(r.to).name.toLowerCase().includes(s.q));
        return (
          <Screen>
            <PageHead title="Email log" sub="Everything sent from this organization, newest first." />
            <Card flush>
              <div className="table-toolbar">
                <div className="row" style={{ gap: 6, flex: 1, minWidth: 0, flexWrap: 'nowrap' }}>
                  <div className="search-field" style={{ flex: 1, minWidth: 0 }}>
                    <Icon name="search" size={15} />
                    <Input t="filter" value={s.q} placeholder="Filter by recipient…" focus={s.focus} style={{ paddingLeft: 31 }} />
                  </div>
                  <Select value="All types" style={{ width: 118 }} />
                  <Select value="Any status" style={{ width: 112 }} />
                </div>
                <span className="small muted log-count">1–{rows.length} of {s.q ? rows.length : 21}</span>
              </div>
              <table className="table hs-tight" data-t="rows">
                <thead>
                  <tr><th>When</th><th>Type</th><th>Event / broadcast</th><th>To</th><th>Status</th>
                    <th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const p = person(r.to);
                    return (
                      <tr key={r.id}>
                        <td className="t-sub nowrap">{r.when}</td>
                        <td><span className="badge badge-gray">{r.kind}</span></td>
                        <td style={{ maxWidth: 150 }}><span className="t-main">{r.from}</span></td>
                        <td><div className="t-main">{p.name}</div><div className="t-sub">{p.email}</div></td>
                        <td><EmailStatusBadge status="sent" /></td>
                        <td><span className="btn btn-sm" data-t={`view-${r.id}`}>View</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            {s.view ? (
              <Modal title={`You're invited: ${OCTOBER.title}`} size="lg">
                <p className="small muted" style={{ margin: '0 0 8px' }}>
                  To glorian@example.com · Invitation · sent · {OCTOBER.title}
                </p>
                <div data-t="email">
                  <Email greeting="Hi Gloria,"
                    paragraphs={[`Join us for ${OCTOBER.title} on Monday, October 19, 2026.`]}
                    details={[['When', 'Monday, October 19, 2026 · 5:30 PM – 7:00 PM'], ['Where', VENUE.name], ['Host', ORG]]}
                    rsvp
                    footer={`This email was sent to glorian@example.com by ${ORG}.`} />
                </div>
              </Modal>
            ) : null}
          </Screen>
        );
      }}
    </Scene>
  );
}
