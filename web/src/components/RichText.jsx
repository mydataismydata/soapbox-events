import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Modal, Field, useToast } from '../ui.jsx';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import { cleanHtml, cleanHtmlString, isOwnFile } from './cleanHtml.js';

// A small rich-text editor for the event description. Bold/italic/underline
// use semantic tags; font and size wrap the selection in a span with an
// allowlisted class (rt-ff-* / rt-fs-*) — the exact set the server sanitizer
// keeps. Pasting drops formatting, and there's an explicit "Paste as plain
// text" button too.
//
// With `keepFormatting` (the flyer's text block) pasting keeps it instead:
// the clipboard's HTML is cut down to the same allowlist by cleanHtml, and the
// pictures in it are copied in as uploads before the text goes in. The
// toolbar gains alignment and lists, and what the editor hands up is always
// that cleaned markup.
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

const ALIGN_BUTTONS = [
  { cmd: 'justifyLeft', icon: 'alignLeft', label: 'Align left' },
  { cmd: 'justifyCenter', icon: 'alignCenter', label: 'Center' },
  { cmd: 'justifyRight', icon: 'alignRight', label: 'Align right' },
];
const LIST_BUTTONS = [
  { cmd: 'insertUnorderedList', icon: 'listBullet', label: 'Bulleted list' },
  { cmd: 'insertOrderedList', icon: 'listNumber', label: 'Numbered list' },
];

// Pictures are copied a few at a time, so a long pasted page doesn't open
// dozens of requests at once.
const COPY_AT_ONCE = 4;

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

