// Database access. Uses the built-in node:sqlite driver (Node 22.13+), so
// there are no native dependencies to compile.
//
// Isolation model: one SQLite file per organization. Request handlers only
// ever receive the single org database attached to the authenticated session
// (req.db), so cross-organization reads are impossible by construction.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';
import { CORE_MIGRATIONS, ORG_MIGRATIONS } from './schema.js';

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error(
    'This application requires the built-in node:sqlite module.\n' +
    'Please run it with Node.js 22.13 or newer (Node 24 LTS recommended).'
  );
  process.exit(1);
}

export const RESERVED_SLUGS = new Set([
  'app', 'api', 'o', 'e', 'i', 'u', 'files', 'admin', 'assets', 'static',
  'login', 'logout', 'data', 'public', 'www', 'mail', 'health',
]);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function migrate(db, migrations) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  for (let i = version; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

let coreDb = null;
const orgCache = new Map(); // slug -> DatabaseSync

export function core() {
  if (!coreDb) {
    coreDb = openDb(path.join(config.dataDir, 'core.db'));
    migrate(coreDb, CORE_MIGRATIONS);
  }
  return coreDb;
}

export function orgDir(slug) {
  return path.join(config.orgsDir, slug);
}

export function uploadsDir(slug) {
  return path.join(orgDir(slug), 'uploads');
}

export function getOrg(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  return core().prepare('SELECT * FROM organizations WHERE slug = ? AND active = 1').get(slug) || null;
}

export function listOrgs() {
  return core().prepare('SELECT * FROM organizations WHERE active = 1 ORDER BY slug').all();
}

export function orgDb(slug) {
  const org = getOrg(slug);
  if (!org) return null;
  if (!orgCache.has(slug)) {
    const db = openDb(path.join(orgDir(slug), 'org.db'));
    migrate(db, ORG_MIGRATIONS);
    orgCache.set(slug, db);
  }
  return orgCache.get(slug);
}

export function createOrg({ slug, name }) {
  if (!SLUG_RE.test(slug)) {
    throw new Error('Slug must be 1-30 lowercase letters, digits or hyphens (no leading/trailing hyphen).');
  }
  if (RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is a reserved name; pick another slug.`);
  const existing = core().prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
  if (existing) throw new Error(`An organization with slug "${slug}" already exists.`);
  core().prepare('INSERT INTO organizations (slug, name) VALUES (?, ?)').run(slug, name);
  fs.mkdirSync(uploadsDir(slug), { recursive: true });
  return { org: getOrg(slug), db: orgDb(slug) };
}

export function withTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// node:sqlite may report rowids as BigInt; normalize for JSON friendliness.
export function insertId(runInfo) {
  return Number(runInfo.lastInsertRowid);
}

export function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? (row.value ?? '') : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value == null ? '' : String(value));
}

// The organization's icon for the admin header, or '' when none is set. It is
// a path on this server rather than a full URL, because the admin app is
// always served from here, whatever BASE_URL says.
export function appIconPath(db, orgSlug) {
  const token = getSetting(db, 'app_icon_token', '');
  return token ? `/o/${orgSlug}/files/${token}` : '';
}
