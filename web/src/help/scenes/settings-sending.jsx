import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Check, Input, Screen, Toast } from '../mock.jsx';
import { Card, Field, Icon } from '../../ui.jsx';
import { ORG } from '../data.js';

const start = { name: '', email: '', key: '', focus: '', live: false, toast: '' };
const steps = [
  { at: 600, point: 'banner', say: 'Nothing is delivered until a key is saved' },
  { at: 2300, tap: 'name', say: 'The name people see', set: { focus: 'name' } },
  ...typing(3000, 'name', ORG, 50),
  { at: 4100, tap: 'email', say: 'An address on your verified domain', set: { focus: 'email' } },
  ...typing(4800, 'email', 'sjcc@example.com', 45),
  { at: 5900, tap: 'key', say: 'Paste the API key from SMTP2GO', side: 'above', set: { focus: 'key' } },
  { at: 6600, set: { key: '••••••••••••••••••••••' } },
  { at: 7600, tap: 'save', say: null, set: { focus: '', live: true, toast: 'Sending settings saved' } },
  { at: 8600, point: 'banner', say: 'Live, with this cycle’s quota' },
];

export default function SettingsSending() {
  return (
    <Scene width={560} height={440} length={11500} start={start} steps={steps}
      label="The Email sending settings. A yellow box says simulation mode: no SMTP2GO API key is set, so nothing is delivered. The sender name SJC Conservatives and a sender email are typed in, the SMTP2GO API key is pasted, and Save sending settings turns the box green: live sending, with the quota left this cycle.">
      {(s) => (
        <Screen bare>
          <Card title="Email sending">
            <div data-t="banner">
              {s.live ? (
                <div className="banner banner-ok">
                  <Icon className="banner-ico" name="checkCircle" size={15} />
                  <div><strong>Live sending via SMTP2GO.</strong> 0 of 1000 emails used this cycle — 1000 remaining · 0 sent by this organization this month.</div>
                </div>
              ) : (
                <div className="banner banner-warn">
                  <Icon className="banner-ico" name="alert" size={15} />
                  <div><strong>Simulation mode.</strong> No SMTP2GO API key is configured, so emails are rendered and
                    logged (viewable in each event's email log) but not delivered.</div>
                </div>
              )}
            </div>
            <div className="field-row">
              <Field label="Sender name" hint="The “from” name guests see.">
                <Input t="name" value={s.name} focus={s.focus === 'name'} />
              </Field>
              <Field label="Sender email" hint="Must belong to a domain verified in SMTP2GO.">
                <Input t="email" value={s.email} focus={s.focus === 'email'} />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Reply-to (optional)"><Input /></Field>
              <Field label="SMTP2GO API key">
                <Input t="key" value={s.key} placeholder="api-…" focus={s.focus === 'key'} />
              </Field>
            </div>
            <label className="checkbox">
              <Check on={false} />
              <span><span className="cb-label">Send broadcasts from a different address</span></span>
            </label>
            <div className="row" style={{ gap: 12 }}>
              <span className="btn btn-primary" data-t="save">Save sending settings</span>
              {s.live ? <span className="small muted">No unsaved changes.</span> : null}
            </div>
          </Card>
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
