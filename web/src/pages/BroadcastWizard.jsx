import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Field, Modal, Spinner, useToast, insertAtCursor, Banner, Card, Icon } from '../ui.jsx';
import FlyerDesigner from '../components/FlyerDesigner.jsx';
import RecipientPicker from '../components/RecipientPicker.jsx';
import TagButtons from '../components/TagButtons.jsx';

const STEPS = ['Details', 'Design & message', 'Recipients', 'Review & send'];

// Broadcasts have no event/RSVP context, so only a few tags apply.
const BROADCAST_TAGS = [
  { tag: 'first_name', label: 'First name', sample: 'Alex' },
  { tag: 'full_name', label: 'Full name', sample: 'Alex Rivera' },
  { tag: 'org_name', label: 'Organization', sample: 'Community Club' },
];

const DEFAULT_BODY = `Hi {{first_name}},

Write your message here.

— {{org_name}}`;

const BLANK = {
  title: '', subject: '', body: DEFAULT_BODY, web_version: true,
  flyer: {
    style: 'blue', font: 'sans', scale: 'm',
    eyebrow: '', tagline: '', note: '', contact: '', showHost: false, showAddress: false,
    imageColumns: 1, imageTokens: [], imageCaptions: [], imageToken: '', imageCaption: '',
  },
};

