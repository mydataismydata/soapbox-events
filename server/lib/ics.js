// iCalendar (.ics) files and Google Calendar links, so guests can add events
// to their calendars from the landing page and confirmation screens.
// Times are emitted as "floating" local times, matching how events are
// entered (wall-clock at the venue).
import { config } from './env.js';
import { formatWhen } from './format.js';

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function compact(date, time) {
  return date.replaceAll('-', '') + (time ? 'T' + time.replace(':', '') + '00' : '');
}

function addHours(date, time, hours) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm));
  dt.setUTCHours(dt.getUTCHours() + hours);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
  };
}

function eventTimes(event) {
  if (!event.date) return null;
  if (!event.start_time) {
    // All-day event.
    return { allDay: true, start: event.date.replaceAll('-', ''), end: null };
  }
  let endDate = event.date;
  let endTime = event.end_time;
  if (!endTime) {
    const end = addHours(event.date, event.start_time, 2);
    endDate = end.date;
    endTime = end.time;
  }
  return { allDay: false, start: compact(event.date, event.start_time), end: compact(endDate, endTime) };
}

// `uidKey` is the local part of the calendar UID — the stable identity of the
// event in a guest's calendar. It is namespaced with the installation's own
// hostname, per RFC 5545, so re-adding an event updates the existing entry
// rather than creating a second one.
export function buildIcs({ event, orgName, url, uidKey }) {
  const times = eventTimes(event);
  if (!times) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const location = [event.venue_name, event.venue_address].filter(Boolean).join(', ');
  const description = [event.description, url ? `Event page: ${url}` : '']
    .filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${icsEscape(config.appName)}//events//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uidKey}@${config.host}`,
    `DTSTAMP:${stamp}`,
    times.allDay ? `DTSTART;VALUE=DATE:${times.start}` : `DTSTART:${times.start}`,
    times.allDay ? '' : `DTEND:${times.end}`,
    `SUMMARY:${icsEscape(event.title)}`,
    location ? `LOCATION:${icsEscape(location)}` : '',
    description ? `DESCRIPTION:${icsEscape(description)}` : '',
    url ? `URL:${icsEscape(url)}` : '',
    orgName ? `ORGANIZER;CN=${icsEscape(orgName)}:MAILTO:noreply@invalid` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}

export function googleCalendarUrl({ event, url }) {
  const times = eventTimes(event);
  if (!times) return null;
  const dates = times.allDay
    ? `${times.start}/${times.start}`
    : `${times.start}/${times.end}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'Event',
    dates,
    details: [event.description, url ? `Event page: ${url}` : '', formatWhen(event)]
      .filter(Boolean).join('\n\n'),
    location: [event.venue_name, event.venue_address].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
