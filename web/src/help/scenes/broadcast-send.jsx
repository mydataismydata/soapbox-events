import React from 'react';
import Scene from '../Scene.jsx';
import { BROADCAST_STEPS, Modal, Picker, Screen, Toast, Wizard, WizardFoot } from '../mock.jsx';
import { Card, Icon } from '../../ui.jsx';
import { BOCC } from '../data.js';

const start = { step: 2, groups: [], confirm: false, toast: '' };
const steps = [
  { at: 600, tap: 'grp-all', say: 'Pick who receives it', set: { groups: ['all'] } },
  { at: 2300, point: 'list', say: 'Everyone in the group is ticked', side: 'above' },
  { at: 4000, tap: 'continue', say: null, set: { step: 3 } },
  { at: 5000, point: 'recipients', say: 'Exactly how many will get it', side: 'above' },
  { at: 6700, tap: 'send', say: null, set: { confirm: true } },
  { at: 7700, point: 'yes', say: 'Nothing goes out until you confirm', side: 'below' },
  { at: 9300, tap: 'yes', say: null, set: { confirm: false, toast: '7 emails queued' } },
];

function Kv({ k, children, t }) {
  return <div className="kv" data-t={t}><span className="k">{k}</span><span>{children}</span></div>;
}

export default function BroadcastSend() {
  return (
    <Scene width={560} height={470} length={12000} start={start} steps={steps}
      label="Steps 3 and 4 of the broadcast wizard. Clicking All members (7) picks all seven people, and Continue moves to Review & send, which says 7 recipients will be emailed. Send broadcast asks Send this broadcast now?, and Yes, send queues 7 emails.">
      {(s) => (
        <Screen bare>
          <Wizard labels={BROADCAST_STEPS} step={s.step}>
            {s.step === 2 ? (
              <>
                <Card title="Who receives this?">
                  <Picker noun="contact" groups={s.groups} listHeight={168} />
                </Card>
                <WizardFoot />
              </>
            ) : (
              <Card title="Review & send">
                <Kv k="Broadcast"><strong>{BOCC.title}</strong></Kv>
                <Kv k="Subject">{BOCC.subject}</Kv>
                <Kv k="Web version">On — “view in browser” link included</Kv>
                <Kv k="Recipients" t="recipients"><strong>7</strong> recipients will be emailed</Kv>
                <div className="row mt" style={{ flexWrap: 'nowrap' }}>
                  <span className="btn btn-primary" data-t="send"><Icon name="send" size={15} /> Send broadcast</span>
                  <span className="btn">Save draft</span>
                </div>
              </Card>
            )}
          </Wizard>
          {s.confirm ? (
            <Modal title="Send this broadcast now?"
              footer={(
                <>
                  <span className="btn">Cancel</span>
                  <span className="btn btn-green" data-t="yes">Yes, send</span>
                </>
              )}>
              <p style={{ margin: 0 }}>
                7 emails will be queued — one per recipient with an email address who hasn't unsubscribed.
                The web version goes live at the same time.
              </p>
            </Modal>
          ) : null}
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
