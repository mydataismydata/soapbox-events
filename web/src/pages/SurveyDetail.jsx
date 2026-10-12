import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatDate, timeAgo, todayIso } from '../api.js';
import {
  Spinner, Modal, ConfirmModal, Empty, Field, CopyBox, CopyButton, useToast, EmailStatusBadge, Badge,
  insertAtCursor, useDelayedSend, Banner, Card, StatGrid, Stat, IconButton, Icon, SortTh, useSort, sortRows,
} from '../ui.jsx';
import RecipientPicker from '../components/RecipientPicker.jsx';
import TagButtons from '../components/TagButtons.jsx';
import EmailLog from '../components/EmailLog.jsx';
import SurveyResults from '../components/SurveyResults.jsx';
import { SurveyBadge, surveyTraits } from './SurveysList.jsx';
import { SURVEY_TAGS } from './SurveyWizard.jsx';

const NOBODY = { contact_ids: [], group_ids: [], excluded_contact_ids: [], new_contacts: [] };

const REMINDER = {
  subject: 'Reminder: {{survey_title}}',
  body: `Hi {{first_name}},

Just a reminder: we would still like your answers to {{survey_title}}.

It only takes a few minutes. Use the button below to answer.`,
};

const EMAIL_RANK = { sent: 0, queued: 1, failed: 2, not_sent: 3 };
const PEOPLE_SORTS = {
  name: (p) => p.name || p.email || '',
  email_status: (p) => EMAIL_RANK[p.email_status] ?? 9,
  answered: (p) => (p.responded_at ? 0 : 1),
};

// Who the next send reaches, as sendQueue.js works it out for an event:
// people not yet emailed, or whose email failed, who haven't answered.
function surveyQueue(people) {
  const pending = people.filter((p) => !p.responded_at && ['not_sent', 'failed'].includes(p.email_status));
  const reachable = pending.filter((p) => p.email && !p.unsubscribed);
  return {
    sendable: reachable.length,
    added: reachable.filter((p) => p.email_status === 'not_sent').length,
    retry: reachable.filter((p) => p.email_status === 'failed').length,
    firstPush: people.every((p) => p.email_status === 'not_sent'),
  };
}

function queueLabel(q) {
  const people = (n) => `${n} new ${n === 1 ? 'person' : 'people'}`;
  if (q.firstPush) return `Send survey (${q.sendable})`;
  if (q.sendable === 0) return 'Send to new people';
  if (q.retry === 0) return `Send to ${people(q.added)}`;
  if (q.added === 0) return `Retry ${q.retry} failed email${q.retry === 1 ? '' : 's'}`;
  return `Send ${q.sendable} pending email${q.sendable === 1 ? '' : 's'}`;
}

function AnsweredBadge({ person }) {
  return person.responded_at ? <Badge tone="green" dot>Answered</Badge> : <Badge tone="gray" dot>Not yet</Badge>;
}

