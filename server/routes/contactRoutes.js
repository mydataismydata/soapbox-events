import { Router } from 'express';
import { insertId, withTx } from '../lib/db.js';
import { wrap, v, ApiError } from '../lib/validate.js';
import { parseCsv, csvToContacts } from '../lib/csv.js';

export const contactRouter = Router();

function contactFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = v.str(body.name, { label: 'Name', max: 200 });
  if (!partial || body.email !== undefined) out.email = v.optEmail(body.email, { label: 'Email' });
  if (!partial || body.phone !== undefined) out.phone = v.optStr(body.phone, { label: 'Phone', max: 50 });
  if (!partial || body.notes !== undefined) out.notes = v.optStr(body.notes, { label: 'Notes', max: 2000 });
  return out;
}

function listContacts(db, q) {
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    rows = db.prepare(
      `SELECT * FROM contacts
       WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?
       ORDER BY name COLLATE NOCASE`
    ).all(like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE').all();
  }
  const memberships = db.prepare('SELECT group_id, contact_id FROM group_members').all();
  const byContact = new Map();
  for (const m of memberships) {
    if (!byContact.has(m.contact_id)) byContact.set(m.contact_id, []);
    byContact.get(m.contact_id).push(Number(m.group_id));
  }
  return rows.map((c) => ({ ...c, group_ids: byContact.get(c.id) || [] }));
}

contactRouter.get('/contacts', wrap(async (req, res) => {
  const q = v.optStr(req.query.q, { max: 200 });
  res.json({ contacts: listContacts(req.db, q) });
}));

contactRouter.post('/contacts', wrap(async (req, res) => {
  const f = contactFields(req.body);
  if (f.email) {
    const dup = req.db.prepare('SELECT id FROM contacts WHERE email = ?').get(f.email);
    if (dup) throw new ApiError(409, 'A contact with this email already exists.');
  }
  const info = req.db.prepare(
    'INSERT INTO contacts (name, email, phone, notes) VALUES (?, ?, ?, ?)'
  ).run(f.name, f.email || null, f.phone || null, f.notes || null);
  const contact = req.db.prepare('SELECT * FROM contacts WHERE id = ?').get(insertId(info));
  res.status(201).json({ contact: { ...contact, group_ids: [] } });
}));

contactRouter.put('/contacts/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  const existing = req.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!existing) throw new ApiError(404, 'Contact not found.');
  const f = contactFields(req.body, { partial: true });
  if (f.email) {
    const dup = req.db.prepare('SELECT id FROM contacts WHERE email = ? AND id != ?').get(f.email, id);
    if (dup) throw new ApiError(409, 'Another contact already uses this email.');
  }
  const merged = { ...existing, ...f };
  req.db.prepare(
    `UPDATE contacts SET name = ?, email = ?, phone = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(merged.name, merged.email || null, merged.phone || null, merged.notes || null, id);
  res.json({ ok: true });
}));

contactRouter.post('/contacts/:id/unsubscribe', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  const on = v.bool(req.body.on, true);
  const info = req.db.prepare(
    `UPDATE contacts SET unsubscribed_at = ${on ? "datetime('now')" : 'NULL'} WHERE id = ?`
  ).run(id);
  if (Number(info.changes) === 0) throw new ApiError(404, 'Contact not found.');
  // Unsubscribing also drops them from every group, so group sends skip them.
  if (on) req.db.prepare('DELETE FROM group_members WHERE contact_id = ?').run(id);
  res.json({ ok: true });
}));

contactRouter.delete('/contacts/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  const info = req.db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  if (Number(info.changes) === 0) throw new ApiError(404, 'Contact not found.');
  res.json({ ok: true });
}));

// Bulk delete from the contact list's selection. One transaction, so a
// selection either goes entirely or not at all. Ids that no longer exist are
// counted as already gone rather than failing the whole batch — two people
// deleting the same contact shouldn't produce an error.
contactRouter.post('/contacts/bulk-delete', wrap(async (req, res) => {
  const ids = v.intArray(req.body.contact_ids, { label: 'contact_ids' });
  if (ids.length === 0) throw new ApiError(400, 'Select at least one contact to delete.');
  const stmt = req.db.prepare('DELETE FROM contacts WHERE id = ?');
  const deleted = withTx(req.db, () => {
    let n = 0;
    for (const id of ids) n += Number(stmt.run(id).changes);
    return n;
  });
  res.json({ ok: true, deleted });
}));

// CSV import. Body: { csv: "<file text>" }. Rows with an email that already
// exists are skipped, so re-importing the same file is safe.
contactRouter.post('/contacts/import', wrap(async (req, res) => {
  const csvText = v.str(req.body.csv, { label: 'CSV content', max: 5_000_000 });
  const { contacts, errors } = csvToContacts(parseCsv(csvText));
  if (contacts.length === 0) {
    throw new ApiError(400, errors[0] || 'No contacts found in the file. Expected columns: name, email, phone, notes.');
  }
  let added = 0;
  let skipped = 0;
  withTx(req.db, () => {
    const existsStmt = req.db.prepare('SELECT id FROM contacts WHERE email = ?');
    const insertStmt = req.db.prepare('INSERT INTO contacts (name, email, phone, notes) VALUES (?, ?, ?, ?)');
    for (const c of contacts) {
      if (c.email && existsStmt.get(c.email)) { skipped++; continue; }
      insertStmt.run(c.name, c.email || null, c.phone || null, c.notes || null);
      added++;
    }
  });
  res.json({ added, skipped, errors });
}));
