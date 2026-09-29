import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Check, GroupCard, Input, Modal, PageHead, Screen, ScrollList, Toast } from '../mock.jsx';
import { Field, Icon } from '../../ui.jsx';
import { PEOPLE } from '../data.js';

const start = { modal: false, name: '', focus: '', members: [], scroll: 0, created: false, toast: '' };
const steps = [
  { at: 600, tap: 'new', say: 'New group', side: 'left', set: { modal: true, focus: 'name' } },
  ...typing(1500, 'name', 'Executive team', 70),
  { at: 2900, tap: 'm-fred', say: 'Tick the people in it', side: 'right', set: { members: ['fred'], focus: '' } },
  { at: 3700, tap: 'm-joe', set: { members: ['fred', 'joe'] } },
  { at: 4500, set: { scroll: 94 } },
  { at: 5000, tap: 'm-mike', set: { members: ['fred', 'joe', 'mike'] } },
  { at: 6200, tap: 'save', say: null, set: { modal: false, created: true, toast: 'Group created' } },
  { at: 7200, point: 'card-exec', say: 'Invite the whole group in one click' },
];

export default function GroupsNew() {
  return (
    <Scene width={560} height={530} length={10000} start={start} steps={steps}
      label="Making a group. New group opens a window where the name Executive team is typed in and Fred P., Joe S. and Mike F. are ticked. Save group adds an Executive team card with 3 members under All members.">
      {(s) => (
        <Screen tab="Groups">
          <PageHead title="Groups" sub="Reusable audiences — invite a whole group in one click."
            actions={<span className="btn btn-primary" data-t="new"><Icon name="plus" size={15} /> New group</span>} />
          <div>
            <GroupCard id="all" name="All members" count={7} />
            {s.created ? <GroupCard id="exec" name="Executive team" count={3} fresh /> : null}
          </div>
          {s.modal ? (
            <Modal title="New group" size="lg"
              footer={(
                <>
                  <span className="btn">Cancel</span>
                  <span className="btn btn-primary" data-t="save">Save group</span>
                </>
              )}>
              <div className="field-row">
                <Field label="Group name" required><Input value={s.name} focus={s.focus === 'name'} /></Field>
                <Field label="Description"><Input /></Field>
              </div>
              <Field label={`Members (${s.members.length})`}>
                <div className="search-field" style={{ marginBottom: 8 }}>
                  <Icon name="search" size={15} />
                  <Input placeholder="Search contacts…" style={{ paddingLeft: 31 }} />
                </div>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <span className="small muted">7 contacts</span>
                  <span className="btn btn-sm">Select all</span>
                </div>
                <ScrollList height={188} scroll={s.scroll}>
                  <table className="table">
                    <tbody>
                      {PEOPLE.map((p) => (
                        <tr key={p.id}>
                          <td style={{ width: 30 }}><Check on={s.members.includes(p.id)} t={`m-${p.id}`} /></td>
                          <td><span className="t-main">{p.name}</span><div className="t-sub">{p.email}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollList>
              </Field>
            </Modal>
          ) : null}
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
