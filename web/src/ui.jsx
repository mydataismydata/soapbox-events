// Shared UI primitives: theming, modal, toasts, badges, cards, stats, option
// cards, empty states, confirm dialog. Presentation only — nothing here knows
// anything about events, guests or email.
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import Icon from './icons.jsx';

// --- theme -----------------------------------------------------------------

const ThemeContext = createContext({ theme: 'system', resolved: 'light', setTheme: () => {} });
const THEME_KEY = 'soapbox.theme';

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  // 'light' | 'dark' | 'system'. Stored per browser, never on the server.
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
  });
  const [systemIsDark, setSystemIsDark] = useState(() => systemTheme() === 'dark');

  // Follow the OS while the preference is 'system'.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (e) => setSystemIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Light ⇄ dark switch. Whatever the current preference resolves to, one click
// pins the opposite — so it always does the obvious thing.
export function ThemeToggle({ className = '' }) {
  const { resolved, setTheme } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={`icon-btn ${className}`.trim()}
      onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

// --- toasts ----------------------------------------------------------------

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((message, kind = 'ok') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'bad' ? 'bad' : ''}`}>
            <Icon className="toast-ico" name={t.kind === 'bad' ? 'alert' : 'checkCircle'} size={15} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// --- modal -----------------------------------------------------------------

export function Modal({ title, onClose, children, footer, size }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    // Move focus into the dialog so the keyboard lands somewhere sensible.
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={panelRef}
        className={`modal ${size === 'lg' ? 'modal-lg' : ''} ${size === 'xl' ? 'modal-xl' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{message}</p>
    </Modal>
  );
}

// --- layout pieces ---------------------------------------------------------

// A card with an optional header strip: title on the left, actions on the
// right, hairline underneath. `flush` skips the body padding so a table can
// sit edge to edge.
export function Card({ title, sub, actions, flush, children, className = '', ...rest }) {
  return (
    <div className={`card ${className}`.trim()} {...rest}>
      {title || actions ? (
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {sub ? <div className="card-head-sub">{sub}</div> : null}
          </div>
          {actions ? <div className="row" style={{ gap: 8 }}>{actions}</div> : null}
        </div>
      ) : null}
      {flush ? children : <div className="card-pad">{children}</div>}
    </div>
  );
}

// The joined stat strip used on the dashboard and detail pages. Children are
// <Stat> elements; the 1px grid gap draws the dividers.
export function StatGrid({ children, style }) {
  return <div className="stat-grid" style={style}>{children}</div>;
}

export function Stat({ icon, label, value, sub, tone }) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ''}`}>
      {icon ? <div className="stat-ico"><Icon name={icon} size={15} /></div> : null}
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub != null ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

// A selectable option card with a radio mark — used for RSVP mode and the
// flyer templates. Renders as a real radio for keyboard and screen readers.
export function OptionCard({ name, checked, onSelect, title, sub, disabled }) {
  return (
    <label className={`seg-opt ${checked ? 'active' : ''}`}>
      <input
        type="radio"
        className="sr-only"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect?.()}
      />
      <span className="seg-title">{title}</span>
      {sub ? <span className="seg-sub">{sub}</span> : null}
      <span className="seg-mark" aria-hidden="true" />
    </label>
  );
}

// --- small bits ------------------------------------------------------------

export function Spinner() {
  return <div className="spin" role="status" aria-label="Loading" />;
}

export function Badge({ tone = 'gray', dot = false, children }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot ? <i className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function ResponseBadge({ response }) {
  if (response === 'yes') return <Badge tone="green" dot>Accepted</Badge>;
  if (response === 'no') return <Badge tone="red" dot>Declined</Badge>;
  return <Badge tone="gray" dot>No reply</Badge>;
}

export function StatusBadge({ status }) {
  if (status === 'published') return <Badge tone="green" dot>Published</Badge>;
  if (status === 'draft') return <Badge tone="amber" dot>Draft</Badge>;
  if (status === 'cancelled') return <Badge tone="red" dot>Cancelled</Badge>;
  return <Badge dot>{status}</Badge>;
}

export function EmailStatusBadge({ status }) {
  const map = {
    not_sent: ['gray', 'Not sent'],
    queued: ['indigo', 'Queued'],
    sending: ['indigo', 'Sending'],
    sent: ['green', 'Sent'],
    simulated: ['green', 'Simulated'],
    failed: ['red', 'Failed'],
  };
  const [tone, label] = map[status] || ['gray', status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

// Banner with a matching status icon.
export function Banner({ tone = 'info', children, style }) {
  const ico = { warn: 'alert', bad: 'xCircle', ok: 'checkCircle', info: 'info' }[tone] || 'info';
  return (
    <div className={`banner banner-${tone}`} style={style}>
      <Icon className="banner-ico" name={ico} size={15} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Empty({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-ico"><Icon name={icon} size={20} /></div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

// --- sortable tables -------------------------------------------------------

// Sort state shared by every table with clickable headers. Clicking the column
// already sorted flips the direction; a new column starts from `startDir`.
export function useSort(key, dir = 'asc') {
  const [sort, setSort] = useState({ key, dir });
  const sortBy = useCallback((next, startDir = 'asc') => {
    setSort((s) => (s.key === next
      ? { key: next, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: next, dir: startDir }));
  }, []);
  return [sort, sortBy];
}

// Sort rows by `sort`, using an accessor per column key. Empty values always
// sink to the bottom, either way up, so a blank never outranks real data.
export function sortRows(rows, sort, accessors) {
  const get = accessors[sort.key];
  if (!get) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const blank = (x) => x === null || x === undefined || x === '';
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (blank(x) || blank(y)) return blank(x) && blank(y) ? 0 : (blank(x) ? 1 : -1);
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

// A clickable table header. `k` is the key looked up in the accessor map.
export function SortTh({ label, k, sort, onSort, startDir = 'asc', style }) {
  const active = sort.key === k;
  return (
    <th style={style} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort ${active ? 'is-active' : ''}`} onClick={() => onSort(k, startDir)}>
        {label}
        <Icon className="th-arrow" size={13}
          name={active ? (sort.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'chevronUpDown'} />
      </button>
    </th>
  );
}

export function Field({ label, hint, required, htmlFor, children }) {
  return (
    <div className="field">
      {label ? (
        <label htmlFor={htmlFor}>
          {label}
          {required ? <span className="req" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

// Square icon-only button — table row actions and toolbars. `label` is
// required: it is both the tooltip and the accessible name.
export function IconButton({ icon, label, onClick, disabled, tone, size = 'sm', ...rest }) {
  const cls = ['btn', 'btn-icon', size === 'sm' ? 'btn-sm' : '', tone ? `btn-${tone}` : '']
    .filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} title={label} aria-label={label}
      onClick={onClick} disabled={disabled} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 15 : 16} />
    </button>
  );
}

export function CopyBox({ value }) {
  const toast = useToast();
  return (
    <div className="copy-box">
      <span className="url" title={value}>{value}</span>
      <button
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast('Copied to clipboard');
          } catch {
            toast('Could not copy — select the text manually', 'bad');
          }
        }}
      >
        <Icon name="copy" size={13} /> Copy
      </button>
    </div>
  );
}

// Insert text at the caret of a textarea/input controlled by React.
export function insertAtCursor(ref, current, snippet, onChange) {
  const el = ref.current;
  if (!el) { onChange(current + snippet); return; }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + snippet + current.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + snippet.length;
    el.setSelectionRange(pos, pos);
  });
}

export { Icon };
