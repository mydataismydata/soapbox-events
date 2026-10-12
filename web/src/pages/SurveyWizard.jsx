import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDate, todayIso } from '../api.js';
import { Field, Modal, Spinner, useToast, Banner, Card, Icon, useDelayedSend } from '../ui.jsx';
import RecipientPicker from '../components/RecipientPicker.jsx';
import TagButtons from '../components/TagButtons.jsx';
import RichText, { looksLikeHtml, plainToHtml } from '../components/RichText.jsx';
import QuestionEditor, { withKeys, questionsPayload } from '../components/QuestionEditor.jsx';

const STEPS = ['Details', 'Questions', 'Invitation', 'People', 'Review & send'];

export const SURVEY_TAGS = [
  { tag: 'first_name', label: 'First name', sample: 'Alex' },
  { tag: 'full_name', label: 'Full name', sample: 'Alex Rivera' },
  { tag: 'survey_title', label: 'Survey title', sample: 'Fall priorities' },
  { tag: 'closes_on', label: 'Closing date', sample: 'Friday, October 30, 2026' },
  { tag: 'org_name', label: 'Organization', sample: 'Community Club' },
];

const DEFAULT_SUBJECT = 'Your opinion, please: {{survey_title}}';
const DEFAULT_BODY = `Hi {{first_name}},

{{org_name}} would like to hear what you think. The survey only takes a few minutes.

Please use the button below to answer.`;

const BLANK = {
  title: '', description: '', share_enabled: false, anonymous: false, closes_on: '',
  email_subject: DEFAULT_SUBJECT, email_body: plainToHtml(DEFAULT_BODY), questions: [],
};
const NOBODY = { contact_ids: [], group_ids: [], excluded_contact_ids: [], new_contacts: [] };

// The ids the server gave new questions and choices, put back on the cards
// they belong to, so the next save names them the same way.
function mergeIds(local, saved) {
  return local.map((q, i) => {
    const s = saved[i];
    if (!s || s.kind !== q.kind) return q;
    return {
      ...q,
      id: s.id,
      options: (q.options || []).filter((o) => o.label.trim())
        .map((o, j) => (s.options?.[j] ? { ...o, id: s.options[j].id } : o)),
    };
  });
}

