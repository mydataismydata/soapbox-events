// Central configuration. Loads `.env` (if present), applies defaults, and
// ensures the data directory + session secret exist before anything else runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// package.json is the single source of truth for the version and build number.
// The build number is bumped on every commit and shown in the app so a deploy
// can be confirmed as the latest.
function loadPackage() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); }
  catch { return {}; }
}
const pkg = loadPackage();

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(ROOT, process.env.DATA_DIR || './data');
const nodeEnv = process.env.NODE_ENV || 'development';

fs.mkdirSync(path.join(dataDir, 'orgs'), { recursive: true });

function loadOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret + '\n', { mode: 0o600 });
  return secret;
}

const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

// The bare hostname, used as the namespace for calendar UIDs so two
// installations can't mint colliding identifiers.
function hostOf(url) {
  try { return new URL(url).hostname || 'localhost'; } catch { return 'localhost'; }
}

export const config = {
  root: ROOT,
  port,
  nodeEnv,
  isProd: nodeEnv === 'production',
  version: pkg.version || '0.0.0',
  build: Number(pkg.build || 0),
  baseUrl,
  host: hostOf(baseUrl),
  dataDir,
  orgsDir: path.join(dataDir, 'orgs'),
  sessionSecret: loadOrCreateSecret(),
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS || 14)),
  smtp2goApiKey: process.env.SMTP2GO_API_KEY || '',
  // Only the smoke test changes this, to point sending at a stand-in it can read.
  smtp2goApiBase: process.env.SMTP2GO_API_BASE || 'https://api.smtp2go.com/v3',
  emailsPerMinute: Math.max(1, Number(process.env.EMAILS_PER_MINUTE || 60)),
  // How long a meeting change waits for more changes before the website is
  // sent the batch. Only the smoke test changes this, so it need not wait.
  websitePushSettleMs: Math.max(0, Number(process.env.WEBSITE_PUSH_SETTLE_MS || 10_000)),
  trustProxy: process.env.TRUST_PROXY === '1',
  appName: process.env.APP_NAME || 'Soapbox',
};
