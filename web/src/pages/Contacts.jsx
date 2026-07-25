import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  Spinner, Modal, ConfirmModal, Empty, Field, useToast, Badge, Banner, Card,
  IconButton, Icon,
} from '../ui.jsx';

function ContactModal({ contact, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: contact?.name || '', email: contact?.email || '',
    phone: contact?.phone || '', notes: contact?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const editing = Boolean(contact?.id);

  async function save() {
    setBusy(true);
    try {
      if (editing) await api.put(`/api/contacts/${contact.id}`, form);
      else await api.post('/api/contacts', form);
      toast(editing ? 'Contact updated' : 'Contact added');
      onSaved();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${contact.name}` : 'New contact'} onClose={onClose}
      footer={
        <>
          {editing ? (
            <button className="btn" style={{ marginRight: 'auto' }} disabled={busy}
              onClick={async () => {
                try {
                  await api.post(`/api/contacts/${contact.id}/unsubscribe`, { on: !contact.unsubscribed_at });
                  toast(contact.unsubscribed_at ? 'Re-subscribed' : 'Marked as unsubscribed');
                  onSaved();
                } catch (err) { toast(err.message, 'bad'); }
              }}>
              {contact.unsubscribed_at ? 'Re-subscribe' : 'Mark unsubscribed'}
            </button>
          ) : null}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }>
      <Field label="Name" required>
        <input value={form.name} maxLength={200} autoFocus
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="field-row">
        <Field label="Email" hint="Needed to receive email invitations.">
          <input type="email" value={form.email} maxLength={254}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input value={form.phone} maxLength={50}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} value={form.notes} maxLength={2000}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  async function readFile(file) {
    if (!file) return;
    setCsv(await file.text());
  }

  async function run() {
    setBusy(true);
    try {
      const r = await api.post('/api/contacts/import', { csv });
      setResult(r);
      toast(`${r.added} contact${r.added === 1 ? '' : 's'} imported`);
      onDone();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import contacts from CSV" size="lg" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
          {!result ? (
            <button className="btn btn-primary" onClick={run} disabled={busy || !csv.trim()}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          ) : null}
        </>
      }>
      <p className="small muted" style={{ marginTop: 0 }}>
        Columns recognized (any order, case-insensitive): <code>name</code> (or <code>first name</code> +
        <code> last name</code>), <code>email</code>, <code>phone</code>, <code>notes</code>.
        Rows whose email already exists are skipped, so re-importing is safe.
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
          onChange={(e) => readFile(e.target.files?.[0])} />
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> Choose CSV file…
        </button>
        <span className="small muted">or paste below</span>
      </div>
      <Field>
        <textarea rows={9} value={csv} placeholder={'name,email,phone\nAva Thompson,ava@example.com,555-0101'}
          onChange={(e) => setCsv(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }} />
      </Field>
      {result ? (
        <Banner tone="ok">
          Imported {result.added}, skipped {result.skipped} duplicate{result.skipped === 1 ? '' : 's'}.
          {result.errors?.length ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {result.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          ) : null}
        </Banner>
      ) : null}
    </Modal>
  );
}

export default function Contacts() {
  const toast = useToast();
  const [contacts, setContacts] = useState(null);
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null); // {type: 'edit'|'new'|'import'|'delete', contact}
  const [busy, setBusy] = useState(false);

  async function load() {
    const [c, g] = await Promise.all([api.get('/api/contacts'), api.get('/api/groups')]);
    setContacts(c.contacts);
    setGroups(g.groups);
    setSelected(new Set());
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'bad')); }, []);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((c) =>
      c.name.toLowerCase().includes(needle)
      || (c.email || '').toLowerCase().includes(needle)
      || (c.phone || '').includes(needle));
  }, [contacts, q]);

  const groupName = (id) => groups.find((g) => g.id === id)?.name;

  function toggle(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  async function addSelectedToGroup(groupId) {
    if (!groupId) return;
    setBusy(true);
    try {
      const detail = await api.get(`/api/groups/${groupId}`);
      const ids = Array.from(new Set([...detail.group.member_ids, ...selected]));
      await api.put(`/api/groups/${groupId}/members`, { contact_ids: ids });
      toast(`Added to ${detail.group.name}`);
      await load();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  if (!contacts) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-sub">
            {contacts.filter((c) => !c.unsubscribed_at).length} people
            {contacts.some((c) => c.unsubscribed_at)
              ? ` · ${contacts.filter((c) => c.unsubscribed_at).length} unsubscribed`
              : ''} · shared across all of your events
          </p>
        </div>
        <div className="head-actions">
          <a className="btn" href="/api/export/contacts.csv">
            <Icon name="download" size={15} /> Export CSV
          </a>
          <button className="btn" onClick={() => setModal({ type: 'import' })}>
            <Icon name="upload" size={15} /> Import CSV
          </button>
          <button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}>
            <Icon name="plus" size={15} /> Add contact
          </button>
        </div>
      </div>

      <Card flush>
        <div className="table-toolbar">
          <div className="search-field" style={{ maxWidth: 320, flex: 1 }}>
            <Icon name="search" size={15} />
            <input className="search-input" placeholder="Search name, email, phone…"
              aria-label="Search contacts"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {selected.size > 0 ? (
            <div className="row">
              <span className="small muted">{selected.size} selected</span>
              <select className="search-input" style={{ width: 190 }} defaultValue="" disabled={busy}
                aria-label="Add selected contacts to a group"
                onChange={(e) => { addSelectedToGroup(Number(e.target.value)); e.target.value = ''; }}>
                <option value="" disabled>Add to group…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          ) : (
            <span className="small muted">{filtered.length} shown</span>
          )}
        </div>
        {filtered.length === 0 ? (
          <Empty icon="user" title={contacts.length === 0 ? 'No contacts yet' : 'No matches'}
            action={contacts.length === 0
              ? <button className="btn btn-primary" onClick={() => setModal({ type: 'import' })}>Import a CSV</button>
              : null}>
            {contacts.length === 0
              ? 'Add people one at a time or import a whole spreadsheet.'
              : 'Try a different name, email or phone number.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" aria-label="Select all shown contacts"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())} />
                  </th>
                  <th>Name</th><th>Email</th><th>Phone</th><th>Groups</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)}
                        aria-label={`Select ${c.name}`} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <span className="t-main">{c.name}</span>
                        {c.unsubscribed_at ? <Badge tone="amber" dot>Unsubscribed</Badge> : null}
                      </div>
                      {c.notes ? <div className="t-sub" title={c.notes}>{c.notes.slice(0, 60)}</div> : null}
                    </td>
                    <td className="t-sub">{c.email || '—'}</td>
                    <td className="t-sub">{c.phone || '—'}</td>
                    <td>
                      <div className="chip-row">
                        {(c.group_ids || []).map((gid) => groupName(gid)
                          ? <span key={gid} className="chip">{groupName(gid)}</span> : null)}
                      </div>
                    </td>
                    <td>
                      <div className="t-actions">
                        <IconButton icon="pencil" label={`Edit ${c.name}`}
                          onClick={() => setModal({ type: 'edit', contact: c })} />
                        <IconButton icon="trash" label={`Delete ${c.name}`} tone="ghost"
                          onClick={() => setModal({ type: 'delete', contact: c })} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal?.type === 'new' || modal?.type === 'edit' ? (
        <ContactModal contact={modal.contact}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }} />
      ) : null}

      {modal?.type === 'import' ? (
        <ImportModal onClose={() => setModal(null)} onDone={load} />
      ) : null}

      {modal?.type === 'delete' ? (
        <ConfirmModal title="Delete contact?" danger busy={busy}
          message={`Delete ${modal.contact.name}? Past event RSVPs keep their name, but they'll disappear from your contact list and groups.`}
          confirmLabel="Delete" onClose={() => setModal(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api.del(`/api/contacts/${modal.contact.id}`);
              toast('Contact deleted');
              setModal(null);
              await load();
            } catch (err) { toast(err.message, 'bad'); }
            finally { setBusy(false); }
          }} />
      ) : null}
    </div>
  );
}
