import React, { useEffect, useRef } from 'react';
import { useToast } from '../ui.jsx';
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

export default function RichText({ value, onChange, placeholder }) {
  const ref = useRef(null);
  const savedRange = useRef(null);
  const toast = useToast();

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
        <span className="rt-sep" />
        <button type="button" className="rt-btn rt-btn-text"
          title="Paste clipboard contents without formatting" aria-label="Paste as plain text"
          onMouseDown={noSel} onClick={pastePlain}>
          <Icon name="pasteText" size={15} /> Plain paste
        </button>
      </div>
      <div ref={ref} className="rt-editor rt-content" contentEditable suppressContentEditableWarning
        data-placeholder={placeholder || ''}
        onInput={emit} onKeyUp={saveSelection} onMouseUp={saveSelection}
        onBlur={() => { saveSelection(); emit(); }} onPaste={onPaste} />
    </div>
  );
}
