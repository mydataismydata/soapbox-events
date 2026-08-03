import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import {
  Spinner, ConfirmModal, CopyBox, useToast, Badge, Modal, Field,
  Banner, Card, StatGrid, Stat, Icon,
} from '../ui.jsx';
import EmailLog from '../components/EmailLog.jsx';

function BroadcastBadge({ status }) {
  if (status === 'sent') return <Badge tone="green" dot>Sent</Badge>;
  if (status === 'sending') return <Badge tone="indigo" dot>Sending</Badge>;
  return <Badge tone="amber" dot>Draft</Badge>;
}

export default function BroadcastDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [b, setB] = useState(null);
  const [summary, setSummary] = useState({ total: 0, pending: 0 });
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState('');

  const load = useCallback(async (quiet = false) => {
    try {
      setB((await api.get(`/api/broadcasts/${id}`)).broadcast);
    } catch (err) {
      if (!quiet) setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // The log refreshes itself while emails are in flight; follow it so the
  // stats above it keep up too.
  useEffect(() => {
    if (!summary.pending) return undefined;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [summary.pending, load]);

  if (error) return <div className="page"><Banner tone="bad">{error}</Banner></div>;
  if (!b) return <div className="page"><Spinner /></div>;

  const s = b.stats;

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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="page-title">{b.title}</h1>
            <BroadcastBadge status={b.status} />
          </div>
          <p className="page-sub">{b.subject || <em>no subject</em>}</p>
        </div>
        <div className="head-actions">
          {b.web_version && b.status !== 'draft'
            ? <a className="btn" href={b.share_url} target="_blank" rel="noopener noreferrer">
                View web version <Icon name="external" size={14} />
              </a>
            : null}
          <Link className="btn" to={`/broadcasts/${b.id}/edit`}>
            <Icon name="pencil" size={14} /> {b.status === 'draft' ? 'Continue editing' : 'Edit'}
          </Link>
          <button className="btn" disabled={busy} onClick={() => { setCopyTo(''); setCopyOpen(true); }}>
            <Icon name="send" size={14} /> Send a copy
          </button>
          <button className="btn" disabled={busy} onClick={() => act(async () => {
            const d = await api.post(`/api/broadcasts/${b.id}/duplicate`);
            navigate(`/broadcasts/${d.broadcast.id}/edit`);
          })}><Icon name="copy" size={14} /> Duplicate</button>
          <button className="btn btn-danger" onClick={() => setConfirm({ type: 'delete' })}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>

      {b.status === 'draft' ? (
        <Banner tone="info">
          <span>
            This broadcast hasn't been sent yet.{' '}
            <Link to={`/broadcasts/${b.id}/edit`}>Open it in the wizard</Link> to pick recipients and send.
          </span>
        </Banner>
      ) : null}

      <StatGrid>
        <Stat icon="users" label="Recipients" value={s.recipients} sub="emailed this broadcast" />
        <Stat icon="checkCircle" tone="ok" label="Sent" value={s.sent} sub="delivered / simulated" />
        <Stat icon="clipboard" tone="warn" label="Queued" value={s.pending} sub="waiting to send" />
        <Stat icon="xCircle" tone="bad" label="Failed" value={s.failed}
          sub={s.failed ? 'retry from the log below' : 'none'} />
      </StatGrid>

      {b.web_version && b.status !== 'draft' ? (
        <Card style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13 }}>Web version link</strong>
          <p className="small muted" style={{ margin: '2px 0 8px' }}>
            The “view in browser” link included in the email. Anyone with it can read this broadcast.
          </p>
          <CopyBox value={b.share_url} />
        </Card>
      ) : null}

      {/* Every row here is this broadcast, so type and subject would only
          repeat the page heading — the type filter covers test vs real. */}
      <Card flush title="Email log">
        <EmailLog scope={{ broadcast_id: id }} kinds={['broadcast', 'test']} onSummary={setSummary}
          emptyHint="Once you send (or run a test), every email shows up here with its exact content and status." />
      </Card>

      {copyOpen ? (
        <Modal title="Send a copy of this broadcast" onClose={() => setCopyOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCopyOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !copyTo.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const d = await api.post(`/api/broadcasts/${b.id}/send-copy`, { to: copyTo.trim() });
                    toast(d.status === 'simulated'
                      ? 'Rendered in simulation mode — nothing was delivered'
                      : `Copy sent to ${d.to}`);
                    setCopyOpen(false);
                    await load(true);
                  } catch (err) { toast(err.message, 'bad'); }
                  finally { setBusy(false); }
                }}>{busy ? 'Sending…' : 'Send copy'}</button>
            </>
          }>
          <p className="small muted" style={{ marginTop: 0 }}>
            Sends this message exactly as recipients get it — same subject, unsubscribe link and headers.
            Useful for checking how it lands, or for a deliverability service like mail-tester.
          </p>
          <Field label="Send to" required>
            <input type="email" value={copyTo} maxLength={254} autoFocus
              placeholder="someone@example.com"
              onChange={(e) => setCopyTo(e.target.value)} />
          </Field>
        </Modal>
      ) : null}

      {confirm?.type === 'delete' ? (
        <ConfirmModal title="Delete broadcast?" danger busy={busy}
          message="This permanently deletes the broadcast and its web version. The email log is kept."
          confirmLabel="Delete forever" onClose={() => setConfirm(null)}
          onConfirm={() => act(async () => { await api.del(`/api/broadcasts/${b.id}`); navigate('/broadcasts'); })} />
      ) : null}
    </div>
  );
}
