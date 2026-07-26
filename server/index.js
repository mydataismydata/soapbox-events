// Soapbox server entry point: assembles the Express app, serves the admin
// SPA, the JSON API, and the public guest pages, and runs the email queue.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './lib/env.js';
import { core } from './lib/db.js';
import { cookieParser, csrfGuard, requireAuth } from './lib/auth.js';
import { ApiError } from './lib/validate.js';
import { publicPage, esc } from './lib/html.js';
import { startQueue } from './lib/queue.js';

import { authRouter } from './routes/authRoutes.js';
import { contactRouter } from './routes/contactRoutes.js';
import { groupRouter } from './routes/groupRoutes.js';
import { templateRouter } from './routes/templateRoutes.js';
import { eventRouter } from './routes/eventRoutes.js';
import { broadcastRouter } from './routes/broadcastRoutes.js';
import { venueRouter } from './routes/venueRoutes.js';
import { flyerRouter } from './routes/flyerRoutes.js';
import { uploadRouter } from './routes/uploadRoutes.js';
import { emailLogRouter } from './routes/emailLogRoutes.js';
import { reportRouter } from './routes/reportRoutes.js';
import { userRouter } from './routes/userRoutes.js';
import { settingsRouter } from './routes/settingsRoutes.js';
import { publicRouter } from './routes/publicRoutes.js';

core(); // open the org registry (creates data/core.db on first run)

export const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '9mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser);

app.get('/api/health', (_req, res) => res.json({ ok: true, version: config.version, build: config.build }));

// --- authenticated JSON API ------------------------------------------------

const api = express.Router();
api.use(csrfGuard);
api.use(authRouter);
api.use(requireAuth);
api.use(contactRouter);
api.use(groupRouter);
api.use(templateRouter);
api.use(eventRouter);
api.use(broadcastRouter);
api.use(venueRouter);
api.use(flyerRouter);
api.use(uploadRouter);
api.use(emailLogRouter);
api.use(reportRouter);
api.use(settingsRouter);
api.use(userRouter);
app.use('/api', api);

// --- public guest pages ----------------------------------------------------

app.use('/o/:orgSlug', publicRouter);

// --- admin SPA -------------------------------------------------------------

const appDir = path.join(config.root, 'server', 'public', 'app');
app.use('/app', express.static(appDir, { index: false, maxAge: '1h' }));
app.get(['/app', '/app/*'], (_req, res) => {
  const index = path.join(appDir, 'index.html');
  if (!fs.existsSync(index)) {
    return res.status(503).send(publicPage({
      title: config.appName,
      bodyHtml: `<div class="pub-card"><h2>${esc(config.appName)}</h2>
        <p class="pub-muted">The admin app has not been built yet. Run <code>npm run build</code> and reload.</p></div>`,
    }));
  }
  res.sendFile(index);
});
app.get('/', (_req, res) => res.redirect('/app/'));

// --- errors ----------------------------------------------------------------

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send(publicPage({
    title: 'Not found',
    bodyHtml: `<div class="pub-card"><h2>Page not found</h2>
      <p class="pub-muted">There's nothing at this address.</p></div>`,
  }));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  const status = err instanceof ApiError ? err.status : 500;
  if (status >= 500) console.error('Unhandled error:', err);
  const message = err instanceof ApiError ? err.message : 'Something went wrong on the server.';
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).send(publicPage({
    title: 'Error',
    bodyHtml: `<div class="pub-card"><h2>Something went wrong</h2><p class="pub-muted">${esc(message)}</p></div>`,
  }));
});

app.listen(config.port, () => {
  console.log(`${config.appName} listening on ${config.baseUrl} (port ${config.port})`);
  console.log(`data directory: ${config.dataDir}`);
  console.log(config.smtp2goApiKey
    ? 'email: SMTP2GO configured via environment'
    : 'email: SIMULATION mode (no SMTP2GO_API_KEY set — emails are logged, not delivered)');
});

startQueue();
