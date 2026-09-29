import React from 'react';
import Scene from '../Scene.jsx';
import { PageHead, Screen } from '../mock.jsx';
import { Card, Icon, StatusBadge } from '../../ui.jsx';
import { OCTOBER, SEPTEMBER, VENUE } from '../data.js';

const start = {};
const steps = [
  { at: 600, point: 'sec-up', say: 'Upcoming events, soonest first' },
  { at: 2300, point: 'counts-oct', say: 'Yes, no and still waiting', side: 'below' },
  { at: 4200, point: 'sec-past', say: 'Past events stay here', side: 'above' },
  { at: 6000, tap: 'row-oct', say: 'Click an event to open it', side: 'below' },
  { at: 7800, tap: 'new', say: 'New event starts the wizard', side: 'left' },
];

function Row({ id, ev, yes, attending, no, waiting, invited }) {
  return (
    <tr data-t={`row-${id}`}>
      <td>
        <span className="t-main">{ev.title}</span>
        <div className="t-sub">{ev.when} · {VENUE.name}</div>
      </td>
      <td><StatusBadge status="published" /></td>
      <td className="t-sub" style={{ width: 158 }} data-t={`counts-${id}`}>
        <strong style={{ color: 'var(--c-ok)' }}>{yes}</strong> yes ({attending} attending) ·{' '}
        <strong style={{ color: 'var(--c-bad)' }}>{no}</strong> no · {waiting} awaiting · {invited} invited
      </td>
      <td style={{ width: 20 }}><Icon name="chevronRight" size={16} className="row-chevron" /></td>
    </tr>
  );
}

export default function EventsList() {
  return (
    <Scene width={560} height={450} length={10000} start={start} steps={steps}
      label="The Events page. Upcoming holds the October meeting, with 3 yes, 1 no and 2 awaiting of 6 invited. Past & cancelled holds the September meeting. Clicking a row opens the event, and New event at the top right starts the wizard.">
      {() => (
        <Screen tab="Events">
          <PageHead title="Events" sub="2 total"
            actions={(
              <>
                <span className="btn"><Icon name="download" size={15} /> Export CSV</span>
                <span className="btn btn-primary" data-t="new"><Icon name="plus" size={15} /> New event</span>
              </>
            )} />
          <div data-t="sec-up">
            <Card flush title="Upcoming" sub="1 event">
              <table className="table hs-tight">
                <tbody>
                  <Row id="oct" ev={OCTOBER} yes={3} attending={4} no={1} waiting={2} invited={6} />
                </tbody>
              </table>
            </Card>
          </div>
          <div data-t="sec-past" style={{ marginTop: 12 }}>
            <Card flush title="Past & cancelled" sub="1 event">
              <table className="table hs-tight">
                <tbody>
                  <Row id="sep" ev={SEPTEMBER} yes={5} attending={6} no={1} waiting={0} invited={6} />
                </tbody>
              </table>
            </Card>
          </div>
        </Screen>
      )}
    </Scene>
  );
}
