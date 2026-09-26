import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api, onUnauthorized } from './api.js';
import { ToastProvider, ThemeProvider, ThemeToggle, Spinner } from './ui.jsx';
import Icon from './icons.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import EventsList from './pages/EventsList.jsx';
import EventDetail from './pages/EventDetail.jsx';
import EventWizard from './pages/EventWizard.jsx';
import BroadcastsList from './pages/BroadcastsList.jsx';
import BroadcastDetail from './pages/BroadcastDetail.jsx';
import BroadcastWizard from './pages/BroadcastWizard.jsx';
import Contacts from './pages/Contacts.jsx';
import Groups from './pages/Groups.jsx';
import Venues from './pages/Venues.jsx';
import Templates from './pages/Templates.jsx';
import Emails from './pages/Emails.jsx';
import Settings from './pages/Settings.jsx';

const AuthContext = createContext(null);
export function useAuth() {
  return useContext(AuthContext);
}

// The tab row carries what you send and who you send it to; the reusable
// pieces and settings live in the account menu so the row stays short.
const PRIMARY = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/events', label: 'Events' },
  { to: '/broadcasts', label: 'Broadcasts' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/groups', label: 'Groups' },
];
const MENU = [
  { to: '/venues', label: 'Venues', icon: 'pin' },
  { to: '/templates', label: 'Templates', icon: 'file' },
  { to: '/emails', label: 'Email log', icon: 'inbox' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}

// Avatar + name button that opens the secondary navigation and sign-out. It
// closes on a click outside, on Escape, and whenever the route changes.
function AccountMenu({ user, logout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="acct" ref={ref}>
      <button
        className="acct-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="acct-avatar" aria-hidden="true">{initials(user.name)}</span>
        <span className="acct-name">{user.name}</span>
        <Icon className="acct-caret" name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className="acct-menu" role="menu">
          <div className="acct-head">
            <div className="who-name" title={user.name}>{user.name}</div>
            <div className="who-meta" title={user.email}>{user.email}</div>
          </div>
          {MENU.map((m) => (
            <NavLink key={m.to} to={m.to} role="menuitem"
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="acct-ico"><Icon name={m.icon} size={16} /></span>
              {m.label}
            </NavLink>
          ))}
          <div className="acct-sep" />
          <button role="menuitem" onClick={logout}>
            <span className="acct-ico"><Icon name="logout" size={16} /></span>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Layout({ children }) {
  const { user, org, app, logout } = useAuth();
  return (
    <div className="shell">
      <header className="appbar">
        <div className="appbar-top">
          <span className="brandmark">Soapbox</span>
          <span className="appbar-sep" aria-hidden="true">/</span>
          <span className="appbar-org" title={org.name}>{org.name}</span>
          <div className="appbar-right">
            {app?.build ? (
              <span className="build-chip" title={`Version ${app.version}`}>
                v{app.version} · build {app.build}
              </span>
            ) : null}
            <ThemeToggle />
            <AccountMenu user={user} logout={logout} />
          </div>
        </div>
        <div className="appbar-tabs-row">
          <nav className="appbar-tabs" aria-label="Main">
            {PRIMARY.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `appbar-tab ${isActive ? 'active' : ''}`}>
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState({ loading: true, user: null, org: null, app: null });

  async function refresh() {
    try {
      const me = await api.get('/api/auth/me');
      setState({ loading: false, user: me.user, org: me.org, app: me.app });
    } catch {
      setState({ loading: false, user: null, org: null, app: null });
    }
  }

  useEffect(() => {
    onUnauthorized(() => setState((s) => (s.user ? { ...s, user: null, org: null } : s)));
    refresh();
  }, []);

  if (state.loading) {
    return (
      <ThemeProvider>
        <div style={{ paddingTop: '30vh' }}><Spinner /></div>
      </ThemeProvider>
    );
  }

  if (!state.user) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <Login onLogin={(me) => setState({ loading: false, user: me.user, org: me.org, app: me.app || null })} />
        </ToastProvider>
      </ThemeProvider>
    );
  }

  const auth = {
    user: state.user,
    org: state.org,
    app: state.app,
    refresh,
    logout: async () => {
      try { await api.post('/api/auth/logout'); } catch { /* session may already be gone */ }
      setState({ loading: false, user: null, org: null, app: null });
    },
  };

  return (
    <AuthContext.Provider value={auth}>
      <ThemeProvider>
        <ToastProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/events" element={<EventsList />} />
              <Route path="/events/new" element={<EventWizard />} />
              <Route path="/events/:id" element={<EventDetail />} />
              <Route path="/events/:id/edit" element={<EventWizard />} />
              <Route path="/broadcasts" element={<BroadcastsList />} />
              <Route path="/broadcasts/new" element={<BroadcastWizard />} />
              <Route path="/broadcasts/:id" element={<BroadcastDetail />} />
              <Route path="/broadcasts/:id/edit" element={<BroadcastWizard />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/venues" element={<Venues />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/emails" element={<Emails />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ToastProvider>
      </ThemeProvider>
    </AuthContext.Provider>
  );
}
