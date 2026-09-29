import React from 'react';
import Scene from '../Scene.jsx';
import { Check, GroupCard, Input, Modal, PageHead, Screen, ScrollList, Toast } from '../mock.jsx';
import { Field, Icon } from '../../ui.jsx';
import { PEOPLE } from '../data.js';

const HINT = 'The ticks only choose whose addresses get copied. Unticking someone doesn’t remove them from the group.';

const start = { modal: false, out: [], toast: '' };
const steps = [
  { at: 600, tap: 'view-all', say: 'View members', set: { modal: true } },
  { at: 2000, point: 'list', say: 'Everyone starts ticked', side: 'right' },
  { at: 3700, tap: 'mc-joe', say: 'Untick anyone to leave them out', side: 'right', set: { out: ['joe'] } },
  { at: 5500, tap: 'copy', say: null, set: { toast: 'Copied 6 emails' } },
  { at: 6200, point: 'copy', say: 'Then paste them into your own email program', side: 'below' },
  { at: 8100, point: 'hint', say: 'Unticking never changes the group', side: 'above' },
];

export default function GroupsCopy() {
  return (
    <Scene width={560} height={492} length={10500} start={start} steps={steps}
      label="Copying a group's email addresses. View members on All members lists all seven people, all ticked. Unticking Joe S. leaves that address out, and Copy emails copies the other 6, separated by commas, to paste into an email program. Unticking never takes anyone out of the group.">
      {(s) => {
        const picked = PEOPLE.filter((p) => !s.out.includes(p.id));
        return (
          <Screen tab="Groups">
            <PageHead title="Groups" sub="Reusable audiences — invite a whole group in one click."
              actions={<span className="btn btn-primary"><Icon name="plus" size={15} /> New group</span>} />
            <div>
              <GroupCard id="all" name="All members" count={7} />
              <GroupCard id="exec" name="Executive team" count={3} />
            </div>
            {s.modal ? (
              <Modal title="All members" size="lg" footer={<span className="btn">Close</span>}>
                <Field label="Members (7)">
                  <div className="search-field" style={{ marginBottom: 8 }}>
                    <Icon name="search" size={15} />
                    <Input placeholder="Search members…" style={{ paddingLeft: 31 }} />
                  </div>
                  <div className="spread" style={{ marginBottom: 6 }}>
                    <span className="small muted">{picked.length} of 7 selected</span>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <span className="btn btn-sm btn-primary" data-t="copy"><Icon name="copy" size={14} /> Copy emails</span>
                      <span className="btn btn-sm">{s.out.length ? 'Select all' : 'Deselect all'}</span>
                    </div>
                  </div>
                  <ScrollList height={188} t="list">
                    <table className="table">
                      <tbody>
                        {PEOPLE.map((p) => (
                          <tr key={p.id}>
                            <td style={{ width: 30 }}><Check on={!s.out.includes(p.id)} t={`mc-${p.id}`} /></td>
                            <td><span className="t-main">{p.name}</span><div className="t-sub">{p.email}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollList>
                  <div className="hint" data-t="hint">{HINT}</div>
                </Field>
              </Modal>
            ) : null}
            <Toast text={s.toast} />
          </Screen>
        );
      }}
    </Scene>
  );
}
