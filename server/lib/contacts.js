// Contact names.
//
// A contact collects a first and last name separately, but everything
// downstream reads one display string: the invite join (`c.name AS
// contact_name`), the email-log snapshot, merge tags, CSV and WordPress
// exports. Rather than teach all of those about two columns, `name` is kept
// beside the parts and composed here on every write — so this file is the
// only place that decides how the three relate.
import { insertId } from './db.js';

export const MAX_NAME_PART = 100;

// Split at the FIRST space, not the last: {{first_name}} has always rendered
// the first word (format.js firstName), and a contact list full of people who
// were imported under one `name` must keep greeting them the same way after
// the split. So "Mary Anne Fitzgerald" becomes Mary / Anne Fitzgerald. A
// single word is a first name — "Mom" and "Reception" are greetings, not
// surnames. Anyone the guess reads wrong can be corrected in the form, which
// collects the two properly and never comes through here.
export function splitPersonName(full) {
  const clean = String(full ?? '').trim().replace(/\s+/g, ' ');
  const cut = clean.indexOf(' ');
  if (cut === -1) return { first_name: clean.slice(0, MAX_NAME_PART), last_name: '' };
  return {
    first_name: clean.slice(0, cut).slice(0, MAX_NAME_PART),
    last_name: clean.slice(cut + 1).slice(0, MAX_NAME_PART),
  };
}

export function joinPersonName(first, last) {
  return [String(first ?? '').trim(), String(last ?? '').trim()].filter(Boolean).join(' ').slice(0, 200);
}

// Normalize either shape into all three fields. Explicit parts win: they come
// from the contact form, where the person typing knows which is which. A lone
// `name` (CSV import, a guest list, the API) gets the guess above.
export function personName(fields = {}) {
  const first = String(fields.first_name ?? '').trim().slice(0, MAX_NAME_PART);
  const last = String(fields.last_name ?? '').trim().slice(0, MAX_NAME_PART);
  if (first || last) return { name: joinPersonName(first, last), first_name: first, last_name: last };
  const whole = String(fields.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return { name: whole, ...splitPersonName(whole) };
}

// Prepare-once insert for the loops that add contacts in bulk (CSV import,
// broadcast recipients, event guest lists).
export function contactInserter(db) {
  const stmt = db.prepare(
    `INSERT INTO contacts (name, first_name, last_name, email, phone, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  return (fields) => {
    const n = personName(fields);
    return insertId(stmt.run(
      n.name, n.first_name, n.last_name,
      fields.email || null, fields.phone || null, fields.notes || null,
    ));
  };
}
