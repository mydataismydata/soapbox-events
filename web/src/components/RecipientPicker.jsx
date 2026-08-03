import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Field, Banner, Icon } from '../ui.jsx';

// Choose who gets invited: pick whole groups, tick individual contacts, and
// add brand-new people inline. Reports the selection upward on every change.
//
// Picking a group brings its members in, but the ticks stay live: unticking
// someone the group brought records an exclusion rather than being refused,
// so "the Choir, but not Ben" needs no new group. Exclusions are held
// separately from the group, so removing and re-adding the group keeps them —
// and they apply last, wherever the person came from.
export default function RecipientPicker({ value, onChange, alreadyInvited = new Set() }) {
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState('');
  const sel = value; // { contact_ids: [], group_ids: [], new_contacts: [] }

  useEffect(() => {
    api.get('/api/contacts').then((d) => setContacts(d.contacts)).catch(() => {});
    api.get('/api/groups').then((d) => setGroups(d.groups)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((c) =>
      c.name.toLowerCase().includes(needle) || (c.email || '').toLowerCase().includes(needle));
  }, [contacts, q]);

  const groupMemberIds = useMemo(() => {
    const set = new Set();
    for (const c of contacts) {
      for (const gid of c.group_ids || []) {
        if (sel.group_ids.includes(gid)) set.add(c.id);
      }
    }
    return set;
  }, [contacts, sel.group_ids]);

  const excluded = useMemo(() => new Set(sel.excluded_contact_ids || []), [sel.excluded_contact_ids]);

  const effectiveCount = useMemo(() => {
    const ids = new Set(sel.contact_ids);
    for (const id of groupMemberIds) ids.add(id);
    for (const id of excluded) ids.delete(id);
    return ids.size + sel.new_contacts.filter((n) => n.name.trim()).length;
  }, [sel, groupMemberIds, excluded]);

  // One tick per person, whichever way they got here: ticking clears any
  // exclusion and adds them; unticking removes them and, if a group would
  // still bring them back, records the exclusion that keeps them out.
  function toggleContact(id) {
    const on = (sel.contact_ids.includes(id) || groupMemberIds.has(id)) && !excluded.has(id);
    const rest = (sel.excluded_contact_ids || []).filter((x) => x !== id);
    if (on) {
      onChange({
        ...sel,
        contact_ids: sel.contact_ids.filter((x) => x !== id),
        excluded_contact_ids: groupMemberIds.has(id) ? [...rest, id] : rest,
      });
    } else {
      onChange({
        ...sel,
        contact_ids: sel.contact_ids.includes(id) ? sel.contact_ids : [...sel.contact_ids, id],
        excluded_contact_ids: rest,
      });
    }
  }
  function toggleGroup(id) {
    const has = sel.group_ids.includes(id);
    onChange({ ...sel, group_ids: has ? sel.group_ids.filter((x) => x !== id) : [...sel.group_ids, id] });
  }
  function setNew(i, patch) {
    const next = sel.new_contacts.map((n, j) => (j === i ? { ...n, ...patch } : n));
    onChange({ ...sel, new_contacts: next });
  }
  function addNewRow() {
    onChange({ ...sel, new_contacts: [...sel.new_contacts, { name: '', email: '' }] });
  }
  function removeNewRow(i) {
    onChange({ ...sel, new_contacts: sel.new_contacts.filter((_, j) => j !== i) });
  }

  return (
    <div>
      {groups.length > 0 ? (
        <Field label="Invite whole groups">
          <div className="chip-row">
            {groups.map((g) => {
              const active = sel.group_ids.includes(g.id);
              return (
                <button key={g.id} type="button"
                  className={`chip ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleGroup(g.id)}>
                  {active ? <Icon name="check" size={12} strokeWidth={2.4} /> : null}
                  {g.name} ({g.member_count})
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}

      <Field label="Pick individual contacts">
        <div className="search-field">
          <Icon name="search" size={15} />
          <input className="search-input" placeholder="Search contacts…" aria-label="Search contacts"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Field>
      <div style={{
        maxHeight: 260, overflowY: 'auto',
        border: '1px solid var(--c-line)', borderRadius: 'var(--r-md)',
      }}>
        {filtered.length === 0 ? (
          <p className="muted" style={{ padding: '14px 16px' }}>
            {contacts.length === 0 ? 'No contacts yet — add new people below, or import contacts first.' : 'No matches.'}
          </p>
        ) : (
          <table className="table">
            <tbody>
              {filtered.map((c) => {
                const viaGroup = groupMemberIds.has(c.id);
                const isExcluded = excluded.has(c.id);
                const invited = alreadyInvited.has((c.email || '').toLowerCase()) && c.email;
                return (
                  <tr key={c.id}>
                    <td style={{ width: 34 }}>
                      <input type="checkbox"
                        aria-label={`Invite ${c.name}`}
                        checked={(sel.contact_ids.includes(c.id) || viaGroup) && !isExcluded}
                        onChange={() => toggleContact(c.id)} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <span className="t-main">{c.name}</span>
                        {c.unsubscribed_at ? <span className="badge badge-amber">Unsubscribed</span> : null}
                        {invited ? <span className="badge badge-gray">Already invited</span> : null}
                      </div>
                      <div className="t-sub">{c.email || <em>no email — can't receive invitations</em>}</div>
                    </td>
                    <td className="t-sub nowrap" style={{ textAlign: 'right' }}>
                      {viaGroup && isExcluded ? <span className="badge badge-amber">Removed</span>
                        : viaGroup ? 'via group' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Field label="Add new people" hint="They'll also be saved to your contact list.">
        {sel.new_contacts.map((n, i) => (
          <div key={i} className="row" style={{ marginBottom: 8, flexWrap: 'nowrap' }}>
            <input className="input" style={{ flex: 1 }} placeholder="Name" value={n.name}
              aria-label={`Name of new person ${i + 1}`}
              onChange={(e) => setNew(i, { name: e.target.value })} />
            <input className="input" style={{ flex: 1.2 }} placeholder="email@example.com" type="email"
              aria-label={`Email of new person ${i + 1}`} value={n.email}
              onChange={(e) => setNew(i, { email: e.target.value })} />
            <button type="button" className="btn btn-ghost btn-sm btn-icon"
              aria-label="Remove this row" title="Remove this row"
              onClick={() => removeNewRow(i)}><Icon name="x" size={15} /></button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={addNewRow}>
          <Icon name="plus" size={14} /> Add a person
        </button>
      </Field>

      <Banner tone="info" style={{ marginBottom: 0 }}>
        {effectiveCount === 0 ? 'No guests selected yet — you can also skip this and share the event link instead.'
          : `${effectiveCount} guest${effectiveCount === 1 ? '' : 's'} selected.`}
      </Banner>
    </div>
  );
}
