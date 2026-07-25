import { Router } from 'express';
import { wrap, v, ApiError } from '../lib/validate.js';

export const emailLogRouter = Router();

// Columns the log can be ordered by. Whitelisted, because the value is
// interpolated into the SQL — never take an ORDER BY from the query string.
const SORTS = {
  when: "COALESCE(l.sent_at, l.created_at)",
  recipient: 'LOWER(COALESCE(NULLIF(l.to_name, \'\'), l.to_email))',
  kind: 'l.kind',
  subject: 'LOWER(l.subject)',
  source: 'LOWER(COALESCE(e.title, b.title))',
  status: 'l.status',
};

const FROM = `
  FROM email_log l
  LEFT JOIN events e ON e.id = l.event_id
  LEFT JOIN broadcasts b ON b.id = l.broadcast_id`;

// Shared WHERE for the list and its total, so the count always matches the rows.
function buildWhere(query) {
  const where = [];
  const params = [];
  if (query.event_id) {
    where.push('l.event_id = ?');
    params.push(v.int(query.event_id, { label: 'event_id', min: 1 }));
  }
  if (query.broadcast_id) {
    where.push('l.broadcast_id = ?');
    params.push(v.int(query.broadcast_id, { label: 'broadcast_id', min: 1 }));
  }
  const status = v.optStr(query.status, { max: 20 });
  if (status) { where.push('l.status = ?'); params.push(status); }
  const kind = v.optStr(query.kind, { max: 20 });
  if (kind) { where.push('l.kind = ?'); params.push(kind); }
  // Free-text search over the recipient — name or address, either way round.
  const q = v.optStr(query.q, { max: 200 }).trim();
  if (q) {
    where.push('(LOWER(l.to_email) LIKE ? OR LOWER(l.to_name) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }
  return { clauses: where, params };
}

function whereSql(clauses, ...extra) {
  const all = [...clauses, ...extra];
  return all.length ? ` WHERE ${all.join(' AND ')}` : '';
}

emailLogRouter.get('/emails', wrap(async (req, res) => {
  const { clauses, params } = buildWhere(req.query);
  const where = whereSql(clauses);

  const sortKey = SORTS[req.query.sort] ? req.query.sort : 'when';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  // id breaks ties so paging can't show the same row twice or skip one.
  const orderBy = ` ORDER BY ${SORTS[sortKey]} ${dir}, l.id ${dir}`;

  // `limit` is the older name for the same thing; both are accepted.
  const perPage = v.int(req.query.per_page ?? req.query.limit, {
    label: 'per_page', min: 1, max: 500, required: false, fallback: 200,
  });
  const page = v.int(req.query.page, { label: 'page', min: 1, max: 100000, required: false, fallback: 1 });

  const total = req.db.prepare(`SELECT COUNT(*) AS n ${FROM}${where}`).get(...params).n;
  const emails = req.db.prepare(`
    SELECT l.id, l.event_id, l.invite_id, l.broadcast_id, l.kind, l.to_name, l.to_email, l.subject,
           l.status, l.error, l.provider_id, l.created_at, l.sent_at,
           e.title AS event_title, e.slug AS event_slug, b.title AS broadcast_title
    ${FROM}${where}${orderBy} LIMIT ? OFFSET ?
  `).all(...params, perPage, (page - 1) * perPage);

  // How many are still moving, so the UI knows whether to keep polling — counted
  // across the whole filtered set, not just the page on screen.
  const pending = req.db.prepare(
    `SELECT COUNT(*) AS n ${FROM}${whereSql(clauses, "l.status IN ('queued', 'sending')")}`
  ).get(...params).n;

  res.json({ emails, total, page, per_page: perPage, pages: Math.max(1, Math.ceil(total / perPage)), pending });
}));

emailLogRouter.get('/emails/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  const email = req.db.prepare(`
    SELECT l.*, e.title AS event_title, b.title AS broadcast_title FROM email_log l
    LEFT JOIN events e ON e.id = l.event_id
    LEFT JOIN broadcasts b ON b.id = l.broadcast_id
    WHERE l.id = ?
  `).get(id);
  if (!email) throw new ApiError(404, 'Email not found.');
  res.json({ email });
}));

emailLogRouter.post('/emails/:id/retry', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  const email = req.db.prepare('SELECT * FROM email_log WHERE id = ?').get(id);
  if (!email) throw new ApiError(404, 'Email not found.');
  if (email.status !== 'failed') throw new ApiError(400, 'Only failed emails can be retried.');
  req.db.prepare("UPDATE email_log SET status = 'queued', error = NULL WHERE id = ?").run(id);
  if (email.invite_id && email.kind === 'invitation') {
    req.db.prepare("UPDATE invites SET email_status = 'queued' WHERE id = ?").run(email.invite_id);
  }
  res.json({ ok: true });
}));
