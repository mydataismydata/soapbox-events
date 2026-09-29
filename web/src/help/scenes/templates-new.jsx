import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Area, Input, Modal, PageHead, Screen, Toast } from '../mock.jsx';
import { Badge, Card, Empty, Field, Icon } from '../../ui.jsx';

const TAGS = [
  ['Event date', 'event_date'],
  ['Event time', 'event_time'],
  ['Event title', 'event_title'],
  ['Guest first name', 'first_name'],
  ['Host name', 'host_name'],
  ['RSVP deadline', 'rsvp_deadline'],
  ['Venue name', 'venue_name'],
];

const B1 = 'Hi {{first_name}}';
const B2 = `${B1},\n\nJoin us for `;
const B3 = `${B2}{{event_title}}`;
const B4 = `${B3} on `;
const B5 = `${B4}{{event_date}}.`;

const start = { modal: false, name: '', body: '', focus: '', saved: false, def: false, toast: '' };
const steps = [
  { at: 600, tap: 'new', say: 'New template', side: 'left', set: { modal: true, focus: 'name' } },
  ...typing(1400, 'name', 'Monthly meeting', 60),
  { at: 2500, set: { focus: 'body' } },
  ...typing(2600, 'body', 'Hi ', 90),
  { at: 3000, tap: 'tag-first_name', say: 'Click a placeholder to put it in', set: { body: B1 } },
  ...typing(3900, 'body', ',\n\nJoin us for ', 45, B1),
  { at: 4700, tap: 'tag-event_title', set: { body: B3 } },
  ...typing(5500, 'body', ' on ', 70, B3),
  { at: 5900, tap: 'tag-event_date', set: { body: B5 } },
  { at: 7000, tap: 'save', say: null, set: { modal: false, saved: true, focus: '', toast: 'Template saved' } },
  { at: 8100, tap: 'make-default', say: null, set: { def: true, toast: 'Default template set' } },
  { at: 9000, point: 'default-badge', say: 'The default starts every new event', side: 'below' },
];

export default function TemplatesNew() {
  return (
    <Scene width={560} height={484} length={11800} start={start} steps={steps}
      label="Writing a template. New template opens a window where the name Monthly meeting is typed. The message is built from typing and placeholder buttons: Hi {{first_name}}, Join us for {{event_title}} on {{event_date}}. Save template adds it, and Make default marks it as the one every new event starts with.">
      {(s) => (
        <Screen>
          <PageHead title="Invitation templates" sub="Reusable message text with placeholders. Pick one inside the event wizard."
            actions={<span className="btn btn-primary" data-t="new"><Icon name="plus" size={15} /> New template</span>} />
          {s.saved ? (
            <div className="grid2">
              <div className="card card-pad hs-new">
                <div className="spread">
                  <h3 style={{ margin: 0, fontSize: 13.5 }}>Monthly meeting</h3>
                  {s.def ? <span data-t="default-badge"><Badge tone="indigo" dot>Default</Badge></span> : null}
                </div>
                <p className="small muted" style={{ margin: '4px 0 2px' }}><strong>Subject:</strong> You're invited: {'{{event_title}}'}</p>
                <p className="small muted" style={{ margin: 0, whiteSpace: 'pre-line' }}>{B5}</p>
                <div className="row mt" style={{ gap: 6 }}>
                  <span className="btn btn-sm"><Icon name="pencil" size={14} /> Edit</span>
                  {s.def ? null : <span className="btn btn-sm" data-t="make-default">Make default</span>}
                  <span className="btn btn-sm btn-ghost"><Icon name="trash" size={14} /> Delete</span>
                </div>
              </div>
            </div>
          ) : (
            <Card flush>
              <Empty icon="file" title="No templates yet" action={<span className="btn btn-primary">Create a template</span>}>
                Write your invitation wording once, reuse it for every event.
              </Empty>
            </Card>
          )}
          {s.modal ? (
            <Modal title="New template" size="lg"
              footer={(
                <>
                  <span className="btn">Cancel</span>
                  <span className="btn btn-primary" data-t="save">Save template</span>
                </>
              )}>
              <Field label="Template name" required><Input value={s.name} focus={s.focus === 'name'} /></Field>
              <Field label="Email subject"><Input value="You're invited: {{event_title}}" /></Field>
              <Field label="Message body">
                <Area value={s.body} rows={4} focus={s.focus === 'body'} />
                <div className="chip-row" style={{ marginTop: 6 }}>
                  {TAGS.map(([label, tag]) => <span key={tag} className="tag-btn" data-t={`tag-${tag}`}>{label}</span>)}
                </div>
              </Field>
            </Modal>
          ) : null}
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
