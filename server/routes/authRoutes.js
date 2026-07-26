import { Router } from 'express';
import { config } from '../lib/env.js';
import { orgDb, listOrgs } from '../lib/db.js';
import { verifyPassword, hashPassword, createSession, destroySession, resolveSession } from '../lib/auth.js';
import { take } from '../lib/ratelimit.js';
import { wrap, v, ApiError } from '../lib/validate.js';

export const authRouter = Router();

// A throwaway hash so a wrong email costs the same wall-clock time as a wrong
// password — otherwise "email exists somewhere" would be detectable by timing.
const DUMMY_HASH = hashPassword('soapbox-placeholder-not-a-real-password');

authRouter.post('/auth/login', wrap(async (req, res) => {
  const email = v.email(req.body.email, { label: 'Email' });
  const password = v.str(req.body.password, { label: 'Password', max: 200 });

  if (!take(`login:ip:${req.ip}`, 30, 15 * 60 * 1000)) {
    throw new ApiError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
  }
  if (!take(`login:acct:${email}`, 8, 15 * 60 * 1000)) {
    throw new ApiError(429, 'Too many sign-in attempts for this account. Please wait a few minutes.');
  }

  // Databases are one-per-organization, so we discover which org owns this
  // email by checking each org's own user table and binding the session to
  // whichever one the password verifies against. The password is the
  // disambiguator if the same address somehow exists in more than one org.
  // The databases stay fully isolated — this only routes the login to the
  // right one. (Fine for the intended handful of organizations; if this ever
  // grew to hundreds, add an email->org index in core.db.)
  let matched = null;
  for (const org of listOrgs()) {
    const db = orgDb(org.slug);
    if (!db) continue;
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (user && verifyPassword(password, user.password_hash)) {
      matched = { org, db, user };
      break;
    }
  }

  if (!matched) {
    verifyPassword(password, DUMMY_HASH); // equalize timing vs. a real miss
    throw new ApiError(401, 'Invalid email or password.');
  }

  const { org, db, user } = matched;
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  createSession(db, org.slug, user.id, req, res);
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    org: { slug: org.slug, name: org.name },
  });
}));

authRouter.post('/auth/logout', wrap(async (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
}));

authRouter.get('/auth/me', wrap(async (req, res) => {
  const resolved = resolveSession(req);
  if (!resolved) throw new ApiError(401, 'Not signed in');
  res.json({
    user: {
      id: resolved.user.id,
      name: resolved.user.name,
      email: resolved.user.email,
      role: resolved.user.role,
    },
    org: { slug: resolved.org.slug, name: resolved.org.name },
    app: { name: config.appName, base_url: config.baseUrl, version: config.version, build: config.build },
  });
}));
