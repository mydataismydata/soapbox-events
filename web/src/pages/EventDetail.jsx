import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatWhen, timeAgo } from '../api.js';
import {
  Spinner, Modal, ConfirmModal, Empty, Field, CopyBox, useToast,
  ResponseBadge, StatusBadge, EmailStatusBadge, insertAtCursor,
  Banner, Card, StatGrid, Stat, IconButton, Icon,
} from '../ui.jsx';
import RecipientPicker from '../components/RecipientPicker.jsx';
import TagButtons from '../components/TagButtons.jsx';

const COMPOSE_PRESETS = {
  nudge: {
    label: 'Remind guests who haven\'t replied',
    audience: 'pending',
    subject: 'Reminder to RSVP: {{event_title}}',
    body: `Hi {{first_name}},

Just a friendly reminder — we haven't heard back from you about {{event_title}} on {{event_date}}.

It only takes a second to reply with the buttons below. We hope you can join us!`,
  },
  follow_up_yes: {
    label: 'Message everyone who accepted',
    audience: 'yes', kind: 'follow_up',
    subject: 'See you soon: {{event_title}}',
    body: `Hi {{first_name}},

You're confirmed for {{event_title}} on {{event_date}} — here's a quick update from us:

`,
  },
  follow_up_all: {
    label: 'Message everyone invited',
    audience: 'all', kind: 'follow_up',
    subject: 'Update: {{event_title}}',
    body: `Hi {{first_name}},

A quick update about {{event_title}} on {{event_date}}:

`,
  },
};

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [guests, setGuests] = useState([]);
  const [emails, setEmails] = useState([]);
  const [tab, setTab] = useState('guests');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [recipients, setRecipients] = useState({ contact_ids: [], group_ids: [], new_contacts: [] });
  const [confirm, setConfirm] = useState(null); // {type, ...}
  const [cancelNotify, setCancelNotify] = useState(true);
  const [viewEmail, setViewEmail] = useState(null);
  const [compose, setCompose] = useState(null); // {presetKey, kind, audience, subject, body}
  const [composePreview, setComposePreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const composeBodyRef = useRef(null);

  const load = useCallback(async (quiet = false) => {
    try {
      const [d, g, e] = await Promise.all([
        api.get(`/api/events/${id}`),
        api.get(`/api/events/${id}/guests`),
        api.get(`/api/emails?event_id=${id}`),
      ]);
      setData(d);
      setGuests(g.guests);
      setEmails(e.emails);
    } catch (err) {
      if (!quiet) setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Quiet refresh while emails are moving through the queue.
  const hasActivity = emails.some((e) => ['queued', 'sending'].includes(e.status));
  useEffect(() => {
    if (!hasActivity) return;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [hasActivity, load]);

  const filteredGuests = useMemo(() => {
    switch (filter) {
      case 'yes': return guests.filter((g) => g.response === 'yes');
      case 'no': return guests.filter((g) => g.response === 'no');
      case 'pending': return guests.filter((g) => !g.response && g.email_status === 'sent');
      case 'not_sent': return guests.filter((g) => ['not_sent', 'failed'].includes(g.email_status));
      default: return guests;
    }
  }, [guests, filter]);

  if (error) return <div className="page"><Banner tone="bad">{error}</Banner></div>;
  if (!data) return <div className="page"><Spinner /></div>;

  const ev = data.event;
  const stats = data.stats;
  const sendable = guests.filter((g) =>
    ['not_sent', 'failed'].includes(g.email_status) && !g.response && g.email && !g.unsubscribed).length;

  async function act(fn, okMsg) {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast(okMsg);
      await load(true);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  function openCompose(presetKey) {
    const p = COMPOSE_PRESETS[presetKey];
    setCompose({
      presetKey,
      kind: p.kind || 'nudge',
      audience: p.audience,
      subject: p.subject,
      body: p.body,
    });
  }

  async function sendCompose() {
    await act(async () => {
      const result = await api.post(`/api/events/${ev.id}/message`, {
        kind: compose.kind, audience: compose.audience,
        subject: compose.subject, body: compose.body,
      });
      toast(`${result.queued} email${result.queued === 1 ? '' : 's'} queued`
        + (result.skipped.unsubscribed ? ` · ${result.skipped.unsubscribed} unsubscribed skipped` : ''));
      setCompose(null);
      setTab('emails');
    });
  }

  const audienceCount = compose ? {
    pending: guests.filter((g) => !g.response && g.email_status === 'sent').length,
    yes: stats.accepted,
    no: stats.declined,
    all: guests.length,
  }[compose.audience] : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="page-title">{ev.title}</h1>
            <StatusBadge status={ev.status} />
          </div>
          <p className="page-sub">
            {formatWhen(ev)}{ev.venue_name ? ` · ${ev.venue_name}` : ''}
            {ev.host_name ? ` · Hosted by ${ev.host_name}` : ''}
          </p>
        </div>
        <div className="head-actions">
          <a className="btn" href={ev.share_url} target="_blank" rel="noopener noreferrer">
            View page <Icon name="external" size={14} />
          </a>
          {/* While it's still a draft the prominent "Continue creating" button
              below is the way back into the wizard; Edit appears once sent. */}
          {ev.status !== 'draft'
            ? <Link className="btn" to={`/events/${ev.id}/edit`}><Icon name="pencil" size={14} /> Edit</Link> : null}
          <button className="btn" onClick={() => act(async () => {
            const d = await api.post(`/api/events/${ev.id}/duplicate`);
            navigate(`/events/${d.event.id}/edit`);
          })}><Icon name="copy" size={14} /> Duplicate</button>
          {ev.status === 'published'
            ? <button className="btn btn-danger" onClick={() => setConfirm({ type: 'cancel' })}>Cancel event</button>
            : <button className="btn btn-danger" onClick={() => setConfirm({ type: 'delete' })}>
                <Icon name="trash" size={14} /> Delete
              </button>}
        </div>
      </div>

      {ev.status === 'draft' ? (
        <div className="card card-pad draft-cta">
          <div>
            <strong style={{ fontSize: 14 }}>This event isn’t finished yet</strong>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              It’s saved as a draft. Pick up where you left off to finish the details, design, and guest list, then send.
            </p>
          </div>
          <Link className="btn btn-primary" to={`/events/${ev.id}/edit`}>
            Continue creating <Icon name="arrowRight" size={15} />
          </Link>
        </div>
      ) : null}

      {ev.status === 'cancelled' ? (
        <Banner tone="bad">This event is cancelled. Guests see a cancellation notice on the event page.</Banner>
      ) : null}

      <StatGrid>
        <Stat icon="user" label="Invited" value={stats.invited}
          sub={`${stats.emails_sent} emailed · ${stats.emails_queued} queued`} />
        <Stat icon="checkCircle" tone="ok" label="Attending" value={stats.guests_attending}
          sub={`${stats.accepted} accepted RSVP${stats.accepted === 1 ? '' : 's'}`} />
        <Stat icon="xCircle" tone="bad" label="Declined" value={stats.declined} sub="&nbsp;" />
        <Stat icon="clipboard" tone="warn" label="Awaiting reply" value={stats.awaiting}
          sub={`${stats.not_reached} not yet emailed`} />
      </StatGrid>

      {ev.capacity ? (
        <Card style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Capacity</strong>
            <span className="small muted">{stats.guests_attending} of {ev.capacity} places taken</span>
          </div>
          <div className="progressbar" role="progressbar" aria-label="Capacity used"
            aria-valuenow={stats.guests_attending} aria-valuemin={0} aria-valuemax={ev.capacity}>
            <div style={{ width: `${Math.min(100, (stats.guests_attending / ev.capacity) * 100)}%` }} />
          </div>
        </Card>
      ) : null}

      {ev.share_enabled && ev.status === 'published' ? (
        <Card style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13 }}>Shareable link</strong>
          <p className="small muted" style={{ margin: '2px 0 8px' }}>
            Anyone with this link can view the event{ev.rsvp_mode === 'rsvp' ? ' and RSVP — forward it anywhere' : ''}.
            New RSVPs from the link appear in the guest list automatically.
          </p>
          <CopyBox value={ev.share_url} />
        </Card>
      ) : null}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'guests'}
          className={`tab ${tab === 'guests' ? 'active' : ''}`} onClick={() => setTab('guests')}>
          Guests ({guests.length})
        </button>
        <button role="tab" aria-selected={tab === 'messages'}
          className={`tab ${tab === 'messages' ? 'active' : ''}`} onClick={() => setTab('messages')}>
          Follow-ups & nudges
        </button>
        <button role="tab" aria-selected={tab === 'emails'}
          className={`tab ${tab === 'emails' ? 'active' : ''}`} onClick={() => setTab('emails')}>
          Email log ({emails.length})
        </button>
      </div>

      {tab === 'guests' ? (
        <Card flush>
          <div className="table-toolbar">
            <div className="row">
              <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
                <Icon name="plus" size={14} /> Add guests
              </button>
              {sendable > 0 && ev.status !== 'cancelled' ? (
                <button className="btn btn-green btn-sm" disabled={busy}
                  onClick={() => setConfirm({ type: 'send' })}>
                  <Icon name="send" size={14} /> Send invitations ({sendable})
                </button>
              ) : null}
              <a className="btn btn-sm" href={`/api/export/events/${ev.id}/guests.csv`}>
                <Icon name="download" size={14} /> Export CSV
              </a>
            </div>
            <select className="search-input" style={{ maxWidth: 190 }} value={filter}
              aria-label="Filter guests"
              onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All guests</option>
              <option value="yes">Accepted</option>
              <option value="no">Declined</option>
              <option value="pending">Awaiting reply</option>
              <option value="not_sent">Not emailed / failed</option>
            </select>
          </div>
          {filteredGuests.length === 0 ? (
            <Empty icon="users" title={guests.length === 0 ? 'No guests yet' : 'Nothing matches this filter'}>
              {guests.length === 0 ? 'Add guests from your contacts, or share the event link.' : ''}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Guest</th><th>Invitation</th><th>Response</th><th>Party</th><th>Note</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGuests.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          <span className="t-main">{g.name || '—'}</span>
                          {g.source === 'link' ? <span className="badge badge-indigo">via link</span> : null}
                          {g.unsubscribed ? <span className="badge badge-amber">Unsubscribed</span> : null}
                        </div>
                        <div className="t-sub">{g.email || g.phone || 'no contact info'}</div>
                      </td>
                      <td><EmailStatusBadge status={g.email_status} /></td>
                      <td>
                        <ResponseBadge response={g.response} />
                        {g.responded_at ? <div className="t-sub">{timeAgo(g.responded_at)}</div> : null}
                      </td>
                      <td className="tabular">{g.party_size}</td>
                      <td className="t-sub" style={{ maxWidth: 180 }} title={g.note}>{g.note}</td>
                      <td>
                        <div className="t-actions">
                          {ev.rsvp_mode === 'rsvp' ? (
                            <>
                              <IconButton icon="check" label="Mark as accepted" disabled={busy}
                                onClick={() => act(() => api.put(`/api/events/${ev.id}/guests/${g.id}`, { response: 'yes' }))} />
                              <IconButton icon="x" label="Mark as declined" disabled={busy}
                                onClick={() => act(() => api.put(`/api/events/${ev.id}/guests/${g.id}`, { response: 'no' }))} />
                            </>
                          ) : null}
                          {g.email && ev.status !== 'cancelled' ? (
                            <IconButton icon="mail" label="Send / resend invitation" disabled={busy}
                              onClick={() => act(() => api.post(`/api/events/${ev.id}/send`, { invite_ids: [g.id] }),
                                'Invitation queued')} />
                          ) : null}
                          {!g.contact_id && g.email ? (
                            <IconButton icon="plus" label="Save to contacts" disabled={busy}
                              onClick={() => act(() => api.post(`/api/events/${ev.id}/guests/${g.id}/add-contact`),
                                'Saved to contacts')} />
                          ) : null}
                          <IconButton icon="trash" label="Remove from event" tone="ghost" disabled={busy}
                            onClick={() => setConfirm({ type: 'removeGuest', guest: g })} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'messages' ? (
        <div className="grid3">
          {Object.entries(COMPOSE_PRESETS).map(([key, p]) => (
            <div key={key} className="card card-pad">
              <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{p.label}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>
                {key === 'nudge'
                  ? `${guests.filter((g) => !g.response && g.email_status === 'sent').length} guest(s) haven't replied yet.`
                  : key === 'follow_up_yes'
                    ? `${stats.accepted} guest(s) have accepted.`
                    : `${guests.length} guest(s) on the list.`}
              </p>
              <button className="btn btn-sm"
                disabled={ev.status === 'cancelled'}
                onClick={() => openCompose(key)}>
                <Icon name="pencil" size={14} /> Compose
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'emails' ? (
        <Card flush>
          {emails.length === 0 ? (
            <Empty icon="inbox" title="No emails yet">Everything sent for this event shows up here, including exact content.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>When</th><th>Type</th><th>To</th><th>Subject</th><th>Status</th>
                    <th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {emails.map((e) => (
                    <tr key={e.id}>
                      <td className="t-sub nowrap">{timeAgo(e.sent_at || e.created_at)}</td>
                      <td><span className="badge badge-gray">{e.kind.replace('_', ' ')}</span></td>
                      <td className="t-sub">{e.to_email}</td>
                      <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject}</td>
                      <td>
                        <EmailStatusBadge status={e.status} />
                        {e.error ? <div className="t-sub" title={e.error}>{e.error.slice(0, 60)}</div> : null}
                      </td>
                      <td>
                        <div className="t-actions">
                          <button className="btn btn-sm" onClick={async () => {
                            try { setViewEmail((await api.get(`/api/emails/${e.id}`)).email); }
                            catch (err) { toast(err.message, 'bad'); }
                          }}>View</button>
                          {e.status === 'failed' ? (
                            <IconButton icon="refresh" label="Retry sending" disabled={busy}
                              onClick={() => act(() => api.post(`/api/emails/${e.id}/retry`), 'Retrying')} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {addOpen ? (
        <Modal title="Add guests" size="lg" onClose={() => setAddOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAddOpen(false)}>Close</button>
              <button className="btn btn-primary" disabled={busy}
                onClick={() => act(async () => {
                  const result = await api.post(`/api/events/${ev.id}/guests`, {
                    ...recipients,
                    new_contacts: recipients.new_contacts.filter((n) => n.name.trim()),
                    save_new: true,
                  });
                  toast(`${result.added} added${result.skipped ? `, ${result.skipped} already invited` : ''}`);
                  setRecipients({ contact_ids: [], group_ids: [], new_contacts: [] });
                  setAddOpen(false);
                })}>
                Add to event
              </button>
            </>
          }>
          <RecipientPicker value={recipients} onChange={setRecipients}
            alreadyInvited={new Set(guests.map((g) => g.email).filter(Boolean))} />
        </Modal>
      ) : null}

      {compose ? (
        <Modal title={COMPOSE_PRESETS[compose.presetKey].label} size="lg" onClose={() => setCompose(null)}
          footer={
            <>
              <button className="btn" onClick={async () => {
                try {
                  const d = await api.post(`/api/events/${ev.id}/email-preview`, {
                    kind: compose.kind, subject: compose.subject, body: compose.body,
                  });
                  setComposePreview(d);
                } catch (err) { toast(err.message, 'bad'); }
              }}><Icon name="eye" size={14} /> Preview</button>
              <button className="btn btn-primary" onClick={sendCompose} disabled={busy || audienceCount === 0}>
                {busy ? 'Queuing…' : `Send to ${audienceCount} guest${audienceCount === 1 ? '' : 's'}`}
              </button>
            </>
          }>
          {compose.kind === 'nudge'
            ? <Banner tone="info">Nudges include the Accept / Decline buttons again.</Banner>
            : null}
          <Field label="Audience">
            <select value={compose.audience}
              onChange={(e) => setCompose({ ...compose, audience: e.target.value })}>
              <option value="pending">Hasn't replied (emailed, no response)</option>
              <option value="yes">Accepted</option>
              <option value="no">Declined</option>
              <option value="all">Everyone on the guest list</option>
            </select>
          </Field>
          <Field label="Subject">
            <input value={compose.subject} maxLength={300}
              onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea ref={composeBodyRef} rows={7} value={compose.body} maxLength={20000}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })} />
            <TagButtons compact onInsert={(snippet) =>
              insertAtCursor(composeBodyRef, compose.body, snippet,
                (val) => setCompose((c) => ({ ...c, body: val })))} />
          </Field>
        </Modal>
      ) : null}

      {composePreview ? (
        <Modal title={`Preview — ${composePreview.subject}`} size="lg" onClose={() => setComposePreview(null)}>
          <iframe className="email-frame" title="Email preview" srcDoc={composePreview.html} />
        </Modal>
      ) : null}

      {viewEmail ? (
        <Modal title={viewEmail.subject} size="lg" onClose={() => setViewEmail(null)}>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            To {viewEmail.to_email} · {viewEmail.kind.replace('_', ' ')} · {viewEmail.status}
            {viewEmail.sent_at ? ` · ${viewEmail.sent_at} UTC` : ''}
          </p>
          <iframe className="email-frame" title="Sent email" srcDoc={viewEmail.html} />
        </Modal>
      ) : null}

      {confirm?.type === 'send' ? (
        <ConfirmModal title="Send invitations?" busy={busy}
          message={`Invitation emails will be queued for ${sendable} guest${sendable === 1 ? '' : 's'} who haven't been emailed yet.`}
          confirmLabel="Send" onClose={() => setConfirm(null)}
          onConfirm={() => act(async () => {
            const result = await api.post(`/api/events/${ev.id}/send`, {});
            toast(`${result.queued} invitation${result.queued === 1 ? '' : 's'} queued`);
            setTab('emails');
          })} />
      ) : null}

      {confirm?.type === 'removeGuest' ? (
        <ConfirmModal title="Remove guest?" danger busy={busy}
          message={`Remove ${confirm.guest.name || 'this guest'} from the event? Their invitation link stops working.`}
          confirmLabel="Remove" onClose={() => setConfirm(null)}
          onConfirm={() => act(() => api.del(`/api/events/${ev.id}/guests/${confirm.guest.id}`), 'Guest removed')} />
      ) : null}

      {confirm?.type === 'delete' ? (
        <ConfirmModal title="Delete event?" danger busy={busy}
          message="This permanently deletes the event, its guest list, and its share links. The email log is kept."
          confirmLabel="Delete forever" onClose={() => setConfirm(null)}
          onConfirm={() => act(async () => { await api.del(`/api/events/${ev.id}`); navigate('/events'); })} />
      ) : null}

      {confirm?.type === 'cancel' ? (
        <Modal title="Cancel this event?" onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>Keep event</button>
              <button className="btn btn-danger" disabled={busy}
                onClick={() => act(async () => {
                  const result = await api.post(`/api/events/${ev.id}/cancel`, { notify: cancelNotify });
                  toast(cancelNotify ? `Event cancelled — ${result.notified} guests notified` : 'Event cancelled');
                })}>
                {busy ? 'Cancelling…' : 'Cancel event'}
              </button>
            </>
          }>
          <p style={{ marginTop: 0 }}>The event page will show a cancellation notice and RSVPs will close.</p>
          <label className="checkbox">
            <input type="checkbox" checked={cancelNotify} onChange={(e) => setCancelNotify(e.target.checked)} />
            <span><span className="cb-label">Email guests about the cancellation</span>
              <div className="cb-sub">Goes to everyone who accepted or was already invited.</div></span>
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
