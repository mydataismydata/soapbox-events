import React from 'react';
import Scene from '../Scene.jsx';
import { Check, Input, PageHead, Screen, Select, Toast } from '../mock.jsx';
import { Card, Icon } from '../../ui.jsx';
import { EXECUTIVE, PEOPLE } from '../data.js';

const start = { sel: [], bulkOpen: false, done: false, toast: '' };
const steps = [
  { at: 600, tap: 'cb-fred', say: 'Tick the people', side: 'right', set: { sel: ['fred'] } },
  { at: 1500, tap: 'cb-joe', set: { sel: ['fred', 'joe'] } },
  { at: 2300, tap: 'cb-mike', set: { sel: ['fred', 'joe', 'mike'] } },
  { at: 3400, tap: 'bulk', say: 'Bulk actions', side: 'left', set: { bulkOpen: true } },
  { at: 4600, tap: 'opt-exec', say: null, set: { bulkOpen: false, done: true, sel: [], toast: 'Added to Executive team' } },
  { at: 5700, point: 'groups-joe', say: 'Their groups show here', side: 'left' },
];

const BULK = [
  ['Add to group', 'g', true],
  ['All members', 'opt-all'],
  ['Executive team', 'opt-exec'],
  ['Delete selected…', 'opt-delete'],
];

export default function ContactsGroup() {
  return (
    <Scene width={560} height={474} length={8800} start={start} steps={steps}
      label="Putting people in a group from Contacts. Fred P., Joe S. and Mike F. are ticked, then Bulk actions, Add to group, Executive team. Each of the three then shows Executive team in the Groups column.">
      {(s) => (
        <Screen tab="Contacts">
          <PageHead title="Contacts" sub="7 people · shared across all of your events" />
          <Card flush>
            <div className="table-toolbar">
              <div className="search-field" style={{ flex: 1, maxWidth: 220 }}>
                <Icon name="search" size={15} />
                <Input placeholder="Search name, email, phone…" style={{ paddingLeft: 31 }} />
              </div>
              {s.sel.length ? (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className="small muted">{s.sel.length} selected</span>
                  <Select t="bulk" placeholder="Bulk actions…" open={s.bulkOpen} hi="opt-exec" options={BULK}
                    style={{ width: 170 }} />
                </div>
              ) : <span className="small muted">7 shown</span>}
            </div>
            <table className="table hs-tight">
              <thead>
                <tr><th style={{ width: 30 }}><Check on={false} /></th><th>First name</th><th>Last name</th><th>Groups</th></tr>
              </thead>
              <tbody>
                {PEOPLE.map((p) => (
                  <tr key={p.id}>
                    <td><Check on={s.sel.includes(p.id)} t={`cb-${p.id}`} /></td>
                    <td><span className="t-main">{p.first}</span></td>
                    <td><span className="t-main">{p.last}</span></td>
                    <td>
                      <div className="chip-row" data-t={`groups-${p.id}`}>
                        <span className="chip">All members</span>
                        {s.done && EXECUTIVE.includes(p.id) ? <span className="chip hs-new">Executive team</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
