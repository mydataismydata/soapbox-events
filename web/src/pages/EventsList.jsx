import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatWhen, todayIso } from '../api.js';
import { Spinner, Empty, StatusBadge, Banner, Card, Icon } from '../ui.jsx';

function EventRow({ ev }) {
  const s = ev.stats;
  return (
    <tr>
      <td>
        <Link to={`/events/${ev.id}`} className="t-main">{ev.title}</Link>
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
      <td style={{ textAlign: 'right' }}>
        <Link className="btn btn-sm" to={`/events/${ev.id}`}>Open</Link>
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

export default function EventsList() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/events').then((d) => setEvents(d.events)).catch((e) => setError(e.message));
  }, []);

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
    </div>
  );
}
