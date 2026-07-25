// RSVP and email statistics for one event, reported everywhere (event list,
// event detail, dashboard, CSV export).
export function eventStats(db, eventId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS invited,
      SUM(CASE WHEN response = 'yes' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN response = 'yes' THEN party_size ELSE 0 END) AS guests_attending,
      SUM(CASE WHEN response = 'no' THEN 1 ELSE 0 END) AS declined,
      SUM(CASE WHEN response IS NULL AND email_status = 'sent' THEN 1 ELSE 0 END) AS awaiting,
      SUM(CASE WHEN response IS NULL AND email_status IN ('not_sent', 'failed') THEN 1 ELSE 0 END) AS not_reached,
      SUM(CASE WHEN email_status = 'sent' THEN 1 ELSE 0 END) AS emails_sent,
      SUM(CASE WHEN email_status = 'queued' THEN 1 ELSE 0 END) AS emails_queued,
      SUM(CASE WHEN email_status = 'failed' THEN 1 ELSE 0 END) AS emails_failed
    FROM invites WHERE event_id = ?
  `).get(eventId);
  const stats = {};
  for (const [k, val] of Object.entries(row)) stats[k] = Number(val || 0);
  // Every email ever sent for the event — invitations, nudges, follow-ups,
  // cancellations and tests — which is what the email log tab lists.
  stats.emails_logged = Number(
    db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE event_id = ?').get(eventId).n || 0
  );
  return stats;
}

// Delivery stats for one broadcast, drawn from its email_log rows (broadcasts
// have no per-recipient table — the log is the record).
export function broadcastStats(db, broadcastId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS recipients,
      SUM(CASE WHEN status IN ('sent', 'simulated') THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status IN ('queued', 'sending') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM email_log WHERE broadcast_id = ? AND kind = 'broadcast'
  `).get(broadcastId);
  const stats = {};
  for (const [k, val] of Object.entries(row)) stats[k] = Number(val || 0);
  return stats;
}

export function monthEmailCount(db) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM email_log
    WHERE status IN ('sent', 'simulated')
      AND sent_at >= strftime('%Y-%m-01 00:00:00', 'now')
  `).get();
  return Number(row.n || 0);
}