export default function SurveyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const delayed = useDelayedSend();

  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [results, setResults] = useState(null);
  const [responses, setResponses] = useState(null);
  const [emailSummary, setEmailSummary] = useState({ total: 0, pending: 0 });
  const [tab, setTab] = useState('results');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, sortBy] = useSort('name');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [recipients, setRecipients] = useState(NOBODY);
  const [confirm, setConfirm] = useState(null);
  const [reopenDate, setReopenDate] = useState('');
  const [compose, setCompose] = useState(null);
  const [composePreview, setComposePreview] = useState(null);
  const [viewing, setViewing] = useState(null);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const tagTarget = useRef('body');
  const tabsRef = useRef(null);
  const filterRef = useRef(null);
  const [jump, setJump] = useState(0);

  const load = useCallback(async (quiet = false) => {
    try {
      const [d, p, r, rs] = await Promise.all([
        api.get(`/api/surveys/${id}`),
        api.get(`/api/surveys/${id}/people`),
        api.get(`/api/surveys/${id}/results`),
        api.get(`/api/surveys/${id}/responses`),
      ]);
      setData(d);
      setPeople(p.people);
      setResults(r);
      setResponses(rs);
    } catch (err) {
      if (!quiet) setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Keep up while emails are going out, as the event page does.
  useEffect(() => {
    if (!emailSummary.pending) return undefined;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [emailSummary.pending, load]);

  // A tile opens the people list on the people it counts.
  function showPeople(next) {
    setTab('people');
    setFilter(next);
    setQuery('');
    setJump((n) => n + 1);
  }
  useEffect(() => {
    if (!jump) return;
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    filterRef.current?.focus({ preventScroll: true });
  }, [jump]);

  const shown = useMemo(() => {
    const byFilter = {
      answered: people.filter((p) => p.responded_at),
      awaiting: people.filter((p) => !p.responded_at && p.email_status === 'sent'),
      not_sent: people.filter((p) => ['not_sent', 'failed'].includes(p.email_status)),
    }[filter] || people;
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? byFilter.filter((p) => (p.name || '').toLowerCase().includes(needle) || (p.email || '').toLowerCase().includes(needle))
      : byFilter;
    return sortRows(matched, sort, PEOPLE_SORTS);
  }, [people, filter, query, sort]);

  const askedEmails = useMemo(() => new Set(people.map((p) => p.email).filter(Boolean)), [people]);

  if (error) return <div className="page"><Banner tone="bad">{error}</Banner></div>;
  if (!data) return <div className="page"><Spinner /></div>;

  const sv = data.survey;
  const stats = data.stats;
  const queue = surveyQueue(people);
  const isOpen = sv.state === 'open';
  const awaiting = people.filter((p) => !p.responded_at && p.email_status === 'sent').length;
  const rate = stats.invited ? Math.round((stats.answered / stats.invited) * 100) : 0;

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

  async function sendReminder() {
    await act(async () => {
      const result = await api.post(`/api/surveys/${sv.id}/remind`, { subject: compose.subject, body: compose.body });
      toast(`${result.queued} reminder${result.queued === 1 ? '' : 's'} queued`
        + (result.skipped.unsubscribed ? ` · ${result.skipped.unsubscribed} unsubscribed skipped` : ''));
      setCompose(null);
      setTab('emails');
    });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="page-title">{sv.title}</h1>
            <SurveyBadge state={sv.state} />
          </div>
          <p className="page-sub">
            {surveyTraits(sv)}
            {sv.closes_on ? ` · ${sv.state === 'closed' ? 'Closed' : 'Closes'} ${formatDate(sv.closes_on)}` : ''}
          </p>
        </div>
        <div className="head-actions">
          <a className="btn" href={sv.share_url} target="_blank" rel="noopener noreferrer">
            {sv.state === 'draft' ? 'Preview' : 'View page'} <Icon name="external" size={14} />
          </a>
          {sv.state !== 'draft'
            ? <Link className="btn" to={`/surveys/${sv.id}/edit`}><Icon name="pencil" size={14} /> Edit</Link> : null}
          <button className="btn" onClick={() => act(async () => {
            const d = await api.post(`/api/surveys/${sv.id}/duplicate`);
            navigate(`/surveys/${d.survey.id}/edit`);
          })}><Icon name="copy" size={14} /> Duplicate</button>
          {isOpen ? <button className="btn" onClick={() => setConfirm({ type: 'close' })}>Close survey</button> : null}
          {sv.state === 'closed' ? <button className="btn" onClick={() => { setReopenDate(''); setConfirm({ type: 'reopen' }); }}>Reopen</button> : null}
          <button className="btn btn-danger" onClick={() => setConfirm({ type: 'delete' })}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>

      {sv.state === 'draft' ? (
        <div className="card card-pad draft-cta">
          <div>
            <strong style={{ fontSize: 14 }}>This survey isn’t finished yet</strong>
            <p className="small muted" style={{ margin: '2px 0 0' }}>
              It’s saved as a draft. Pick up where you left off to finish the questions and the people to ask, then send.
              {sv.share_enabled ? ' Or open it now with no emails, to share by its link.' : ''}
            </p>
          </div>
          <div className="row">
            {sv.share_enabled && sv.questions.length ? (
              <button className="btn" disabled={busy} onClick={() => act(
                () => api.post(`/api/surveys/${sv.id}/open`, {}), 'The survey is open. No emails were sent.',
              )}><Icon name="eye" size={15} /> Open without sending</button>
            ) : null}
            <Link className="btn btn-primary" to={`/surveys/${sv.id}/edit`}>
              Continue creating <Icon name="arrowRight" size={15} />
            </Link>
          </div>
        </div>
      ) : null}

      {sv.state === 'closed' ? (
        <Banner tone="info">This survey is closed. Its pages show that it has closed, and take no more answers.</Banner>
      ) : null}

      <StatGrid>
        <Stat icon="user" label="Asked" value={stats.invited}
          sub={`${stats.emails_sent} emailed · ${stats.emails_queued} queued`}
          onClick={() => showPeople('all')} title="Show everyone asked" />
        <Stat icon="checkCircle" tone="ok" label="Answered" value={stats.answered}
          sub={`${stats.responses} response${stats.responses === 1 ? '' : 's'} in all`}
          onClick={() => showPeople('answered')} title="Show the people who have answered" />
        <Stat icon="clipboard" tone="warn" label="Awaiting answers" value={stats.awaiting}
          sub={`${stats.not_reached} not yet emailed`}
          onClick={() => showPeople('awaiting')} title="Show the people who have not answered" />
        <Stat icon="listBullet" label="Response rate" value={`${rate}%`}
          sub={stats.invited ? `of the ${stats.invited} asked` : 'nobody asked yet'} />
      </StatGrid>

      {sv.share_enabled && isOpen ? (
        <Card style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13 }}>Shareable link</strong>
          <p className="small muted" style={{ margin: '2px 0 8px' }}>
            Anyone with this link can answer{sv.anonymous ? ', anonymously' : ', giving their name and email'}.
            Their answers count in the results straight away.
          </p>
          <CopyBox value={sv.share_url} />
        </Card>
      ) : null}

      <div className="tabs" role="tablist" ref={tabsRef} style={{ scrollMarginTop: 'calc(var(--topbar-h) + var(--sp-4))' }}>
        {[
          ['results', 'Results'],
          ['responses', `Responses (${stats.responses})`],
          ['people', `People (${people.length})`],
          ['reminders', 'Reminders'],
          ['emails', `Email log (${stats.emails_logged ?? 0})`],
        ].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key}
            className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'results' ? (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="small muted">
              {results?.responses
                ? `From ${results.responses} response${results.responses === 1 ? '' : 's'}${sv.anonymous ? ', given anonymously' : ''}.`
                : 'No answers yet. Results appear here as people answer.'}
            </span>
            {results?.responses ? (
              <a className="btn btn-sm" href={`/api/export/surveys/${sv.id}/responses.csv`}>
                <Icon name="download" size={14} /> Export responses
              </a>
            ) : null}
          </div>
          <SurveyResults results={results} />
        </>
      ) : null}

      {tab === 'responses' ? (
        <Card flush>
          {!responses?.responses.length ? (
            <Empty icon="inbox" title="No responses yet">Each set of answers shows up here as it arrives.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{responses.anonymous ? 'Response' : 'From'}</th>
                    <th>{responses.anonymous ? 'Day' : 'Answered'}</th>
                    <th>First answer</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {responses.responses.map((r, i) => {
                    const firstQ = responses.questions[0];
                    return (
                      <tr key={r.id}>
                        <td>
                          {responses.anonymous
                            ? <span className="t-main">Anonymous {i + 1}</span>
                            : <><div className="t-main">{r.name || '—'}</div><div className="t-sub">{r.email}</div></>}
                        </td>
                        <td className="t-sub nowrap">
                          {responses.anonymous ? formatDate(r.submitted_at.slice(0, 10)) : timeAgo(r.updated_at)}
                          {!responses.anonymous && r.updated_at !== r.submitted_at ? <div className="t-sub">changed since</div> : null}
                        </td>
                        <td className="ellipsis" style={{ maxWidth: 320 }} title={firstQ ? r.answers[firstQ.id] : ''}>
                          {firstQ ? (r.answers[firstQ.id] || <span className="muted">No answer</span>) : ''}
                        </td>
                        <td>
                          <div className="t-actions">
                            <button className="btn btn-sm" onClick={() => setViewing({ ...r, n: i + 1 })}>View</button>
                            <IconButton icon="trash" label="Take this response out of the results" tone="ghost" disabled={busy}
                              onClick={() => setConfirm({ type: 'removeResponse', response: r, n: i + 1 })} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'people' ? (
        <Card flush>
          <div className="table-toolbar">
            <div className="row">
              <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
                <Icon name="plus" size={14} /> Add people
              </button>
              {people.length > 0 && sv.state !== 'closed' ? (
                <button className="btn btn-green btn-sm" disabled={busy || queue.sendable === 0}
                  title={queue.sendable === 0 ? 'Add people to the list and this sends to just them.' : undefined}
                  onClick={() => setConfirm({ type: 'send' })}>
                  <Icon name="send" size={14} /> {queueLabel(queue)}
                </button>
              ) : null}
              <a className="btn btn-sm" href={`/api/export/surveys/${sv.id}/people.csv`}>
                <Icon name="download" size={14} /> Export CSV
              </a>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="search-field" style={{ width: 220 }}>
                <Icon name="search" size={15} />
                <input className="search-input" value={query} placeholder="Filter by name…"
                  aria-label="Filter people by name or email" onChange={(e) => setQuery(e.target.value)} />
              </div>
              <select ref={filterRef} className="search-input" style={{ width: 185 }} value={filter}
                aria-label="Filter people" onChange={(e) => setFilter(e.target.value)}>
                <option value="all">Everyone asked</option>
                <option value="answered">Answered</option>
                <option value="awaiting">Awaiting answers</option>
                <option value="not_sent">Not emailed / failed</option>
              </select>
            </div>
          </div>
          {sv.anonymous && people.length ? (
            <div style={{ padding: '0 var(--sp-5) var(--sp-3)' }}>
              <p className="small muted" style={{ margin: 0 }}>
                The survey is anonymous: this list says who has answered, never what they said.
              </p>
            </div>
          ) : null}
          {shown.length === 0 ? (
            <Empty icon="users" title={people.length ? 'Nobody matches this filter' : 'Nobody asked yet'}>
              {people.length ? '' : `Add people from your contacts${sv.share_enabled ? ', or share the survey’s link' : ''}.`}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh label="Person" k="name" sort={sort} onSort={sortBy} />
                    <SortTh label="Email" k="email_status" sort={sort} onSort={sortBy} />
                    <SortTh label="Answered" k="answered" sort={sort} onSort={sortBy} />
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          <span className="t-main">{p.name || '—'}</span>
                          {p.source === 'link' ? <span className="badge badge-indigo">via link</span> : null}
                          {p.unsubscribed ? <span className="badge badge-amber">Unsubscribed</span> : null}
                        </div>
                        <div className="t-sub">{p.email || 'no email address'}</div>
                      </td>
                      <td><EmailStatusBadge status={p.email_status} /></td>
                      <td>
                        <AnsweredBadge person={p} />
                        {p.responded_at ? <div className="t-sub">{sv.anonymous ? formatDate(p.responded_at.slice(0, 10)) : timeAgo(p.responded_at)}</div> : null}
                      </td>
                      <td>
                        <div className="t-actions">
                          <CopyButton value={p.link} label="Copy link" />
                          {p.email && sv.state !== 'closed' ? (
                            <IconButton icon="mail" label="Send / resend the survey" disabled={busy}
                              onClick={() => delayed.start(`the survey to ${p.name || p.email}`,
                                () => act(() => api.post(`/api/surveys/${sv.id}/send`, { invite_ids: [p.id] }), 'Survey email queued'))} />
                          ) : null}
                          <IconButton icon="trash" label="Remove from the survey" tone="ghost" disabled={busy}
                            onClick={() => setConfirm({ type: 'removePerson', person: p })} />
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

      {tab === 'reminders' ? (
        <div className="grid3">
          <div className="card card-pad">
            <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Remind people who haven’t answered</h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              {isOpen
                ? `${awaiting} ${awaiting === 1 ? 'person was' : 'people were'} emailed and ${awaiting === 1 ? 'hasn’t' : 'haven’t'} answered yet.`
                : 'Reminders go out only while the survey is open.'}
            </p>
            <button className="btn btn-sm" disabled={!isOpen || awaiting === 0}
              onClick={() => setCompose({ ...REMINDER })}>
              <Icon name="pencil" size={14} /> Compose
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'emails' ? (
        <Card flush>
          <EmailLog scope={{ survey_id: id }} onSummary={setEmailSummary}
            kinds={['survey', 'survey_reminder', 'test']}
            emptyHint="Everything sent for this survey shows up here, with its exact content." />
        </Card>
      ) : null}

      {addOpen ? (
        <Modal title="Add people" size="lg" onClose={() => setAddOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAddOpen(false)}>Close</button>
              <button className="btn btn-primary" disabled={busy}
                onClick={() => act(async () => {
                  const result = await api.post(`/api/surveys/${sv.id}/people`, {
                    ...recipients, new_contacts: recipients.new_contacts.filter((n) => n.name.trim()), save_new: true,
                  });
                  toast(`${result.added} added${result.skipped ? `, ${result.skipped} already on the survey` : ''}`
                    + (result.added && !queue.firstPush ? ' · not emailed yet' : ''));
                  setRecipients(NOBODY);
                  setAddOpen(false);
                })}>
                Add to survey
              </button>
            </>
          }>
          {!queue.firstPush ? (
            <Banner tone="info">
              Adding someone doesn’t email them. They join the list unsent, and the green
              <strong> Send to new people </strong> button then emails just them.
            </Banner>
          ) : null}
          <RecipientPicker value={recipients} onChange={setRecipients} alreadyInvited={askedEmails} noun="person" />
        </Modal>
      ) : null}

      {compose ? (
        <Modal title="Remind people who haven’t answered" size="lg" onClose={() => setCompose(null)}
          footer={
            <>
              <button className="btn" onClick={async () => {
                try {
                  setComposePreview(await api.post(`/api/surveys/${sv.id}/email-preview`, {
                    kind: 'survey_reminder', subject: compose.subject, body: compose.body,
                  }));
                } catch (err) { toast(err.message, 'bad'); }
              }}><Icon name="eye" size={14} /> Preview</button>
              <button className="btn btn-primary" onClick={sendReminder} disabled={busy || awaiting === 0}>
                {busy ? 'Queuing…' : `Send to ${awaiting} ${awaiting === 1 ? 'person' : 'people'}`}
              </button>
            </>
          }>
          <Banner tone="info">Each reminder carries the person’s own survey button again.</Banner>
          <Field label="Subject">
            <input ref={subjectRef} value={compose.subject} maxLength={300}
              onFocus={() => { tagTarget.current = 'subject'; }}
              onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea ref={bodyRef} rows={7} value={compose.body} maxLength={20000}
              onFocus={() => { tagTarget.current = 'body'; }}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })} />
            <TagButtons tags={SURVEY_TAGS} onInsert={(snippet) => (tagTarget.current === 'subject'
              ? insertAtCursor(subjectRef, compose.subject, snippet, (val) => setCompose((c) => ({ ...c, subject: val })))
              : insertAtCursor(bodyRef, compose.body, snippet, (val) => setCompose((c) => ({ ...c, body: val }))))} />
          </Field>
        </Modal>
      ) : null}

      {composePreview ? (
        <Modal title={`Preview — ${composePreview.subject}`} size="lg" onClose={() => setComposePreview(null)}>
          <iframe className="email-frame" title="Email preview" srcDoc={composePreview.html} />
        </Modal>
      ) : null}

      {viewing ? (
        <Modal title={responses?.anonymous ? `Anonymous response ${viewing.n}` : `Answers from ${viewing.name || viewing.email}`}
          size="lg" onClose={() => setViewing(null)}>
          {responses.questions.map((q, i) => (
            <div key={q.id} className="kv" style={{ alignItems: 'flex-start' }}>
              <span className="k">Q{i + 1}</span>
              <span>
                <div style={{ fontWeight: 560 }}>{q.prompt}</div>
                <div className={viewing.answers[q.id] ? '' : 'muted'} style={{ whiteSpace: 'pre-wrap' }}>
                  {viewing.answers[q.id] || 'No answer'}
                </div>
              </span>
            </div>
          ))}
        </Modal>
      ) : null}

      {confirm?.type === 'send' ? (
        <ConfirmModal title={`${queueLabel(queue)}?`} busy={busy}
          message={`${queue.sendable} ${queue.sendable === 1 ? 'person' : 'people'} will be emailed the survey.`
            + (queue.firstPush ? '' : ' Nobody who has already been emailed gets a second copy.')}
          confirmLabel={`Send ${queue.sendable}`} onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            delayed.start(`the survey to ${queue.sendable} ${queue.sendable === 1 ? 'person' : 'people'}`, () => act(async () => {
              const result = await api.post(`/api/surveys/${sv.id}/send`, {});
              toast(`${result.queued} survey email${result.queued === 1 ? '' : 's'} queued`);
              setTab('emails');
            }));
          }} />
      ) : null}
      {delayed.popup}

      {confirm?.type === 'removePerson' ? (
        <ConfirmModal title="Remove from the survey?" danger busy={busy}
          message={`Remove ${confirm.person.name || 'this person'} from the survey? Their link stops working. Any answers they gave stay in the results.`}
          confirmLabel="Remove" onClose={() => setConfirm(null)}
          onConfirm={() => act(() => api.del(`/api/surveys/${sv.id}/people/${confirm.person.id}`), 'Removed')} />
      ) : null}

      {confirm?.type === 'removeResponse' ? (
        <ConfirmModal title="Take this response out?" danger busy={busy}
          message={`${responses.anonymous ? `Anonymous response ${confirm.n}` : `The answers from ${confirm.response.name || confirm.response.email}`} will be deleted and no longer count in the results.${responses.anonymous ? '' : ' They can answer again with their link.'}`}
          confirmLabel="Delete response" onClose={() => setConfirm(null)}
          onConfirm={() => act(() => api.del(`/api/surveys/${sv.id}/responses/${confirm.response.id}`), 'Response deleted')} />
      ) : null}

      {confirm?.type === 'close' ? (
        <ConfirmModal title="Close this survey?" busy={busy}
          message="It stops taking answers straight away, from every link. You can reopen it later."
          confirmLabel="Close survey" onClose={() => setConfirm(null)}
          onConfirm={() => act(() => api.post(`/api/surveys/${sv.id}/close`, {}), 'Survey closed')} />
      ) : null}

      {confirm?.type === 'reopen' ? (
        <Modal title="Reopen this survey?" onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}
                onClick={() => act(() => api.post(`/api/surveys/${sv.id}/reopen`, { closes_on: reopenDate }), 'Survey reopened')}>
                Reopen
              </button>
            </>
          }>
          <p style={{ marginTop: 0 }}>Every link takes answers again.</p>
          <Field label="New closing date" hint="Leave it empty to close it yourself.">
            <input type="date" value={reopenDate} min={todayIso()} style={{ maxWidth: 200 }}
              onChange={(e) => setReopenDate(e.target.value)} />
          </Field>
        </Modal>
      ) : null}

      {confirm?.type === 'delete' ? (
        <ConfirmModal title="Delete survey?" danger busy={busy}
          message="This permanently deletes the survey, everyone’s answers, and its links. The email log is kept."
          confirmLabel="Delete forever" onClose={() => setConfirm(null)}
          onConfirm={() => act(async () => { await api.del(`/api/surveys/${sv.id}`); navigate('/surveys'); })} />
      ) : null}
    </div>
  );
}
