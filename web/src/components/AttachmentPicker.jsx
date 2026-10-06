import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../ui.jsx';
import Icon from '../icons.jsx';

// The one file a broadcast can carry, such as a PDF agenda. It goes out as a
// real attachment on every email. The server decides what may be attached
// from the file's contents; `accept` only narrows what the picker offers.
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.docx,.xlsx,.pptx,image/jpeg,image/png,image/gif,image/webp';

export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export default function AttachmentPicker({ value, onChange }) {
  const fileRef = useRef(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function pick(file) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast(`That file is ${fileSize(file.size)}. Attachments must be 5 MB or smaller.`, 'bad');
      return;
    }
    setBusy(true);
    try {
      const data = await readDataUrl(file);
      const up = await api.post('/api/uploads', { name: file.name, data, kind: 'attachment' });
      onChange({ token: up.token, name: up.name, bytes: up.bytes, mime: up.mime, url: up.url });
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attach">
      {value ? (
        <div className="attach-file">
          <Icon name="paperclip" size={15} />
          <a className="attach-name" href={value.url} target="_blank" rel="noopener noreferrer"
            title="Open the attached file">{value.name}</a>
          <span className="attach-size">{fileSize(value.bytes)}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
            <Icon name="x" size={13} /> Remove
          </button>
        </div>
      ) : (
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="paperclip" size={14} /> {busy ? 'Attaching…' : 'Attach a file'}
        </button>
      )}
      <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
