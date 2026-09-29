import React from 'react';
import Scene from '../Scene.jsx';
import { EventTabs, LogCard, Modal, Picker, Screen, Toast } from '../mock.jsx';
import { Card, EmailStatusBadge, Icon, ResponseBadge } from '../../ui.jsx';
import { EXECUTIVE, PEOPLE } from '../data.js';

// The executive team was invited first. Adding All members brings in the
// other four, who are then invited on their own.
const NEW = PEOPLE.filter((p) => !EXECUTIVE.includes(p.id));

const start = { modal: false, groups: [], added: false, confirm: false, tab: 'guests', delivered: false, toast: '' };
const steps = [
  { at: 600, tap: 'add', say: 'Add guests any time', side: 'right', set: { modal: true } },
  { at: 2000, tap: 'grp-all', say: 'Pick a group or people', set: { groups: ['all'] } },
  { at: 3600, point: 'tally', say: 'People already invited are skipped', side: 'above' },
  { at: 5400, tap: 'add-to-event', say: null, set: { modal: false, added: true, toast: '4 added, 3 already invited · not emailed yet' } },
  { at: 6500, point: 'send-new', say: 'This emails only the new guests', side: 'below' },
  { at: 8200, tap: 'send-new', say: null, set: { confirm: true, toast: '' } },
  { at: 9300, tap: 'send-4', say: null, set: { confirm: false, tab: 'emails', toast: '4 invitations queued' } },
  { at: 10300, set: { delivered: true } },
  { at: 10400, point: 'log', say: 'Just the four new guests', side: 'above' },
];

export default function EventAdd() {
  return (
    <Scene width={560} height={524} length={13000} start={start} steps={steps}
      label="Adding guests to an event whose invitations have gone out. Three executive team members were invited first. Add guests opens the picker, and All members (7) selects the other 4, since 3 are already invited. Add to event puts them on the list unsent, and the green Send invitations to 4 new guests button emails only those four.">
      {(s) => {
        const people = PEOPLE.filter((p) => s.added || EXECUTIVE.includes(p.id));
        const fresh = s.added && !s.tab.startsWith('e');
        return (
          <Screen bare>
            <EventTabs tab={s.tab} guests={people.length} emails={s.tab === 'emails' ? 7 : 3} />
            {s.tab === 'guests' ? (
              <Card flush>
                <div className="table-toolbar">
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <span className="btn btn-primary btn-sm" data-t="add"><Icon name="plus" size={14} /> Add guests</span>
                    <span className="btn btn-green btn-sm" data-t="send-new" aria-disabled={s.added ? undefined : 'true'}>
                      <Icon name="send" size={14} /> {s.added ? 'Send invitations to 4 new guests' : 'Send invitations to new guests'}
                    </span>
                  </div>
                </div>
                <table className="table hs-tight">
                  <thead><tr><th>Guest</th><th>Invitation</th><th>Response</th></tr></thead>
                  <tbody>
                    {people.map((p) => {
                      const isNew = !EXECUTIVE.includes(p.id);
                      return (
                        <tr key={p.id} className={isNew && fresh ? 'hs-new' : undefined}>
                          <td><span className="t-main">{p.name}</span><div className="t-sub">{p.email}</div></td>
                          <td><EmailStatusBadge status={isNew ? 'not_sent' : 'sent'} /></td>
                          <td><ResponseBadge response={p.id === 'joe' ? 'yes' : null} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            ) : (
              <LogCard total={7} rows={[
                ...NEW.map((p) => ({ id: p.id, when: 'just now', name: p.name, email: p.email, status: s.delivered ? 'sent' : 'queued', fresh: true })),
                { id: 'fred', when: '3d ago', name: 'Fred P.', email: 'fredp@example.com', status: 'sent' },
              ]} />
            )}
            {s.modal ? (
              <Modal title="Add guests" size="lg"
                footer={(
                  <>
                    <span className="btn">Close</span>
                    <span className="btn btn-primary" data-t="add-to-event">Add to event</span>
                  </>
                )}>
                <div className="banner banner-info">
                  <Icon className="banner-ico" name="info" size={15} />
                  <div>Adding someone doesn’t email them. They join the list unsent, and the green
                    <strong> Send invitation to N new guests </strong>button then invites just them — nobody
                    already invited is contacted again.</div>
                </div>
                <Picker groups={s.groups} invited={EXECUTIVE} listHeight={104} />
              </Modal>
            ) : null}
            {s.confirm ? (
              <Modal title="Send invitations to 4 new guests?"
                footer={(
                  <>
                    <span className="btn">Cancel</span>
                    <span className="btn btn-primary" data-t="send-4">Send 4</span>
                  </>
                )}>
                <p style={{ margin: 0 }}>
                  4 guests have been added since the last send, and will be emailed now. Nobody who has
                  already been emailed gets a second copy.
                </p>
              </Modal>
            ) : null}
            <Toast text={s.toast} />
          </Screen>
        );
      }}
    </Scene>
  );
}
