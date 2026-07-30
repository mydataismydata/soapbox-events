// The email queue. A background loop drains queued email_log rows across all
// organizations, throttled to EMAILS_PER_MINUTE, and records the outcome.
// With no SMTP2GO key configured, messages complete as "simulated".
import { config } from './env.js';
import { listOrgs, orgDb } from './db.js';
import { sendEmail, orgApiKey, senderFor } from './email.js';
import { buildLinks, publicUrl, signContactToken } from './sending.js';

const TICK_MS = 2000;
let timer = null;
let busy = false;

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function processOne(db, org, row) {
  db.prepare("UPDATE email_log SET status = 'sending' WHERE id = ?").run(row.id);

  const headers = [];
  let invite = null;
  if (row.invite_id) {
    invite = db.prepare('SELECT * FROM invites WHERE id = ?').get(row.invite_id);
    const event = row.event_id ? db.prepare('SELECT * FROM events WHERE id = ?').get(row.event_id) : null;
    if (invite && event) {
      const links = buildLinks(org.slug, event, invite);
      headers.push({ header: 'List-Unsubscribe', value: `<${links.unsub}>` });
    }
  } else if (row.broadcast_id && row.kind === 'broadcast') {
    const contact = db.prepare('SELECT id FROM contacts WHERE email = ?').get((row.to_email || '').toLowerCase());
    if (contact) {
      const unsub = publicUrl(org.slug, `/bu/${signContactToken(contact.id)}`);
      headers.push({ header: 'List-Unsubscribe', value: `<${unsub}>` });
    }
  }

  const { sender, replyTo } = senderFor(db, org.name, row.broadcast_id ? 'broadcast' : 'event');
  const result = await sendEmail({
    apiKey: orgApiKey(db),
    sender,
    replyTo,
    toName: row.to_name,
    toEmail: row.to_email,
    subject: row.subject,
    html: row.html,
    text: row.body_text,
    headers,
  });

  if (result.ok) {
    const status = result.simulated ? 'simulated' : 'sent';
    db.prepare("UPDATE email_log SET status = ?, provider_id = ?, sent_at = ?, error = NULL WHERE id = ?")
      .run(status, result.id || null, nowSql(), row.id);
    if (invite && row.kind === 'invitation') {
      db.prepare("UPDATE invites SET email_status = 'sent' WHERE id = ?").run(invite.id);
    }
  } else {
    db.prepare("UPDATE email_log SET status = 'failed', error = ? WHERE id = ?").run(result.error || 'Unknown error', row.id);
    if (invite && row.kind === 'invitation') {
      db.prepare("UPDATE invites SET email_status = 'failed' WHERE id = ?").run(invite.id);
    }
  }
}

async function tick(limit) {
  let remaining = limit;
  for (const org of listOrgs()) {
    if (remaining <= 0) break;
    const db = orgDb(org.slug);
    if (!db) continue;
    const rows = db.prepare(
      "SELECT * FROM email_log WHERE status = 'queued' ORDER BY id LIMIT ?"
    ).all(remaining);
    for (const row of rows) {
      await processOne(db, org, row);
      remaining--;
    }
  }
  return limit - remaining;
}

export function startQueue() {
  if (timer) return;
  const perTick = Math.max(1, Math.round((config.emailsPerMinute * TICK_MS) / 60000));
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick(perTick);
    } catch (err) {
      console.error('email queue error:', err);
    } finally {
      busy = false;
    }
  }, TICK_MS);
  timer.unref?.();
}

export function stopQueue() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Drain everything now — used by scripts and tests.
export async function processAllQueued(maxRounds = 50) {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    const n = await tick(100);
    total += n;
    if (n === 0) break;
  }
  return total;
}
