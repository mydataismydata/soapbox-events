import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { BROADCAST_STEPS, Check, Input, Screen, Wizard, WizardFoot } from '../mock.jsx';
import { Card, Field } from '../../ui.jsx';
import { BOCC } from '../data.js';

const start = { title: '', subject: '', focus: 'title' };
const steps = [
  { at: 500, point: 'title', say: 'The title names it in your list' },
  ...typing(900, 'title', BOCC.title, 38),
  { at: 3300, tap: 'subject', say: 'The subject people see in their inbox', set: { focus: 'subject' } },
  ...typing(4000, 'subject', BOCC.subject, 50),
  { at: 6000, point: 'web', say: 'A link to read it in a web browser', side: 'above', set: { focus: '' } },
  { at: 7800, tap: 'continue', say: 'On to the message', side: 'left' },
];

export default function BroadcastDetails() {
  return (
    <Scene width={560} height={410} length={10000} start={start} steps={steps}
      label="Step 1 of the broadcast wizard. The title Board of County Commissioners special meeting Oct 28 is typed in, then the email subject Special meeting Oct 28 at 9 AM. Publish a web version is ticked. Continue moves on to the message.">
      {(s) => (
        <Screen bare>
          <Wizard labels={BROADCAST_STEPS} step={0}>
            <Card title="What are you sending?">
              <Field label="Title" required>
                <Input t="title" value={s.title} placeholder="May 2026 Primary — Our Endorsements" focus={s.focus === 'title'} />
              </Field>
              <Field label="Email subject" hint="The subject line recipients see. Defaults to the title if left blank.">
                <Input t="subject" value={s.subject} placeholder="Our endorsements for the May primary" focus={s.focus === 'subject'} />
              </Field>
              <label className="checkbox" data-t="web">
                <Check on />
                <span><span className="cb-label">Publish a web version</span>
                  <div className="cb-sub">Adds a “View this email online” link at an unguessable URL — handy when
                    email clients clip long messages. Turn off to keep this broadcast email-only.</div></span>
              </label>
            </Card>
            <WizardFoot />
          </Wizard>
        </Screen>
      )}
    </Scene>
  );
}
