// Monochrome line icons. One stroke weight, currentColor, no fills — so an
// icon always matches the text colour of whatever it sits in and both themes
// work without a second asset. Add new glyphs to PATHS and use <Icon name="…" />.
import React from 'react';

const PATHS = {
  // --- navigation ---------------------------------------------------------
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /></>,
  ticket: <><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v2a2 2 0 0 0 0 3.9v2A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-2a2 2 0 0 0 0-3.9Z" /><path d="M14 7v11" strokeDasharray="2 2.5" /></>,
  megaphone: <><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15 8.5a4.5 4.5 0 0 1 0 7" /><path d="M18 6a8 8 0 0 1 0 12" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.9" /><path d="M17.5 14.2a6.5 6.5 0 0 1 4 5.8" /></>,
  pin: <><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
  file: <><path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8Z" /><path d="M13 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" /></>,

  // --- actions ------------------------------------------------------------
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: <path d="M6 6 18 18M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <><path d="M4 7h16" /><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" /><path d="M6.5 7v12.3A1.7 1.7 0 0 0 8.2 21h7.6a1.7 1.7 0 0 0 1.7-1.7V7" /><path d="M10.5 11v6M13.5 11v6" /></>,
  pencil: <><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M15.5 5.5 18.5 8.5" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 7.4 5.6a2 2 0 0 0 2.2 0L20.5 7" /></>,
  send: <path d="M20.5 3.5 3.8 10.2a.6.6 0 0 0 0 1.1l6.6 2.3 2.3 6.6a.6.6 0 0 0 1.1 0Zm0 0-10 10" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  download: <><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4.5 20h15" /></>,
  upload: <><path d="M12 20V9" /><path d="m7.5 13.5 4.5-4.5 4.5 4.5" /><path d="M4.5 4h15" /></>,
  external: <><path d="M14 4h6v6" /><path d="m20 4-8.5 8.5" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></>,
  link: <><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.4 1.4" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1.4-1.4" /></>,
  clipboard: <><rect x="6" y="4.5" width="12" height="16" rx="2" /><path d="M9.5 4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5v1h-5Z" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 10h17" /><path d="M8 3v4M16 3v4" /></>,
  inbox: <><path d="M3.5 13 6 5.6A2 2 0 0 1 7.9 4.2h8.2A2 2 0 0 1 18 5.6L20.5 13" /><path d="M3.5 13h4.2l1.2 2.6h6.2L16.3 13h4.2v5.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8Z" /></>,
  heart: <path d="M12 20s-7.5-4.7-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 15.3 12 20 12 20Z" />,

  // --- state / feedback ---------------------------------------------------
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8.2v.2" /></>,
  alert: <><path d="M10.6 4.3 2.9 17.5a1.6 1.6 0 0 0 1.4 2.4h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.3a1.6 1.6 0 0 0-2.8 0Z" /><path d="M12 9.5v4M12 16.8v.2" /></>,
  checkCircle: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-4.9" /></>,
  xCircle: <><circle cx="12" cy="12" r="8.5" /><path d="m9.5 9.5 5 5M14.5 9.5l-5 5" /></>,

  // --- chrome -------------------------------------------------------------
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" /></>,
  moon: <path d="M20 14.2A8.5 8.5 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z" />,
  panelLeft: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9.5 4v16" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  arrowLeft: <><path d="M20 12H4" /><path d="m9.5 6.5-5.5 5.5 5.5 5.5" /></>,
  arrowRight: <><path d="M4 12h16" /><path d="m14.5 6.5 5.5 5.5-5.5 5.5" /></>,
  logout: <><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" /><path d="M20 12H9.5" /><path d="m16.5 8.5 3.5 3.5-3.5 3.5" /></>,

  // --- text editor --------------------------------------------------------
  bold: <path d="M7 4.5h6a3.7 3.7 0 0 1 0 7.5H7Zm0 7.5h6.8a3.75 3.75 0 0 1 0 7.5H7Z" />,
  italic: <path d="M15.5 4.5h-5M13.5 19.5h-5M14.5 4.5l-5 15" />,
  underline: <><path d="M7 4.5v6.8a5 5 0 0 0 10 0V4.5" /><path d="M5.5 20.5h13" /></>,
  pasteText: <><rect x="4" y="5.5" width="11" height="14" rx="2" /><path d="M7.5 5.5A1.5 1.5 0 0 1 9 4h1a1.5 1.5 0 0 1 1.5 1.5v.8h-4Z" /><path d="M14 11.5h6M17 11.5v8" /></>,
};

export default function Icon({ name, size = 16, className = '', strokeWidth = 1.6, title }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      className={`ico ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {path}
    </svg>
  );
}
