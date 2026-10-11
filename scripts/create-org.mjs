#!/usr/bin/env node
// Create a new organization with its own database and first administrator.
// Organizations are created from the command line on purpose: it keeps
// tenant creation in the hands of whoever operates the server.
//
//   node scripts/create-org.mjs --slug sjc --name "St. James Community" \
//     --admin-email you@example.org --admin-name "Your Name" [--password ...]
import { parseArgs } from 'node:util';
import { config } from '../server/lib/env.js';
import { createOrgWithAdmin } from '../server/lib/orgSetup.js';
import { isValidEmail } from '../server/lib/validate.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    'admin-email': { type: 'string' },
    'admin-name': { type: 'string' },
    password: { type: 'string' },
  },
});

function fail(msg) {
  console.error(`Error: ${msg}`);
  console.error('\nUsage: node scripts/create-org.mjs --slug <slug> --name "<Org Name>" --admin-email <email> --admin-name "<Name>" [--password <password>]');
  process.exit(1);
}

const slug = (values.slug || '').toLowerCase().trim();
const name = (values.name || '').trim();
const adminEmail = (values['admin-email'] || '').toLowerCase().trim();
const adminName = (values['admin-name'] || '').trim();

if (!slug) fail('--slug is required (short lowercase identifier, e.g. "sjc")');
if (!name) fail('--name is required (the organization\'s display name)');
if (!isValidEmail(adminEmail)) fail('--admin-email must be a valid email address');
if (!adminName) fail('--admin-name is required');
if (values.password && values.password.length < 10) fail('--password must be at least 10 characters');

try {
  const { org, password } = createOrgWithAdmin({
    slug, name, adminEmail, adminName, password: values.password,
  });
  console.log('');
  console.log(`Organization created: ${org.name} (${org.slug})`);
  console.log(`  Sign-in URL:   ${config.baseUrl}/app/  (sign in with email + password)`);
  console.log(`  Email:         ${adminEmail}`);
  console.log(`  Password:      ${values.password ? '(as provided)' : password}`);
  console.log(`  Public pages:  ${config.baseUrl}/${org.slug}/…  (the slug appears only in event URLs)`);
  if (!values.password) {
    console.log('');
    console.log('Store this password now — it is not shown again. It can be changed after signing in.');
  }
} catch (err) {
  fail(err.message);
}
