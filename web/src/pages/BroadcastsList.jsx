import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, timeAgo } from '../api.js';
import { Spinner, Empty, Badge, Banner, Card, Icon } from '../ui.jsx';

function BroadcastBadge({ status }) {
  if (status === 'sent') return <Badge tone="green" dot>Sent</Badge>;
  if (status === 'sending') return <Badge tone="indigo" dot>Sending</Badge>;
  return <Badge tone="amber" dot>Draft</Badge>;
}

function Row({ b }) {
  const s = b.stats;
  return (
    <tr>
      <td>
        <Link to={`/broadcasts/${b.id}`} className="t-main">{b.title}</Link>
        <div className="t-sub">{b.subject || <em>no subject yet</em>}</div>
      </td>
      <td><BroadcastBadge status={b.status} /></td>
      <td className="t-sub nowrap">
        {b.status === 'draft'
          ? (b.sent_at ? '' : 'Not sent')
          : <span><strong style={{ color: 'var(--c-ok)' }}>{s.sent}</strong> sent
            {s.failed ? <> · <strong style={{ color: 'var(--c-bad)' }}>{s.failed}</strong> failed</> : ''}
            {s.pending ? ` · ${s.pending} queued` : ''} · {s.recipients} recipients</span>}
      </td>
      <td className="t-sub nowrap">{timeAgo(b.sent_at || b.updated_at)}</td>
      <td style={{ textAlign: 'right' }}>
        <Link className="btn btn-sm" to={`/broadcasts/${b.id}`}>Open</Link>
      </td>
    </tr>
  );
}

function Section({ title, rows }) {
  if (rows.length === 0) return null;
  return (
    <Card flush title={title} sub={`${rows.length} broadcast${rows.length === 1 ? '' : 's'}`}
      style={{ marginBottom: 16 }}>
      <div className="table-wrap">
        <table className="table"><tbody>{rows.map((b) => <Row key={b.id} b={b} />)}</tbody></table>
      </div>
    </Card>
  );
}

export default function BroadcastsList() {
  const [broadcasts, setBroadcasts] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/broadcasts').then((d) => setBroadcasts(d.broadcasts)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="page"><Banner tone="bad">{error}</Banner></div>;
  if (!broadcasts) return <div className="page"><Spinner /></div>;

  const drafts = broadcasts.filter((b) => b.status === 'draft');
  const sent = broadcasts.filter((b) => b.status !== 'draft');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Broadcasts</h1>
          <p className="page-sub">Email blasts to your contacts and groups — no event, no RSVP.</p>
        </div>
        <div className="head-actions">
          {broadcasts.length > 0 ? (
            <a className="btn" href="/api/export/broadcasts.csv">
              <Icon name="download" size={15} /> Export CSV
            </a>
          ) : null}
          <button className="btn btn-primary" onClick={() => navigate('/broadcasts/new')}>
            <Icon name="plus" size={15} /> New broadcast
          </button>
        </div>
      </div>

      {broadcasts.length === 0 ? (
        <Card flush>
          <Empty icon="megaphone" title="No broadcasts yet" action={
            <button className="btn btn-primary" onClick={() => navigate('/broadcasts/new')}>Create your first broadcast</button>
          }>
            Use a broadcast for announcements that aren't tied to an event — endorsements, primary
            reminders, newsletters. You get the flyer designer and templates, minus RSVP.
          </Empty>
        </Card>
      ) : (
        <>
          <Section title="Drafts" rows={drafts} />
          <Section title="Sent" rows={sent} />
        </>
      )}
    </div>
  );
}
