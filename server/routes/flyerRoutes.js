import { Router } from 'express';
import { wrap } from '../lib/validate.js';
import { flyerPresets, renderFlyerDocument } from '../lib/flyer.js';
import { flyerImageUrls } from '../lib/sending.js';

export const flyerRouter = Router();

flyerRouter.get('/flyer/presets', wrap(async (_req, res) => {
  res.json(flyerPresets());
}));

// Live preview for the designer: takes the in-progress event fields + flyer
// JSON and returns a standalone HTML document for an iframe.
flyerRouter.post('/flyer/preview', wrap(async (req, res) => {
  const e = req.body.event || {};
  const event = {
    title: String(e.title || '').slice(0, 200),
    host_name: String(e.host_name || '').slice(0, 200),
    venue_name: String(e.venue_name || '').slice(0, 200),
    venue_address: String(e.venue_address || '').slice(0, 400),
    date: String(e.date || '').slice(0, 10),
    start_time: String(e.start_time || '').slice(0, 5),
    end_time: String(e.end_time || '').slice(0, 5),
    timezone_note: String(e.timezone_note || '').slice(0, 60),
    rsvp_mode: e.rsvp_mode === 'rsvp' ? 'rsvp' : (e.rsvp_mode === 'open' ? 'open' : ''),
  };
  const flyer = req.body.flyer || {};
  const imageUrls = flyerImageUrls(req.org.slug, flyer);
  const hideEventMeta = req.body.mode === 'broadcast';
  // The designer asks for `snapshot` when it is about to rasterize the flyer
  // into the JPEG that goes in the invitation email.
  const snapshot = req.body.snapshot === true;
  res.type('html').send(renderFlyerDocument({ event, flyer, imageUrls, hideEventMeta, snapshot }));
}));
