import React from 'react';
import Scene from '../Scene.jsx';
import { Area, EventTabs, Input, LogCard, Modal, Screen, Select, Toast } from '../mock.jsx';
import { EmailStatusBadge, Field, Icon, ResponseBadge } from '../../ui.jsx';
import { OCTOBER_GUESTS } from '../data.js';

const BODY = 'Hi {{first_name}},\n\nJust a friendly reminder — we haven’t heard back from you about {{event_title}} on {{event_date}}.';
const TAGS = ['Event date', 'Event time', 'Event title', 'Guest first name', 'Host name', 'RSVP deadline', 'Venue name'];

const CARDS = [
  ['nudge', 'Remind guests who haven’t replied', '2 guest(s) haven’t replied yet.'],
  ['yes', 'Message everyone who accepted', '3 guest(s) have accepted.'],
  ['all', 'Message everyone invited', '6 guest(s) on the list.'],
];

const start = { tab: 'guests', modal: false, delivered: false, toast: '' };
const steps = [
  { at: 600, tap: 'tab-messages', say: 'Follow-ups & nudges', set: { tab: 'messages' } },
  { at: 2100, point: 'card-nudge', say: 'A reminder for everyone who hasn’t replied', side: 'below' },
  { at: 3800, tap: 'compose-nudge', say: null, set: { modal: true } },
  { at: 4800, point: 'audience', say: 'Who gets it', side: 'below' },
  { at: 6300, point: 'message', say: 'Change the words if you like', side: 'above' },
  { at: 8000, tap: 'send', say: null, set: { modal: false, tab: 'emails', toast: '2 emails queued' } },
  { at: 9000, point: 'log', say: 'Every email lands in the log', side: 'above' },
  { at: 9800, set: { delivered: true } },
];

export default function EventNudge() {
  return (
    <Scene width={560} height={566} length={12500} start={start} steps={steps}
      label="An event's Follow-ups & nudges tab, with three messages ready to write. Compose on Remind guests who haven't replied opens the reminder, addressed to the 2 guests who haven't replied, with the Accept and Decline buttons included. Send to 2 guests queues both, and the Email log tab shows them go out.">
      {(s) => (
        <Screen bare>
          <EventTabs tab={s.tab} emails={s.tab === 'emails' ? 8 : 6} />
          {s.tab === 'guests' ? (
            <div className="card">
              <table className="table hs-tight">
                <thead><tr><th>Guest</th><th>Invitation</th><th>Response</th></tr></thead>
                <tbody>
                  {OCTOBER_GUESTS.map((g) => (
                    <tr key={g.id}>
                      <td><span className="t-main">{g.name}</span><div className="t-sub">{g.email}</div></td>
                      <td><EmailStatusBadge status="sent" /></td>
                      <td><ResponseBadge response={g.response} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {s.tab === 'messages' ? (
            <div className="grid3">
              {CARDS.map(([key, title, text]) => (
                <div key={key} className="card card-pad" data-t={`card-${key}`}>
                  <h3 style={{ margin: '0 0 6px', fontSize: 13.5 }}>{title}</h3>
                  <p className="small muted" style={{ marginTop: 0 }}>{text}</p>
                  <span className="btn btn-sm" data-t={`compose-${key}`}><Icon name="pencil" size={14} /> Compose</span>
                </div>
              ))}
            </div>
          ) : null}
          {s.tab === 'emails' ? (
            <LogCard total={8} rows={[
              { id: 'eric', when: 'just now', name: 'Eric A.', email: 'erica@example.com', status: s.delivered ? 'sent' : 'queued', fresh: true },
              { id: 'sean', when: 'just now', name: 'Sean C.', email: 'seanc@example.com', status: s.delivered ? 'sent' : 'queued', fresh: true },
              { id: 'fred', when: '3d ago', name: 'Fred P.', email: 'fredp@example.com', status: 'sent' },
              { id: 'gloria', when: '3d ago', name: 'Gloria N.', email: 'glorian@example.com', status: 'sent' },
            ]} />
          ) : null}
          {s.modal ? (
            <Modal title="Remind guests who haven’t replied" size="lg"
              footer={(
                <>
                  <span className="btn"><Icon name="eye" size={14} /> Preview</span>
                  <span className="btn btn-primary" data-t="send">Send to 2 guests</span>
                </>
              )}>
              <div className="banner banner-info">
                <Icon className="banner-ico" name="info" size={15} />
                <div>Nudges include the Accept / Decline buttons again.</div>
              </div>
              <Field label="Audience">
                <Select t="audience" value="Hasn't replied (emailed, no response)" />
              </Field>
              <Field label="Subject"><Input value="Reminder to RSVP: {{event_title}}" /></Field>
              <Field label="Message">
                <Area t="message" value={BODY} rows={4} />
                <div className="chip-row" style={{ marginTop: 6 }}>
                  {TAGS.map((t) => <span key={t} className="tag-btn">{t}</span>)}
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
