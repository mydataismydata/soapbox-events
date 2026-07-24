import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Field, useToast } from '../ui.jsx';

let cachedPresets = null;

// The flyer designer: pick a style, adjust palette / fonts / sizes, add short
// text and an optional featured image. The preview iframe is rendered by the
// server with the exact same code that renders the public landing page.
export default function FlyerDesigner({ eventBasics, flyer, onChange, mode = 'event' }) {
  const [presets, setPresets] = useState(cachedPresets);
  const [srcdoc, setSrcdoc] = useState('');
  const [previewHeight, setPreviewHeight] = useState(640);
  const [uploadingSlot, setUploadingSlot] = useState(-1);
  const toast = useToast();
  const timer = useRef(null);
  const fileRef = useRef(null);
  const frameRef = useRef(null);
  const pendingSlot = useRef(0);

  useEffect(() => {
    if (cachedPresets) return;
    api.get('/api/flyer/presets').then((d) => { cachedPresets = d; setPresets(d); }).catch(() => {});
  }, []);

  // Debounced live preview.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/flyer/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'sjc-vite' },
          credentials: 'same-origin',
          body: JSON.stringify({ event: eventBasics, flyer, mode }),
        });
        if (res.ok) setSrcdoc(await res.text());
      } catch { /* preview is best-effort */ }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [JSON.stringify(eventBasics), JSON.stringify(flyer), mode]);

  // Grow the preview iframe to fit the flyer, so even a long design shows in
  // full with no inner scrollbar. A srcdoc frame is same-origin, so we can
  // measure the rendered document and watch it for late changes (image loads).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    let ro = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) return;
      // Measure the body box itself — scrollHeight would floor at the frame's
      // own height, which grows every pass once we resize it.
      const h = Math.ceil(doc.body.getBoundingClientRect().height);
      // The frame's border sits inside its height, so add it back.
      const border = Math.max(0, frame.offsetHeight - frame.clientHeight);
      if (h > 0) setPreviewHeight(h + border);
    };
    const attach = () => {
      measure();
      const doc = frame.contentDocument;
      if (!doc || !doc.body || typeof ResizeObserver === 'undefined') return;
      ro?.disconnect();
      ro = new ResizeObserver(measure);
      ro.observe(doc.body);
    };
    frame.addEventListener('load', attach);
    attach();
    return () => { frame.removeEventListener('load', attach); ro?.disconnect(); };
  }, [srcdoc]);

  function set(patch) {
    onChange({ ...flyer, ...patch });
  }

  // The wide (landscape) templates put one tall photo down their right-hand
  // side, so they offer a single image slot instead of three.
  const wide = Boolean(presets?.styles.find((s) => s.id === flyer.style)?.landscape);
  const slotCount = wide ? 1 : 3;

  // Featured images live in parallel arrays (imageTokens / imageCaptions), one
  // entry per slot. imageToken / imageCaption mirror the first slot so older
  // readers still work. These helpers always write both the arrays and mirror.
  function writeImages(tokens, captions) {
    const filled = tokens.filter(Boolean).length;
    set({
      imageColumns: Math.max(1, filled),
      imageTokens: tokens,
      imageCaptions: captions,
      imageToken: tokens[0] || '',
      imageCaption: captions[0] || '',
    });
  }

  function pickImage(i) {
    pendingSlot.current = i;
    fileRef.current?.click();
  }

  async function uploadImage(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Images must be 5 MB or smaller', 'bad'); return; }
    const slot = pendingSlot.current;
    setUploadingSlot(slot);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const up = await api.post('/api/uploads', { name: file.name, data: dataUrl });
      const tokens = imageSlots().map((t, i) => (i === slot ? up.token : t));
      writeImages(tokens, captionSlots());
      toast('Image added to the flyer');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setUploadingSlot(-1);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Read the current featured-image state as fixed slots — three normally, one
  // on a wide template. Older flyers stored a single imageToken/imageCaption,
  // so fold those into slot 0.
  function imageSlots() {
    const arr = Array.isArray(flyer.imageTokens) && flyer.imageTokens.length
      ? flyer.imageTokens : (flyer.imageToken ? [flyer.imageToken] : []);
    return Array.from({ length: slotCount }, (_, i) => arr[i] || '');
  }
  function captionSlots() {
    const arr = Array.isArray(flyer.imageCaptions) && flyer.imageCaptions.length
      ? flyer.imageCaptions : (flyer.imageCaption ? [flyer.imageCaption] : []);
    return Array.from({ length: slotCount }, (_, i) => arr[i] || '');
  }

  function setImageAt(i, token) {
    const tokens = imageSlots().map((t, k) => (k === i ? token : t));
    const captions = captionSlots().map((c, k) => (k === i && !token ? '' : c));
    writeImages(tokens, captions);
  }
  function setCaptionAt(i, caption) {
    const captions = captionSlots().map((c, k) => (k === i ? caption : c));
    writeImages(imageSlots(), captions);
  }

  if (!presets) return null;
  const tokens = imageSlots();
  const captions = captionSlots();

  const templates = (
    <Field label="Template" hint="Each template has its own fixed patriotic colors.">
      <div className="style-grid">
        {presets.styles.map((s) => (
          <button key={s.id} type="button"
            className={`style-card ${flyer.style === s.id ? 'active' : ''}`}
            onClick={() => set({ style: s.id })}>
            <div className="s-name">{s.label}{s.landscape ? <span className="s-tag">Wide</span> : null}</div>
            <div className="s-desc">{s.description}</div>
          </button>
        ))}
      </div>
    </Field>
  );

  const preview = (
    <div>
      <iframe ref={frameRef} className="preview-frame" title="Flyer preview" scrolling="no"
        style={{ height: previewHeight }} srcDoc={srcdoc} />
      <p className="small muted" style={{ textAlign: 'center', marginTop: 6 }}>
        {mode === 'broadcast'
          ? 'Live preview — the masthead at the top of the email and web version.'
          : 'Live preview — exactly what guests see on the event page.'}
      </p>
    </div>
  );

  const images = (
    <Field label={wide ? 'Featured image' : 'Featured images'}
      hint={wide
        ? 'Optional. One photo, shown full height down the right-hand side. JPEG/PNG/GIF/WebP up to 5 MB.'
        : 'Optional. Add up to three — one shows on its own, two or three sit side by side (e.g. featured speakers). JPEG/PNG/GIF/WebP up to 5 MB.'}>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }} onChange={(e) => uploadImage(e.target.files?.[0])} />
      <div className="img-slots">
        {tokens.map((tok, i) => (
          <div className="img-slot" key={i}>
            {wide ? null : <div className="img-slot-label">Image {i + 1}</div>}
            <div className="row">
              <button type="button" className="btn" disabled={uploadingSlot !== -1}
                onClick={() => pickImage(i)}>
                {uploadingSlot === i ? 'Uploading…' : tok ? 'Replace' : 'Add image'}
              </button>
              {tok ? (
                <button type="button" className="btn btn-ghost" onClick={() => setImageAt(i, '')}>
                  Remove
                </button>
              ) : null}
            </div>
            {tok ? (
              <input className="img-cap" value={captions[i] || ''} maxLength={160}
                placeholder="Caption / name (optional)"
                onChange={(e) => setCaptionAt(i, e.target.value)} />
            ) : null}
          </div>
        ))}
      </div>
    </Field>
  );

  const fields = (
    <div className={wide ? 'field-cols' : ''}>
      <div className="field-row">
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
      </div>

      <Field label="Eyebrow line" hint="The short line above the title.">
        <input value={flyer.eyebrow} maxLength={60} placeholder="You're invited"
          onChange={(e) => set({ eyebrow: e.target.value })} />
      </Field>
      <Field label="Tagline" hint="One sentence under the title (optional).">
        <input value={flyer.tagline} maxLength={140} placeholder="Dinner, dancing, and good company"
          onChange={(e) => set({ tagline: e.target.value })} />
      </Field>
      <Field label="Footnote"
        hint={wide && flyer.style === 'panel'
          ? 'Small print at the bottom. Separate points with · to get up to three bullet rows.'
          : 'Small print at the bottom (optional).'}>
        <input value={flyer.note} maxLength={200} placeholder="Rain or shine · Free parking on 5th"
          onChange={(e) => set({ note: e.target.value })} />
      </Field>
      <Field label="Contact" hint="Who to reach with questions — shown in the details (optional).">
        <input value={flyer.contact || ''} maxLength={120} placeholder="Questions? Jane · (555) 100-2000"
          onChange={(e) => set({ contact: e.target.value })} />
      </Field>

      {mode === 'event' ? (
        <>
          <label className="checkbox">
            <input type="checkbox" checked={flyer.showHost}
              onChange={(e) => set({ showHost: e.target.checked })} />
            <span><span className="cb-label">Show host line</span>
              <div className="cb-sub">Displays “Hosted by {eventBasics.host_name || '…'}” on the flyer.</div></span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={!!flyer.showAddress}
              onChange={(e) => set({ showAddress: e.target.checked })} />
            <span><span className="cb-label">Show venue address</span>
              <div className="cb-sub">The venue name and time always show; turn this on to add the street address.</div></span>
          </label>
        </>
      ) : null}
    </div>
  );

  // A wide template needs the full width for its preview, so it stacks:
  // templates, preview, fields, image. The portrait templates keep the fields
  // beside the preview.
  if (wide) {
    return (
      <div className="designer-wrap">
        {templates}
        {preview}
        <div style={{ marginTop: 16 }}>{fields}</div>
        {images}
      </div>
    );
  }

  return (
    <div className="designer-wrap">
      {templates}
      <div className="designer">
        {fields}
        {preview}
      </div>
      {images}
    </div>
  );
}
