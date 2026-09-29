import React from 'react';
import Scene from '../Scene.jsx';
import { EVENT_STEPS, Input, Modal, Screen, Toast, Wizard } from '../mock.jsx';
import { Card, Icon } from '../../ui.jsx';
import { OCTOBER, VENUE } from '../data.js';

const start = { confirm: false, toast: '' };
const steps = [
  { at: 600, point: 'summary', say: 'A last look before anything goes out' },
  { at: 2500, tap: 'test', say: 'Send yourself a test first', side: 'above', set: { toast: 'Test email sent — check your inbox' } },
  { at: 4700, tap: 'send', say: null, set: { confirm: true, toast: '' } },
  { at: 5700, point: 'yes', say: 'Nothing goes out until you confirm', side: 'below' },
  { at: 7400, tap: 'yes', say: null, set: { confirm: false, toast: '6 invitations queued for sending' } },
];

function Kv({ k, children }) {
  return <div className="kv"><span className="k">{k}</span><span>{children}</span></div>;
}

export default function WizardSend() {
  return (
    <Scene width={560} height={480} length={10500} start={start} steps={steps}
      label="Step 5 of the event wizard. The summary lists the event, when and where, the RSVP deadline, and 6 guests to be emailed. Send test email sends a copy first. Send invitations asks Send invitations now?, and Yes, send queues 6 invitations.">
      {(s) => (
        <Screen bare>
          <Wizard labels={EVENT_STEPS} step={4}>
            <Card title="Review & send">
              <div data-t="summary">
                <Kv k="Event"><strong>{OCTOBER.title}</strong></Kv>
                <Kv k="When">{OCTOBER.iso} at 17:30</Kv>
                <Kv k="Where">{VENUE.name} — {VENUE.address}</Kv>
                <Kv k="RSVPs">Collecting responses until 2026-10-16</Kv>
                <Kv k="Recipients"><strong>6</strong> will be emailed · 6 on the guest list</Kv>
              </div>
              <div className="row mt" style={{ flexWrap: 'nowrap' }}>
                <span className="btn btn-primary" data-t="send"><Icon name="send" size={15} /> Send invitations</span>
                <span className="btn">Save without sending</span>
              </div>
              <div className="divider" style={{ margin: '14px 0' }} />
              <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Send yourself a test first</h3>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <Input placeholder="you@example.org (defaults to your login)" style={{ flex: 1, minWidth: 0 }} />
                <span className="btn" data-t="test">Send test email</span>
              </div>
            </Card>
          </Wizard>
          {s.confirm ? (
            <Modal title="Send invitations now?"
              footer={(
                <>
                  <span className="btn">Cancel</span>
                  <span className="btn btn-green" data-t="yes">Yes, send</span>
                </>
              )}>
              <p style={{ margin: 0 }}>
                Invitation emails will be queued for the <strong>6</strong> guests who have an email
                address and haven't been contacted yet. The event page goes live at the same time.
              </p>
            </Modal>
          ) : null}
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
