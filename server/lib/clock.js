// The meeting's clock. Event dates and times are stored as wall-clock
// strings, so "now" is read in the zone the meetings are in (TIMEZONE),
// never the server's own.
import { config } from './env.js';

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// { date: 'YYYY-MM-DD', time: 'HH:MM' } where the meetings are.
export function localNow(at = new Date()) {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function localToday() {
  return localNow().date;
}

// Wall-clock arithmetic on a date and time, with no zone involved.
function shift(date, time, { days = 0, hours = 0 }) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, hh + hours, mm));
  return dt.toISOString().slice(0, 16).replace('T', ' ');
}

// When the meeting ends, as 'YYYY-MM-DD HH:MM', or '' when it has no date.
// With no end time it runs two hours, the length the calendar file gives
// it. With no time at all it runs to the end of its day. An end time before
// the start time is after midnight.
export function meetingEnd(event) {
  const date = String(event.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const start = /^\d{2}:\d{2}$/.test(event.start_time || '') ? event.start_time : '';
  const end = /^\d{2}:\d{2}$/.test(event.end_time || '') ? event.end_time : '';
  if (end) return shift(date, end, { days: start && end <= start ? 1 : 0 });
  if (start) return shift(date, start, { hours: 2 });
  return shift(date, '00:00', { days: 1 });
}

// Whether the meeting is over. A meeting that is over takes no replies.
export function meetingOver(event, at = new Date()) {
  const end = meetingEnd(event);
  if (!end) return false;
  const now = localNow(at);
  return `${now.date} ${now.time}` >= end;
}