// One pasted picture as an upload of this installation's, by its address.
async function copyPicture(src) {
  if (/^data:image\//i.test(src)) return (await api.post('/api/uploads', { name: 'pasted picture', data: src })).url;
  if (/^blob:/i.test(src)) {
    const blob = await (await fetch(src)).blob();
    return (await api.post('/api/uploads', { name: 'pasted picture', data: await readDataUrl(blob) })).url;
  }
  if (/^https?:\/\//i.test(src)) return (await api.post('/api/uploads/remote', { url: src })).url;
  throw new Error('That picture has no address that can be copied.');
}

const IMAGE_SIZES = [
  { id: '', label: 'Full width' },
  { id: 'rt-img-half', label: 'Half width' },
  { id: 'rt-img-small', label: 'Small' },
];

// `links` and `images` opt the toolbar into the two buttons that need a
// dialog and an upload; the event description doesn't want either.
// A parent can insert text (merge tags) through the forwarded ref.
// `align` is the editor's own alignment, set to match where the text will
// show: the flyer's portrait templates centre theirs.
const RichText = forwardRef(function RichText({ value, onChange, placeholder, links, images, keepFormatting, align }, handle) {
  const ref = useRef(null);
  const savedRange = useRef(null);
  const fileRef = useRef(null);
  const lastEmitted = useRef(null);
  const draggingInside = useRef(false);
  const toast = useToast();
  const [copying, setCopying] = useState(0); // pictures still being copied in
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [imgSize, setImgSize] = useState('');
  const [busy, setBusy] = useState(false);

  // Push value into the DOM only when it changes from the outside (initial
  // load, template), never on our own keystrokes — that would drop the caret.
  // With keepFormatting the value is the cleaned markup, which differs from
  // what the editor holds, so it is recognised as our own by remembering it.
  useEffect(() => {
    const el = ref.current;
    if (!el || (value || '') === lastEmitted.current) return;
    if ((value || '') !== el.innerHTML) el.innerHTML = value || '';
  }, [value]);

  function emit() {
    const raw = ref.current?.innerHTML || '';
    const html = keepFormatting ? cleanHtmlString(raw) : raw;
    lastEmitted.current = html;
    onChange(html);
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
    const data = e.clipboardData || window.clipboardData;
    if (keepFormatting) { saveSelection(); pasteFormatted(data); return; }
    document.execCommand('insertText', false, data.getData('text/plain'));
    emit();
  }

  // Formatted text: cleaned, its pictures copied in, then put in where the
  // caret was. The pictures that can't be copied are left out, and said so.
  async function pasteFormatted(data) {
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    const files = [...(data.files || [])].filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    const root = html ? cleanHtml(html) : null;
    // A picture on its own — a screenshot, or a browser's Copy Image — also
    // comes as a file, and uploading that beats fetching the page's copy.
    if (files.length && !root?.textContent.trim()) {
      const holder = document.createElement('div');
      for (const file of files) {
        const img = document.createElement('img');
        img.setAttribute('src', await readDataUrl(file));
        img.setAttribute('alt', '');
        holder.appendChild(img);
      }
      await copyPictures(holder);
      insertNodes(holder);
      return;
    }
    if (!root || (!root.textContent.trim() && !root.querySelector('img'))) {
      if (!text) return;
      restoreSelection();
      document.execCommand('insertText', false, text);
      emit();
      return;
    }
    await copyPictures(root);
    insertNodes(root);
  }

  async function copyPictures(root) {
    const imgs = [...root.querySelectorAll('img')].filter((img) => !isOwnFile(img.getAttribute('src')));
    if (!imgs.length) return;
    const copies = new Map(); // the same picture twice is copied once
    let failed = 0;
    let next = 0;
    setCopying(imgs.length);
    async function worker() {
      while (next < imgs.length) {
        const img = imgs[next++];
        const src = img.getAttribute('src') || '';
        try {
          if (!copies.has(src)) copies.set(src, copyPicture(src));
          img.setAttribute('src', await copies.get(src));
        } catch {
          failed++;
          img.remove();
        }
        setCopying((n) => Math.max(0, n - 1));
      }
    }
    await Promise.all(Array.from({ length: Math.min(COPY_AT_ONCE, imgs.length) }, worker));
    setCopying(0);
    if (failed) {
      toast(failed === 1
        ? 'One picture could not be copied. Save it and add it with the picture button.'
        : `${failed} pictures could not be copied. Save them and add them with the picture button.`, 'bad');
    }
  }

  // Put cleaned nodes in at the caret. They go in through the selection's own
  // range rather than insertHTML, which would restyle them to match the text
  // around them. A single plain paragraph goes in as its words, so a pasted
  // phrase joins the line it lands in.
  function insertNodes(root) {
    const el = ref.current;
    if (!el) return;
    const only = root.children.length === 1 && root.firstElementChild;
    if (only && only.tagName === 'P' && !only.className && root.childNodes.length === 1) {
      root.replaceChildren(...only.childNodes);
    }
    if (!root.childNodes.length) return;
    restoreSelection();
    const sel = window.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    const last = root.lastChild;
    const frag = document.createDocumentFragment();
    frag.append(...root.childNodes);
    range.insertNode(frag);
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    emit();
    saveSelection();
  }

  // A drop from outside the editor is a paste at the spot it lands on. Text
  // dragged about inside the editor is left to the browser.
  function onDrop(e) {
    if (!keepFormatting || draggingInside.current || !e.dataTransfer) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint
      ? document.caretRangeFromPoint(e.clientX, e.clientY)
      : (() => {
        const p = document.caretPositionFromPoint?.(e.clientX, e.clientY);
        if (!p) return null;
        const r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
        return r;
      })();
    if (pos && ref.current?.contains(pos.startContainer)) savedRange.current = pos;
    pasteFormatted(e.dataTransfer);
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

  // Merge-tag buttons live outside this component but type into it, and the
  // flyer's pencil brings the caret back to it.
  useImperativeHandle(handle, () => ({
    insertText(text) {
      restoreSelection();
      document.execCommand('insertText', false, text);
      emit();
      saveSelection();
    },
    focus() {
      const el = ref.current;
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
      if (savedRange.current) { restoreSelection(); return; }
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
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
      const data = await readDataUrl(file);
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
        {keepFormatting ? (
          <>
            <span className="rt-sep" />
            {ALIGN_BUTTONS.concat(LIST_BUTTONS).map((b, i) => (
              <React.Fragment key={b.cmd}>
                {i === ALIGN_BUTTONS.length ? <span className="rt-sep" /> : null}
                <button type="button" className="rt-btn" title={b.label} aria-label={b.label}
                  onMouseDown={noSel} onClick={() => exec(b.cmd)}><Icon name={b.icon} size={15} /></button>
              </React.Fragment>
            ))}
          </>
        ) : null}
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
        {copying ? (
          <span className="rt-status" role="status">
            <span className="rt-spin" aria-hidden="true" />
            Copying {copying === 1 ? 'a picture' : `${copying} pictures`}…
          </span>
        ) : null}
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
      <div ref={ref} className={`rt-editor rt-content${align === 'center' ? ' rt-centered' : ''}`}
        contentEditable suppressContentEditableWarning
        data-placeholder={placeholder || ''}
        onInput={emit} onKeyUp={saveSelection} onMouseUp={saveSelection}
        onFocus={keepFormatting ? () => document.execCommand('defaultParagraphSeparator', false, 'p') : undefined}
        onBlur={() => { saveSelection(); emit(); }} onPaste={onPaste}
        onDragStart={() => { draggingInside.current = true; }}
        onDragEnd={() => { draggingInside.current = false; }}
        onDrop={onDrop} />
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
