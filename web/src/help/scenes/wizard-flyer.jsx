import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Check, Screen, Select } from '../mock.jsx';
import { Card, Field, Icon } from '../../ui.jsx';
import { OCTOBER, ORG, VENUE } from '../data.js';

const STYLES = [
  ['classic', 'Classic'],
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['retro', 'Retro'],
  ['spotlight', 'Spotlight', true],
  ['panel', 'Panel', true],
];

const start = { tagline: '', typing: false, pics: 0, preview: false };
const steps = [
  { at: 600, point: 'flyer', say: 'You type straight onto the flyer', side: 'right' },
  { at: 2300, tap: 'pencil-tagline', say: 'Click the pencil beside a line', side: 'right', set: { typing: true } },
  ...typing(3100, 'tagline', 'Hear from the candidates', 55),
  { at: 4800, tap: 'accept', say: 'Press Enter or ⏎ to keep it', side: 'right', set: { typing: false } },
  { at: 6300, tap: 'add', say: 'Add a picture of a speaker', side: 'below', set: { pics: 1 } },
  { at: 7800, tap: 'add', say: 'The next one goes beside it', side: 'below', set: { pics: 2 } },
  { at: 9400, tap: 'preview', say: 'Preview hides the editing marks', side: 'above', set: { preview: true } },
  { at: 11500, tap: 'preview', say: null, set: { preview: false } },
];

// A line typed on the flyer: its text, or a faint placeholder while it is
// empty, with its pencil in front of it. While it is being typed in, the ⏎
// button sits at the end of the text instead. Preview drops the placeholders
// and the buttons. The buttons hang outside the line, so the text stays
// centred just as it is on the real flyer.
function Line({ name, text, ghost, typing: open, preview, className }) {
  if (preview && !text) return null;
  let cls = '';
  if (open) cls = 'typing';
  else if (!text) cls = 'ghost';
  return (
    <div className={className}>
      <span className="hs-line">
        {preview || open ? null : <span className="hs-tool lead" data-t={`pencil-${name}`}><Icon name="pencil" size={9} strokeWidth={2.2} /></span>}
        <span className={cls}>{text || (open ? '' : ghost)}{open ? <span className="hs-caret" /> : null}</span>
        {open && !preview ? <span className="hs-tool accept" data-t="accept"><Icon name="enter" size={9} strokeWidth={2.4} /></span> : null}
      </span>
    </div>
  );
}

// The speakers' pictures. One keeps its own shape; two sit side by side,
// cropped to match. Each carries an X, and the add button waits beside the
// last one, or on its own where the first will go.
function Pictures({ count, preview }) {
  const add = <span className="hs-tool add" data-t="add"><Icon name="imagePlus" size={12} strokeWidth={2} /></span>;
  if (!count) return preview ? null : <div className="hs-tile">{add}</div>;
  return (
    <div className={`hs-pics${count === 1 ? ' lone' : ''}`}>
      {[['SG', 'one'], ['SF', 'two']].slice(0, count).map(([initials, k]) => (
        <span key={k} className={`hs-pic ${k}`}>
          {initials}
          {preview ? null : <span className="x"><Icon name="x" size={7} strokeWidth={3} /></span>}
        </span>
      ))}
      {preview ? null : add}
    </div>
  );
}

function Flyer({ s }) {
  const p = s.preview;
  return (
    <div className="hs-flyer classic hs-onflyer" data-t="flyer">
      <span className="frame" />
      <span className="star">★</span>
      <Line name="eyebrow" text="You're invited" preview={p} className="eyebrow" />
      <div className="title">{OCTOBER.title}</div>
      <Line name="tagline" text={s.tagline} ghost="Tagline" typing={s.typing} preview={p} className="tag" />
      <Pictures count={s.pics} preview={p} />
      <span className="pill">RSVP requested</span>
      <div className="date">Monday, October 19, 2026</div>
      <div className="time">5:30 PM – 7:00 PM · {VENUE.name}</div>
      <div className="host">Hosted by {ORG}</div>
      <Line name="contact" text="" ghost="Contact" preview={p} className="time" />
      <Line name="note" text="" ghost="Footnote" preview={p} className="time note" />
    </div>
  );
}

export default function WizardFlyer() {
  return (
    <Scene width={560} height={694} length={13000} start={start} steps={steps}
      label="Step 3 of the event wizard, designing the flyer. The templates, fonts, title size and three checkboxes sit above the flyer. Clicking the pencil beside the tagline lets you type Hear from the candidates right on the flyer, and the return button keeps it. The add picture button puts one speaker's photo on the flyer, then a second beside it. Preview shows the flyer without the pencils and placeholders.">
      {(s) => (
        <Screen bare>
          <Card title="Design the flyer" className="hs-tight">
            <Field label="Template">
              <div className="style-grid">
                {STYLES.map(([id, label, wide]) => (
                  <span key={id} className={`style-card${id === 'classic' ? ' active' : ''}`}>
                    <span className="seg-mark" />
                    <div className="s-name">{label}{wide ? <span className="s-tag">Wide</span> : null}</div>
                  </span>
                ))}
              </div>
            </Field>
            <div className="designer-bar">
              <Field label="Fonts"><Select value="Classic serif" /></Field>
              <Field label="Title size"><Select value="Standard" /></Field>
              <div className="designer-checks">
                <label className="checkbox"><Check on /><span><span className="cb-label">Show host line</span></span></label>
                <label className="checkbox"><Check on={false} /><span><span className="cb-label">Show venue address</span></span></label>
                <label className="checkbox"><Check on={false} /><span><span className="cb-label">Text block instead of pictures</span></span></label>
              </div>
            </div>
            <div className="hs-stage"><Flyer s={s} /></div>
            <div className="designer-foot">
              <span className="btn"><Icon name="refresh" size={14} /> Reset flyer</span>
              <span className="btn" aria-pressed={s.preview} data-t="preview"><Icon name="eye" size={14} /> Preview</span>
            </div>
          </Card>
        </Screen>
      )}
    </Scene>
  );
}
