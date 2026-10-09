import React from 'react';
import Scene from '../Scene.jsx';
import { EventTabs, Input, Screen, Select, SendCountdown, Toast } from '../mock.jsx';
import { Card, EmailStatusBadge, Icon, ResponseBadge, Stat, StatGrid } from '../../ui.jsx';
import { OCTOBER_GUESTS } from '../data.js';

const FILTERS = [
  ['All guests', 'f-all'],
  ['Accepted', 'f-yes'],
  ['Declined', 'f-no'],
  ['Awaiting reply', 'f-pending'],
  ['Not emailed / failed', 'f-unsent'],
];

// A second of the countdown, shortened for the scene. The count starts when
// the press on the send button lands, which is 600ms after the tap begins.
const TICK = 700;
const COUNT = 7900 + 600;

const start = { eric: null, filter: 'All guests', filterOpen: false, count: 0, toast: '' };
const steps = [
  { at: 600, point: 'stats', say: 'Where things stand' },
  { at: 2300, tap: 'yes-eric', say: 'Eric phoned to say yes? Mark it here', side: 'left', set: { eric: 'yes' } },
  { at: 4100, point: '.stat-grid .stat:nth-child(2)', say: 'Attending goes up by one', side: 'below' },
  { at: 5800, tap: 'filter', say: 'Show only who has not replied', side: 'below', set: { filterOpen: true } },
  { at: 6900, tap: 'f-pending', say: null, set: { filterOpen: false, filter: 'Awaiting reply' } },
  { at: 7900, tap: 'mail-sean', say: 'Send the invitation again', side: 'below', set: { count: 5 } },
  { at: COUNT + TICK, point: 'cancel-send', say: 'It waits five seconds, in case you cancel', side: 'below', set: { count: 4 } },
  { at: COUNT + TICK * 2, set: { count: 3 } },
  { at: COUNT + TICK * 3, set: { count: 2 } },
  { at: COUNT + TICK * 4, set: { count: 1 } },
  { at: COUNT + TICK * 5, hide: true, say: null, set: { count: 0, toast: 'Invitation queued' } },
];

export default function EventGuests() {
  return (
    <Scene width={560} height={500} length={13900} start={start} steps={steps}
      label="An event's Guests tab. Six guests are listed with their invitation and reply. Clicking the tick on Eric A.'s row marks Eric as accepted, and Attending goes from 4 to 5. The filter is then set to Awaiting reply, leaving Sean C. The envelope button on that row opens a popup that counts down five seconds with a Cancel sending button, and then queues the invitation again.">
      {(s) => {
        const guests = OCTOBER_GUESTS.map((g) => (g.id === 'eric' && s.eric ? { ...g, response: s.eric, ago: 'just now' } : g));
        const shown = s.filter === 'Awaiting reply' ? guests.filter((g) => !g.response) : guests;
        const yes = guests.filter((g) => g.response === 'yes');
        const attending = yes.reduce((n, g) => n + g.party, 0);
        return (
          <Screen bare>
            <div data-t="stats">
              <StatGrid>
                <Stat label="Invited" value={6} sub="6 emailed · 0 queued" />
                <Stat label="Attending" value={attending} tone="ok" sub={`${yes.length} accepted RSVPs`} />
                <Stat label="Declined" value={1} tone="bad" sub={' '} />
                <Stat label="Awaiting reply" value={guests.filter((g) => !g.response).length} tone="warn" sub="0 not yet emailed" />
              </StatGrid>
            </div>
            <EventTabs tab="guests" />
            <Card flush>
              <div className="table-toolbar">
                <span className="btn btn-primary btn-sm"><Icon name="plus" size={14} /> Add guests</span>
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <div className="search-field" style={{ width: 150 }}>
                    <Icon name="search" size={15} />
                    <Input placeholder="Filter by guest…" style={{ paddingLeft: 31 }} />
                  </div>
                  <Select t="filter" value={s.filter} open={s.filterOpen} hi="f-pending" options={FILTERS}
                    style={{ width: 170 }} />
                </div>
              </div>
              <table className="table hs-tight">
                <thead>
                  <tr><th>Guest</th><th>Invitation</th><th>Response</th><th>Party</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {shown.map((g) => (
                    <tr key={g.id}>
                      <td><span className="t-main">{g.name}</span><div className="t-sub">{g.email}</div></td>
                      <td><EmailStatusBadge status="sent" /></td>
                      <td>
                        <ResponseBadge response={g.response} />
                        {g.ago ? <div className="t-sub">{g.ago}</div> : null}
                      </td>
                      <td className="tabular">{g.party}</td>
                      <td>
                        <div className="t-actions">
                          <span className="btn btn-icon btn-sm" data-t={`yes-${g.id}`}><Icon name="check" size={15} /></span>
                          <span className="btn btn-icon btn-sm"><Icon name="x" size={15} /></span>
                          <span className="btn btn-icon btn-sm" data-t={`mail-${g.id}`}><Icon name="mail" size={15} /></span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {s.count ? <SendCountdown what="the invitation to Sean C." count={s.count} tick={TICK} /> : null}
            <Toast text={s.toast} />
          </Screen>
        );
      }}
    </Scene>
  );
}