export default function SurveyWizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const delayed = useDelayedSend();
  const editing = Boolean(id);

  const [surveyId, setSurveyId] = useState(id ? Number(id) : null);
  const [s, setS] = useState(editing ? null : { ...BLANK });
  const [meta, setMeta] = useState({ state: 'draft', locked: false, share_url: '' });
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(editing ? STEPS.length - 1 : 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [people, setPeople] = useState([]);
  const [recipients, setRecipients] = useState(NOBODY);
  const [emailPreview, setEmailPreview] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [testTo, setTestTo] = useState('');
  const bodyRef = useRef(null);

  async function refreshPeople(sid = surveyId) {
    if (!sid) return;
    try { setPeople((await api.get(`/api/surveys/${sid}/people`)).people); } catch { /* not fatal */ }
  }

  useEffect(() => {
    if (!editing) return;
    api.get(`/api/surveys/${id}`).then((d) => {
      const sv = d.survey;
      setS({
        title: sv.title ?? '',
        description: sv.description ?? '',
        share_enabled: sv.share_enabled,
        anonymous: sv.anonymous,
        closes_on: sv.closes_on || '',
        email_subject: sv.email_subject || DEFAULT_SUBJECT,
        email_body: sv.email_body ? (looksLikeHtml(sv.email_body) ? sv.email_body : plainToHtml(sv.email_body)) : plainToHtml(DEFAULT_BODY),
        questions: withKeys(sv.questions),
      });
      setMeta({ state: sv.state, locked: sv.locked, share_url: sv.share_url });
    }).catch((err) => setError(err.message));
    refreshPeople(Number(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function patch(p) { setS((cur) => ({ ...cur, ...p })); }

  function payload() {
    return {
      title: s.title, description: s.description, share_enabled: s.share_enabled, anonymous: s.anonymous,
      closes_on: s.closes_on || '', email_subject: s.email_subject, email_body: s.email_body,
      questions: questionsPayload(s.questions),
    };
  }

  async function persist() {
    setSaving(true);
    setError('');
    try {
      const d = surveyId
        ? await api.put(`/api/surveys/${surveyId}`, payload())
        : await api.post('/api/surveys', payload());
      setSurveyId(d.survey.id);
      setS((cur) => ({ ...cur, questions: mergeIds(cur.questions, d.survey.questions) }));
      setMeta({ state: d.survey.state, locked: d.survey.locked, share_url: d.survey.share_url });
      return d.survey.id;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const pendingSelection = useMemo(() => recipients.contact_ids.length + recipients.group_ids.length
    + recipients.new_contacts.filter((n) => n.name.trim()).length, [recipients]);

  async function persistPeople(sid) {
    if (!pendingSelection) return;
    const result = await api.post(`/api/surveys/${sid}/people`, {
      ...recipients, new_contacts: recipients.new_contacts.filter((n) => n.name.trim()), save_new: true,
    });
    setRecipients(NOBODY);
    await refreshPeople(sid);
    toast(`${result.added} ${result.added === 1 ? 'person' : 'people'} added${result.skipped ? ` (${result.skipped} already on the survey)` : ''}`);
  }

  async function goTo(next) {
    if (next > step && step === 0 && !s.title.trim()) {
      setError('Give the survey a title first.');
      return;
    }
    if (next > step && step === 1 && s.questions.length === 0) {
      setError('Add at least one question.');
      return;
    }
    try {
      const sid = await persist();
      if (step === 3 && next > 3) await persistPeople(sid);
      setStep(next);
      setMaxStep((m) => Math.max(m, next));
      setError('');
    } catch { /* shown */ }
  }

  async function saveDraftAndExit() {
    try {
      const sid = await persist();
      if (step >= 3) await persistPeople(sid);
      toast('Saved');
      navigate(`/surveys/${sid}`);
    } catch { /* shown */ }
  }

  // A public survey can open with nobody emailed, to be shared by its link.
  async function openNow() {
    try {
      const sid = await persist();
      if (step >= 3) await persistPeople(sid);
      await api.post(`/api/surveys/${sid}/open`, {});
      toast('The survey is open. No emails were sent.');
      navigate(`/surveys/${sid}`);
    } catch (err) { setError(err.message); }
  }

  async function sendNow() {
    try {
      const sid = await persist();
      await persistPeople(sid);
      const result = await api.post(`/api/surveys/${sid}/send`, {});
      toast(`${result.queued} survey email${result.queued === 1 ? '' : 's'} queued`
        + (result.skipped?.unsubscribed ? ` · ${result.skipped.unsubscribed} unsubscribed skipped` : ''));
      navigate(`/surveys/${sid}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function previewEmail() {
    try {
      const sid = await persist();
      setEmailPreview(await api.post(`/api/surveys/${sid}/email-preview`, {
        kind: 'survey', subject: s.email_subject, body: s.email_body,
      }));
    } catch (err) { setError(err.message); }
  }

  async function sendTest() {
    try {
      const sid = await persist();
      const d = await api.post(`/api/surveys/${sid}/test-email`, testTo ? { to: testTo } : {});
      toast(d.status === 'simulated'
        ? 'Test rendered in simulation mode. View it under the survey’s Email log tab.'
        : 'Test email sent. Check your inbox.');
    } catch (err) { toast(err.message, 'bad'); }
  }

  const sendable = people.filter((p) => ['not_sent', 'failed'].includes(p.email_status)
    && !p.responded_at && p.email && !p.unsubscribed).length;
  const closed = meta.state === 'closed';

  if (!s) return <div className="page">{error ? <Banner tone="bad">{error}</Banner> : <Spinner />}</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{editing ? `Edit: ${s.title || 'survey'}` : 'New survey'}</h1>
          <p className="page-sub">Write the questions, then email everyone their own link. Saves as you go.</p>
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
              <span className="n">{i < step ? <Icon name="check" size={11} strokeWidth={2.6} /> : i + 1}</span> {label}
            </button>
          ))}
        </div>

        <div>
          {error ? <Banner tone="bad">{error}</Banner> : null}

          {step === 0 ? (
            <Card title="What are you asking about?">
              <Field label="Title" required hint="Shown at the top of the survey page and in the email.">
                <input value={s.title} maxLength={200} placeholder="Fall priorities"
                  onChange={(e) => patch({ title: e.target.value })} autoFocus />
              </Field>
              <Field label="Introduction" hint="Shown above the questions. Say what the survey is for and how long it takes.">
                <RichText value={s.description} placeholder="We are planning next year and would like your views…"
                  onChange={(html) => patch({ description: html })} />
              </Field>
              <Field label="Closing date" hint="The last day it takes answers. Leave it empty to close it yourself.">
                <input type="date" value={s.closes_on} min={todayIso()} style={{ maxWidth: 200 }}
                  onChange={(e) => patch({ closes_on: e.target.value })} />
              </Field>
              <label className="checkbox">
                <input type="checkbox" checked={s.share_enabled}
                  onChange={(e) => patch({ share_enabled: e.target.checked })} />
                <span><span className="cb-label">Public survey</span>
                  <div className="cb-sub">Anyone with the survey’s link can answer, as well as the people you email.
                    Turn it off and only the people you email can answer, each through their own link.</div></span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={s.anonymous} disabled={meta.locked}
                  onChange={(e) => patch({ anonymous: e.target.checked })} />
                <span><span className="cb-label">Anonymous</span>
                  <div className="cb-sub">
                    {meta.locked
                      ? 'People have answered already, so this can’t change now.'
                      : 'Answers are kept with no link to who gave them. You still see who has answered, so reminders skip them, but not what they said. People can’t change anonymous answers once sent.'}
                  </div></span>
              </label>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card title="Questions" sub="People answer them in this order.">
              <QuestionEditor questions={s.questions} locked={meta.locked}
                onChange={(questions) => patch({ questions })} />
            </Card>
          ) : null}

          {step === 2 ? (
            <Card title="Write the invitation">
              <Field label="Email subject">
                <input value={s.email_subject} maxLength={300}
                  onChange={(e) => patch({ email_subject: e.target.value })} />
              </Field>
              <Field label="Message" hint="Each email ends with a button to the person’s own survey page, so you don’t add a link.">
                <RichText ref={bodyRef} links images value={s.email_body}
                  onChange={(html) => patch({ email_body: html })} />
                <TagButtons tags={SURVEY_TAGS} onInsert={(snippet) => bodyRef.current?.insertText(snippet)} />
              </Field>
              <button className="btn" onClick={previewEmail} disabled={saving}>
                <Icon name="eye" size={14} /> Preview email
              </button>
            </Card>
          ) : null}

          {step === 3 ? (
            <Card title="Who are you asking?">
              {people.length > 0 ? (
                <Banner tone="info">
                  {people.length} {people.length === 1 ? 'person is' : 'people are'} already on this survey
                  {editing ? ' (manage them from the survey page)' : ''}. Anyone you pick here is added on top.
                </Banner>
              ) : null}
              <RecipientPicker value={recipients} onChange={setRecipients} noun="person"
                alreadyInvited={new Set(people.map((p) => p.email).filter(Boolean))} />
            </Card>
          ) : null}

          {step === 4 ? (
            <Card title="Review & send">
              <div className="kv"><span className="k">Survey</span><span><strong>{s.title || '—'}</strong></span></div>
              <div className="kv"><span className="k">Questions</span>
                <span>{s.questions.length || <em>None yet. Add them in step 2.</em>}</span></div>
              <div className="kv"><span className="k">Who can answer</span>
                <span>{s.share_enabled ? 'Anyone with the link, and the people you email' : 'Only the people you email'}</span></div>
              <div className="kv"><span className="k">Answers</span>
                <span>{s.anonymous ? 'Anonymous, and final once sent' : 'Named, and can be changed until it closes'}</span></div>
              <div className="kv"><span className="k">Closes</span>
                <span>{s.closes_on ? formatDate(s.closes_on) : 'When you close it'}</span></div>
              <div className="kv"><span className="k">People</span>
                <span><strong>{sendable}</strong> will be emailed{people.length ? ` · ${people.length} on the survey` : ''}
                  {pendingSelection ? ` · ${pendingSelection} selection${pendingSelection === 1 ? '' : 's'} to add first` : ''}</span></div>

              {closed ? <div className="mt"><Banner tone="warn">This survey is closed. Reopen it from its page to send more.</Banner></div> : null}

              <div className="row mt">
                <button className="btn btn-primary btn-lg"
                  disabled={saving || closed || !s.questions.length || (sendable === 0 && pendingSelection === 0)}
                  onClick={() => setConfirmSend(true)}>
                  <Icon name="send" size={15} /> Send survey
                </button>
                {meta.state === 'draft' && s.share_enabled ? (
                  <button className="btn btn-lg" onClick={openNow} disabled={saving || !s.questions.length}>
                    <Icon name="eye" size={15} /> Open without sending
                  </button>
                ) : null}
                <button className="btn btn-lg" onClick={saveDraftAndExit} disabled={saving}>
                  {meta.state === 'draft' ? 'Save draft' : 'Save without sending'}
                </button>
              </div>
              {meta.state === 'draft' && s.share_enabled ? (
                <p className="small muted" style={{ marginTop: 8 }}>
                  Open without sending starts taking answers at the survey’s link, with no emails. Share the link
                  yourself, and send the survey to people later if you like.
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
          <p className="small muted" style={{ marginTop: 0 }}>
            Rendered for {emailPreview.to}. In a preview, the button goes to the survey’s shared page.
          </p>
          <iframe className="email-frame" title="Email preview" srcDoc={emailPreview.html} />
        </Modal>
      ) : null}

      {confirmSend ? (
        <Modal title="Send the survey now?" onClose={() => setConfirmSend(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmSend(false)}>Cancel</button>
              <button className="btn btn-green" disabled={saving}
                onClick={() => { setConfirmSend(false); delayed.start('the survey', sendNow); }}>
                Yes, send
              </button>
            </>
          }>
          <p style={{ marginTop: 0 }}>
            The survey will be emailed to the <strong>{sendable}</strong> {sendable === 1 ? 'person' : 'people'} with
            an email address who haven’t been sent it yet{pendingSelection ? ', plus anyone you just selected' : ''}.
            It starts taking answers straight away.
          </p>
        </Modal>
      ) : null}
      {delayed.popup}
    </div>
  );
}
