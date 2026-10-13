import { Router } from 'express';
import { wrap, v, ApiError } from '../lib/validate.js';
import { requireAdmin, hashPassword, verifyPassword, generatePassword, createUser } from '../lib/auth.js';

export const userRouter = Router();

// Any signed-in user may change their own password.
userRouter.post('/account/password', wrap(async (req, res) => {
  const current = v.str(req.body.current, { label: 'Current password', max: 200 });
  const next = v.str(req.body.next, { label: 'New password', min: 10, max: 200 });
  const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, user.password_hash)) {
    throw new ApiError(400, 'Your current password is incorrect.');
  }
  req.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  // Sign out other sessions for this user; the current one stays valid.
  res.json({ ok: true });
}));

userRouter.use(requireAdmin);

userRouter.get('/users', wrap(async (req, res) => {
  const users = req.db.prepare(
    'SELECT id, email, name, role, active, created_at, last_login_at FROM users ORDER BY name COLLATE NOCASE'
  ).all().map((u) => ({ ...u, active: Boolean(u.active) }));
  res.json({ users });
}));

userRouter.post('/users', wrap(async (req, res) => {
  const name = v.str(req.body.name, { label: 'Name', max: 200 });
  const email = v.email(req.body.email, { label: 'Email' });
  const role = v.oneOf(req.body.role, ['admin', 'member'], { label: 'Role', fallback: 'member' });
  const existing = req.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) throw new ApiError(409, 'A user with this email already exists.');
  const password = generatePassword();
  const id = createUser(req.db, { email, name, password, role });
  res.status(201).json({
    user: { id, email, name, role, active: true },
    temp_password: password,
  });
}));

function assertNotLastAdmin(db, userId) {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!target) throw new ApiError(404, 'User not found.');
  if (target.role === 'admin' && target.active) {
    const admins = Number(db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1"
    ).get().n);
    if (admins <= 1) throw new ApiError(400, 'This is the only administrator — add another admin first.');
  }
  return target;
}

userRouter.put('/users/:id', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  const target = req.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new ApiError(404, 'User not found.');

  const name = req.body.name !== undefined ? v.str(req.body.name, { label: 'Name', max: 200 }) : target.name;
  const role = req.body.role !== undefined
    ? v.oneOf(req.body.role, ['admin', 'member'], { label: 'Role' }) : target.role;
  const active = req.body.active !== undefined ? (v.bool(req.body.active, true) ? 1 : 0) : target.active;

  if (id === req.user.id && (role !== 'admin' || !active)) {
    throw new ApiError(400, 'You cannot demote or deactivate your own account.');
  }
  if ((role !== target.role && target.role === 'admin') || (!active && target.active)) {
    assertNotLastAdmin(req.db, id);
  }
  req.db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name, role, active, id);
  if (!active) req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ ok: true });
}));

userRouter.post('/users/:id/reset-password', wrap(async (req, res) => {
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  const target = req.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) throw new ApiError(404, 'User not found.');
  const password = generatePassword();
  req.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ temp_password: password });
}));
