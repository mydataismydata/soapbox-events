import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Input, Screen } from '../mock.jsx';
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

const start = { style: 'classic', tagline: '', focus: false };
const steps = [
  { at: 600, point: 'styles', say: 'Six templates, each with its own colors', side: 'right' },
  { at: 2300, tap: 'style-retro', say: 'Click one to try it', side: 'below', set: { style: 'retro' } },
  { at: 3700, point: 'flyer', say: 'The preview is the real page', side: 'left' },
  { at: 5300, tap: 'style-dark', say: null, set: { style: 'dark' } },
  { at: 6500, tap: 'tagline', say: 'Short lines have set places', side: 'below', set: { focus: true } },
  ...typing(7200, 'tagline', 'Meet the candidates', 60),
  { at: 8800, point: 'add-image', say: 'Add photos of the speakers', side: 'above', set: { focus: false } },
];

// The flyer as each template draws it, small. Only the portrait templates
// are ever picked here.
function Flyer({ style, tagline }) {
  const date = 'Monday, October 19, 2026';
  const time = '5:30 PM – 7:00 PM';
  if (style === 'retro') {
    return (
      <div className="hs-flyer retro">
        <div className="top">
          <div className="host">Hosted by {ORG}</div>
          <div className="eyebrow">★★★ You're invited ★★★</div>
          <div className="title">{OCTOBER.title}</div>
          <span className="pill">RSVP requested</span>
        </div>
        {tagline ? <div className="band">{tagline}</div> : null}
        <div className="bottom">
          <div className="rule">★</div>
          <div className="date">{date} // <span>{time}</span></div>
          <div className="venue">{VENUE.name}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`hs-flyer ${style}`}>
      {style === 'classic' ? <span className="frame" /> : null}
      <span className="star">★</span>
      <div className="eyebrow">You're invited</div>
      <div className="title">{OCTOBER.title}</div>
      {tagline ? <div className="tag">{tagline}</div> : null}
      <span className="pill">RSVP requested</span>
      <div className="date">{date}</div>
      <div className="time">{time}</div>
      <div className="venue">{VENUE.name}</div>
      <div className="host">Hosted by {ORG}</div>
    </div>
  );
}

export default function WizardFlyer() {
  return (
    <Scene width={560} height={436} length={11500} start={start} steps={steps}
      label="Step 3 of the event wizard, designing the flyer. The six templates are Classic, Dark, Light, Retro, Spotlight and Panel. Clicking Retro, then Dark, changes the preview beside them. Typing Meet the candidates into the tagline puts it on the flyer, and Add image adds photos.">
      {(s) => (
        <Screen bare>
          <Card title="Design the flyer">
            <div className="hs-designer">
              <div>
                <Field label="Template">
                  <div className="style-grid" data-t="styles">
                    {STYLES.map(([id, label, wide]) => (
                      <span key={id} className={`style-card${s.style === id ? ' active' : ''}`} data-t={`style-${id}`}>
                        <span className="seg-mark" />
                        <div className="s-name">{label}{wide ? <span className="s-tag">Wide</span> : null}</div>
                      </span>
                    ))}
                  </div>
                </Field>
                <Field label="Tagline">
                  <Input t="tagline" value={s.tagline} focus={s.focus} placeholder="A short line under the title" />
                </Field>
                <Field label="Featured images">
                  <span className="btn btn-sm" data-t="add-image"><Icon name="image" size={14} /> Add image</span>
                </Field>
              </div>
              <div className="hs-preview" data-t="flyer">
                <Flyer style={s.style} tagline={s.tagline} />
                <p className="small muted">Live preview — exactly what guests see on the event page.</p>
              </div>
            </div>
          </Card>
        </Screen>
      )}
    </Scene>
  );
}
