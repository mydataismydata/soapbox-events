import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Spinner, Modal, ConfirmModal, Empty, Field, useToast, Card, Icon, IconButton } from '../ui.jsx';

// Both member dialogs list people alphabetically by name, the order the
// Contacts page opens in, and search on name or email.
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

function matching(list, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((c) => c.name.toLowerCase().includes(needle)
    || (c.email || '').toLowerCase().includes(needle));
}

function toggled(set, id) {
  const next = new Set(set);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}

// Someone an email can actually reach: they have an address and haven't
// unsubscribed.
const reachable = (c) => Boolean(c.email) && !c.unsubscribed_at;

// The Clipboard API only exists on https and localhost. Over plain http (a LAN
// address, say) it is missing, so fall back to the older copy command, which
// still works while it runs inside the click.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const active = document.activeElement;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed; top:0; left:0; opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* reported by the caller */ }
    ta.remove();
    active?.focus?.();
    return ok;
  }
}

function GroupModal({ group, contacts, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(group?.id);
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [memberIds, setMemberIds] = useState(new Set());
  // The membership as it was when the dialog opened. The list sorts on this,
  // not on the live ticks, so a row stays put when it is clicked instead of
  // jumping to the other end of the list.
  const [savedIds, setSavedIds] = useState(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    if (!editing) return;
    api.get(`/api/groups/${group.id}`).then((d) => {
      setMemberIds(new Set(d.group.member_ids));
      setSavedIds(new Set(d.group.member_ids));
      setLoaded(true);
    }).catch((e) => toast(e.message, 'bad'));
  }, [editing, group?.id]);

  // People already in the group first, then everyone else, each alphabetical.
  const ordered = useMemo(() => [...contacts].sort((a, b) =>
    (Number(savedIds.has(b.id)) - Number(savedIds.has(a.id))) || byName(a, b)), [contacts, savedIds]);
  const filtered = useMemo(() => matching(ordered, q), [ordered, q]);

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
                        onChange={() => setMemberIds(toggled(memberIds, c.id))} />
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

// A read-only look at who is in a group, for pasting their addresses into an
// ordinary email client. The ticks only choose which addresses get copied.
// Nothing in this dialog changes the group.
function MembersModal({ group, contacts, onClose }) {
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get(`/api/groups/${group.id}`).then((d) => {
      const ids = new Set(d.group.member_ids);
      const list = contacts.filter((c) => ids.has(c.id)).sort(byName);
      setMembers(list);
      // Everyone starts ticked except people who have unsubscribed. The app's
      // own sends skip them, so a copied list leaves them out too unless
      // someone ticks them on purpose.
      setPicked(new Set(list.filter(reachable).map((c) => c.id)));
    }).catch((e) => toast(e.message, 'bad'));
  }, [group.id]);

  const shown = useMemo(() => matching(members || [], q), [members, q]);

  // One address per ticked person, in list order. Two contacts can share an
  // address, and it only needs pasting once.
  const emails = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of members || []) {
      const key = (c.email || '').toLowerCase();
      if (!picked.has(c.id) || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(c.email);
    }
    return out;
  }, [members, picked]);

  // "Select all" ticks everyone shown who can be emailed. "Deselect all"
  // clears everyone shown, including anyone unsubscribed who was ticked by hand.
  const canSelect = shown.some((c) => reachable(c) && !picked.has(c.id));
  const canDeselect = shown.some((c) => picked.has(c.id));
  function toggleAllShown() {
    const next = new Set(picked);
    for (const c of shown) {
      if (!canSelect) next.delete(c.id);
      else if (reachable(c)) next.add(c.id);
    }
    setPicked(next);
  }

  async function copyEmails() {
    if (await copyText(emails.join(', '))) {
      toast(`Copied ${emails.length} email${emails.length === 1 ? '' : 's'}`);
    } else {
      toast('Could not copy — the browser blocked the clipboard', 'bad');
    }
  }

  const hint = 'The ticks only choose whose addresses get copied. Unticking someone doesn’t remove them from the group.'
    + (members?.some((c) => c.unsubscribed_at) ? ' People who have unsubscribed start unticked.' : '');

  return (
    <Modal title={group.name} size="lg" onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      {group.description ? <p className="muted" style={{ marginTop: 0 }}>{group.description}</p> : null}
      <Field label={`Members (${members ? members.length : group.member_count})`} hint={hint}>
        <div className="search-field" style={{ marginBottom: 8 }}>
          <Icon name="search" size={15} />
          <input className="search-input" placeholder="Search members…" aria-label="Search members"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {members && members.length > 0 ? (
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="small muted">
              {q.trim()
                ? `${shown.length} match${shown.length === 1 ? '' : 'es'} · ${picked.size} selected`
                : `${picked.size} of ${members.length} selected`}
            </span>
            <div className="row">
              <button type="button" className="btn btn-sm btn-primary" onClick={copyEmails}
                disabled={emails.length === 0}>
                <Icon name="copy" size={14} /> Copy emails
              </button>
              <button type="button" className="btn btn-sm" onClick={toggleAllShown}
                disabled={!canSelect && !canDeselect}>
                {canSelect ? (q.trim() ? 'Select all matches' : 'Select all') : 'Deselect all'}
              </button>
            </div>
          </div>
        ) : null}
        <div style={{
          maxHeight: 300, overflowY: 'auto',
          border: '1px solid var(--c-line)', borderRadius: 'var(--r-md)',
        }}>
          {!members ? <Spinner /> : shown.length === 0 ? (
            <p className="muted" style={{ padding: 14 }}>
              {members.length === 0 ? 'No one is in this group yet.' : 'No members match.'}
            </p>
          ) : (
            <table className="table">
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td style={{ width: 34 }}>
                      <input type="checkbox" checked={picked.has(c.id)} disabled={!c.email}
                        aria-label={c.email ? `Copy ${c.name}’s email` : `${c.name} has no email`}
                        onChange={() => setPicked(toggled(picked, c.id))} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <span className="t-main">{c.name}</span>
                        {c.unsubscribed_at ? <span className="badge badge-amber">Unsubscribed</span> : null}
                      </div>
                      <div className="t-sub">{c.email || 'no email'}</div>
                    </td>
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
                <button className="btn btn-sm" onClick={() => setModal({ type: 'view', group: g })}>
                  <Icon name="eye" size={14} /> View members
                </button>
                <button className="btn btn-sm" onClick={() => setModal({ type: 'edit', group: g })}>
                  <Icon name="pencil" size={14} /> Edit members
                </button>
                <IconButton icon="trash" label="Delete group" tone="ghost" style={{ marginLeft: 'auto' }}
                  onClick={() => setModal({ type: 'delete', group: g })} />
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

      {modal?.type === 'view' ? (
        <MembersModal group={modal.group} contacts={contacts} onClose={() => setModal(null)} />
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
