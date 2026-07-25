import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDate, formatTime } from '../api.js';
import { useAuth } from '../App.jsx';
import {
  Field, Modal, Spinner, useToast, insertAtCursor, Banner, Card, OptionCard, Icon,
} from '../ui.jsx';
import FlyerDesigner from '../components/FlyerDesigner.jsx';
import FlyerSnapshotKeeper from '../components/useFlyerSnapshot.js';
import RecipientPicker from '../components/RecipientPicker.jsx';
import RichText from '../components/RichText.jsx';
import TagButtons from '../components/TagButtons.jsx';
import VenuePicker from '../components/VenuePicker.jsx';

const STEPS = ['Event details', 'RSVP options', 'Invitation & flyer', 'Guests', 'Review & send'];

const BLANK = {
  title: '', description: '', host_name: '', venue_name: '', venue_address: '',
  venue_phone: '', venue_map_url: '',
  date: '', start_time: '', end_time: '',
  rsvp_mode: 'rsvp', rsvp_deadline: '', capacity: '', allow_plus_ones: true,
  max_party_size: 0, show_guest_list: false, share_enabled: true,
  email_subject: "You're invited: {{event_title}}",
  email_body: '',
  flyer: {
    style: 'blue', font: 'sans', scale: 'm',
    eyebrow: "You're invited", tagline: '', note: '', contact: '', showHost: true, showAddress: false,
    imageColumns: 1, imageTokens: [], imageCaptions: [], imageToken: '', imageCaption: '',
    includeFlyerImage: false, flyerImageToken: '',
  },
};

const DEFAULT_BODY = `Hi {{first_name}},

{{host_name}} invites you to {{event_title}} on {{event_date}}. We'd love to see you there!

Please let us know if you can make it using the buttons below.`;

