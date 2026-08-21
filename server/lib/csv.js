// CSV writing and parsing. The writer emits RFC 4180 CSV with a UTF-8 BOM so
// Excel opens exports cleanly; the parser is a small state machine that
// handles quoted fields, embedded commas/newlines and both line endings.

function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Guard against spreadsheet formula injection on export.
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv(rows, columns) {
  const header = columns.map((c) => csvField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => csvField(typeof c.get === 'function' ? c.get(row) : row[c.key])).join(',')
  );
  return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n';
}

export function parseCsv(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    sawAny = true;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (sawAny && (field !== '' || row.length > 0)) pushRow();
  // Drop fully empty trailing rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Interpret a parsed CSV as contacts. Accepts flexible headers: first/last
// name pair (or a single name), email, phone, notes — case-insensitive, any order.
// Without a header row, columns are assumed to be name,email,phone,notes.
export function csvToContacts(rows) {
  if (rows.length === 0) return { contacts: [], errors: ['The file is empty.'] };
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const first = rows[0].map(norm);
  const findCol = (...names) => first.findIndex((h) => names.includes(h));

  let idx = {
    name: findCol('name', 'fullname', 'contactname', 'contact'),
    firstName: findCol('firstname', 'first', 'givenname'),
    lastName: findCol('lastname', 'last', 'surname', 'familyname'),
    email: findCol('email', 'emailaddress', 'mail'),
    phone: findCol('phone', 'phonenumber', 'mobile', 'cell', 'telephone'),
    notes: findCol('notes', 'note', 'comment', 'comments'),
  };
  const hasHeader = idx.name !== -1 || idx.email !== -1 || idx.firstName !== -1;
  let dataRows = rows;
  if (hasHeader) {
    dataRows = rows.slice(1);
  } else {
    idx = { name: 0, firstName: -1, lastName: -1, email: 1, phone: 2, notes: 3 };
  }

  const contacts = [];
  const errors = [];
  dataRows.forEach((row, i) => {
    const cell = (j) => (j >= 0 && j < row.length ? row[j].trim() : '');
    // A file with first/last columns keeps them apart; one with a single name
    // column is split downstream by personName().
    const firstPart = cell(idx.firstName);
    const lastPart = cell(idx.lastName);
    let name = cell(idx.name) || [firstPart, lastPart].filter(Boolean).join(' ');
    const email = cell(idx.email).toLowerCase();
    const phone = cell(idx.phone);
    const notes = cell(idx.notes);
    if (!name && !email) return;
    if (!name) name = email.split('@')[0];
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errors.push(`Row ${i + (hasHeader ? 2 : 1)}: "${email}" is not a valid email — row skipped.`);
      return;
    }
    contacts.push({
      name: name.slice(0, 200),
      first_name: firstPart.slice(0, 100),
      last_name: lastPart.slice(0, 100),
      email, phone: phone.slice(0, 50), notes: notes.slice(0, 1000),
    });
  });
  return { contacts, errors };
}