export default function BroadcastWizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const editing = Boolean(id);

  const [broadcastId, setBroadcastId] = useState(id ? Number(id) : null);
  const [b, setB] = useState(editing ? null : { ...BLANK });
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(editing ? STEPS.length - 1 : 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recipients, setRecipients] = useState({ contact_ids: [], group_ids: [], new_contacts: [] });
  const [templates, setTemplates] = useState([]);
  const [emailPreview, setEmailPreview] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [recipientCount, setRecipientCount] = useState(0);
  const bodyRef = useRef(null);

  useEffect(() => {
    api.get('/api/templates').then((d) => setTemplates(d.templates)).catch(() => {});
    if (editing) {
      api.get(`/api/broadcasts/${id}`).then((d) => {
        const bc = d.broadcast;
        setB({
          ...BLANK,
          title: bc.title ?? '',
          subject: bc.subject ?? '',
          body: bc.body ?? '',
          web_version: bc.web_version,
          flyer: { ...BLANK.flyer, ...bc.flyer },
        });
        setRecipients({
          contact_ids: bc.audience?.contact_ids || [],
          group_ids: bc.audience?.group_ids || [],
          new_contacts: bc.audience?.new_contacts || [],
        });
        if (bc.status !== 'draft') {
          toast('This broadcast was already sent — changes create a fresh send when you send again.', 'bad');
        }
      }).catch((err) => setError(err.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function patch(p) { setB((cur) => ({ ...cur, ...p })); }

  function audiencePayload() {
    return {
      contact_ids: recipients.contact_ids,
      group_ids: recipients.group_ids,
      new_contacts: recipients.new_contacts.filter((n) => n.name.trim()),
    };
  }

  async function persist() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: b.title, subject: b.subject, body: b.body,
        web_version: b.web_version, flyer: b.flyer, audience: audiencePayload(),
      };
      if (!broadcastId) {
        const d = await api.post('/api/broadcasts', payload);
        setBroadcastId(d.broadcast.id);
        return d.broadcast.id;
      }
      await api.put(`/api/broadcasts/${broadcastId}`, payload);
      return broadcastId;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function goTo(next) {
    if (next > step && step === 0 && !b.title.trim()) {
      setError('Give the broadcast a title first.');
      return;
    }
    try {
      await persist();
      setStep(next);
      setMaxStep((m) => Math.max(m, next));
      setError('');
    } catch { /* shown */ }
  }

  async function saveDraftAndExit() {
    try {
      const bid = await persist();
      toast('Saved');
      navigate(`/broadcasts/${bid}`);
    } catch { /* shown */ }
  }

  async function sendNow() {
    try {
      const bid = await persist();
      const result = await api.post(`/api/broadcasts/${bid}/send`, audiencePayload());
      toast(`${result.queued} email${result.queued === 1 ? '' : 's'} queued`
        + (result.skipped?.unsubscribed ? ` · ${result.skipped.unsubscribed} unsubscribed skipped` : ''));
      navigate(`/broadcasts/${bid}`);
    } catch (err) {
      setConfirmSend(false);
      setError(err.message);
    }
  }

  async function previewEmail() {
    try {
      const bid = await persist();
      const d = await api.post(`/api/broadcasts/${bid}/email-preview`, { subject: b.subject, body: b.body });
      setEmailPreview(d);
    } catch (err) { setError(err.message); }
  }

  async function sendTest() {
    try {
      const bid = await persist();
      const d = await api.post(`/api/broadcasts/${bid}/test-email`, testTo ? { to: testTo } : {});
      toast(d.status === 'simulated'
        ? 'Test rendered in simulation mode — view it on the broadcast page'
        : 'Test email sent — check your inbox');
    } catch (err) { toast(err.message, 'bad'); }
  }

  const pendingSelection = useMemo(() => {
    const ids = new Set(recipients.contact_ids);
    return ids.size + recipients.group_ids.length + recipients.new_contacts.filter((n) => n.name.trim()).length;
  }, [recipients]);

  // Actual number of emails this selection would send (groups expanded, deduped,
  // no-email + unsubscribed removed). null while loading.
  useEffect(() => {
    const sel = {
      contact_ids: recipients.contact_ids, group_ids: recipients.group_ids,
      new_contacts: recipients.new_contacts.filter((n) => n.name.trim()),
    };
    if (!sel.contact_ids.length && !sel.group_ids.length && !sel.new_contacts.length) {
      setRecipientCount(0);
      return;
    }
    let cancelled = false;
    setRecipientCount(null);
    api.post('/api/recipients/preview', sel)
      .then((d) => { if (!cancelled) setRecipientCount(d.recipients); })
      .catch(() => { if (!cancelled) setRecipientCount(null); });
    return () => { cancelled = true; };
  }, [recipients]);

  if (!b) return <div className="page">{error ? <Banner tone="bad">{error}</Banner> : <Spinner />}</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{editing ? `Edit: ${b.title || 'broadcast'}` : 'New broadcast'}</h1>
          <p className="page-sub">An email blast to your contacts — flyer and templates, no RSVP. Saves as you go.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={saveDraftAndExit} disabled={saving}>Save &amp; exit</button>
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
            <Card title="What are you sending?">
              <Field label="Title" required hint="Shown at the top of the email and web version, and as the internal name.">
                <input value={b.title} maxLength={200} placeholder="May 2026 Primary — Our Endorsements"
                  onChange={(e) => patch({ title: e.target.value })} autoFocus />
              </Field>
              <Field label="Email subject" hint="The subject line recipients see. Defaults to the title if left blank.">
                <input value={b.subject} maxLength={300} placeholder="Our endorsements for the May primary"
                  onChange={(e) => patch({ subject: e.target.value })} />
              </Field>
              <label className="checkbox">
                <input type="checkbox" checked={b.web_version}
                  onChange={(e) => patch({ web_version: e.target.checked })} />
                <span><span className="cb-label">Publish a web version</span>
                  <div className="cb-sub">Adds a “View this email online” link at an unguessable URL — handy when
                    email clients clip long messages. Turn off to keep this broadcast email-only.</div></span>
              </label>
            </Card>
          ) : null}

          {step === 1 ? (
            <>
              <Card title="Design the masthead">
                <FlyerDesigner mode="broadcast" eventBasics={{ title: b.title, host_name: '' }}
                  flyer={b.flyer} onChange={(flyer) => patch({ flyer })} />
              </Card>
              <Card title="Write the message">
                {templates.length > 0 ? (
                  <Field label="Start from a template" hint="Event-only placeholders (dates, venue) are left blank in a broadcast.">
                    <select defaultValue="" onChange={(e) => {
                      const t = templates.find((x) => x.id === Number(e.target.value));
                      if (t) patch({ body: t.body, subject: b.subject || t.subject });
                    }}>
                      <option value="" disabled>Choose a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <Field label="Message" hint="Placeholders fill in per recipient. The masthead above and an unsubscribe footer are added automatically.">
                  <textarea ref={bodyRef} rows={9} value={b.body} maxLength={20000}
                    onChange={(e) => patch({ body: e.target.value })} />
                  <TagButtons tags={BROADCAST_TAGS} onInsert={(snippet) =>
                    insertAtCursor(bodyRef, b.body, snippet, (val) => patch({ body: val }))} />
                </Field>
                <button className="btn" onClick={previewEmail} disabled={saving}>
                  <Icon name="eye" size={14} /> Preview email
                </button>
              </Card>
            </>
          ) : null}

          {step === 2 ? (
            <Card title="Who receives this?">
              <RecipientPicker value={recipients} onChange={setRecipients} />
            </Card>
          ) : null}

          {step === 3 ? (
            <Card title="Review & send">
              <div className="kv"><span className="k">Broadcast</span><span><strong>{b.title || '—'}</strong></span></div>
              <div className="kv"><span className="k">Subject</span><span>{b.subject || b.title || '—'}</span></div>
              <div className="kv"><span className="k">Web version</span>
                <span>{b.web_version ? 'On — “view in browser” link included' : 'Off — email only'}</span></div>
              <div className="kv"><span className="k">Recipients</span>
                <span>{recipientCount == null ? '…'
                  : recipientCount === 0 ? <em>None selected yet</em>
                    : <><strong>{recipientCount}</strong> recipient{recipientCount === 1 ? '' : 's'} will be emailed</>}</span></div>

              {recipientCount === 0 ? (
                <div className="mt">
                  <Banner tone="warn">
                    {pendingSelection === 0
                      ? 'Pick recipients (step 3) before sending.'
                      : 'None of the selected people have an email address (or they’ve unsubscribed).'}
                  </Banner>
                </div>
              ) : null}

              <div className="row mt">
                <button className="btn btn-primary btn-lg" disabled={saving || !recipientCount}
                  onClick={() => setConfirmSend(true)}>
                  <Icon name="send" size={15} /> Send broadcast
                </button>
                <button className="btn btn-lg" onClick={saveDraftAndExit} disabled={saving}>Save draft</button>
              </div>

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
          <p className="small muted" style={{ marginTop: 0 }}>Rendered for a sample recipient ({emailPreview.to}).</p>
          <iframe className="email-frame" title="Email preview" srcDoc={emailPreview.html} />
        </Modal>
      ) : null}

      {confirmSend ? (
        <Modal title="Send this broadcast now?" onClose={() => setConfirmSend(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmSend(false)}>Cancel</button>
              <button className="btn btn-green" onClick={sendNow} disabled={saving}>
                {saving ? 'Sending…' : 'Yes, send'}
              </button>
            </>
          }>
          <p style={{ marginTop: 0 }}>
            {recipientCount} email{recipientCount === 1 ? '' : 's'} will be queued — one per recipient with an
            email address who hasn't unsubscribed.
            {b.web_version ? ' The web version goes live at the same time.' : ''}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
