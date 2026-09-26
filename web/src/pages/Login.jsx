import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, ThemeToggle } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [build, setBuild] = useState(null);

  // Unauthenticated build check, so the running build can be confirmed from
  // the login screen right after a deploy.
  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setBuild).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const me = await api.post('/api/auth/login', { email, password });
      onLogin(me);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <ThemeToggle className="login-theme" />

      <div className="login-aside">
        <div className="login-brandmark">Soapbox</div>
        <div className="login-form-wrap">
          <form className="login-form" onSubmit={submit}>
            <h1 className="login-title">Sign in</h1>
            <p className="login-sub">Admin console</p>
            <Field label="Email" htmlFor="login-email">
              <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="username" autoFocus required
                aria-invalid={error ? 'true' : undefined} />
            </Field>
            <Field label="Password" htmlFor="login-password">
              <input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" required
                aria-invalid={error ? 'true' : undefined} />
            </Field>
            {error ? <div className="error-text" role="alert">{error}</div> : null}
            <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 14 }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {build?.build ? (
              <p className="login-build">v{build.version} · build {build.build}</p>
            ) : null}
          </form>
        </div>
        <div className="login-foot">Soapbox · self-hosted event invitations and bulk mailer</div>
      </div>

      <div className="login-hero">
        <div className="login-hero-inner">
          <h2>Events, invitations and email for your whole list — in one place.</h2>
          <p>Run your events and your mailing list from the same roster. No per-guest fees, no third-party invite service.</p>
          <ul className="login-feats">
            <li><span className="arrow" aria-hidden="true">→</span><span>Invite by group, add people inline, and send only to those not yet invited.</span></li>
            <li><span className="arrow" aria-hidden="true">→</span><span>Publish a web version of any broadcast, or keep it email-only.</span></li>
            <li><span className="arrow" aria-hidden="true">→</span><span>Every send is logged — delivered, bounced, opened.</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
