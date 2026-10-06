// The pieces the Help scenes are drawn with. They use the app's own classes
// wherever those look right at this size, so a scene reads as the real
// screen. Anything the scenes need that the app draws with a real control
// (a text box being typed into, an open drop-down) is a lookalike here, since
// nothing in a scene is ever really clicked.
import React from 'react';
import Icon from '../icons.jsx';
import { Badge, Card, EmailStatusBadge } from '../ui.jsx';
import { GROUPS, ME, ORG, PEOPLE } from './data.js';

const TABS = ['Dashboard', 'Events', 'Broadcasts', 'Contacts', 'Groups'];
const MENU = [
  ['Venues', 'pin'],
  ['Templates', 'file'],
  ['Email log', 'inbox'],
  ['Settings', 'settings'],
];

// The top bar and tab row, as on a computer. `menu` opens the account menu.
export function TopBar({ tab, menu = false }) {
  return (
    <>
      <div className="hs-bar">
        <span className="brandmark">Soapbox</span>
        <span className="hs-sep">/</span>
        <span className="hs-org">{ORG}</span>
        <span className="hs-bar-right">
          <span className="hs-helpbtn" data-t="help"><Icon name="help" size={15} /> Help</span>
          <span className="hs-iconbtn"><Icon name="moon" size={15} /></span>
          <span className="hs-acct-wrap">
            <span className="hs-acct" data-t="acct">
              <span className="acct-avatar">{ME.initials}</span>
              <span>{ME.name}</span>
              <Icon name="chevronDown" size={12} />
            </span>
            {menu ? (
              <div className="acct-menu hs-acct-menu">
                <div className="acct-head">
                  <div className="who-name">{ME.name}</div>
                  <div className="who-meta">{ME.email}</div>
                </div>
                {MENU.map(([label, icon]) => (
                  <a key={label} data-t={`menu-${label}`}>
                    <span className="acct-ico"><Icon name={icon} size={16} /></span>{label}
                  </a>
                ))}
                <div className="acct-sep" />
                <a><span className="acct-ico"><Icon name="logout" size={16} /></span>Sign out</a>
              </div>
            ) : null}
          </span>
        </span>
      </div>
      <div className="hs-tabs">
        {TABS.map((t) => <span key={t} className={t === tab ? 'on' : ''} data-t={`tab-${t}`}>{t}</span>)}
      </div>
    </>
  );
}

// A whole screen: the top bar (unless `bare`) over the page.
export function Screen({ tab, menu, bare = false, children }) {
  return (
    <div className="hs-screen">
      {bare ? null : <TopBar tab={tab} menu={menu} />}
      <div className="hs-page">{children}</div>
    </div>
  );
}

export function PageHead({ title, sub, actions, badge }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <h1 className="page-title">{title}</h1>
          {badge}
        </div>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
  );
}

// A text box. `focus` draws it as the one being typed into, with a caret, and
// like a real box it then shows the end of text too long to fit.
export function Input({ t, value, placeholder, focus = false, mono = false, style }) {
  return (
    <div className={`input hs-input${focus ? ' is-focus' : ''}${mono ? ' hs-mono' : ''}`} data-t={t} style={style}>
      {value ? <span className="hs-val"><bdi>{value}</bdi></span> : <span className="ph">{placeholder}</span>}
      {focus ? <span className="hs-caret" /> : null}
    </div>
  );
}

// A box that holds several lines.
export function Area({ t, value, placeholder, focus = false, rows = 4, mono = false }) {
  return (
    <div className={`input hs-input hs-area${focus ? ' is-focus' : ''}${mono ? ' hs-mono' : ''}`} data-t={t}
      style={{ minHeight: rows * 20 + 18 }}>
      {value
        ? <span className="hs-val">{value}{focus ? <span className="hs-caret" /> : null}</span>
        : <><span className="ph">{placeholder}</span>{focus ? <span className="hs-caret" /> : null}</>}
    </div>
  );
}

// A drop-down. `options` are [label, data-t] pairs; `open` shows them, with
// `hi` picked out.
export function Select({ t, value, open = false, options = [], hi, placeholder, style }) {
  return (
    <div className="hs-anchor" style={style}>
      <div className={`input hs-select${open ? ' is-focus' : ''}`} data-t={t}>
        {value ? <span className="hs-val">{value}</span> : <span className="ph">{placeholder}</span>}
      </div>
      {open ? (
        <div className="hs-menu">
          {options.map(([label, key, group]) => (group
            ? <span key={label} className="grp">{label}</span>
            : <span key={label} data-t={key} className={key === hi ? 'hi' : ''}>{label}</span>))}
        </div>
      ) : null}
    </div>
  );
}

export function Check({ on, t, off = false }) {
  return <input type="checkbox" checked={on} disabled={off} readOnly data-t={t} tabIndex={-1} />;
}

