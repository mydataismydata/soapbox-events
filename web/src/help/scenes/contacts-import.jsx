import React from 'react';
import Scene from '../Scene.jsx';
import { Area, Modal, PageHead, Screen, Toast } from '../mock.jsx';
import { Card, Empty, Field, Icon } from '../../ui.jsx';
import { PEOPLE } from '../data.js';

const CSV = ['first name,last name,email', ...PEOPLE.map((p) => `${p.first},${p.last},${p.email}`)].join('\n');

const start = { modal: false, csv: '', result: false, done: false, toast: '' };
const steps = [
  { at: 600, tap: 'import', say: 'Import CSV', side: 'left', set: { modal: true } },
  { at: 1900, point: 'choose', say: 'Choose a file, or paste rows below', side: 'right' },
  { at: 3400, set: { csv: CSV } },
  { at: 3500, point: 'csv', say: 'The first row names the columns', side: 'above' },
  { at: 5300, tap: 'run', say: null, set: { result: true, toast: '7 contacts imported' } },
  { at: 6200, point: 'result', say: 'Anyone already here is skipped', side: 'above' },
  { at: 7900, tap: 'close', say: null, set: { modal: false, done: true } },
  { at: 8800, point: 'table', say: 'All seven, ready to invite', side: 'above' },
];

export default function ContactsImport() {
  return (
    <Scene width={560} height={500} length={11500} start={start} steps={steps}
      label="Importing contacts. Import CSV opens a window where rows copied from a spreadsheet are pasted in, starting with the column names first name, last name and email. Import adds all seven people, and the list then shows them.">
      {(s) => (
        <Screen tab="Contacts">
          <PageHead title="Contacts" sub={`${s.done ? 7 : 0} people · shared across all of your events`}
            actions={(
              <>
                <span className="btn" data-t="import"><Icon name="upload" size={15} /> Import CSV</span>
                <span className="btn btn-primary"><Icon name="plus" size={15} /> Add contact</span>
              </>
            )} />
          {s.done ? (
            <Card flush>
              <table className="table hs-tight" data-t="table">
                <thead><tr><th>First name</th><th>Last name</th><th>Email</th></tr></thead>
                <tbody>
                  {PEOPLE.map((p) => (
                    <tr key={p.id} className="hs-new">
                      <td><span className="t-main">{p.first}</span></td>
                      <td><span className="t-main">{p.last}</span></td>
                      <td className="t-sub">{p.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <Card flush>
              <Empty icon="user" title="No contacts yet"
                action={<span className="btn btn-primary">Import a CSV</span>}>
                Add people one at a time or import a whole spreadsheet.
              </Empty>
            </Card>
          )}
          {s.modal ? (
            <Modal title="Import contacts from CSV" size="lg"
              footer={(
                <>
                  <span className="btn" data-t="close">{s.result ? 'Close' : 'Cancel'}</span>
                  {s.result ? null : <span className="btn btn-primary" data-t="run">Import</span>}
                </>
              )}>
              <p className="small muted" style={{ marginTop: 0 }}>
                Columns recognized (any order, case-insensitive): <code>first name</code> + <code>last name</code> (or
                a single <code>name</code>, split at the first space), <code>email</code>, <code>phone</code>,{' '}
                <code>notes</code>. Rows whose
                email already exists are skipped, so re-importing is safe.
              </p>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="btn btn-sm" data-t="choose"><Icon name="upload" size={14} /> Choose CSV file…</span>
                <span className="small muted">or paste below</span>
              </div>
              <Field>
                <Area t="csv" value={s.csv} rows={5} mono
                  placeholder={'first name,last name,email,phone\nAva,Thompson,ava@example.com,555-0101'} />
              </Field>
              {s.result ? (
                <div className="banner banner-ok" data-t="result" style={{ marginBottom: 0 }}>
                  <Icon className="banner-ico" name="checkCircle" size={15} />
                  <div>Imported 7, skipped 0 duplicates.</div>
                </div>
              ) : null}
            </Modal>
          ) : null}
          <Toast text={s.toast} />
        </Screen>
      )}
    </Scene>
  );
}
