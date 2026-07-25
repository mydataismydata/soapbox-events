import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api.js';
import { useAuth } from '../App.jsx';
import {
  Spinner, Empty, ResponseBadge, Badge, Banner, Card, StatGrid, Stat, Icon,
} from '../ui.jsx';

function QuotaValue({ quota }) {
  if (!quota) return '—';
  if (!quota.configured) return 'Simulation';
  if (quota.error) return 'Unavailable';
  return `${quota.remaining ?? '—'}`;
}

// Compact stat tile matching the event page's tiles, for the dashboard rows.
function MiniTile({ label, value, tone }) {
  return (
    <div className={`mini-tile${tone ? ` tone-${tone}` : ''}`}>
      <div className="mt-value">{value}</div>
      <div className="mt-label">{label}</div>
    </div>
  );
}

function EventMiniTiles({ ev }) {
  const s = ev.stats;
  if (ev.rsvp_mode === 'open') {
    return (
      <div className="mini-tiles">
        <MiniTile label="Invited" value={s.invited} />
        <MiniTile label="Notified" value={s.emails_sent} tone="ok" />
      </div>
    );
  }
  return (
    <div className="mini-tiles">
      <MiniTile label="Invited" value={s.invited} />
      <MiniTile label="Coming" value={s.guests_attending} tone="ok" />
      <MiniTile label="Declined" value={s.declined} tone="bad" />
      <MiniTile label="Waiting" value={s.awaiting} tone="warn" />
    </div>
  );
}

function SeeAll({ to, children }) {
  return (
    <Link className="btn btn-sm" to={to}>
      {children} <Icon name="chevronRight" size={13} />
    </Link>
  );
}

export default function Dashboard() {
  const { user, org } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="page"><Banner tone="bad">{error}</Banner></div>;
  if (!data) return <div className="page"><Spinner /></div>;

  const { counts, upcoming, recent, broadcasts = [], quota, month_emails } = data;
  const firstName = (user.name || '').split(' ')[0];
  const gettingStarted = counts.events === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-sub">Here's what's happening at {org.name}.</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-primary" to="/events/new">
            <Icon name="plus" size={15} /> New event
          </Link>
        </div>
      </div>

      <StatGrid>
        <Stat icon="ticket" label="Upcoming events" value={counts.upcoming}
          sub={`${counts.drafts} draft${counts.drafts === 1 ? '' : 's'}`} />
        <Stat icon="user" label="Contacts" value={counts.contacts}
          sub={`${counts.groups} group${counts.groups === 1 ? '' : 's'}`} />
        <Stat icon="mail" label="Emails this month" value={month_emails}
          sub={quota?.configured ? 'via SMTP2GO' : 'simulation mode'} />
        <Stat icon="send" label="Email quota left" value={<QuotaValue quota={quota} />}
          sub={quota?.configured && !quota.error
            ? `${quota.used} of ${quota.max} used this cycle`
            : quota?.configured ? quota.error : 'no SMTP2GO key yet'} />
      </StatGrid>

      {gettingStarted ? (
        <Card title="Get started">
          <p className="muted" style={{ marginTop: 0 }}>
            Three steps and your first invitations are out the door:
          </p>
          <ol style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 2 }}>
            <li><Link to="/contacts">Add or import your contacts</Link> — paste a CSV straight from a spreadsheet.</li>
            <li><Link to="/groups">Organize them into groups</Link> (optional, but handy for recurring audiences).</li>
            <li><Link to="/events/new">Create your first event</Link> — the wizard walks you through details, design, and sending.</li>
          </ol>
          <Link className="btn btn-primary" to="/events/new">Create your first event</Link>
        </Card>
      ) : null}

      <Card flush title="Upcoming events" actions={<SeeAll to="/events">All events</SeeAll>}
        style={{ marginBottom: 16 }}>
        {upcoming.length === 0 ? (
          <Empty icon="calendar" title="Nothing scheduled">Events with future dates appear here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {upcoming.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <div className="row" style={{ gap: 7 }}>
                        <Link to={`/events/${ev.id}`} className="t-main">{ev.title}</Link>
                        {ev.status === 'draft' ? <Badge tone="amber" dot>Draft</Badge> : null}
                      </div>
                      <div className="t-sub">{ev.when}{ev.venue_name ? ` · ${ev.venue_name}` : ''}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <EventMiniTiles ev={ev} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <Card flush title="Broadcasts" actions={<SeeAll to="/broadcasts">All broadcasts</SeeAll>}>
          {broadcasts.length === 0 ? (
            <Empty icon="megaphone" title="No broadcasts yet">Email blasts to your contacts show up here.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {broadcasts.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link to={`/broadcasts/${b.id}`} className="t-main">{b.title}</Link>
                        <div className="t-sub">
                          {b.status === 'sent'
                            ? `${b.stats.recipients} recipient${b.stats.recipients === 1 ? '' : 's'}${b.sent_at ? ` · ${timeAgo(b.sent_at)}` : ''}`
                            : 'Draft'}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Badge tone={b.status === 'sent' ? 'green' : 'amber'} dot>
                          {b.status === 'sent' ? 'Sent' : 'Draft'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card flush title="Recent responses">
          {recent.length === 0 ? (
            <Empty icon="heart" title="No responses yet">RSVPs land here the moment guests click.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="t-main">{r.name}</span>
                        {r.party_size > 1 ? <span className="muted"> +{r.party_size - 1}</span> : null}
                        <div className="t-sub">
                          <Link to={`/events/${r.event_id}`}>{r.event_title}</Link> · {timeAgo(r.responded_at)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}><ResponseBadge response={r.response} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
