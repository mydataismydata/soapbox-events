import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { api, onUnauthorized } from './api.js';
import { ToastProvider, ThemeProvider, ThemeToggle, Spinner } from './ui.jsx';
import Icon from './icons.jsx';
import Logo from './components/Logo.jsx';
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
import Settings from './pages/Settings.jsx';

const AuthContext = createContext(null);
export function useAuth() {
  return useContext(AuthContext);
}

// Grouped like the reference layouts: what you send, who you send it to, and
// the reusable pieces. `group` starts a new labelled section in the rail.
const NAV = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/events', label: 'Events', icon: 'ticket' },
  { to: '/broadcasts', label: 'Broadcasts', icon: 'megaphone' },
  { group: 'Audience' },
  { to: '/contacts', label: 'Contacts', icon: 'user' },
  { to: '/groups', label: 'Groups', icon: 'users' },
  { group: 'Library' },
  { to: '/venues', label: 'Venues', icon: 'pin' },
  { to: '/templates', label: 'Templates', icon: 'file' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

const COLLAPSE_KEY = 'soapbox.sidebar.collapsed';

// The topbar label follows the route: deepest matching nav entry wins, so
// /events/12/edit still reads "Events".
function sectionLabel(pathname) {
  const items = NAV.filter((n) => n.to);
  const match = items
    .filter((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match?.label || 'Soapbox';
}

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}

function Layout({ children }) {
  const { user, org, app, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Picking a destination closes the mobile drawer.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function toggleRail() {
    // Under 900px the rail is an off-canvas drawer; above it, a width toggle.
    if (window.matchMedia('(max-width: 900px)').matches) {
      setDrawerOpen((v) => !v);
      return;
    }
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${drawerOpen ? 'is-open' : ''}`}>
      <aside className="sidebar">
        <div className="side-head">
          {/* Both variants render; the stylesheet picks one, so the drawer
              breakpoint keeps control of what a narrow screen shows. */}
          <Logo className="side-logo side-logo-full" variant="full" />
          <Logo className="side-logo side-logo-mark" variant="mark" />
          <div className="side-org" title={org.name}>{org.name}</div>
        </div>

        <nav className="side-nav" aria-label="Main">
          {NAV.map((item) => (item.group ? (
            <div className="side-group" key={`g-${item.group}`}>{item.group}</div>
          ) : (
            <NavLink key={item.to} to={item.to} end={item.end} title={item.label}>
              <span className="nav-ico"><Icon name={item.icon} size={17} /></span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          )))}
        </nav>

        <div className="side-foot">
          <div className="side-avatar" aria-hidden="true">{initials(user.name)}</div>
          <div className="side-who">
            <div className="who-name" title={user.name}>{user.name}</div>
            <div className="who-meta" title={user.email}>{user.email}</div>
          </div>
          <button className="side-btn" onClick={logout} title="Sign out" aria-label="Sign out">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>

      {drawerOpen ? (
        <button className="scrim" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />
      ) : null}

      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn"
            onClick={toggleRail}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="panelLeft" size={17} />
          </button>
          <span className="topbar-title">{sectionLabel(location.pathname)}</span>
          <div className="topbar-actions">
            {app?.build ? (
              <span className="build-chip" title={`Version ${app.version}`}>
                v{app.version} · build {app.build}
              </span>
            ) : null}
            <ThemeToggle />
          </div>
        </header>
        {children}
      </main>
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
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ToastProvider>
      </ThemeProvider>
    </AuthContext.Provider>
  );
}
