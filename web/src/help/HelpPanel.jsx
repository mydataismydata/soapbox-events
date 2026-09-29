// The Help panel: a sheet down the right-hand side explaining the page under
// it, with small moving pictures of the screen. It loads on first use, so the
// pictures cost nothing until someone asks for help.
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import Icon from '../icons.jsx';
import { helpFor, sectionsFor } from './content.js';
import './help.css';
import './scenes.css';

// Every scene, by its file name, which is the name the help content uses.
const SCENES = Object.fromEntries(
  Object.entries(import.meta.glob('./scenes/*.jsx', { eager: true }))
    .map(([file, mod]) => [file.slice('./scenes/'.length, -'.jsx'.length), mod.default]),
);

export default function HelpPanel({ onClose }) {
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const { pathname } = useLocation();
  const { user } = useAuth();
  const page = helpFor(pathname);
  const sections = sectionsFor(page, user.role);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  // Going to another page closes the panel.
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (pathname !== openedOn.current) onClose();
  }, [pathname, onClose]);

  function jump(i) {
    bodyRef.current?.querySelector(`#help-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <dialog ref={dialogRef} className="helpsheet" aria-labelledby="help-title"
      onClose={onClose}
      // A click on the dimmed page beside the panel closes it.
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}>
      <div className="help-sheet-inner">
        <div className="help-head">
          <div>
            <div className="help-kicker">Help</div>
            <h2 id="help-title">{page?.title || 'Help'}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close help">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="help-body" ref={bodyRef}>
          {!page ? (
            <p className="help-intro">There is no help written for this page yet.</p>
          ) : (
            <>
              <p className="help-intro">{page.intro}</p>
              {sections.length > 3 ? (
                <nav className="help-toc" aria-label="On this page">
                  {sections.map((s, i) => (
                    <button key={s.heading} type="button" onClick={() => jump(i)}>{s.heading}</button>
                  ))}
                </nav>
              ) : null}
              {sections.map((s, i) => {
                const Picture = s.scene ? SCENES[s.scene] : null;
                return (
                  <section key={s.heading} id={`help-${i}`} className="help-section">
                    <h3>{s.heading}</h3>
                    {(s.text || []).map((t) => <p key={t}>{t}</p>)}
                    {s.steps ? <ol>{s.steps.map((t) => <li key={t}>{t}</li>)}</ol> : null}
                    {s.points ? <ul>{s.points.map((t) => <li key={t}>{t}</li>)}</ul> : null}
                    {Picture ? <figure><Picture /></figure> : null}
                  </section>
                );
              })}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
