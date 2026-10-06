import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { BROADCAST_STEPS, Email, Modal, Screen, Wizard } from '../mock.jsx';
import { Card, Field, Icon } from '../../ui.jsx';
import { BOCC, ORG } from '../data.js';

const start = { blurb: '', focus: false, attached: false, preview: false };
const steps = [
  { at: 600, tap: 'editor', say: 'Write the message', side: 'above', set: { focus: true } },
  ...typing(1400, 'blurb', BOCC.blurb, 26),
  { at: 5000, point: 'tags', say: 'Placeholders fill in for each person' },
  { at: 6600, point: 'toolbar', say: 'Bold, italics, links and pictures', side: 'below' },
  { at: 8200, tap: 'attach', say: 'Attach a file, such as a PDF', side: 'above', set: { attached: true, focus: false } },
  { at: 9800, tap: 'preview', say: null, set: { preview: true } },
  { at: 10700, point: 'email', say: 'What Fred will see', side: 'above' },
];

export default function BroadcastMessage() {
  return (
    <Scene width={560} height={560} length={14000} start={start} steps={steps}
      label="Step 2 of the broadcast wizard. The message reads Hi {{first_name}}, then the notice that the County Commissioners are having a special meeting on Oct 28 at 9 AM to reconsider approvals for Agricultural Enclaves, signed {{org_name}}. First name, Full name and Organization under the box are placeholders. Attach a file adds Agenda Oct 28.pdf, 182 KB, which every email carries. Preview email shows Fred's copy, which ends with View this email online and a link to stop receiving emails.">
      {(s) => (
        <Screen bare>
          <Wizard labels={BROADCAST_STEPS} step={1}>
            <Card title="Write the message">
              <Field label="Message">
                <div className={`rt${s.focus ? ' hs-rt-focus' : ''}`}>
                  <div className="rt-toolbar" data-t="toolbar">
                    <span className="rt-btn"><Icon name="bold" size={15} /></span>
                    <span className="rt-btn"><Icon name="italic" size={15} /></span>
                    <span className="rt-btn"><Icon name="underline" size={15} /></span>
                    <span className="rt-sep" />
                    <span className="rt-select">Font…</span>
                    <span className="rt-select">Size…</span>
                    <span className="rt-sep" />
                    <span className="rt-btn"><Icon name="link" size={15} /></span>
                    <span className="rt-btn"><Icon name="image" size={15} /></span>
                    <span className="rt-select">Full width</span>
                  </div>
                  <div className="rt-editor" data-t="editor">
                    <div>Hi {'{{first_name}}'},</div>
                    <br />
                    <div>
                      {s.blurb || (s.focus ? '' : 'Write your message here.')}
                      {s.focus ? <span className="hs-caret" /> : null}
                    </div>
                    <br />
                    <div>— {'{{org_name}}'}</div>
                  </div>
                </div>
                <div className="chip-row" style={{ marginTop: 6 }} data-t="tags">
                  <span className="tag-btn">First name</span>
                  <span className="tag-btn">Full name</span>
                  <span className="tag-btn">Organization</span>
                </div>
                <div className="hint">Placeholders fill in per recipient. An unsubscribe footer is added automatically.</div>
              </Field>
              <Field label="Attachment" hint="One file up to 5 MB, such as a PDF. Every email carries it.">
                {s.attached ? (
                  <span className="attach-file" data-t="attach">
                    <Icon name="paperclip" size={15} />
                    <span className="attach-name">{BOCC.attachment.name}</span>
                    <span className="attach-size">{BOCC.attachment.size}</span>
                    <span className="btn btn-sm btn-ghost"><Icon name="x" size={13} /> Remove</span>
                  </span>
                ) : (
                  <span className="btn" data-t="attach"><Icon name="paperclip" size={14} /> Attach a file</span>
                )}
              </Field>
              <span className="btn" data-t="preview"><Icon name="eye" size={14} /> Preview email</span>
            </Card>
          </Wizard>
          {s.preview ? (
            <Modal title={`Preview — ${BOCC.subject}`} size="lg">
              <p className="small muted" style={{ margin: '0 0 8px' }}>
                Rendered for a sample recipient (fredp@example.com). {BOCC.attachment.name} ({BOCC.attachment.size}) is attached.
              </p>
              <div data-t="email">
                <Email greeting="Hi Fred," paragraphs={[BOCC.blurb, `— ${ORG}`]}
                  footer={(
                    <>
                      <u>View this email online</u><br />
                      This email was sent to fredp@example.com by {ORG}.<br />
                      <u>Stop receiving emails from {ORG}</u>
                    </>
                  )} />
              </div>
            </Modal>
          ) : null}
        </Screen>
      )}
    </Scene>
  );
}
