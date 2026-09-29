import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Input, Modal, PageHead, Screen, Toast } from '../mock.jsx';
import { Card, Empty, Field, Icon } from '../../ui.jsx';
import { VENUE } from '../data.js';

const MAP = 'https://maps.google.com/?q=UF+Health+Nocatee';

const start = { modal: false, name: '', address: '', map: '', focus: '', saved: false, toast: '' };
const steps = [
  { at: 600, tap: 'new', say: 'New venue', side: 'left', set: { modal: true, focus: 'name' } },
  ...typing(1500, 'name', VENUE.name, 55),
  { at: 2700, set: { focus: 'address' } },
  ...typing(2800, 'address', VENUE.address, 70),
  { at: 3800, tap: 'map', say: 'A map link gives guests directions', side: 'above', set: { focus: 'map', map: MAP } },
  { at: 5700, tap: 'save', say: null, set: { modal: false, saved: true, focus: '', toast: 'Venue saved' } },
  { at: 6700, point: 'row', say: 'Pick it in any event’s first step' },
];

export default function VenuesAdd() {
  return (
    <Scene width={560} height={440} length={9500} start={start} steps={steps}
      label="Saving a venue. New venue opens a window where the name UF Health Building and the address Nocatee are typed in, and a Google Maps link is added. Save venue adds it to the list, ready to pick in an event.">
      {(s) => (
        <Screen>
          <PageHead title="Venues" sub="Reusable locations you can drop into any event from the wizard."
            actions={<span className="btn btn-primary" data-t="new"><Icon name="plus" size={15} /> New venue</span>} />
          <Card flush>
            {s.saved ? (
              <table className="table hs-tight">
                <thead><tr><th>Name</th><th>Address</th><th>Phone</th><th>Map</th></tr></thead>
                <tbody>
                  <tr data-t="row" className="hs-new">
                    <td className="t-main">{VENUE.name}</td>
                    <td className="t-sub">{VENUE.address}</td>
                    <td className="t-sub">—</td>
                    <td><a>Map <Icon name="external" size={12} /></a></td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <Empty icon="pin" title="No venues yet" action={<span className="btn btn-primary">Add a venue</span>}>
                Save the places you host at — name, address, phone, and a map link — then pick them in the event wizard.
              </Empty>
            )}
          </Card>
          {s.modal ? (
            <Modal title="New venue"
              footer={(
                <>
                  <span className="btn">Cancel</span>
                  <span className="btn btn-primary" data-t="save">Save venue</span>
                </>
              )}>
              <Field label="Venue name" required><Input value={s.name} focus={s.focus === 'name'} /></Field>
              <Field label="Address">
                <Input value={s.address} placeholder="12 River Rd, Springfield" focus={s.focus === 'address'} />
              </Field>
              <div className="field-row">
                <Field label="Phone"><Input placeholder="(555) 123-4567" /></Field>
                <Field label="Map link" hint="Google Maps / directions URL.">
                  <Input t="map" value={s.map} placeholder="https://maps.google.com/…" focus={s.focus === 'map'} />
                </Field>
              </div>
            </Modal>
          ) : null}
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
