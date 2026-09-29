import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Area, Check, Email, Input, Modal, Screen } from '../mock.jsx';
import { Card, Field, Icon } from '../../ui.jsx';
import { OCTOBER, ORG, VENUE } from '../data.js';

const BODY = 'Hi {{first_name}},\n\nJoin us for {{event_title}} on {{event_date}}.';
const MEET = '\n\nWe meet at ';
const TAGS = [
  ['Event date', 'event_date'],
  ['Event time', 'event_time'],
  ['Event title', 'event_title'],
  ['Guest first name', 'first_name'],
  ['Host name', 'host_name'],
  ['RSVP deadline', 'rsvp_deadline'],
  ['Venue address', 'venue_address'],
  ['Venue name', 'venue_name'],
];

const start = { body: BODY, focus: false, preview: false };
const steps = [
  { at: 600, point: 'subject', say: 'The subject guests see' },
  { at: 2200, tap: 'body', say: 'Write the message', side: 'above', set: { focus: true } },
  ...typing(3000, 'body', MEET, 60, BODY),
  { at: 4100, tap: 'tag-venue_name', say: 'A placeholder fills in for each guest', set: { body: `${BODY}${MEET}{{venue_name}}` } },
  { at: 5300, set: { body: `${BODY}${MEET}{{venue_name}}.` } },
  { at: 5600, point: 'hint', say: 'Accept and Decline buttons are added for you', side: 'above' },
  { at: 7600, tap: 'preview', say: null, set: { preview: true, focus: false } },
  { at: 8500, point: 'email', say: 'What Fred will see', side: 'above' },
];

export default function WizardEmail() {
  return (
    <Scene width={560} height={492} length={12000} start={start} steps={steps}
      label="Step 3 of the event wizard, writing the invitation. The message says Hi {{first_name}}, Join us for {{event_title}} on {{event_date}}. We meet at, and clicking the Venue name button adds {{venue_name}}. Preview email then shows Fred's copy, with the event's details filled in and the Accept and Decline buttons underneath.">
      {(s) => (
        <Screen bare>
          <Card title="Write the invitation email">
            <Field label="Subject">
              <Input t="subject" value="You're invited: {{event_title}}" />
            </Field>
            <Field label="Message">
              <Area t="body" value={s.body} rows={5} focus={s.focus} />
              <div className="chip-row" style={{ marginTop: 6 }}>
                {TAGS.map(([label, tag]) => <span key={tag} className="tag-btn" data-t={`tag-${tag}`}>{label}</span>)}
              </div>
              <div className="hint" data-t="hint">
                Placeholders fill in per guest. Accept / Decline buttons and event details are added automatically below your message.
              </div>
            </Field>
            <label className="checkbox">
              <Check on={false} />
              <span><span className="cb-label">Include flyer in email</span>
                <div className="cb-sub">Adds a picture of the flyer to the invitation, below the Accept / Decline buttons.</div></span>
            </label>
            <span className="btn" data-t="preview"><Icon name="eye" size={14} /> Preview email</span>
          </Card>
          {s.preview ? (
            <Modal title={`Preview — You're invited: ${OCTOBER.title}`} size="lg">
              <p className="small muted" style={{ margin: '0 0 8px' }}>Rendered for fredp@example.com.</p>
              <div data-t="email">
                <Email greeting="Hi Fred,"
                  paragraphs={[
                    `Join us for ${OCTOBER.title} on Monday, October 19, 2026.`,
                    `We meet at ${VENUE.name}.`,
                  ]}
                  details={[['When', 'Monday, October 19, 2026 · 5:30 PM – 7:00 PM'], ['Where', VENUE.name], ['Host', ORG]]}
                  rsvp
                  footer={`This email was sent to fredp@example.com by ${ORG}.`} />
              </div>
            </Modal>
          ) : null}
        </Screen>
      )}
    </Scene>
  );
}
