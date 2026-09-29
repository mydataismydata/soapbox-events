import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Input, Modal, Screen, Select } from '../mock.jsx';
import { Badge, Card, Field, Icon } from '../../ui.jsx';
import { ME } from '../data.js';

const start = { modal: '', name: '', email: '', focus: '', added: false };
const steps = [
  { at: 600, tap: 'add', say: 'Add user', side: 'left', set: { modal: 'new', focus: 'name' } },
  ...typing(1500, 'name', 'Fred P.', 70),
  { at: 2100, set: { focus: 'email' } },
  ...typing(2200, 'email', 'fredp@example.com', 45),
  { at: 3400, point: 'role', say: 'Members can do everything but settings', set: { focus: '' } },
  { at: 5200, tap: 'create', say: null, set: { modal: 'password' } },
  { at: 6100, point: 'password', say: 'Give Fred this. It is shown only once.' },
  { at: 8100, tap: 'done', say: null, set: { modal: '', added: true } },
  { at: 8900, point: 'row-fred', say: 'Fred can sign in now', side: 'above' },
];

export default function SettingsTeam() {
  return (
    <Scene width={560} height={430} length={11500} start={start} steps={steps}
      label="Adding a team member. Add user opens a window where the name Fred P. and the email fredp@example.com are typed in, with the role Member. Create user shows a temporary password, shown only once, to give to Fred. Done adds Fred P. to the team as a member.">
      {(s) => (
        <Screen bare>
          <Card flush title="Team members"
            actions={<span className="btn btn-sm btn-primary" data-t="add"><Icon name="plus" size={14} /> Add user</span>}>
            <table className="table hs-tight">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th></tr></thead>
              <tbody>
                <tr>
                  <td><span className="t-main">{ME.name}</span> <span className="muted">(you)</span></td>
                  <td className="t-sub">{ME.email}</td>
                  <td><Badge tone="indigo">Admin</Badge></td>
                  <td className="t-sub">5m ago</td>
                </tr>
                {s.added ? (
                  <tr className="hs-new" data-t="row-fred">
                    <td><span className="t-main">Fred P.</span></td>
                    <td className="t-sub">fredp@example.com</td>
                    <td><Badge>Member</Badge></td>
                    <td className="t-sub">never</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
          {s.modal === 'new' ? (
            <Modal title="Add a team member"
              footer={(
                <>
                  <span className="btn">Cancel</span>
                  <span className="btn btn-primary" data-t="create">Create user</span>
                </>
              )}>
              <Field label="Name" required><Input value={s.name} focus={s.focus === 'name'} /></Field>
              <Field label="Email" required><Input value={s.email} focus={s.focus === 'email'} /></Field>
              <Field label="Role"><Select t="role" value="Member — full access except settings & users" /></Field>
            </Modal>
          ) : null}
          {s.modal === 'password' ? (
            <Modal title="Temporary password for Fred P."
              footer={<span className="btn btn-primary" data-t="done">Done</span>}>
              <p style={{ marginTop: 0 }}>Share this with them securely — it is shown only once:</p>
              <div className="password-reveal" data-t="password">k7Qm-3VxP-9dTr</div>
              <span className="btn btn-sm mt"><Icon name="copy" size={14} /> Copy to clipboard</span>
            </Modal>
          ) : null}
        </Screen>
      )}
    </Scene>
  );
}