export default function EventWizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { org } = useAuth();
  const editing = Boolean(id);

  const [eventId, setEventId] = useState(id ? Number(id) : null);
  const [ev, setEv] = useState(null);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(editing ? STEPS.length - 1 : 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recipients, setRecipients] = useState({ contact_ids: [], group_ids: [], new_contacts: [] });
  const [guests, setGuests] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [emailPreview, setEmailPreview] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [testTo, setTestTo] = useState('');
  const bodyRef = useRef(null);

  useEffect(() => {
    api.get('/api/templates').then((d) => setTemplates(d.templates)).catch(() => {});
    if (editing) {
      api.get(`/api/events/${id}`).then((d) => {
        const e = d.event;
        setEv({
          ...BLANK,
          ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, e[k] ?? BLANK[k]])),
          capacity: e.capacity ?? '',
          email_body: e.email_body ?? '',
          email_subject: e.email_subject ?? BLANK.email_subject,
        });
      }).catch((err) => setError(err.message));
      refreshGuests(Number(id));
    } else {
      // New event: host defaults to the org name, and start/end times to the
      // org's configured defaults (Settings → Event defaults).
      const base = { ...BLANK, host_name: org?.name || '', email_body: DEFAULT_BODY };
      api.get('/api/settings').then((d) => {
        setEv({
          ...base,
          start_time: d.settings.default_start_time || '',
          end_time: d.settings.default_end_time || '',
        });
      }).catch(() => setEv(base));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Apply the org's default template body once templates load (new events only).
  useEffect(() => {
    if (editing || !ev || ev.email_body !== DEFAULT_BODY) return;
    const def = templates.find((t) => t.is_default);
    if (def?.body) {
      setEv((cur) => ({ ...cur, email_body: def.body, email_subject: def.subject || cur.email_subject }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  async function refreshGuests(evId = eventId) {
    if (!evId) return;
    try {
      const d = await api.get(`/api/events/${evId}/guests`);
      setGuests(d.guests);
    } catch { /* not fatal */ }
  }

  function patch(p) {
    setEv((cur) => ({ ...cur, ...p }));
  }

  function payload() {
    return {
      ...ev,
      capacity: ev.capacity === '' ? null : Number(ev.capacity),
      max_party_size: Number(ev.max_party_size) || 0,
    };
  }

  async function persist() {
    setSaving(true);
    setError('');
    try {
      if (!eventId) {
        const d = await api.post('/api/events', payload());
        setEventId(d.event.id);
        return d.event.id;
      }
      await api.put(`/api/events/${eventId}`, payload());
      return eventId;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function persistGuests(evId) {
    const hasSelection = recipients.contact_ids.length || recipients.group_ids.length
      || recipients.new_contacts.some((n) => n.name.trim());
    if (!hasSelection) return;
    const result = await api.post(`/api/events/${evId}/guests`, {
      contact_ids: recipients.contact_ids,
      group_ids: recipients.group_ids,
      new_contacts: recipients.new_contacts.filter((n) => n.name.trim()),
      save_new: true,
    });
    setRecipients({ contact_ids: [], group_ids: [], new_contacts: [] });
    await refreshGuests(evId);
    toast(`${result.added} guest${result.added === 1 ? '' : 's'} added${result.skipped ? ` (${result.skipped} already on the list)` : ''}`);
  }

  async function goTo(next) {
    if (next > step && step === 0 && !ev.title.trim()) {
      setError('Give the event a title first.');
      return;
    }
    try {
      const evId = await persist();
      if (step === 3 && next > 3) await persistGuests(evId);
      setStep(next);
      setMaxStep((m) => Math.max(m, next));
      setError('');
    } catch { /* error shown */ }
  }

  async function saveDraftAndExit() {
    try {
      const evId = await persist();
      if (step >= 3) await persistGuests(evId);
      toast('Saved');
      navigate(`/events/${evId}`);
    } catch { /* shown */ }
  }

  async function sendNow() {
    try {
      const evId = await persist();
      await persistGuests(evId);
      const result = await api.post(`/api/events/${evId}/send`, {});
      toast(`${result.queued} invitation${result.queued === 1 ? '' : 's'} queued for sending`);
      navigate(`/events/${evId}`);
    } catch (err) {
      setConfirmSend(false);
      setError(err.message);
    }
  }

  async function previewEmail() {
    try {
      const evId = await persist();
      const d = await api.post(`/api/events/${evId}/email-preview`, {
        kind: 'invitation', subject: ev.email_subject, body: ev.email_body,
      });
      setEmailPreview(d);
    } catch (err) { setError(err.message); }
  }

  async function sendTest() {
    try {
      const evId = await persist();
      const d = await api.post(`/api/events/${evId}/test-email`, testTo ? { to: testTo } : {});
      toast(d.status === 'simulated'
        ? 'Test email rendered in simulation mode — view it under the event\'s Emails tab'
        : 'Test email sent — check your inbox');
    } catch (err) { toast(err.message, 'bad'); }
  }

  const sendable = useMemo(() => guests.filter((g) =>
    ['not_sent', 'failed'].includes(g.email_status) && !g.response && g.email && !g.unsubscribed).length,
  [guests]);
  const pendingSelection = useMemo(() => {
    const ids = new Set(recipients.contact_ids);
    return ids.size + recipients.group_ids.length + recipients.new_contacts.filter((n) => n.name.trim()).length;
  }, [recipients]);

  if (!ev) return <div className="page">{error ? <Banner tone="bad">{error}</Banner> : <Spinner />}</div>;

  const basics = {
    title: ev.title, host_name: ev.host_name, venue_name: ev.venue_name,
    venue_address: ev.venue_address, date: ev.date, start_time: ev.start_time,
    end_time: ev.end_time, rsvp_mode: ev.rsvp_mode,
  };

  // Fill event-level placeholders with real values for the review summary.
  function resolvePlaceholders(text) {
    const time = [formatTime(ev.start_time), formatTime(ev.end_time)].filter(Boolean).join(' – ');
    const ctx = {
      event_title: ev.title || '',
      event_date: formatDate(ev.date) || 'Date to be announced',
      event_time: time,
      venue_name: ev.venue_name || '',
      venue_address: ev.venue_address || '',
      venue_phone: ev.venue_phone || '',
      host_name: ev.host_name || org?.name || '',
      org_name: org?.name || '',
      rsvp_deadline: formatDate(ev.rsvp_deadline) || '',
      first_name: 'there', full_name: 'there', recipient_name: 'there',
      event_description: '', event_link: '', rsvp_link: '', accept_link: '', decline_link: '',
    };
    return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, t) => {
      const k = t.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ctx, k) ? String(ctx[k]) : '';
    });
  }

  return (
    <div className="page">
      {/* The flyer picture for the email tracks the event's own details, so it
          has to keep re-rendering while the designer is off-screen. */}
      {step !== 2 ? (
        <FlyerSnapshotKeeper eventBasics={basics} flyer={ev.flyer}
          onChange={(flyer) => patch({ flyer })} />
      ) : null}
      <div className="page-head">
        <div>
          <h1 className="page-title">{editing ? `Edit: ${ev.title || 'event'}` : 'New event'}</h1>
          <p className="page-sub">The wizard saves as you go — leave any time and pick up later.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={saveDraftAndExit} disabled={saving}>Save & exit</button>
        </div>
      </div>

      <div className="wiz">
        <div className="wiz-rail">
          {STEPS.map((label, i) => (
            <button key={label}
              className={`wiz-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              disabled={i > maxStep}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => goTo(i)}>
              <span className="n">
                {i < step ? <Icon name="check" size={11} strokeWidth={2.6} /> : i + 1}
              </span> {label}
            </button>
          ))}
        </div>

        <div>
          {error ? <Banner tone="bad">{error}</Banner> : null}

          {step === 0 ? (
            <Card title="What's the occasion?">
              <Field label="Event title" required>
                <input value={ev.title} maxLength={200} placeholder="Summer Gala 2026"
                  onChange={(e) => patch({ title: e.target.value })} autoFocus />
              </Field>
              <Field label="Host" hint="Defaults to your organization name. Shown as “Hosted by …” on the flyer and emails.">
                <input value={ev.host_name} maxLength={200} placeholder="The Events Committee"
                  onChange={(e) => patch({ host_name: e.target.value })} />
              </Field>
              <div className="field-row3">
                <Field label="Date">
                  <input type="date" value={ev.date} onChange={(e) => patch({ date: e.target.value })} />
                </Field>
                <Field label="Starts">
                  <input type="time" value={ev.start_time} onChange={(e) => patch({ start_time: e.target.value })} />
                </Field>
                <Field label="Ends">
                  <input type="time" value={ev.end_time} onChange={(e) => patch({ end_time: e.target.value })} />
                </Field>
              </div>
              <VenuePicker
                value={{
                  venue_name: ev.venue_name, venue_address: ev.venue_address,
                  venue_phone: ev.venue_phone, venue_map_url: ev.venue_map_url,
                }}
                onChange={patch} />
              <Field label="Description" hint="Shown on the public event page. Use the toolbar for bold, italics, underline, fonts and sizes.">
                <RichText value={ev.description} placeholder="Tell guests what to expect…"
                  onChange={(html) => patch({ description: html })} />
              </Field>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card title="How should guests respond?">
              <div className="seg" style={{ marginBottom: 16 }}>
                <OptionCard name="rsvp_mode" checked={ev.rsvp_mode === 'rsvp'}
                  onSelect={() => patch({ rsvp_mode: 'rsvp' })}
                  title="Collect RSVPs"
                  sub="Guests accept or decline; you see exactly who's coming." />
                <OptionCard name="rsvp_mode" checked={ev.rsvp_mode === 'open'}
                  onSelect={() => patch({ rsvp_mode: 'open' })}
                  title="Open event"
                  sub="No RSVP — invitations are informational, everyone's welcome." />
              </div>

              {ev.rsvp_mode === 'rsvp' ? (
                <>
                  <div className="field-row">
                    <Field label="RSVP deadline" hint="After this date responses close. Optional.">
                      <input type="date" value={ev.rsvp_deadline}
                        onChange={(e) => patch({ rsvp_deadline: e.target.value })} />
                    </Field>
                    <Field label="Capacity" hint="Total places including plus-ones. Leave empty for unlimited.">
                      <input type="number" min="1" value={ev.capacity}
                        onChange={(e) => patch({ capacity: e.target.value })} />
                    </Field>
                  </div>
                  <label className="checkbox">
                    <input type="checkbox" checked={ev.allow_plus_ones}
                      onChange={(e) => patch({ allow_plus_ones: e.target.checked })} />
                    <span><span className="cb-label">Allow plus-ones</span>
                      <div className="cb-sub">Guests can say how many people they're bringing.</div></span>
                  </label>
                  {ev.allow_plus_ones ? (
                    <Field label="Largest party size">
                      <select value={ev.max_party_size}
                        onChange={(e) => patch({ max_party_size: Number(e.target.value) })}>
                        <option value={0}>Unlimited (no cap)</option>
                        {[2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                  ) : null}
                  <label className="checkbox">
                    <input type="checkbox" checked={ev.show_guest_list}
                      onChange={(e) => patch({ show_guest_list: e.target.checked })} />
                    <span><span className="cb-label">Show the guest list on the event page</span>
                      <div className="cb-sub">First names + last initial of everyone who accepted.</div></span>
                  </label>
                </>
              ) : null}

              <label className="checkbox">
                <input type="checkbox" checked={ev.share_enabled}
                  onChange={(e) => patch({ share_enabled: e.target.checked })} />
                <span><span className="cb-label">Shareable link</span>
                  <div className="cb-sub">Anyone with the event link can view it{ev.rsvp_mode === 'rsvp' ? ' and RSVP — perfect for forwarding' : ''}. Turn off to limit responses to personal invitations.</div></span>
              </label>
            </Card>
          ) : null}

          {step === 2 ? (
            <>
              <Card title="Design the flyer">
                <FlyerDesigner eventBasics={basics} flyer={ev.flyer}
                  onChange={(flyer) => patch({ flyer })} />
              </Card>
              <Card title="Write the invitation email">
                {templates.length > 0 ? (
                  <Field label="Start from a template">
                    <select defaultValue="" onChange={(e) => {
                      const t = templates.find((x) => x.id === Number(e.target.value));
                      if (t) patch({ email_subject: t.subject || ev.email_subject, email_body: t.body });
                    }}>
                      <option value="" disabled>Choose a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <Field label="Subject">
                  <input value={ev.email_subject} maxLength={300}
                    onChange={(e) => patch({ email_subject: e.target.value })} />
                </Field>
                <Field label="Message"
                  hint="Placeholders fill in per guest. Accept / Decline buttons and event details are added automatically below your message.">
                  <textarea ref={bodyRef} rows={8} value={ev.email_body} maxLength={20000}
                    onChange={(e) => patch({ email_body: e.target.value })} />
                  <TagButtons onInsert={(snippet) =>
                    insertAtCursor(bodyRef, ev.email_body, snippet, (val) => patch({ email_body: val }))} />
                </Field>
                <button className="btn" onClick={previewEmail} disabled={saving}>
                  <Icon name="eye" size={14} /> Preview email
                </button>
              </Card>
            </>
          ) : null}

          {step === 3 ? (
            <Card title="Who's invited?">
              {guests.length > 0 ? (
                <Banner tone="info">
                  {guests.length} guest{guests.length === 1 ? '' : 's'} already on the list
                  {editing ? ' (manage them from the event page)' : ''}. Anyone you pick here is added on top.
                </Banner>
              ) : null}
              <RecipientPicker value={recipients} onChange={setRecipients}
                alreadyInvited={new Set(guests.map((g) => g.email).filter(Boolean))} />
            </Card>
          ) : null}

          {step === 4 ? (
            <Card title="Review & send">
              <div className="kv"><span className="k">Event</span><span><strong>{resolvePlaceholders(ev.title)}</strong></span></div>
              <div className="kv"><span className="k">When</span>
                <span>{ev.date ? `${ev.date}${ev.start_time ? ` at ${ev.start_time}` : ''}` : <em>No date yet — required before sending</em>}</span></div>
              <div className="kv"><span className="k">Where</span>
                <span>{[ev.venue_name, ev.venue_address].filter(Boolean).join(' — ') || '—'}</span></div>
              <div className="kv"><span className="k">RSVPs</span>
                <span>{ev.rsvp_mode === 'rsvp'
                  ? `Collecting responses${ev.rsvp_deadline ? ` until ${ev.rsvp_deadline}` : ''}${ev.capacity ? ` · capacity ${ev.capacity}` : ''}`
                  : 'Open event, no RSVP'}</span></div>
              <div className="kv"><span className="k">Recipients</span>
                <span><strong>{sendable}</strong> will be emailed{guests.length ? ` · ${guests.length} on the guest list` : ''}{pendingSelection ? ` · ${pendingSelection} selection${pendingSelection === 1 ? '' : 's'} to add first` : ''}</span></div>
              <div className="kv"><span className="k">Subject</span><span>{resolvePlaceholders(ev.email_subject)}</span></div>

              {!ev.date ? (
                <div className="mt">
                  <Banner tone="warn">Add a date (step 1) before sending invitations.</Banner>
                </div>
              ) : null}

              <div className="row mt">
                <button className="btn btn-primary btn-lg"
                  disabled={saving || !ev.date || (sendable === 0 && pendingSelection === 0)}
                  onClick={() => setConfirmSend(true)}>
                  <Icon name="send" size={15} /> Send invitations
                </button>
                <button className="btn btn-lg" onClick={saveDraftAndExit} disabled={saving}>
                  {ev.date ? 'Save without sending' : 'Save draft'}
                </button>
              </div>
              {sendable === 0 && pendingSelection === 0 ? (
                <p className="small muted" style={{ marginTop: 8 }}>
                  No un-emailed guests yet — add guests in step 4, or save and share the event link instead.
                </p>
              ) : null}

              <div className="divider" style={{ margin: '18px 0' }} />
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Send yourself a test first</h3>
              <div className="row">
                <input className="input" style={{ maxWidth: 280 }} type="email"
                  aria-label="Send the test email to"
                  placeholder="you@example.org (defaults to your login)"
                  value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                <button className="btn" onClick={sendTest} disabled={saving}>Send test email</button>
              </div>
            </Card>
          ) : null}

          <div className="wiz-foot">
            <button className="btn" onClick={() => goTo(step - 1)} disabled={step === 0 || saving}>
              <Icon name="arrowLeft" size={15} /> Back
            </button>
            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" onClick={() => goTo(step + 1)} disabled={saving}>
                {saving ? 'Saving…' : <>Continue <Icon name="arrowRight" size={15} /></>}
              </button>
            ) : <span />}
          </div>
        </div>
      </div>

      {emailPreview ? (
        <Modal title={`Preview — ${emailPreview.subject}`} size="lg" onClose={() => setEmailPreview(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>Rendered for {emailPreview.to}. Buttons in previews link to the event page.</p>
          <iframe className="email-frame" title="Email preview" srcDoc={emailPreview.html} />
        </Modal>
      ) : null}

      {confirmSend ? (
        <Modal title="Send invitations now?" onClose={() => setConfirmSend(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmSend(false)}>Cancel</button>
              <button className="btn btn-green" onClick={sendNow} disabled={saving}>
                {saving ? 'Sending…' : 'Yes, send'}
              </button>
            </>
          }>
          <p style={{ marginTop: 0 }}>
            Invitation emails will be queued for the <strong>{sendable}</strong> guest{sendable === 1 ? '' : 's'} who
            have an email address and haven't been contacted yet{pendingSelection ? ', plus anyone you just selected' : ''}.
            The event page goes live at the same time.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
