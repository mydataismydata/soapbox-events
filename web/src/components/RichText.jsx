import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Modal, Field, useToast } from '../ui.jsx';
import { api } from '../api.js';
import Icon from '../icons.jsx';

// A small rich-text editor for the event description. Bold/italic/underline
// use semantic tags; font and size wrap the selection in a span with an
// allowlisted class (rt-ff-* / rt-fs-*) — the exact set the server sanitizer
// keeps. Pasting always drops formatting, and there's an explicit
// "Paste as plain text" button too.
const FONTS = [
  { label: 'Font…', cls: '' },
  { label: 'Serif', cls: 'rt-ff-serif' },
  { label: 'Sans-serif', cls: 'rt-ff-sans' },
  { label: 'Monospace', cls: 'rt-ff-mono' },
];
const SIZES = [
  { label: 'Size…', cls: '' },
  { label: 'Small', cls: 'rt-fs-sm' },
  { label: 'Normal', cls: '' },
  { label: 'Large', cls: 'rt-fs-lg' },
  { label: 'Extra large', cls: 'rt-fs-xl' },
];

const IMAGE_SIZES = [
  { id: '', label: 'Full width' },
  { id: 'rt-img-half', label: 'Half width' },
  { id: 'rt-img-small', label: 'Small' },
];

