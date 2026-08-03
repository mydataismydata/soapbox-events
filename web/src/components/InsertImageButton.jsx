// Puts a picture in a message body. The body is plain text, so what actually
// goes in at the caret is a marker — {{image:<token>}} — which the email and
// web-version renderers turn into an <img> pointing at the uploaded file.
//
// Uploading is the same data-URL POST the flyer designer uses, so there is no
// multipart handling anywhere in the app.
import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon, useToast } from '../ui.jsx';

const SIZES = [
  { id: 'full', label: 'Full width' },
  { id: 'half', label: 'Half width' },
  { id: 'small', label: 'Small' },
];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export default function InsertImageButton({ onInsert, disabled }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [size, setSize] = useState('full');
  const [busy, setBusy] = useState(false);

  async function pick(file) {
    if (!file) return;
    setBusy(true);
    try {
      const up = await api.post('/api/uploads', { name: file.name, data: await readAsDataUrl(file) });
      onInsert(`{{image:${up.token}${size === 'full' ? '' : `|${size}`}}}`);
      toast('Image added to the message');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
      // Let the same file be chosen again after a failure.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="btn btn-sm" disabled={disabled || busy}
        onClick={() => fileRef.current?.click()}>
        <Icon name="image" size={14} /> {busy ? 'Uploading…' : 'Insert image'}
      </button>
      <select className="search-input" style={{ width: 130 }} value={size}
        aria-label="Image width" disabled={disabled || busy}
        onChange={(e) => setSize(e.target.value)}>
        {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
