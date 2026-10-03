import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatWhen, todayIso } from '../api.js';
import { useAuth } from '../App.jsx';
import { Spinner, Empty, StatusBadge, Banner, Card, Icon, Modal, useToast } from '../ui.jsx';

function EventRow({ ev }) {
  const s = ev.stats;
  return (
    <tr className="row-link">
      <td>
        <Link to={`/events/${ev.id}`} className="t-main row-link-target">{ev.title}</Link>
        <div className="t-sub">{formatWhen(ev)}{ev.venue_name ? ` · ${ev.venue_name}` : ''}</div>
      </td>
      <td><StatusBadge status={ev.status} /></td>
      <td className="t-sub nowrap">
        {ev.rsvp_mode === 'open'
          ? <span>Open event · {s.emails_sent} notified</span>
          : <span>
              <strong style={{ color: 'var(--c-ok)' }}>{s.accepted}</strong> yes
              {s.guests_attending > s.accepted ? ` (${s.guests_attending} attending)` : ''} ·{' '}
              <strong style={{ color: 'var(--c-bad)' }}>{s.declined}</strong> no ·{' '}
              {s.awaiting} awaiting · {s.invited} invited
            </span>}
      </td>
      <td style={{ textAlign: 'right', width: 24 }}>
        <Icon name="chevronRight" size={16} className="row-chevron" />
      </td>
    </tr>
  );
}

function Section({ title, events }) {
  if (events.length === 0) return null;
  return (
    <Card flush title={title} sub={`${events.length} event${events.length === 1 ? '' : 's'}`}
      style={{ marginBottom: 16 }}>
      <div className="table-wrap">
        <table className="table">
          <tbody>{events.map((ev) => <EventRow key={ev.id} ev={ev} />)}</tbody>
        </table>
      </div>
    </Card>
  );
}

// Meetings that so far exist only on the chapter's website, from the file
// its tools/export-meetings.php writes. Each keeps its web address, so the
// next delivery replaces the website's copy rather than adding a second one.
function ImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  async function readFile(f) {
    if (!f) return;
    setName(f.name);
    setError('');
    try {
      const parsed = JSON.parse(await f.text());
      if (parsed?.format !== 'rlc-meetings-export' || !Array.isArray(parsed.events)) {
        throw new Error('That is not a meetings file from the website.');
      }
      setFile(parsed);
    } catch (err) {
      setFile(null);
      setError(err instanceof SyntaxError ? 'That file is not readable as a meetings file.' : err.message);
    }
  }

  async function run() {
    setBusy(true);
    try {
      const r = await api.post('/api/events/import', { file });
      setResult(r);
      toast(`${r.added} meeting${r.added === 1 ? '' : 's'} imported`);
      onDone();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import meetings from the website" size="lg" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
          {!result ? (
            <button className="btn btn-primary" onClick={run} disabled={busy || !file}>
              {busy ? 'Importing…' : file ? `Import ${file.events.length} meeting${file.events.length === 1 ? '' : 's'}` : 'Import'}
            </button>
          ) : null}
        </>
      }>
      <p className="small muted" style={{ marginTop: 0 }}>
        For meetings that are on the chapter&rsquo;s website but not in Soapbox. Make the file on the
        website with <code>tools/export-meetings.php</code>. Each meeting comes in with its picture and
        keeps its web address, so the website shows it once. A meeting already here is skipped, so
        importing the same file twice is safe. Past meetings take no new RSVPs.
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(e) => readFile(e.target.files?.[0])} />
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> Choose file…
        </button>
        {name ? <span className="small muted">{name}</span> : null}
      </div>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {file && !result ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {file.events.map((ev, i) => (
            <li key={i}>{ev.date || 'No date'} · {ev.title}{ev.picture ? '' : ' · no picture'}</li>
          ))}
        </ul>
      ) : null}
      {result ? (
        <Banner tone="ok">
          Imported {result.added}.
          {result.skipped?.length ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {result.skipped.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          ) : null}
        </Banner>
      ) : null}
    </Modal>
  );
}

export default function EventsList() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();
  const isAdmin = useAuth().user?.role === 'admin';

  function load() {
    api.get('/api/events').then((d) => setEvents(d.events)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  if (error) return <div className="page"><Banner tone="bad">{error}</Banner></div>;
  if (!events) return <div className="page"><Spinner /></div>;

  const today = todayIso();
  const upcoming = events
    .filter((e) => e.status === 'published' && e.date && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const drafts = events.filter((e) => e.status === 'draft');
  const past = events.filter((e) => e.status !== 'draft' && (!e.date || e.date < today || e.status === 'cancelled'))
    .filter((e) => !upcoming.includes(e));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Events</h1>
          <p className="page-sub">{events.length} total</p>
        </div>
        <div className="head-actions">
          <a className="btn" href="/api/export/events.csv">
            <Icon name="download" size={15} /> Export CSV
          </a>
          {isAdmin ? (
            <button className="btn" onClick={() => setImporting(true)}>
              <Icon name="upload" size={15} /> Import meetings
            </button>
          ) : null}
          <button className="btn btn-primary" onClick={() => navigate('/events/new')}>
            <Icon name="plus" size={15} /> New event
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <Card flush>
          <Empty icon="ticket" title="No events yet" action={
            <button className="btn btn-primary" onClick={() => navigate('/events/new')}>Create your first event</button>
          }>
            The wizard walks you through details, RSVP options, invitation design, and guests.
          </Empty>
        </Card>
      ) : (
        <>
          <Section title="Upcoming" events={upcoming} />
          <Section title="Drafts" events={drafts} />
          <Section title="Past & cancelled" events={past} />
        </>
      )}

      {importing ? <ImportModal onClose={() => setImporting(false)} onDone={load} /> : null}
    </div>
  );
}
