import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Field, Banner, Icon } from '../ui.jsx';

const NOBODY = new Set();

// Someone an email can reach: they have an address and haven't unsubscribed.
const reachable = (c) => Boolean(c.email) && !c.unsubscribed_at;

// The same picker serves events and broadcasts, but the people it picks are
// called different things in each: an event has guests, a broadcast goes to
// contacts. Nothing else about the two differs, so only the words are keyed.
const WORDING = {
  guest: {
    one: 'guest',
    many: 'guests',
    groups: 'Invite whole groups',
    tick: (name) => `Invite ${name}`,
    empty: 'No guests selected yet — you can also skip this and share the event link instead.',
  },
  contact: {
    one: 'contact',
    many: 'contacts',
    groups: 'Send to whole groups',
    tick: (name) => `Send to ${name}`,
    empty: 'No contacts selected yet — pick a group above, or tick people from the list.',
  },
};

// Choose who gets invited: pick whole groups, tick individual contacts, and
// add brand-new people inline. Reports the selection upward on every change.
//
// Picking a group brings its members in, but the ticks stay live: unticking
// someone the group brought records an exclusion rather than being refused,
// so "the Choir, but not Ben" needs no new group. Exclusions are held
// separately from the group, so removing and re-adding the group keeps them —
// and they apply last, wherever the person came from.
//
// alreadyInvited (emails already on the event) locks those rows instead of
// just labelling them, so the running total is what will actually be added
// rather than what was ticked.
export default function RecipientPicker({ value, onChange, alreadyInvited = NOBODY, noun = 'guest' }) {
  const w = WORDING[noun] || WORDING.guest;
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

  const picked = useMemo(() => new Set(sel.contact_ids), [sel.contact_ids]);
  const excluded = useMemo(() => new Set(sel.excluded_contact_ids || []), [sel.excluded_contact_ids]);

  const invitedIds = useMemo(() => {
    const set = new Set();
    if (alreadyInvited.size === 0) return set;
    for (const c of contacts) {
      const email = (c.email || '').toLowerCase();
      if (email && alreadyInvited.has(email)) set.add(c.id);
    }
    return set;
  }, [contacts, alreadyInvited]);

  // A row is ticked when the person was picked or a group brought them, and
  // nobody has unticked them since. A row for someone already on the event
  // never is.
  const isOn = (id) => !invitedIds.has(id) && (picked.has(id) || groupMemberIds.has(id)) && !excluded.has(id);

  // Split rather than summed: picking a group nearly always sweeps up people
  // who are already on the event, and a total that counts them would promise
  // more than "Add to event" delivers.
  const tally = useMemo(() => {
    const ids = new Set(sel.contact_ids);
    for (const id of groupMemberIds) ids.add(id);
    for (const id of excluded) ids.delete(id);
    let onAlready = 0;
    for (const id of invitedIds) if (ids.delete(id)) onAlready++;
    return { selected: ids.size + sel.new_contacts.filter((n) => n.name.trim()).length, onAlready };
  }, [sel, groupMemberIds, excluded, invitedIds]);

  // One tick per person, whichever way they got here: ticking clears any
  // exclusion and adds them; unticking removes them and, if a group would
  // still bring them back, records the exclusion that keeps them out.
  function toggleContact(id) {
    if (invitedIds.has(id)) return; // already on the event — nothing to toggle
    const rest = (sel.excluded_contact_ids || []).filter((x) => x !== id);
    if (isOn(id)) {
      onChange({
        ...sel,
        contact_ids: sel.contact_ids.filter((x) => x !== id),
        excluded_contact_ids: groupMemberIds.has(id) ? [...rest, id] : rest,
      });
    } else {
      onChange({
        ...sel,
        contact_ids: picked.has(id) ? sel.contact_ids : [...sel.contact_ids, id],
        excluded_contact_ids: rest,
      });
    }
  }

  // "Select all" ticks everyone shown whom an email can reach. People with no
  // address, and people who have unsubscribed, stay as they were; they can
  // still be ticked one at a time. After a search, it acts on the matches.
  const searching = Boolean(q.trim());
  const toTick = filtered.filter((c) => reachable(c) && !invitedIds.has(c.id) && !isOn(c.id));
  const deselecting = toTick.length === 0 && filtered.some((c) => isOn(c.id));
  function selectAllShown() {
    const ids = new Set(toTick.map((c) => c.id));
    onChange({
      ...sel,
      contact_ids: [...sel.contact_ids, ...toTick.filter((c) => !picked.has(c.id)).map((c) => c.id)],
      excluded_contact_ids: (sel.excluded_contact_ids || []).filter((id) => !ids.has(id)),
    });
  }
  // With nothing searched, "Deselect all" empties the list, and the groups
  // above go with it. After a search, it unticks the matches the way
  // unticking each one would, so a group keeps everyone else it brought.
  function deselectAllShown() {
    if (!searching) {
      onChange({ ...sel, contact_ids: [], group_ids: [], excluded_contact_ids: [] });
      return;
    }
    const off = filtered.filter((c) => isOn(c.id)).map((c) => c.id);
    const ids = new Set(off);
    onChange({
      ...sel,
      contact_ids: sel.contact_ids.filter((id) => !ids.has(id)),
      excluded_contact_ids: [...(sel.excluded_contact_ids || []), ...off.filter((id) => groupMemberIds.has(id))],
    });
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
        <Field label={w.groups}>
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
      {filtered.length > 0 ? (
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="small muted">
            {searching
              ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
              : `${filtered.length} contact${filtered.length === 1 ? '' : 's'}`}
          </span>
          <button type="button" className="btn btn-sm" disabled={!deselecting && toTick.length === 0}
            onClick={deselecting ? deselectAllShown : selectAllShown}>
            {deselecting ? 'Deselect all' : searching ? 'Select all matches' : 'Select all'}
          </button>
        </div>
      ) : null}
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
                const invited = invitedIds.has(c.id);
                const viaGroup = groupMemberIds.has(c.id);
                const isExcluded = excluded.has(c.id);
                return (
                  <tr key={c.id} style={invited ? { opacity: 0.55 } : undefined}>
                    <td style={{ width: 34 }}>
                      <input type="checkbox" disabled={invited}
                        aria-label={invited ? `${c.name} is already invited` : w.tick(c.name)}
                        checked={isOn(c.id)}
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
                      {invited ? '' /* the badge beside the name already says so */
                        : viaGroup && isExcluded ? <span className="badge badge-amber">Removed</span>
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
        {tally.selected === 0
          ? (tally.onAlready
            ? `Nobody new selected — all ${tally.onAlready} of the people picked are already invited.`
            : w.empty)
          : `${tally.selected} ${alreadyInvited.size ? 'new ' : ''}${tally.selected === 1 ? w.one : w.many} selected.`}
        {tally.selected > 0 && tally.onAlready
          ? ` ${tally.onAlready} other${tally.onAlready === 1 ? ' is' : 's are'} already invited and won’t be added again.`
          : ''}
      </Banner>
    </div>
  );
}
