import { Router } from 'express';
import { config } from '../lib/env.js';
import { core, getSetting, setSetting } from '../lib/db.js';
import { wrap, v } from '../lib/validate.js';
import { requireAdmin } from '../lib/auth.js';

export const settingsRouter = Router();

settingsRouter.get('/settings', wrap(async (req, res) => {
  res.json({
    org: { slug: req.org.slug, name: req.org.name },
    settings: {
      sender_name: getSetting(req.db, 'sender_name', ''),
      sender_email: getSetting(req.db, 'sender_email', ''),
      reply_to: getSetting(req.db, 'reply_to', ''),
      broadcast_sender_split: getSetting(req.db, 'broadcast_sender_split', '') === '1',
      broadcast_sender_name: getSetting(req.db, 'broadcast_sender_name', ''),
      broadcast_sender_email: getSetting(req.db, 'broadcast_sender_email', ''),
      broadcast_reply_to: getSetting(req.db, 'broadcast_reply_to', ''),
      smtp2go_key_set: Boolean(getSetting(req.db, 'smtp2go_api_key', '')),
      default_start_time: getSetting(req.db, 'default_start_time', ''),
      default_end_time: getSetting(req.db, 'default_end_time', ''),
    },
    env: {
      smtp2go_key_present: Boolean(config.smtp2goApiKey),
      base_url: config.baseUrl,
      emails_per_minute: config.emailsPerMinute,
    },
  });
}));

settingsRouter.put('/settings', requireAdmin, wrap(async (req, res) => {
  const b = req.body;
  if (b.org_name !== undefined) {
    const name = v.str(b.org_name, { label: 'Organization name', max: 200 });
    core().prepare('UPDATE organizations SET name = ? WHERE slug = ?').run(name, req.org.slug);
  }
  if (b.sender_name !== undefined) {
    setSetting(req.db, 'sender_name', v.optStr(b.sender_name, { label: 'Sender name', max: 200 }));
  }
  if (b.sender_email !== undefined) {
    setSetting(req.db, 'sender_email', v.optEmail(b.sender_email, { label: 'Sender email' }));
  }
  if (b.reply_to !== undefined) {
    setSetting(req.db, 'reply_to', v.optEmail(b.reply_to, { label: 'Reply-to email' }));
  }
  if (b.broadcast_sender_split !== undefined) {
    setSetting(req.db, 'broadcast_sender_split', b.broadcast_sender_split ? '1' : '');
  }
  if (b.broadcast_sender_name !== undefined) {
    setSetting(req.db, 'broadcast_sender_name', v.optStr(b.broadcast_sender_name, { label: 'Broadcast sender name', max: 200 }));
  }
  if (b.broadcast_sender_email !== undefined) {
    setSetting(req.db, 'broadcast_sender_email', v.optEmail(b.broadcast_sender_email, { label: 'Broadcast sender email' }));
  }
  if (b.broadcast_reply_to !== undefined) {
    setSetting(req.db, 'broadcast_reply_to', v.optEmail(b.broadcast_reply_to, { label: 'Broadcast reply-to email' }));
  }
  if (b.smtp2go_api_key !== undefined) {
    const key = v.optStr(b.smtp2go_api_key, { label: 'API key', max: 200 });
    setSetting(req.db, 'smtp2go_api_key', key);
  }
  if (b.default_start_time !== undefined) {
    setSetting(req.db, 'default_start_time', v.time(b.default_start_time, { label: 'Default start time' }));
  }
  if (b.default_end_time !== undefined) {
    setSetting(req.db, 'default_end_time', v.time(b.default_end_time, { label: 'Default end time' }));
  }
  res.json({ ok: true });
}));
