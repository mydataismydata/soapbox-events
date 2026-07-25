import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Spinner, Modal, ConfirmModal, Empty, Field, useToast, Card, Icon } from '../ui.jsx';

function GroupModal({ group, contacts, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(group?.id);
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [memberIds, setMemberIds] = useState(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    if (!editing) return;
    api.get(`/api/groups/${group.id}`).then((d) => {
      setMemberIds(new Set(d.group.member_ids));
      setLoaded(true);
    }).catch((e) => toast(e.message, 'bad'));
  }, [editing, group?.id]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(needle)
      || (c.email || '').toLowerCase().includes(needle));
  }, [contacts, q]);

  // "Select all" acts on whatever is currently shown, so searching first and
  // then selecting all adds just those matches.
  const allShownSelected = filtered.length > 0 && filtered.every((c) => memberIds.has(c.id));
  function toggleAllShown() {
    const next = new Set(memberIds);
    for (const c of filtered) allShownSelected ? next.delete(c.id) : next.add(c.id);
    setMemberIds(next);
  }

  async function save() {
    setBusy(true);
    try {
      let id = group?.id;
      if (editing) {
        await api.put(`/api/groups/${id}`, { name, description });
      } else {
        const d = await api.post('/api/groups', { name, description });
        id = d.group.id;
      }
      await api.put(`/api/groups/${id}/members`, { contact_ids: Array.from(memberIds) });
      toast(editing ? 'Group updated' : 'Group created');
      onSaved();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${group.name}` : 'New group'} size="lg" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim() || !loaded}>
            {busy ? 'Saving…' : 'Save group'}
          </button>
        </>
      }>
      <div className="field-row">
        <Field label="Group name" required>
          <input value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <Field label={`Members (${memberIds.size})`}>
        <div className="search-field" style={{ marginBottom: 8 }}>
          <Icon name="search" size={15} />
          <input className="search-input" placeholder="Search contacts…" aria-label="Search contacts"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loaded && filtered.length > 0 ? (
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="small muted">
              {q.trim() ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : `${filtered.length} contact${filtered.length === 1 ? '' : 's'}`}
            </span>
            <button type="button" className="btn btn-sm" onClick={toggleAllShown}>
              {allShownSelected ? 'Deselect all' : q.trim() ? 'Select all matches' : 'Select all'}
            </button>
          </div>
        ) : null}
        <div style={{
          maxHeight: 300, overflowY: 'auto',
          border: '1px solid var(--c-line)', borderRadius: 'var(--r-md)',
        }}>
          {!loaded ? <Spinner /> : filtered.length === 0 ? (
            <p className="muted" style={{ padding: 14 }}>No contacts found.</p>
          ) : (
            <table className="table">
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td style={{ width: 34 }}>
                      <input type="checkbox" checked={memberIds.has(c.id)}
                        aria-label={`Include ${c.name}`}
                        onChange={() => {
                          const next = new Set(memberIds);
                          next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                          setMemberIds(next);
                        }} />
                    </td>
                    <td><span className="t-main">{c.name}</span>
                      <div className="t-sub">{c.email || 'no email'}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Field>
    </Modal>
  );
}

export default function Groups() {
  const toast = useToast();
  const [groups, setGroups] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [g, c] = await Promise.all([api.get('/api/groups'), api.get('/api/contacts')]);
    setGroups(g.groups);
    setContacts(c.contacts);
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'bad')); }, []);

  if (!groups) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Groups</h1>
          <p className="page-sub">Reusable audiences — invite a whole group in one click.</p>
        </div>
        <div className="head-actions">
          <a className="btn" href="/api/export/groups.csv">
            <Icon name="download" size={15} /> Export CSV
          </a>
          <button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}>
            <Icon name="plus" size={15} /> New group
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <Card flush>
          <Empty icon="users" title="No groups yet"
            action={<button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}>Create a group</button>}>
            Groups like “Choir”, “Volunteers”, or “Board” make inviting the same people again painless.
          </Empty>
        </Card>
      ) : (
        <div className="grid3">
          {groups.map((g) => (
            <div key={g.id} className="card card-pad">
              <div className="spread">
                <h3 style={{ margin: 0, fontSize: 14 }}>{g.name}</h3>
                <span className="badge badge-gray">{g.member_count} member{g.member_count === 1 ? '' : 's'}</span>
              </div>
              {g.description ? <p className="small muted" style={{ margin: '6px 0 0' }}>{g.description}</p> : null}
              <div className="row mt">
                <button className="btn btn-sm" onClick={() => setModal({ type: 'edit', group: g })}>
                  <Icon name="pencil" size={14} /> Edit members
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'delete', group: g })}>
                  <Icon name="trash" size={14} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.type === 'new' || modal?.type === 'edit' ? (
        <GroupModal group={modal.group} contacts={contacts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }} />
      ) : null}

      {modal?.type === 'delete' ? (
        <ConfirmModal title="Delete group?" danger busy={busy}
          message={`Delete "${modal.group.name}"? The contacts themselves are kept.`}
          confirmLabel="Delete" onClose={() => setModal(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api.del(`/api/groups/${modal.group.id}`);
              toast('Group deleted');
              setModal(null);
              await load();
            } catch (err) { toast(err.message, 'bad'); }
            finally { setBusy(false); }
          }} />
      ) : null}
    </div>
  );
}