// `links` and `images` opt the toolbar into the two buttons that need a
// dialog and an upload; the event description doesn't want either.
// A parent can insert text (merge tags) through the forwarded ref.
const RichText = forwardRef(function RichText({ value, onChange, placeholder, links, images }, handle) {
  const ref = useRef(null);
  const savedRange = useRef(null);
  const fileRef = useRef(null);
  const toast = useToast();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [imgSize, setImgSize] = useState('');
  const [busy, setBusy] = useState(false);

  // Push value into the DOM only when it changes from the outside (initial
  // load, template), never on our own keystrokes — that would drop the caret.
  useEffect(() => {
    const el = ref.current;
    if (el && (value || '') !== el.innerHTML) el.innerHTML = value || '';
  }, [value]);

  function emit() {
    onChange(ref.current?.innerHTML || '');
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (ref.current && ref.current.contains(r.commonAncestorContainer)) {
        savedRange.current = r.cloneRange();
      }
    }
  }

  function exec(cmd) {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(cmd, false, null);
    emit();
    saveSelection();
  }

  // Font/size: native <select> steals focus and collapses the selection, so we
  // fall back to the range saved on the editor's last blur.
  function applyClass(group, cls) {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    let range = null;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer) && !r.collapsed) range = r;
    }
    if (!range && savedRange.current && !savedRange.current.collapsed) {
      range = savedRange.current;
      sel.removeAllRanges();
      sel.addRange(range);
    }
    if (!range) { toast('Select some text first, then pick a font or size', 'bad'); return; }

    const frag = range.extractContents();
    // Remove any existing classes of this group so choices replace, not stack.
    frag.querySelectorAll('span[class]').forEach((s) => {
      const kept = s.className.split(/\s+/).filter((k) => k && !k.startsWith(`rt-${group}-`));
      if (kept.length) s.className = kept.join(' ');
      else {
        const parent = s.parentNode;
        while (s.firstChild) parent.insertBefore(s.firstChild, s);
        parent.removeChild(s);
      }
    });
    if (cls) {
      const span = document.createElement('span');
      span.className = cls;
      span.appendChild(frag);
      range.insertNode(span);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
    } else {
      range.insertNode(frag);
    }
    emit();
    saveSelection();
  }

  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  }

  async function pastePlain() {
    ref.current?.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    try {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
      emit();
    } catch {
      toast('Clipboard unavailable — normal paste already strips formatting here', 'bad');
    }
  }

  // Put the caret back where it was before a button or dialog stole focus.
  function restoreSelection() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (!savedRange.current) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange.current);
  }

  function insertHtml(html) {
    restoreSelection();
    document.execCommand('insertHTML', false, html);
    emit();
    saveSelection();
  }

  // Merge-tag buttons live outside this component but type into it.
  useImperativeHandle(handle, () => ({
    insertText(text) {
      restoreSelection();
      document.execCommand('insertText', false, text);
      emit();
      saveSelection();
    },
  }));

  function startLink() {
    const sel = window.getSelection();
    const selected = sel && sel.rangeCount && ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer)
      ? sel.toString().trim()
      : '';
    saveSelection();
    setLinkLabel(selected);
    setLinkUrl('');
    setLinkOpen(true);
  }

  function addLink() {
    let href = linkUrl.trim();
    if (!href) return;
    // A pasted "example.org/page" is what someone means by a link.
    if (!/^[a-zA-Z][\w+.-]*:/.test(href)) href = `https://${href}`;
    if (!/^(https?:\/\/|mailto:)/i.test(href)) {
      toast('Links must be http://, https:// or mailto:', 'bad');
      return;
    }
    const text = linkLabel.trim() || href;
    insertHtml(`<a href="${escapeAttr(href)}">${escapeText(text)}</a>&nbsp;`);
    setLinkOpen(false);
  }

  async function pickImage(file) {
    if (!file) return;
    setBusy(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('That file could not be read.'));
        reader.readAsDataURL(file);
      });
      const up = await api.post('/api/uploads', { name: file.name, data });
      insertHtml(`<img src="${escapeAttr(up.url)}"${imgSize ? ` class="${imgSize}"` : ''} alt="">`);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const noSel = (e) => e.preventDefault(); // keep the selection when clicking a button

  return (
    <div className="rt">
      <div className="rt-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" className="rt-btn" title="Bold" aria-label="Bold"
          onMouseDown={noSel} onClick={() => exec('bold')}><Icon name="bold" size={15} /></button>
        <button type="button" className="rt-btn" title="Italic" aria-label="Italic"
          onMouseDown={noSel} onClick={() => exec('italic')}><Icon name="italic" size={15} /></button>
        <button type="button" className="rt-btn" title="Underline" aria-label="Underline"
          onMouseDown={noSel} onClick={() => exec('underline')}><Icon name="underline" size={15} /></button>
        <span className="rt-sep" />
        <select className="rt-select" title="Font" aria-label="Font" value=""
          onChange={(e) => applyClass('ff', e.target.value)}>
          {FONTS.map((f, i) => <option key={i} value={f.cls}>{f.label}</option>)}
        </select>
        <select className="rt-select" title="Text size" aria-label="Text size" value=""
          onChange={(e) => applyClass('fs', e.target.value)}>
          {SIZES.map((s, i) => <option key={i} value={s.cls}>{s.label}</option>)}
        </select>
        {links || images ? <span className="rt-sep" /> : null}
        {links ? (
          <button type="button" className="rt-btn" title="Insert link" aria-label="Insert link"
            onMouseDown={noSel} onClick={startLink}><Icon name="link" size={15} /></button>
        ) : null}
        {images ? (
          <>
            <button type="button" className="rt-btn" title="Insert image" aria-label="Insert image"
              disabled={busy} onMouseDown={noSel} onClick={() => { saveSelection(); fileRef.current?.click(); }}>
              <Icon name="image" size={15} />
            </button>
            <select className="rt-select" title="Width of inserted images" aria-label="Image width"
              value={imgSize} onChange={(e) => setImgSize(e.target.value)}>
              {IMAGE_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
              style={{ display: 'none' }} onChange={(e) => pickImage(e.target.files?.[0])} />
          </>
        ) : null}
        <span className="rt-sep" />
        <button type="button" className="rt-btn rt-btn-text"
          title="Paste clipboard contents without formatting" aria-label="Paste as plain text"
          onMouseDown={noSel} onClick={pastePlain}>
          <Icon name="pasteText" size={15} /> Plain paste
        </button>
      </div>
      {linkOpen ? (
        <Modal title="Insert a link" onClose={() => setLinkOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setLinkOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!linkUrl.trim()} onClick={addLink}>Insert</button>
            </>
          }>
          <Field label="Text to show" hint="Leave blank to show the address itself.">
            <input value={linkLabel} maxLength={300} autoFocus placeholder="our endorsements"
              onChange={(e) => setLinkLabel(e.target.value)} />
          </Field>
          <Field label="Address" required>
            <input value={linkUrl} maxLength={600} placeholder="https://example.org/endorsements"
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} />
          </Field>
        </Modal>
      ) : null}
      <div ref={ref} className="rt-editor rt-content" contentEditable suppressContentEditableWarning
        data-placeholder={placeholder || ''}
        onInput={emit} onKeyUp={saveSelection} onMouseUp={saveSelection}
        onBlur={() => { saveSelection(); emit(); }} onPaste={onPaste} />
    </div>
  );
});

// Whether a stored body is already rich text. Mirrors the server's check;
// bodies written before the editor existed are plain text with real newlines,
// which a contenteditable would collapse into one long line.
export function looksLikeHtml(text) {
  return /<(?:b|strong|i|em|u|br|p|div|span|a|img)\b[^>]*>/i.test(String(text ?? ''));
}

export function plainToHtml(text) {
  return String(text ?? '').trim().split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeText(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Small local helpers — the editor writes HTML by hand in two places, and
// both values come from a person typing.
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default RichText;