// A dialog, drawn over the scene rather than the whole window.
export function Modal({ title, children, footer, size, t }) {
  return (
    <div className="hs-overlay">
      <div className={`modal${size === 'lg' ? ' modal-lg' : ''}`} data-t={t}>
        <div className="modal-head">
          <h3>{title}</h3>
          <span className="modal-close"><Icon name="x" size={17} /></span>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Toast({ text, bad = false }) {
  if (!text) return null;
  return (
    <div className="hs-toasts">
      <div className={`toast${bad ? ' bad' : ''}`} key={text}>
        <Icon className="toast-ico" name={bad ? 'alert' : 'checkCircle'} size={15} />
        <span>{text}</span>
      </div>
    </div>
  );
}

// The wizard's step list down the left, with the step's card beside it.
export function Wizard({ labels, step, children }) {
  return (
    <div className="wiz">
      <div className="wiz-rail">
        {labels.map((label, i) => (
          <span key={label} data-t={`step-${i}`}
            className={`wiz-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>
            <span className="n">{i < step ? <Icon name="check" size={11} strokeWidth={2.6} /> : i + 1}</span>
            {label}
          </span>
        ))}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function WizardFoot({ next = true }) {
  return (
    <div className="wiz-foot">
      <span className="btn" data-t="back"><Icon name="arrowLeft" size={15} /> Back</span>
      {next ? <span className="btn btn-primary" data-t="continue">Continue <Icon name="arrowRight" size={15} /></span> : <span />}
    </div>
  );
}

export const EVENT_STEPS = ['Event details', 'RSVP options', 'Invitation & flyer', 'Guests', 'Review & send'];
export const BROADCAST_STEPS = ['Details', 'Design & message', 'Recipients', 'Review & send'];

// The people picker from the event and broadcast wizards and the Add guests
// dialog. `groups` are the group ids picked, `out` the people unticked from
// them, `ticked` people picked one by one, and `invited` the people already on
// the event. The count underneath, and the Select all button over the list,
// work the way the real ones do.
const WORDING = {
  guest: {
    one: 'guest', many: 'guests', groups: 'Invite whole groups',
    empty: 'No guests selected yet — you can also skip this and share the event link instead.',
  },
  contact: {
    one: 'contact', many: 'contacts', groups: 'Send to whole groups',
    empty: 'No contacts selected yet — pick a group above, or tick people from the list.',
  },
};

export function Picker({ noun = 'guest', groups = [], out = [], ticked = [], invited = [], listHeight = 150 }) {
  const w = WORDING[noun];
  const viaGroup = new Set(GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => g.members));
  const isOn = (id) => !invited.includes(id) && (ticked.includes(id) || viaGroup.has(id)) && !out.includes(id);
  const deselect = PEOPLE.every((p) => invited.includes(p.id) || isOn(p.id)) && PEOPLE.some((p) => isOn(p.id));
  const chosen = new Set([...ticked, ...viaGroup].filter((id) => !out.includes(id)));
  let onAlready = 0;
  for (const id of invited) if (chosen.delete(id)) onAlready++;
  const selected = chosen.size;
  const banner = selected === 0
    ? (onAlready ? `Nobody new selected — all ${onAlready} of the people picked are already invited.` : w.empty)
    : `${selected} ${invited.length ? 'new ' : ''}${selected === 1 ? w.one : w.many} selected.`
      + (onAlready ? ` ${onAlready} other${onAlready === 1 ? ' is' : 's are'} already invited and won’t be added again.` : '');

  return (
    <div>
      <div className="field">
        <label>{w.groups}</label>
        <div className="chip-row">
          {GROUPS.map((g) => {
            const on = groups.includes(g.id);
            return (
              <span key={g.id} className={`chip${on ? ' active' : ''}`} data-t={`grp-${g.id}`}>
                {on ? <Icon name="check" size={12} strokeWidth={2.4} /> : null}
                {g.name} ({g.members.length})
              </span>
            );
          })}
        </div>
      </div>
      <div className="field">
        <label>Pick individual contacts</label>
        <div className="search-field">
          <Icon name="search" size={15} />
          <Input placeholder="Search contacts…" style={{ paddingLeft: 31 }} />
        </div>
      </div>
      <div className="spread" style={{ marginBottom: 8 }}>
        <span className="small muted">{PEOPLE.length} contacts</span>
        <span className="btn btn-sm" data-t="select-all">{deselect ? 'Deselect all' : 'Select all'}</span>
      </div>
      <div className="hs-list" style={{ height: listHeight }} data-t="list">
        <table className="table">
          <tbody>
            {PEOPLE.map((p) => {
              const already = invited.includes(p.id);
              const group = viaGroup.has(p.id);
              const isOut = out.includes(p.id);
              const on = isOn(p.id);
              return (
                <tr key={p.id} style={already ? { opacity: 0.55 } : undefined}>
                  <td style={{ width: 30 }}><Check on={on} off={already} t={`pick-${p.id}`} /></td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="t-main">{p.name}</span>
                      {already ? <span className="badge badge-gray">Already invited</span> : null}
                    </div>
                    <div className="t-sub">{p.email}</div>
                  </td>
                  <td className="t-sub nowrap" style={{ textAlign: 'right' }}>
                    {already ? '' : group && isOut ? <Badge tone="amber">Removed</Badge> : group ? 'via group' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="banner banner-info" data-t="tally" style={{ marginTop: 10, marginBottom: 0 }}>
        <Icon className="banner-ico" name="info" size={15} />
        <div style={{ minWidth: 0 }}>{banner}</div>
      </div>
    </div>
  );
}

// An email as the reader gets it: the message, then (for an invitation) the
// event's details and the Accept and Decline buttons.
export function Email({ greeting, paragraphs, details, rsvp = false, footer }) {
  return (
    <div className="hs-email">
      <div className="hs-email-card">
        <p>{greeting}</p>
        {paragraphs.map((p) => <p key={p}>{p}</p>)}
        {details ? (
          <div className="hs-email-details">
            {details.map(([k, v]) => (
              <div key={k}><span className="k">{k}</span><span>{v}</span></div>
            ))}
          </div>
        ) : null}
        {rsvp ? (
          <div className="hs-email-rsvp">
            <strong>Will you be there?</strong>
            <div>
              <span className="hs-email-yes">✓ Accept</span>
              <span className="hs-email-no">✕ Decline</span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="hs-email-foot">{footer}</div>
    </div>
  );
}

// The tabs on an event's page.
export function EventTabs({ tab, guests = 6, emails = 6 }) {
  const cls = (name) => `tab${tab === name ? ' active' : ''}`;
  return (
    <div className="tabs">
      <span className={cls('guests')} data-t="tab-guests">Guests ({guests})</span>
      <span className={cls('messages')} data-t="tab-messages">Follow-ups &amp; nudges</span>
      <span className={cls('emails')} data-t="tab-emails">Email log ({emails})</span>
    </div>
  );
}

// An email log as an event or a broadcast shows it: when, who, and how it
// went. `rows` are { id, when, name, email, status, error }.
export function LogCard({ rows, total, title, kinds = 'All types', t = 'log' }) {
  return (
    <Card flush title={title}>
      <div className="table-toolbar">
        <div className="row" style={{ gap: 6, flex: 1, minWidth: 0, flexWrap: 'nowrap' }}>
          <div className="search-field" style={{ flex: 1, minWidth: 0 }}>
            <Icon name="search" size={15} />
            <Input placeholder="Filter by recipient…" style={{ paddingLeft: 31 }} />
          </div>
          <Select value={kinds} style={{ width: 118 }} />
          <Select value="Any status" style={{ width: 112 }} />
        </div>
        <span className="small muted log-count">1–{Math.min(rows.length, 25)} of {total ?? rows.length}</span>
      </div>
      <table className="table hs-tight" data-t={t}>
        <thead>
          <tr><th>When</th><th>To</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.fresh ? 'hs-new' : undefined} data-t={`row-${r.id}`}>
              <td className="t-sub nowrap">{r.when}</td>
              <td><div className="t-main">{r.name}</div><div className="t-sub">{r.email}</div></td>
              <td>
                <EmailStatusBadge status={r.status} />
                {r.error ? <div className="t-sub">{r.error}</div> : null}
              </td>
              <td>
                <div className="t-actions">
                  <span className="btn btn-sm" data-t={`view-${r.id}`}>View</span>
                  {r.status === 'failed' ? (
                    <span className="btn btn-icon btn-sm" data-t={`retry-${r.id}`}>
                      <Icon name="refresh" size={15} />
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// A card on the Groups page.
export function GroupCard({ id, name, count, fresh = false }) {
  return (
    <div className={`card card-pad${fresh ? ' hs-new' : ''}`} data-t={`card-${id}`}>
      <div className="spread">
        <h3 style={{ margin: 0, fontSize: 13.5 }}>{name}</h3>
        <span className="badge badge-gray">{count} member{count === 1 ? '' : 's'}</span>
      </div>
      <div className="row mt" style={{ flexWrap: 'nowrap', gap: 6 }}>
        <span className="btn btn-sm" data-t={`view-${id}`}><Icon name="eye" size={14} /> View members</span>
        <span className="btn btn-sm" data-t={`edit-${id}`}><Icon name="pencil" size={14} /> Edit members</span>
        <span className="btn btn-icon btn-sm btn-ghost" style={{ marginLeft: 'auto' }}><Icon name="trash" size={15} /></span>
      </div>
    </div>
  );
}

// A list that scrolls in the app. `scroll` moves it up by that many pixels.
export function ScrollList({ height, scroll = 0, t, children }) {
  return (
    <div className="hs-list" style={{ height }} data-t={t}>
      <div className="hs-scroll" style={{ transform: `translateY(${-scroll}px)` }}>{children}</div>
    </div>
  );
}
