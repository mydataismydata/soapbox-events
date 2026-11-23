import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Area, Check, Input, Modal, PageHead, Screen, Toast } from '../mock.jsx';
import { Card, Field, Icon } from '../../ui.jsx';
import { GROUPS, PEOPLE } from '../data.js';

const start = {
  modal: false, first: '', last: '', email: '', focus: '', groups: [], groupsOpen: false,
  added: false, toast: '',
};
const steps = [
  { at: 600, tap: 'add', say: 'Add contact', side: 'left', set: { modal: true, focus: 'first' } },
  ...typing(1600, 'first', 'Sean', 80),
  { at: 2100, set: { focus: 'last' } },
  ...typing(2200, 'last', 'C.', 80),
  { at: 2600, set: { focus: 'email' } },
  ...typing(2700, 'email', 'seanc@example.com', 45),
  { at: 3800, point: 'email', say: 'The address invitations go to' },
  { at: 5400, tap: 'groups', say: 'Pick their groups', side: 'above', set: { focus: '', groupsOpen: true } },
  { at: 6400, tap: 'opt-all', say: null, set: { groups: ['all'] } },
  { at: 7300, tap: 'groups', set: { groupsOpen: false } },
  { at: 8300, tap: 'save', set: { modal: false, added: true, toast: 'Contact added' } },
  { at: 9300, point: 'row-sean', say: 'Ready to invite', side: 'above' },
];

export default function ContactsAdd() {
  return (
    <Scene width={560} height={620} length={12300} start={start} steps={steps}
      label="Adding a contact. Add contact opens New contact, where the first name Sean, last name C. and email seanc@example.com are typed in. The Groups drop-down opens and All members is ticked. Save adds Sean C. to the contact list.">
      {(s) => {
        const people = PEOPLE.filter((p) => s.added || p.id !== 'sean');
        return (
          <Screen tab="Contacts">
            <PageHead title="Contacts" sub={`${people.length} people · shared across all of your events`}
              actions={(
                <>
                  <span className="btn"><Icon name="upload" size={15} /> Import CSV</span>
                  <span className="btn btn-primary" data-t="add"><Icon name="plus" size={15} /> Add contact</span>
                </>
              )} />
            <Card flush>
              <table className="table hs-tight">
                <thead>
                  <tr><th style={{ width: 30 }}><Check on={false} /></th><th>First name</th><th>Last name</th><th>Email</th>
                    <th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} data-t={`row-${p.id}`} className={p.id === 'sean' ? 'hs-new' : undefined}>
                      <td><Check on={false} /></td>
                      <td><span className="t-main">{p.first}</span></td>
                      <td><span className="t-main">{p.last}</span></td>
                      <td className="t-sub">
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <span>{p.email}</span>
                          <span className="copy-btn"><Icon name="copy" size={14} /></span>
                        </div>
                      </td>
                      <td>
                        <div className="t-actions">
                          <span className="btn btn-icon btn-sm"><Icon name="pencil" size={15} /></span>
                          <span className="btn btn-icon btn-sm btn-ghost"><Icon name="trash" size={15} /></span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {s.modal ? (
              <Modal title="New contact"
                footer={(
                  <>
                    <span className="btn">Cancel</span>
                    <span className="btn btn-primary" data-t="save">Save</span>
                  </>
                )}>
                <div className="field-row">
                  <Field label="First name" required><Input value={s.first} focus={s.focus === 'first'} /></Field>
                  <Field label="Last name"><Input value={s.last} focus={s.focus === 'last'} /></Field>
                </div>
                <div className="field-row">
                  <Field label="Email" hint="Needed to receive email invitations.">
                    <Input t="email" value={s.email} focus={s.focus === 'email'} />
                  </Field>
                  <Field label="Phone"><Input /></Field>
                </div>
                <Field label="Groups">
                  <div className="ms">
                    <div className={`input ms-btn${s.groupsOpen ? ' is-open' : ''}`} data-t="groups">
                      <span className="ms-picked">
                        {s.groups.length
                          ? GROUPS.filter((g) => s.groups.includes(g.id))
                            .map((g) => <span key={g.id} className="chip">{g.name}</span>)
                          : <span className="ms-ph">Not in any group</span>}
                      </span>
                      <Icon className="ms-caret" name="chevronDown" size={16} />
                    </div>
                    {s.groupsOpen ? (
                      <div className="ms-list">
                        {GROUPS.map((g) => (
                          <span key={g.id} className="ms-opt" data-t={`opt-${g.id}`}>
                            <Check on={s.groups.includes(g.id)} />
                            <span className="ms-label">{g.name}</span>
                            <span className="ms-meta">{g.members.filter((m) => m !== 'sean').length}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Field>
                <Field label="Notes"><Area rows={2} /></Field>
              </Modal>
            ) : null}
            <Toast text={s.toast} />
          </Screen>
        );
      }}
    </Scene>
  );
}
