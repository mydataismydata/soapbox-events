import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Area, Check, Input, Modal, PageHead, Screen, Toast } from '../mock.jsx';
import { Card, Field, Icon } from '../../ui.jsx';
import { PEOPLE } from '../data.js';

const start = { modal: false, first: '', last: '', email: '', focus: '', added: false, toast: '' };
const steps = [
  { at: 600, tap: 'add', say: 'Add contact', side: 'left', set: { modal: true, focus: 'first' } },
  ...typing(1600, 'first', 'Sean', 80),
  { at: 2100, set: { focus: 'last' } },
  ...typing(2200, 'last', 'C.', 80),
  { at: 2600, set: { focus: 'email' } },
  ...typing(2700, 'email', 'seanc@example.com', 45),
  { at: 3800, point: 'email', say: 'The address invitations go to' },
  { at: 5500, tap: 'save', say: null, set: { modal: false, added: true, focus: '', toast: 'Contact added' } },
  { at: 6500, point: 'row-sean', say: 'Ready to invite', side: 'above' },
];

export default function ContactsAdd() {
  return (
    <Scene width={560} height={544} length={9500} start={start} steps={steps}
      label="Adding a contact. Add contact opens New contact, where the first name Sean, last name C. and email seanc@example.com are typed in. Save adds Sean C. to the contact list.">
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
