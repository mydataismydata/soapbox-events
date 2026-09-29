import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { EVENT_STEPS, Input, Screen, Select, Wizard, WizardFoot } from '../mock.jsx';
import { Card, Field } from '../../ui.jsx';
import { OCTOBER, ORG, VENUE } from '../data.js';

const start = { title: '', date: '', focus: 'title', venueOpen: false, venue: '', vname: '', vaddr: '' };
const steps = [
  { at: 500, point: 'title', say: 'Give it a title' },
  ...typing(900, 'title', OCTOBER.title, 38),
  { at: 3300, tap: 'date', say: 'Pick the date', set: { focus: 'date', date: OCTOBER.date } },
  { at: 4800, point: 'times', say: 'Times come from your event defaults', side: 'below', set: { focus: '' } },
  { at: 6500, tap: 'venue', say: 'Pick a saved venue', side: 'above', set: { focus: 'venue', venueOpen: true } },
  { at: 7600, tap: 'venue-uf', say: null, set: { venueOpen: false, focus: '', venue: VENUE.name, vname: VENUE.name, vaddr: VENUE.address } },
  { at: 8500, point: 'vfields', say: 'Its details fill in', side: 'below' },
  { at: 10100, tap: 'continue', say: 'Continue saves and moves on', side: 'left' },
];

export default function WizardDetails() {
  return (
    <Scene width={560} height={500} length={12500} start={start} steps={steps}
      label="Step 1 of the event wizard. The title October Meeting with Candidates Sean G. and Sandra F. is typed in, the date is set to October 19, and the start and end times are already 5:30 PM and 7:00 PM. Picking UF Health Building from the Venue list fills in the venue name and address. Continue moves to the next step.">
      {(s) => (
        <Screen bare>
          <Wizard labels={EVENT_STEPS} step={0}>
            <Card title="What's the occasion?">
              <Field label="Event title" required>
                <Input t="title" value={s.title} placeholder="Summer Gala 2026" focus={s.focus === 'title'} />
              </Field>
              <Field label="Host"><Input value={ORG} /></Field>
              <div className="field-row3">
                <Field label="Date"><Input t="date" value={s.date} placeholder="mm/dd/yyyy" focus={s.focus === 'date'} /></Field>
                <div className="field-row" data-t="times" style={{ gridColumn: 'span 2' }}>
                  <Field label="Starts"><Input value={OCTOBER.start} /></Field>
                  <Field label="Ends"><Input value={OCTOBER.end} /></Field>
                </div>
              </div>
              <Field label="Venue">
                <Select t="venue" value={s.venue} placeholder="— Choose a saved venue —" open={s.venueOpen}
                  hi="venue-uf" options={[['— Choose a saved venue —', 'venue-none'], [VENUE.name, 'venue-uf']]} />
              </Field>
              <div className="field-row" data-t="vfields">
                <Field label="Venue name"><Input value={s.vname} placeholder="Riverside Hall" /></Field>
                <Field label="Venue address"><Input value={s.vaddr} placeholder="12 River Rd, Springfield" /></Field>
              </div>
            </Card>
            <WizardFoot />
          </Wizard>
        </Screen>
      )}
    </Scene>
  );
}
