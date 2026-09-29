import React from 'react';
import Scene from '../Scene.jsx';
import { Check, EVENT_STEPS, Input, Screen, Select, Wizard, WizardFoot } from '../mock.jsx';
import { Card, Field } from '../../ui.jsx';

const start = { deadline: '', party: 'Unlimited (no cap)', partyOpen: false, focus: '' };
const steps = [
  { at: 600, point: 'mode-rsvp', say: 'Collect RSVPs to see who is coming' },
  { at: 2300, point: 'mode-open', say: 'Or send a notice with nothing to answer' },
  { at: 4000, tap: 'deadline', say: 'Replies close after this date', set: { focus: 'deadline', deadline: '10/16/2026' } },
  { at: 5800, tap: 'party', say: 'The most each guest can bring', side: 'above', set: { focus: 'party', partyOpen: true } },
  { at: 6900, tap: 'party-2', say: null, set: { partyOpen: false, focus: '', party: '2' } },
  { at: 7900, point: 'share', say: 'Anyone with the link can reply', side: 'below' },
  { at: 9700, tap: 'continue', say: 'On to the invitation', side: 'left' },
];

export default function WizardRsvp() {
  return (
    <Scene width={560} height={512} length={12000} start={start} steps={steps}
      label="Step 2 of the event wizard. Collect RSVPs is chosen rather than Open event. The RSVP deadline is set to October 16, Allow plus-ones is ticked with a largest party size of 2, and Shareable link is ticked. Continue moves on to the invitation.">
      {(s) => (
        <Screen bare>
          <Wizard labels={EVENT_STEPS} step={1}>
            <Card title="How should guests respond?">
              <div className="seg" style={{ marginBottom: 12 }}>
                <span className="seg-opt active" data-t="mode-rsvp">
                  <span className="seg-title">Collect RSVPs</span>
                  <span className="seg-sub">Guests accept or decline; you see exactly who's coming.</span>
                  <span className="seg-mark" />
                </span>
                <span className="seg-opt" data-t="mode-open">
                  <span className="seg-title">Open event</span>
                  <span className="seg-sub">No RSVP — invitations are informational, everyone's welcome.</span>
                  <span className="seg-mark" />
                </span>
              </div>
              <div className="field-row">
                <Field label="RSVP deadline">
                  <Input t="deadline" value={s.deadline} placeholder="mm/dd/yyyy" focus={s.focus === 'deadline'} />
                </Field>
                <Field label="Capacity"><Input placeholder="Unlimited" /></Field>
              </div>
              <label className="checkbox">
                <Check on />
                <span><span className="cb-label">Allow plus-ones</span>
                  <div className="cb-sub">Guests can say how many people they're bringing.</div></span>
              </label>
              <Field label="Largest party size">
                <Select t="party" value={s.party} open={s.partyOpen} hi="party-2"
                  options={[['Unlimited (no cap)', 'party-0'], ['2', 'party-2'], ['3', 'party-3'], ['4', 'party-4']]} />
              </Field>
              <label className="checkbox" data-t="share">
                <Check on />
                <span><span className="cb-label">Shareable link</span>
                  <div className="cb-sub">Anyone with the event link can view it and RSVP — perfect for forwarding.</div></span>
              </label>
            </Card>
            <WizardFoot />
          </Wizard>
        </Screen>
      )}
    </Scene>
  );
}
