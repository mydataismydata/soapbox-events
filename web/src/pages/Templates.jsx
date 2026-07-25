import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  Spinner, Modal, ConfirmModal, Empty, Field, useToast, Badge, insertAtCursor, Card, Icon,
} from '../ui.jsx';
import TagButtons from '../components/TagButtons.jsx';

function TemplateModal({ template, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(template?.id);
  const [form, setForm] = useState({
    name: template?.name || '',
    subject: template?.subject || "You're invited: {{event_title}}",
    body: template?.body || '',
  });
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

  async function save() {
    setBusy(true);
    try {
      if (editing) await api.put(`/api/templates/${template.id}`, form);
      else await api.post('/api/templates', form);
      toast('Template saved');
      onSaved();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${template.name}` : 'New template'} size="lg" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? 'Saving…' : 'Save template'}
          </button>
        </>
      }>
      <Field label="Template name" required>
        <input value={form.name} maxLength={120} autoFocus
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Email subject">
        <input value={form.subject} maxLength={300}
          onChange={(e) => setForm({ ...form, subject: e.target.value })} />
      </Field>
      <Field label="Message body"
        hint="Click a placeholder to insert it at the cursor — it fills in automatically for each event and guest.">
        <textarea ref={bodyRef} rows={10} value={form.body} maxLength={20000}
          onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <TagButtons onInsert={(snippet) =>
          insertAtCursor(bodyRef, form.body, snippet, (val) => setForm((f) => ({ ...f, body: val })))} />
      </Field>
    </Modal>
  );
}

export default function Templates() {
  const toast = useToast();
  const [templates, setTemplates] = useState(null);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api.get('/api/templates');
    setTemplates(d.templates);
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'bad')); }, []);

  if (!templates) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Invitation templates</h1>
          <p className="page-sub">Reusable message text with placeholders. Pick one inside the event wizard.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}>
            <Icon name="plus" size={15} /> New template
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card flush>
          <Empty icon="file" title="No templates yet"
            action={<button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}>Create a template</button>}>
            Write your invitation wording once, reuse it for every event.
          </Empty>
        </Card>
      ) : (
        <div className="grid2">
          {templates.map((t) => (
            <div key={t.id} className="card card-pad">
              <div className="spread">
                <h3 style={{ margin: 0, fontSize: 14 }}>{t.name}</h3>
                {t.is_default ? <Badge tone="indigo" dot>Default</Badge> : null}
              </div>
              <p className="small muted" style={{ margin: '4px 0 2px' }}><strong>Subject:</strong> {t.subject || '—'}</p>
              <p className="small muted" style={{
                margin: 0, whiteSpace: 'pre-line', maxHeight: 72, overflow: 'hidden',
              }}>{t.body.slice(0, 220)}{t.body.length > 220 ? '…' : ''}</p>
              <div className="row mt">
                <button className="btn btn-sm" onClick={() => setModal({ type: 'edit', template: t })}>
                  <Icon name="pencil" size={14} /> Edit
                </button>
                {!t.is_default ? (
                  <button className="btn btn-sm" disabled={busy} onClick={async () => {
                    try { await api.post(`/api/templates/${t.id}/default`); toast('Default template set'); load(); }
                    catch (err) { toast(err.message, 'bad'); }
                  }}>Make default</button>
                ) : null}
                <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'delete', template: t })}>
                  <Icon name="trash" size={14} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.type === 'new' || modal?.type === 'edit' ? (
        <TemplateModal template={modal.template}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }} />
      ) : null}

      {modal?.type === 'delete' ? (
        <ConfirmModal title="Delete template?" danger busy={busy}
          message={`Delete "${modal.template.name}"? Events that already used it keep their text.`}
          confirmLabel="Delete" onClose={() => setModal(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api.del(`/api/templates/${modal.template.id}`);
              toast('Template deleted');
              setModal(null);
              await load();
            } catch (err) { toast(err.message, 'bad'); }
            finally { setBusy(false); }
          }} />
      ) : null}
    </div>
  );
}
