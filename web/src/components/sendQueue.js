// Who an event's next send would reach, and how to describe them.
//
// "Send invitations" is honest for the first push and misleading afterwards —
// on an event that has already gone out it reads like a second copy to the
// whole list, when what actually happens is that only people added since get
// emailed. So the button names its audience instead, and these helpers work
// out which audience that is.
//
// Kept out of the component so the wording can be checked directly.

// Mirrors the filter in POST /events/:id/send, so the number on the button is
// the number of emails that get queued.
export function sendQueue(guests) {
  const pending = guests.filter((g) => !g.response && ['not_sent', 'failed'].includes(g.email_status));
  const reachable = pending.filter((g) => g.email && !g.unsubscribed);
  return {
    sendable: reachable.length,
    added: reachable.filter((g) => g.email_status === 'not_sent').length,
    retry: reachable.filter((g) => g.email_status === 'failed').length,
    noEmail: pending.filter((g) => !g.email).length,
    unsubscribed: pending.filter((g) => g.email && g.unsubscribed).length,
    // Nothing has left the outbox yet, so this is the first push rather than a
    // top-up — plain "Send invitations" reads correctly there.
    firstPush: guests.every((g) => g.email_status === 'not_sent'),
  };
}

export function sendLabel(q) {
  const guests = (n) => `${n} new guest${n === 1 ? '' : 's'}`;
  if (q.firstPush) return `Send invitations (${q.sendable})`;
  if (q.sendable === 0) return 'Send invitations to new guests';
  if (q.retry === 0) return `Send invitation${q.added === 1 ? '' : 's'} to ${guests(q.added)}`;
  if (q.added === 0) return `Retry ${q.retry} failed invitation${q.retry === 1 ? '' : 's'}`;
  return `Send ${q.sendable} pending invitation${q.sendable === 1 ? '' : 's'}`;
}

export function sendSummary(q) {
  const parts = [];
  if (q.added) {
    parts.push(q.firstPush
      ? `${q.added} guest${q.added === 1 ? '' : 's'} will be emailed the invitation.`
      : `${q.added} guest${q.added === 1 ? ' has' : 's have'} been added since the last send, and will be emailed now.`);
  }
  if (q.retry) parts.push(`${q.retry} invitation${q.retry === 1 ? '' : 's'} that failed will be retried.`);
  const skipped = [];
  if (q.noEmail) skipped.push(`${q.noEmail} with no email address`);
  if (q.unsubscribed) skipped.push(`${q.unsubscribed} unsubscribed`);
  if (skipped.length) parts.push(`Skipping ${skipped.join(' and ')}.`);
  if (!q.firstPush) parts.push('Nobody who has already been emailed gets a second copy.');
  return parts.join(' ');
}
