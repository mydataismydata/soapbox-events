import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  Spinner, Modal, ConfirmModal, Empty, Field, useToast, Badge, Banner, Card,
  IconButton, Icon, SortTh, useSort, sortRows,
} from '../ui.jsx';

// Contacts arriving from a CSV or a guest list may only ever have had a single
// name, so the form falls back to splitting it the same way the server does.
function nameParts(contact) {
  if (!contact) return { first_name: '', last_name: '' };
  if (contact.first_name || contact.last_name) {
    return { first_name: contact.first_name || '', last_name: contact.last_name || '' };
  }
  const clean = String(contact.name || '').trim().replace(/\s+/g, ' ');
  const cut = clean.indexOf(' ');
  return cut === -1
    ? { first_name: clean, last_name: '' }
    : { first_name: clean.slice(0, cut), last_name: clean.slice(cut + 1) };
}

const CONTACT_SORTS = {
  first_name: (c) => (c.first_name || c.name || '').toLowerCase(),
  last_name: (c) => (c.last_name || '').toLowerCase(),
  email: (c) => (c.email || '').toLowerCase(),
  phone: (c) => c.phone || '',
};

function ContactModal({ contact, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    ...nameParts(contact),
    email: contact?.email || '', phone: contact?.phone || '', notes: contact?.notes || '',
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
          <button className="btn btn-primary" onClick={save}
            disabled={busy || !(form.first_name.trim() || form.last_name.trim())}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }>
      {/* Either one on its own is enough — plenty of contacts are a single
          word ("Mom", "Reception") and refusing them helps nobody. */}
      <div className="field-row">
        <Field label="First name" required>
          <input value={form.first_name} maxLength={100} autoFocus
            onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name">
          <input value={form.last_name} maxLength={100}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
      </div>
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
        Columns recognized (any order, case-insensitive): <code>first name</code> + <code>last name</code>
        {' '}(or a single <code>name</code>, split at the first space), <code>email</code>, <code>phone</code>,
        {' '}<code>notes</code>. Rows whose email already exists are skipped, so re-importing is safe.
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
        <textarea rows={9} value={csv} placeholder={'first name,last name,email,phone\nAva,Thompson,ava@example.com,555-0101'}
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
  const [sort, sortBy] = useSort('first_name');

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
    const matched = !needle ? contacts : contacts.filter((c) =>
      c.name.toLowerCase().includes(needle)
      || (c.email || '').toLowerCase().includes(needle)
      || (c.phone || '').includes(needle));
    return sortRows(matched, sort, CONTACT_SORTS);
  }, [contacts, q, sort]);

  const groupName = (id) => groups.find((g) => g.id === id)?.name;

  function toggle(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  // One menu for everything that acts on the selection. Values are namespaced
  // ("group:12") so new actions can be added without colliding.
  function runBulkAction(action) {
    if (!action) return;
    if (action === 'delete') { setModal({ type: 'delete-selected' }); return; }
    if (action.startsWith('group:')) addSelectedToGroup(Number(action.slice(6)));
  }

  async function deleteSelected() {
    setBusy(true);
    try {
      const { deleted } = await api.post('/api/contacts/bulk-delete', {
        contact_ids: Array.from(selected),
      });
      toast(`${deleted} contact${deleted === 1 ? '' : 's'} deleted`);
      setModal(null);
      await load();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
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
                aria-label="Bulk actions for the selected contacts"
                onChange={(e) => { runBulkAction(e.target.value); e.target.value = ''; }}>
                <option value="" disabled>Bulk actions…</option>
                {groups.length ? (
                  <optgroup label="Add to group">
                    {groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
                  </optgroup>
                ) : null}
                <option value="delete">Delete selected…</option>
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
                  <SortTh label="First name" k="first_name" sort={sort} onSort={sortBy} />
                  <SortTh label="Last name" k="last_name" sort={sort} onSort={sortBy} />
                  <SortTh label="Email" k="email" sort={sort} onSort={sortBy} />
                  <SortTh label="Phone" k="phone" sort={sort} onSort={sortBy} />
                  <th>Groups</th>
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
                        <span className="t-main">{nameParts(c).first_name || '—'}</span>
                        {c.unsubscribed_at ? <Badge tone="amber" dot>Unsubscribed</Badge> : null}
                      </div>
                      {c.notes ? <div className="t-sub" title={c.notes}>{c.notes.slice(0, 60)}</div> : null}
                    </td>
                    <td><span className="t-main">{nameParts(c).last_name || '—'}</span></td>
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

      {modal?.type === 'delete-selected' ? (
        <ConfirmModal title={`Delete ${selected.size} contact${selected.size === 1 ? '' : 's'}?`} danger busy={busy}
          message={`This removes ${selected.size === 1 ? 'them' : 'them all'} from your contact list and from every group. Past event RSVPs keep the names they were sent to. It cannot be undone.`}
          confirmLabel={`Delete ${selected.size}`} onClose={() => setModal(null)}
          onConfirm={deleteSelected} />
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
