// The email log, in three shapes: scoped to one event, scoped to one
// broadcast, or the whole organization's. Filtering, sorting and paging all
// happen on the server, so a long log stays fast and nothing is silently
// truncated.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api.js';
import {
  Banner, Empty, EmailStatusBadge, Icon, IconButton, Modal, Spinner, SortTh, useSort, useToast,
} from '../ui.jsx';

const KIND_LABELS = {
  invitation: 'Invitation',
  nudge: 'Nudge',
  follow_up: 'Follow-up',
  cancellation: 'Cancellation',
  broadcast: 'Broadcast',
  test: 'Test',
};

const STATUSES = ['queued', 'sending', 'sent', 'simulated', 'failed'];

export function kindLabel(kind) {
  return KIND_LABELS[kind] || String(kind || '').replace(/_/g, ' ');
}

export default function EmailLog({
  scope = {}, // fixed query params: { event_id } / { broadcast_id } / {}
  kinds, // which type filters to offer
  showType = false,
  showSubject = false,
  showSource = false,
  perPage = 25,
  onSummary, // ({ total, pending }) — lets the parent label a tab and poll
  emptyHint,
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, sortBy] = useSort('when', 'desc');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewEmail, setViewEmail] = useState(null);
  const summaryRef = useRef(onSummary);
  summaryRef.current = onSummary;

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Any change of filter puts you back on page one — page 4 of the old result
  // set is meaningless against the new one.
  useEffect(() => { setPage(1); }, [debouncedQ, kind, status, sort.key, sort.dir]);

  const scopeKey = JSON.stringify(scope);
  const load = useCallback(async (quiet = false) => {
    const params = new URLSearchParams({
      ...JSON.parse(scopeKey),
      page: String(page),
      per_page: String(perPage),
      sort: sort.key,
      dir: sort.dir,
    });
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    try {
      const d = await api.get(`/api/emails?${params}`);
      setData(d);
      setError('');
      summaryRef.current?.({ total: d.total, pending: d.pending });
    } catch (err) {
      if (!quiet) setError(err.message);
    }
  }, [scopeKey, page, perPage, sort.key, sort.dir, debouncedQ, kind, status]);

  useEffect(() => { load(); }, [load]);

  // Keep refreshing while anything is still queued or sending.
  useEffect(() => {
    if (!data?.pending) return undefined;
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [data?.pending, load]);

  async function retry(id) {
    setBusy(true);
    try {
      await api.post(`/api/emails/${id}/retry`);
      toast('Retrying');
      await load(true);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="card-pad"><Banner tone="bad">{error}</Banner></div>;
  if (!data) return <div className="card-pad"><Spinner /></div>;

  const filtering = Boolean(debouncedQ.trim() || kind || status);
  const from = (data.page - 1) * data.per_page + 1;
  const to = Math.min(data.page * data.per_page, data.total);

  return (
    <>
      <div className="table-toolbar">
        <div className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
          <div className="search-field" style={{ maxWidth: 260, flex: 1 }}>
            <Icon name="search" size={15} />
            <input className="search-input" value={q} placeholder="Filter by recipient…"
              aria-label="Filter by recipient" onChange={(e) => setQ(e.target.value)} />
          </div>
          {kinds?.length ? (
            <select className="search-input" style={{ width: 160 }} value={kind}
              aria-label="Filter by type" onChange={(e) => setKind(e.target.value)}>
              <option value="">All types</option>
              {kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
          ) : null}
          <select className="search-input" style={{ width: 155 }} value={status}
            aria-label="Filter by status" onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          {filtering ? (
            <button className="btn btn-sm btn-ghost"
              onClick={() => { setQ(''); setKind(''); setStatus(''); }}>Clear</button>
          ) : null}
        </div>
        <span className="small muted log-count">
          {data.total === 0 ? 'No emails' : `${from}–${to} of ${data.total}`}
        </span>
      </div>

      {data.emails.length === 0 ? (
        <Empty icon="inbox" title={filtering ? 'Nothing matches these filters' : 'No emails yet'}>
          {filtering ? 'Try a different recipient, type or status.' : emptyHint}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh label="When" k="when" sort={sort} onSort={sortBy} startDir="desc" />
                {showType ? <SortTh label="Type" k="kind" sort={sort} onSort={sortBy} /> : null}
                {showSource ? <SortTh label="Event / broadcast" k="source" sort={sort} onSort={sortBy} /> : null}
                <SortTh label="To" k="recipient" sort={sort} onSort={sortBy} />
                {showSubject ? <SortTh label="Subject" k="subject" sort={sort} onSort={sortBy} /> : null}
                <SortTh label="Status" k="status" sort={sort} onSort={sortBy} />
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.emails.map((e) => (
                <tr key={e.id}>
                  <td className="t-sub nowrap">{timeAgo(e.sent_at || e.created_at)}</td>
                  {showType ? <td><span className="badge badge-gray">{kindLabel(e.kind)}</span></td> : null}
                  {showSource ? (
                    <td style={{ maxWidth: 220 }}>
                      {e.event_id ? (
                        <Link className="t-main" to={`/events/${e.event_id}`}>{e.event_title}</Link>
                      ) : e.broadcast_id ? (
                        <Link className="t-main" to={`/broadcasts/${e.broadcast_id}`}>{e.broadcast_title}</Link>
                      ) : <span className="t-sub">—</span>}
                    </td>
                  ) : null}
                  <td>
                    {e.to_name ? <div className="t-main">{e.to_name}</div> : null}
                    <div className="t-sub">{e.to_email}</div>
                  </td>
                  {showSubject ? (
                    <td className="ellipsis" style={{ maxWidth: 240 }} title={e.subject}>{e.subject}</td>
                  ) : null}
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
                          onClick={() => retry(e.id)} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pages > 1 ? (
        <div className="pager">
          <button className="btn btn-sm" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
            <Icon name="chevronLeft" size={14} /> Previous
          </button>
          <span className="small muted">Page {data.page} of {data.pages}</span>
          <button className="btn btn-sm" disabled={data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Next <Icon name="chevronRight" size={14} />
          </button>
        </div>
      ) : null}

      {viewEmail ? (
        <Modal title={viewEmail.subject} size="lg" onClose={() => setViewEmail(null)}>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            To {viewEmail.to_email} · {kindLabel(viewEmail.kind)} · {viewEmail.status}
            {viewEmail.event_title || viewEmail.broadcast_title
              ? ` · ${viewEmail.event_title || viewEmail.broadcast_title}` : ''}
            {viewEmail.sent_at ? ` · ${viewEmail.sent_at} UTC` : ''}
          </p>
          <iframe className="email-frame" title="Sent email" srcDoc={viewEmail.html} />
        </Modal>
      ) : null}
    </>
  );
}
