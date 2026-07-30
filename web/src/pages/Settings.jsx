import React, { useEffect, useState } from 'react';
import { api, timeAgo } from '../api.js';
import { useAuth } from '../App.jsx';
import { Spinner, Modal, Field, useToast, Badge, Banner, Card, Icon } from '../ui.jsx';

function SendingCard({ data, isAdmin, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    sender_name: data.settings.sender_name,
    sender_email: data.settings.sender_email,
    reply_to: data.settings.reply_to,
    broadcast_sender_split: data.settings.broadcast_sender_split,
    broadcast_sender_name: data.settings.broadcast_sender_name,
    broadcast_sender_email: data.settings.broadcast_sender_email,
    broadcast_reply_to: data.settings.broadcast_reply_to,
    smtp2go_api_key: undefined,
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [quota, setQuota] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/quota').then(setQuota).catch(() => {});
  }, []);

  async function save() {
    // A split with no address of its own would silently fall back to the
    // default sender — better to say so than to look like it took effect.
    if (form.broadcast_sender_split && !form.broadcast_sender_email.trim()) {
      toast('Give broadcasts a sender email, or turn the split off.', 'bad');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        sender_name: form.sender_name,
        sender_email: form.sender_email,
        reply_to: form.reply_to,
        broadcast_sender_split: form.broadcast_sender_split,
        broadcast_sender_name: form.broadcast_sender_name,
        broadcast_sender_email: form.broadcast_sender_email,
        broadcast_reply_to: form.broadcast_reply_to,
      };
      if (form.smtp2go_api_key !== undefined) payload.smtp2go_api_key = form.smtp2go_api_key;
      await api.put('/api/settings', payload);
      toast('Sending settings saved');
      onSaved();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const simulation = quota && quota.mode === 'simulation';

  return (
    <Card title="Email sending">
      {quota ? (
        simulation ? (
          <Banner tone="warn">
            <strong>Simulation mode.</strong> No SMTP2GO API key is configured, so emails are rendered
            and logged (viewable in each event's email log) but not delivered. Add a key below or set
            <code> SMTP2GO_API_KEY</code> on the server to go live.
          </Banner>
        ) : (
          <Banner tone="ok">
            <strong>Live sending via SMTP2GO.</strong>{' '}
            {quota.error
              ? `Quota lookup failed: ${quota.error}`
              : `${quota.used} of ${quota.max} emails used this cycle — ${quota.remaining} remaining` +
                (quota.cycle_end ? ` (cycle ends ${quota.cycle_end.slice(0, 10)})` : '')}
            {' '}· {quota.month_emails} sent by this organization this month.
          </Banner>
        )
      ) : null}

      <div className="field-row">
        <Field label="Sender name" hint="The “from” name guests see.">
          <input value={form.sender_name} maxLength={200} disabled={!isAdmin}
            onChange={(e) => set({ sender_name: e.target.value })} />
        </Field>
        <Field label="Sender email"
          hint={form.broadcast_sender_split
            ? 'Used for events. Must belong to a domain verified in SMTP2GO.'
            : 'Must belong to a domain verified in SMTP2GO.'}>
          <input type="email" value={form.sender_email} maxLength={254} disabled={!isAdmin}
            onChange={(e) => set({ sender_email: e.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Reply-to (optional)">
          <input type="email" value={form.reply_to} maxLength={254} disabled={!isAdmin}
            onChange={(e) => set({ reply_to: e.target.value })} />
        </Field>
        <Field label="SMTP2GO API key"
          hint={data.settings.smtp2go_key_set
            ? 'A key is saved for this organization. Enter a new one to replace it, or save an empty field to remove it.'
            : data.env.smtp2go_key_present
              ? 'Using the server-wide key. A key entered here overrides it for this organization.'
              : 'Starts with “api-”. Created in the SMTP2GO dashboard under Settings → API Keys.'}>
          <input type="password" placeholder={data.settings.smtp2go_key_set ? '••••••••••••' : 'api-…'}
            disabled={!isAdmin}
            onChange={(e) => set({ smtp2go_api_key: e.target.value })} />
        </Field>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={form.broadcast_sender_split} disabled={!isAdmin}
          onChange={(e) => set({ broadcast_sender_split: e.target.checked })} />
        <span><span className="cb-label">Send broadcasts from a different address</span>
          <div className="cb-sub">
            Off, everything goes out from the address above — event invitations and broadcasts alike.
            On, broadcasts use their own identity, so a newsletter needn't come from the address
            that invites people to meetings.
          </div></span>
      </label>

      {form.broadcast_sender_split ? (
        <>
          <div className="field-row">
            <Field label="Broadcast sender name" hint="Leave blank to reuse the sender name above.">
              <input value={form.broadcast_sender_name} maxLength={200} disabled={!isAdmin}
                onChange={(e) => set({ broadcast_sender_name: e.target.value })} />
            </Field>
            <Field label="Broadcast sender email" required
              hint="Also has to be on a domain verified in SMTP2GO.">
              <input type="email" value={form.broadcast_sender_email} maxLength={254} disabled={!isAdmin}
                onChange={(e) => set({ broadcast_sender_email: e.target.value })} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Broadcast reply-to (optional)"
              hint="Blank sends replies to the broadcast address itself. The reply-to above never applies to broadcasts.">
              <input type="email" value={form.broadcast_reply_to} maxLength={254} disabled={!isAdmin}
                onChange={(e) => set({ broadcast_reply_to: e.target.value })} />
            </Field>
          </div>
        </>
      ) : null}

      {isAdmin ? (
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save sending settings'}
        </button>
      ) : <p className="small muted">Only administrators can change sending settings.</p>}
    </Card>
  );
}

function UsersCard() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [modal, setModal] = useState(null); // {type:'new'} | {type:'password', value, name}
  const [form, setForm] = useState({ name: '', email: '', role: 'member' });
  const [busy, setBusy] = useState(false);

  async function load() {
    setUsers((await api.get('/api/users')).users);
  }
  useEffect(() => { load().catch(() => setUsers([])); }, []);

  if (!users) return <div className="card card-pad"><Spinner /></div>;

  return (
    <Card flush title="Team members"
      actions={
        <button className="btn btn-sm btn-primary" onClick={() => {
          setForm({ name: '', email: '', role: 'member' });
          setModal({ type: 'new' });
        }}><Icon name="plus" size={14} /> Add user</button>
      }>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th>
            <th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="t-main">{u.name}</span>
                    {u.id === me.id ? <span className="muted">(you)</span> : null}
                    {!u.active ? <Badge tone="gray" dot>Deactivated</Badge> : null}
                  </div>
                </td>
                <td className="t-sub">{u.email}</td>
                <td>{u.role === 'admin' ? <Badge tone="indigo">Admin</Badge> : <Badge>Member</Badge>}</td>
                <td className="t-sub">{u.last_login_at ? timeAgo(u.last_login_at) : 'never'}</td>
                <td>
                  <div className="t-actions">
                    {u.id !== me.id ? (
                      <>
                        <button className="btn btn-sm" disabled={busy} onClick={async () => {
                          try {
                            await api.put(`/api/users/${u.id}`, { role: u.role === 'admin' ? 'member' : 'admin' });
                            toast('Role updated'); load();
                          } catch (err) { toast(err.message, 'bad'); }
                        }}>{u.role === 'admin' ? 'Make member' : 'Make admin'}</button>
                        <button className="btn btn-sm" disabled={busy} onClick={async () => {
                          try {
                            const d = await api.post(`/api/users/${u.id}/reset-password`);
                            setModal({ type: 'password', value: d.temp_password, name: u.name });
                          } catch (err) { toast(err.message, 'bad'); }
                        }}>Reset password</button>
                        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={async () => {
                          try {
                            await api.put(`/api/users/${u.id}`, { active: !u.active });
                            toast(u.active ? 'User deactivated' : 'User reactivated'); load();
                          } catch (err) { toast(err.message, 'bad'); }
                        }}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.type === 'new' ? (
        <Modal title="Add a team member" onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !form.name.trim() || !form.email.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const d = await api.post('/api/users', form);
                    setModal({ type: 'password', value: d.temp_password, name: form.name });
                    load();
                  } catch (err) { toast(err.message, 'bad'); }
                  finally { setBusy(false); }
                }}>Create user</button>
            </>
          }>
          <Field label="Name" required><input value={form.name} autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email" required><input type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="member">Member — full access except settings & users</option>
              <option value="admin">Admin — everything</option>
            </select>
          </Field>
        </Modal>
      ) : null}

      {modal?.type === 'password' ? (
        <Modal title={`Temporary password for ${modal.name}`} onClose={() => setModal(null)}
          footer={<button className="btn btn-primary" onClick={() => setModal(null)}>Done</button>}>
          <p style={{ marginTop: 0 }}>Share this with them securely — it is shown only once:</p>
          <div className="password-reveal">{modal.value}</div>
          <button className="btn btn-sm mt" onClick={async () => {
            try { await navigator.clipboard.writeText(modal.value); toast('Copied'); }
            catch { toast('Could not copy', 'bad'); }
          }}><Icon name="copy" size={14} /> Copy to clipboard</button>
        </Modal>
      ) : null}
    </Card>
  );
}

function AccountCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Your account">
      <div className="field-row">
        <Field label="Current password">
          <input type="password" value={current} autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 10 characters.">
          <input type="password" value={next} autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <button className="btn" disabled={busy || next.length < 10 || !current}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post('/api/account/password', { current, next });
            toast('Password changed');
            setCurrent(''); setNext('');
          } catch (err) { toast(err.message, 'bad'); }
          finally { setBusy(false); }
        }}>Change password</button>
    </Card>
  );
}

export default function Settings() {
  const toast = useToast();
  const { user, org, refresh } = useAuth();
  const isAdmin = user.role === 'admin';
  const [data, setData] = useState(null);
  const [orgName, setOrgName] = useState(org.name);
  const [defStart, setDefStart] = useState('');
  const [defEnd, setDefEnd] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api.get('/api/settings');
    setData(d);
    setOrgName(d.org.name);
    setDefStart(d.settings.default_start_time || '');
    setDefEnd(d.settings.default_end_time || '');
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'bad')); }, []);

  if (!data) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Organization “{data.org.name}” · sign-in slug <code>{data.org.slug}</code></p>
        </div>
      </div>

      <Card title="Organization">
        <div className="field-row">
          <Field label="Display name" hint="Shown to guests on event pages and in email footers.">
            <input value={orgName} maxLength={200} disabled={!isAdmin}
              onChange={(e) => setOrgName(e.target.value)} />
          </Field>
          <Field label="Server address" hint="Set BASE_URL in .env — links in emails are built from it.">
            <input value={data.env.base_url} disabled />
          </Field>
        </div>
        {isAdmin ? (
          <button className="btn btn-primary" disabled={busy || !orgName.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put('/api/settings', { org_name: orgName });
                toast('Organization updated');
                await refresh();
                await load();
              } catch (err) { toast(err.message, 'bad'); }
              finally { setBusy(false); }
            }}>Save</button>
        ) : null}
      </Card>

      <Card title="Event defaults">
        <p className="small muted" style={{ marginTop: 0 }}>
          Prefilled when you create a new event. You can still change the times on any event.
        </p>
        <div className="field-row">
          <Field label="Default start time">
            <input type="time" value={defStart} disabled={!isAdmin}
              onChange={(e) => setDefStart(e.target.value)} />
          </Field>
          <Field label="Default end time">
            <input type="time" value={defEnd} disabled={!isAdmin}
              onChange={(e) => setDefEnd(e.target.value)} />
          </Field>
        </div>
        {isAdmin ? (
          <button className="btn btn-primary" disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put('/api/settings', { default_start_time: defStart, default_end_time: defEnd });
                toast('Event defaults saved');
                await load();
              } catch (err) { toast(err.message, 'bad'); }
              finally { setBusy(false); }
            }}>Save</button>
        ) : <p className="small muted">Only administrators can change event defaults.</p>}
      </Card>

      <SendingCard data={data} isAdmin={isAdmin} onSaved={load} />

      {isAdmin ? <UsersCard /> : null}

      <AccountCard />

      <Card title="Export your data">
        <p className="small muted" style={{ marginTop: 0 }}>
          Everything is yours, always. CSVs open in any spreadsheet; the JSON backup contains all
          records. For a byte-perfect backup of every organization, copy the server's <code>data/</code> directory.
        </p>
        <div className="row">
          {[
            ['contacts.csv', 'Contacts CSV'],
            ['groups.csv', 'Groups CSV'],
            ['venues.csv', 'Venues CSV'],
            ['events.csv', 'Events CSV'],
            ['broadcasts.csv', 'Broadcasts CSV'],
            ['emails.csv', 'Email log CSV'],
            ['backup.json', 'Full JSON backup'],
          ].map(([file, label]) => (
            <a key={file} className="btn btn-sm" href={`/api/export/${file}`}>
              <Icon name="download" size={14} /> {label}
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
