// Downloads the interchange document the WordPress plugin imports.
//
// The flyer is rendered to a JPEG here, in the browser, for the same reason
// the invitation's flyer picture is: there is no headless browser on the
// server. A flyer that won't render is not a reason to fail — the document is
// still worth having, so a failed capture just means no picture.
import { api } from '../api.js';
import { flyerToJpeg } from './flyerSnapshot.js';

async function renderFlyerJpeg(event) {
  const res = await fetch('/api/flyer/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'sjc-vite' },
    credentials: 'same-origin',
    body: JSON.stringify({
      event: {
        title: event.title, host_name: event.host_name, venue_name: event.venue_name,
        venue_address: event.venue_address, date: event.date, start_time: event.start_time,
        end_time: event.end_time, rsvp_mode: event.rsvp_mode,
      },
      flyer: event.flyer,
      mode: 'event',
      snapshot: true,
    }),
  });
  if (!res.ok) throw new Error('The flyer could not be rendered.');
  return flyerToJpeg(await res.text());
}

function saveJson(doc, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the blob goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function exportEventForWordPress(event) {
  let flyerImage = '';
  try {
    flyerImage = await renderFlyerJpeg(event);
  } catch {
    flyerImage = ''; // fall back to the stored picture, or none at all
  }
  const doc = await api.post(`/api/events/${event.id}/export/wordpress`, { flyer_image: flyerImage });
  const stamp = new Date().toISOString().slice(0, 10);
  saveJson(doc, `soapbox-${event.slug}-${stamp}.json`);
  return doc;
}
