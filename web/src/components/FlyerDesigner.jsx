import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { ConfirmModal, Field, useToast, Icon } from '../ui.jsx';
import FlyerStage from './FlyerStage.jsx';
import RichText from './RichText.jsx';
import { trimPlainEdges } from './trimEdges.js';

let cachedPresets = null;

const MAX_MB = 5;

// The Panel template's footnote as up to three points, split the way the
// server's renderer splits it (splitPoints in server/lib/flyer.js).
function splitPoints(note) {
  return String(note || '').split(/\s*[·•|;]\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// The flyer designer. The template, fonts, title size and the event
// checkboxes sit above the flyer; everything else is set on the flyer itself
// (FlyerStage draws it and its pencils and picture buttons). The one exception
// is the text block, which takes the pictures' place when its box is ticked:
// formatted text needs a toolbar, so it is written in an editor just above the
// flyer, and its pencil on the flyer brings you to it. Reset flyer clears
// what is on the flyer, and Preview shows it without any of the editing marks.
export default function FlyerDesigner({ eventBasics, flyer, onChange, mode = 'event' }) {
  const [presets, setPresets] = useState(cachedPresets);
  const [previewing, setPreviewing] = useState(false);
  const [uploading, setUploading] = useState(''); // '' | 'picture' | 'background'
  const [resetting, setResetting] = useState(false);
  const toast = useToast();
  const fileRef = useRef(null);
  const fileFor = useRef('');
  const textRef = useRef(null);
  // Writes start from the newest flyer, not the one this render saw: an upload
  // can finish after the host has typed something else on the flyer.
  const latest = useRef(flyer);
  latest.current = flyer;

  useEffect(() => {
    if (cachedPresets) return;
    api.get('/api/flyer/presets').then((d) => { cachedPresets = d; setPresets(d); }).catch(() => {});
  }, []);

  function set(patch) {
    onChange({ ...latest.current, ...patch });
  }

  if (!presets) return null;

  const style = presets.styles.find((s) => s.id === flyer.style) || presets.styles[0];
  // The wide (landscape) templates put one tall photo down their right-hand
  // side, so they take a single picture instead of three.
  const wide = Boolean(style.landscape);
  const maxPictures = wide ? 1 : 3;
  // The photo templates (Dark, Light) take a full-bleed background photo too.
  const takesBackground = Boolean(style.photo);

  // The featured pictures as one list of { token, caption }, read the way the
  // renderer reads them: an old single imageToken counts as the first, a gap
  // an old flyer left closes up, and a wide template keeps only one.
  function pictures(f = latest.current) {
    const tokens = Array.isArray(f.imageTokens) && f.imageTokens.length ? f.imageTokens : (f.imageToken ? [f.imageToken] : []);
    const captions = Array.isArray(f.imageCaptions) && f.imageCaptions.length ? f.imageCaptions : (f.imageCaption ? [f.imageCaption] : []);
    return tokens.slice(0, maxPictures).map((token, i) => ({ token, caption: captions[i] || '' })).filter((p) => p.token);
  }

  // imageToken / imageCaption mirror the first picture so older readers still
  // work, and imageColumns is how many there are.
  function writePictures(list) {
    set({
      imageColumns: Math.max(1, list.length),
      imageTokens: list.map((p) => p.token),
      imageCaptions: list.map((p) => p.caption),
      imageToken: list[0]?.token || '',
      imageCaption: list[0]?.caption || '',
    });
  }

  function choose(kind) {
    if (uploading) return;
    fileFor.current = kind;
    fileRef.current?.click();
  }

  async function upload(file) {
    const kind = fileFor.current;
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !kind) return;
    if (file.size > MAX_MB * 1024 * 1024) { toast(`Pictures must be ${MAX_MB} MB or smaller`, 'bad'); return; }
    setUploading(kind);
    try {
      // A background loses any plain white or black strip along its edges,
      // which would otherwise show where the flyer fades the photo out.
      const data = (kind === 'background' && await trimPlainEdges(file)) || await readFile(file);
      const up = await api.post('/api/uploads', { name: file.name, data });
      if (kind === 'background') set({ bgToken: up.token });
      else writePictures([...pictures(), { token: up.token, caption: '' }]);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setUploading('');
    }
  }

  // A line typed on the flyer: a field of its own, one picture's caption, or
  // one of the Panel template's footnote bullets (note:0, note:1, …).
  function setLine(key, value) {
    const [field, at] = key.split(':');
    const i = Number(at);
    if (field === 'note' && at !== undefined) {
      // The footnote is stored as one line, the points joined with ·, so a
      // separator typed inside a point would split it in two.
      const points = splitPoints(latest.current.note);
      const point = value.replace(/[·•|;]/g, ',').replace(/\s+/g, ' ').trim();
      if (point) points[i] = point;
      else points.splice(i, 1);
      set({ note: points.filter(Boolean).join(' · ').slice(0, 200) });
      return;
    }
    if (field !== 'caption') { set({ [field]: value }); return; }
    const list = pictures();
    if (!list[i]) return;
    list[i] = { ...list[i], caption: value };
    writePictures(list);
  }

  function clearFlyer() {
    set({
      eyebrow: '', tagline: '', note: '', contact: '',
      imageColumns: 1, imageTokens: [], imageCaptions: [], imageToken: '', imageCaption: '',
      bgToken: '', bgTopHalf: false, textHtml: '',
    });
    setResetting(false);
    toast('Flyer cleared');
  }

  const empty = !flyer.eyebrow && !flyer.tagline && !flyer.note && !flyer.contact
    && !pictures(flyer).length && !flyer.bgToken && !flyer.textHtml;
  const textBlock = mode === 'event' && Boolean(flyer.textBlock);

  // Everything the drawing depends on. The email-picture fields are left out:
  // re-making that picture changes them, and changes nothing that is drawn.
  const { includeFlyerImage, flyerImageToken, ...look } = flyer;
  const body = { event: eventBasics, flyer: look, mode };
  const widths = presets.snapshotWidths || { portrait: 640, wide: 920 };

  return (
    <div className="designer-wrap">
      <Field label="Template" hint="Each template has its own fixed colors and layout.">
        <div className="style-grid" role="radiogroup" aria-label="Flyer template">
          {presets.styles.map((s) => (
            <button key={s.id} type="button"
              role="radio"
              aria-checked={flyer.style === s.id}
              className={`style-card ${flyer.style === s.id ? 'active' : ''}`}
              onClick={() => set({ style: s.id })}>
              <span className="seg-mark" aria-hidden="true" />
              <div className="s-name">{s.label}{s.landscape ? <span className="s-tag">Wide</span> : null}</div>
              <div className="s-desc">{s.description}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="designer-bar">
        <Field label="Fonts">
          <select value={flyer.font} onChange={(e) => set({ font: e.target.value })}>
            {presets.fonts.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Title size">
          <select value={flyer.scale} onChange={(e) => set({ scale: e.target.value })}>
            {presets.scales.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        {mode === 'event' ? (
          <div className="designer-checks">
            <label className="checkbox">
              <input type="checkbox" checked={!!flyer.showHost}
                onChange={(e) => set({ showHost: e.target.checked })} />
              <span><span className="cb-label">Show host line</span></span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={!!flyer.showAddress}
                onChange={(e) => set({ showAddress: e.target.checked })} />
              <span><span className="cb-label">Show venue address</span></span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={!!flyer.textBlock}
                onChange={(e) => set({ textBlock: e.target.checked })} />
              <span><span className="cb-label">Text block instead of pictures</span></span>
            </label>
          </div>
        ) : null}
      </div>

      {textBlock ? (
        <div className="designer-text">
          <Field label="Text block"
            hint="Paste from a document, an email or a web page. Bold, sizes, lists, links and pictures come along. Fonts and colors follow the template.">
            <RichText ref={textRef} value={flyer.textHtml || ''} onChange={(html) => set({ textHtml: html })}
              placeholder="Paste or type the text for the middle of the flyer"
              keepFormatting links images align={wide ? undefined : 'center'} />
          </Field>
        </div>
      ) : null}

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden
        onChange={(e) => upload(e.target.files?.[0])} />
      <FlyerStage body={body} previewing={previewing}
        snapshotWidth={mode === 'event' ? widths[wide ? 'wide' : 'portrait'] : 0}
        model={{ maxPictures, uploading, takesBackground, background: Boolean(flyer.bgToken), topHalf: Boolean(flyer.bgTopHalf) }}
        onEditText={() => textRef.current?.focus()}
        onLine={setLine}
        onAddPicture={() => choose('picture')}
        onRemovePicture={(i) => writePictures(pictures().filter((_, k) => k !== i))}
        onAddBackground={() => choose('background')}
        onRemoveBackground={() => set({ bgToken: '', bgTopHalf: false })}
        onTopHalf={(on) => set({ bgTopHalf: on })} />

      <div className="designer-foot">
        <button type="button" className="btn" onClick={() => setResetting(true)} disabled={empty}>
          <Icon name="refresh" size={14} /> Reset flyer
        </button>
        <button type="button" className="btn" aria-pressed={previewing} onClick={() => setPreviewing((p) => !p)}>
          <Icon name="eye" size={14} /> Preview
        </button>
      </div>
      <p className="small muted designer-hint">
        {!previewing
          ? 'Click a pencil to type on the flyer, then press Enter to keep it.'
          : mode === 'broadcast'
            ? 'This is the masthead as the web version shows it. Click Preview again to keep editing.'
            : 'This is the flyer as the email picture shows it. Click Preview again to keep editing.'}
      </p>

      {resetting ? (
        <ConfirmModal title="Clear the flyer?" danger confirmLabel="Clear flyer"
          message={`This removes the lines you typed, the captions, the pictures${mode === 'event' ? ', the text block' : ''} and the background picture. The template, fonts${mode === 'event' ? ', title size and checkboxes stay' : ' and title size stay'} as they are.`}
          onConfirm={clearFlyer} onClose={() => setResetting(false)} />
      ) : null}
    </div>
  );
}
