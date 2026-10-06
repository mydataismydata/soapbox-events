import React from 'react';
import Scene from '../Scene.jsx';
import { EVENT_STEPS, Picker, Screen, Wizard, WizardFoot } from '../mock.jsx';
import { Card } from '../../ui.jsx';

const start = { groups: [], out: [] };
const steps = [
  { at: 600, tap: 'grp-all', say: 'Click a group to invite everyone in it', set: { groups: ['all'] } },
  { at: 2400, point: 'list', say: 'Everyone in it is ticked', side: 'above' },
  { at: 4100, tap: 'pick-joe', say: 'Untick anyone to leave them out', side: 'right', set: { out: ['joe'] } },
  { at: 5900, point: 'tally', say: 'The number who will be added', side: 'below' },
  { at: 7700, tap: 'continue', say: 'Continue adds them to the guest list', side: 'left' },
];

export default function WizardGuests() {
  return (
    <Scene width={560} height={572} length={10500} start={start} steps={steps}
      label="Step 4 of the event wizard. Clicking All members (7) ticks all seven people, each marked via group. Unticking Joe S. marks that row Removed, and the count underneath changes to 6 guests selected. Continue adds them to the guest list.">
      {(s) => (
        <Screen bare>
          <Wizard labels={EVENT_STEPS} step={3}>
            <Card title="Who's invited?">
              <Picker noun="guest" groups={s.groups} out={s.out} listHeight={198} />
            </Card>
            <WizardFoot />
          </Wizard>
        </Screen>
      )}
    </Scene>
  );
}
