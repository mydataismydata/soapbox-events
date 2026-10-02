// The flyer the host edits in place.
//
// The server draws the flyer with the same renderer as the event page and the
// email picture, in its edit mode, which marks every typed line and picture
// with data-slot and draws an empty line as a faint placeholder. This lays that
// drawing out in a frame, measures the marks, and puts its own buttons over
// them: a pencil beside each line, add and remove buttons on the pictures, and
// the background's buttons on the photo templates. A pencil (or a click on the
// line) turns the line into a text box right there on the flyer, in the
// flyer's own type. Enter or the ⏎ button keeps the text, and Esc puts the
// line back.
//
// Preview swaps in a second frame, drawn with no marks at all. For an event
// that is the picture the invitation email carries, laid out at that picture's
// own width and shrunk to fit. For a broadcast it is the web version's masthead.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';

// The lines typed on the flyer: what each is called in a button's label, and
// the longest it may run (the same limits the server trims to).
const LINES = {
  eyebrow: { name: 'eyebrow line', max: 60 },
  tagline: { name: 'tagline', max: 140 },
  note: { name: 'footnote', max: 200 },
  contact: { name: 'contact line', max: 120 },
  caption: { name: 'caption', max: 160 },
};
const lineOf = (key) => LINES[String(key || '').split(':')[0]] || null;
const ORDINAL = ['first', 'second', 'third'];

// What a line is called in its buttons' labels. Captions say which picture
// they belong to, so three pencils don't all read "the caption", and each of
// the Panel template's footnote points (note:0, note:1, …) is a bullet.
function nameOf(key, pictures) {
  const [field, at] = String(key).split(':');
  if (field === 'note' && at !== undefined) return `${ORDINAL[Number(at)]} bullet`;
  if (field !== 'caption' || pictures < 2) return LINES[field].name;
  return `caption for the ${ORDINAL[Number(at)]} picture`;
}

// The longest a line may run. A Panel bullet is one of up to three points
// that share the footnote's 200 characters.
function maxOf(key) {
  return String(key).startsWith('note:') ? 64 : lineOf(key).max;
}

// A picture drawn with object-fit: contain fills its box only along one side.
// Its buttons belong on the picture, so measure the part the picture covers.
function pictureBox(el) {
  const r = el.getBoundingClientRect();
  if (el.tagName !== 'IMG' || !el.naturalWidth || !el.naturalHeight) return r;
  if (el.ownerDocument.defaultView.getComputedStyle(el).objectFit !== 'contain') return r;
  const k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
  const width = el.naturalWidth * k;
  const height = el.naturalHeight * k;
  return { left: r.left + (r.width - width) / 2, top: r.top + (r.height - height) / 2, width, height };
}

// Button sizes, in px: a pencil, ⏎ or arrow; an add-picture button; the X on
// a picture.
const TOOL = 26;
const ADD = 34;
const REMOVE = 24;

// Both frames start on this empty page and never reload. Each new drawing is
// written into the page instead, which swaps the flyer without the blank flash
// of a reload and keeps the listeners on it.
const BLANK = '<!doctype html><html><head></head><body></body></html>';

function paint(frame, html) {
  const doc = frame?.contentDocument;
  if (!doc?.body || !html) return false;
  const next = new DOMParser().parseFromString(html, 'text/html');
  doc.head.innerHTML = next.head.innerHTML;
  doc.body.innerHTML = next.body.innerHTML;
  return true;
}

async function draw(body) {
  const res = await fetch('/api/flyer/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'sjc-vite' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('The flyer could not be drawn.');
  return res.text();
}

// A frame is ready once its own empty page has loaded. Anything written into it
// before then is thrown away with the page it replaces.
function isReady(frame) {
  const doc = frame?.contentDocument;
  return Boolean(doc?.body && doc.URL === 'about:srcdoc' && doc.readyState === 'complete');
}

// Where a button goes beside a line: just past the end of its text, or under
// that end when the text runs to the flyer's edge.
function beside(r, card, size) {
  let left = r.x + r.w + 6;
  let top = r.y + r.h / 2 - size / 2;
  const most = card.x + card.w - size - 4;
  if (left > most) {
    left = most;
    top = r.y + r.h + 2;
  }
  return { left: Math.round(left), top: Math.round(top) };
}

// Where the next picture's add button goes: to the right of the last picture,
// pulled in over its edge when the margin has no room for it.
function rightOf(r, card, size) {
  const left = Math.min(r.x + r.w + 10, card.x + card.w - size - 6);
  return { left: Math.round(left), top: Math.round(r.y + r.h / 2 - size / 2) };
}

export default function FlyerStage({
  body, previewing, snapshotWidth = 0, model,
  onLine, onAddPicture, onRemovePicture, onAddBackground, onRemoveBackground, onTopHalf,
}) {
  const editFrame = useRef(null);
  const previewFrame = useRef(null);
  const stageRef = useRef(null);
  const [height, setHeight] = useState(0);
  const [marks, setMarks] = useState(null);
  const [typing, setTyping] = useState(null);
  const [pending, setPending] = useState(true);
  const [shown, setShown] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(0);
  const [stageWidth, setStageWidth] = useState(0);
  const cur = useRef(null); // the line being typed in
  const held = useRef(''); // a drawing that arrived while a line was open
  const waiting = useRef({ edit: '', preview: '' }); // drawings that beat their frame's page
  const seq = useRef({ edit: 0, preview: 0 });
  const toolEls = useRef({});
  const on = useRef({});
  const key = JSON.stringify(body);

  // Read where every mark sits in the editing frame. Coordinates are in the
  // stage's own px: the frame's content box starts just inside its border.
  function measure() {
    const frame = editFrame.current;
    const doc = frame?.contentDocument;
    const card = doc?.body?.firstElementChild;
    if (!card || !frame.offsetWidth) return;
    const border = Math.max(0, frame.offsetHeight - frame.clientHeight);
    const h = Math.ceil(doc.body.getBoundingClientRect().height);
    if (h > 0) setHeight(h + border);
    const ox = frame.clientLeft;
    const oy = frame.clientTop;
    const box = (r) => ({ x: r.left + ox, y: r.top + oy, w: r.width, h: r.height });
    const slots = [...doc.querySelectorAll('[data-slot]')].map((el) => {
      const s = { key: el.getAttribute('data-slot'), box: box(pictureBox(el)), ghost: el.hasAttribute('data-ghost') };
      if (lineOf(s.key)) {
        // The end of the text itself, not of its box: a centred line's box
        // runs the width of the flyer.
        const range = doc.createRange();
        range.selectNodeContents(el);
        const lines = [...range.getClientRects()].filter((r) => r.width > 0.5);
        s.end = lines.length ? box(lines[lines.length - 1]) : s.box;
      }
      return s;
    });
    setMarks({ card: box(card.getBoundingClientRect()), slots });
  }

  function measurePreview() {
    const frame = previewFrame.current;
    const doc = frame?.contentDocument;
    if (!doc?.body || !frame.offsetWidth) return;
    const h = Math.ceil(doc.body.getBoundingClientRect().height);
    if (h > 0) setPreviewHeight(h);
  }

  function showEdit(html) {
    if (cur.current) { held.current = html; return; }
    if (!isReady(editFrame.current)) { waiting.current.edit = html; return; }
    paint(editFrame.current, html);
    measure();
  }

  function showPreview(html) {
    if (!isReady(previewFrame.current)) { waiting.current.preview = html; return; }
    paint(previewFrame.current, html);
    setShown(true);
    measurePreview();
  }

  function focusTool(id) {
    toolEls.current[id]?.focus();
  }

  // Turn a line into a text box where it sits. An empty line loses its
  // placeholder, so typing starts from nothing.
  function startTyping(slotKey) {
    if (previewing) return;
    if (cur.current) {
      if (cur.current.key === slotKey) return;
      finishTyping(true);
    }
    const doc = editFrame.current?.contentDocument;
    const el = doc?.querySelector(`[data-slot="${slotKey}"]`);
    const line = lineOf(slotKey);
    if (!el || !line) return;
    const ghost = el.hasAttribute('data-ghost');
    cur.current = { key: slotKey, el, html: el.innerHTML, ghost, value: ghost ? '' : el.textContent, max: maxOf(slotKey) };
    if (ghost) {
      el.removeAttribute('data-ghost');
      el.textContent = '';
    }
    // plaintext-only keeps pasted styling out. A browser without it falls
    // back to an ordinary editable box, and the text is read as plain anyway.
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-editing', '');
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', `Flyer ${nameOf(slotKey, doc.querySelectorAll('[data-slot^="image:"]').length)}`);
    el.setAttribute('spellcheck', 'true');
    el.focus({ preventScroll: true });
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    setTyping(slotKey);
    measure();
  }

  // Close the open line. `keep` hands a changed value up; otherwise the line
  // goes back to exactly what was drawn there.
  function finishTyping(keep) {
    const t = cur.current;
    if (!t) return;
    cur.current = null;
    const { el } = t;
    const value = el.textContent.replace(/\s+/g, ' ').trim().slice(0, t.max);
    ['contenteditable', 'data-editing', 'role', 'aria-label', 'spellcheck'].forEach((a) => el.removeAttribute(a));
    const changed = keep && value !== t.value;
    if (!changed) {
      el.innerHTML = t.html;
      if (t.ghost) el.setAttribute('data-ghost', '');
    }
    el.ownerDocument.getSelection()?.removeAllRanges();
    if (el.ownerDocument.activeElement === el) el.blur();
    setTyping(null);
    if (changed) {
      // Any drawing held back is older than this change; a new one follows.
      held.current = '';
      onLine(t.key, value);
    } else if (held.current) {
      paint(editFrame.current, held.current);
      held.current = '';
    }
    measure();
  }

  // The frame's listeners are bound once and call through here, so they always
  // see this render's state and props.
  on.current = {
    measure,
    measurePreview,
    keydown(e) {
      const t = cur.current;
      if (!t || e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finishTyping(true);
        focusTool(t.key);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finishTyping(false);
        focusTool(t.key);
      }
    },
    beforeinput(e) {
      const t = cur.current;
      if (!t) return;
      // A phone keyboard's return key arrives as a new paragraph, not as Enter.
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        e.preventDefault();
        finishTyping(true);
        focusTool(t.key);
        return;
      }
      if (!e.inputType.startsWith('insert')) return;
      const added = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
      const sel = t.el.ownerDocument.getSelection();
      const replaced = sel && !sel.isCollapsed ? sel.toString().length : 0;
      if (t.el.textContent.length - replaced + added.length > t.max) e.preventDefault();
    },
    paste(e) {
      const t = cur.current;
      if (!t) return;
      e.preventDefault();
      const doc = t.el.ownerDocument;
      const sel = doc.getSelection();
      const replaced = sel && !sel.isCollapsed ? sel.toString().length : 0;
      const room = t.max - (t.el.textContent.length - replaced);
      const text = (e.clipboardData?.getData('text/plain') || '').replace(/\s+/g, ' ').slice(0, Math.max(0, room));
      if (text) doc.execCommand('insertText', false, text);
    },
    input() { measure(); },
    focusout(e) {
      if (cur.current && e.target === cur.current.el) finishTyping(true);
    },
    click(e) {
      const slotKey = e.target?.closest?.('[data-slot]')?.getAttribute('data-slot');
      if (slotKey && lineOf(slotKey)) startTyping(slotKey);
    },
    blur() { finishTyping(true); },
  };

  // The editing frame: bind the listeners once its page has loaded.
  useLayoutEffect(() => {
    const frame = editFrame.current;
    let detach = null;
    function attach() {
      if (detach || !isReady(frame)) return;
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      const call = (name) => (e) => on.current[name](e);
      const stop = (e) => e.preventDefault();
      const listeners = ['keydown', 'beforeinput', 'paste', 'input', 'focusout', 'click']
        .map((type) => [type, call(type)])
        .concat([['dragstart', stop], ['drop', stop]]);
      listeners.forEach(([type, fn]) => doc.addEventListener(type, fn));
      const remeasure = () => on.current.measure();
      doc.addEventListener('load', remeasure, true); // a picture finished loading
      const blur = () => on.current.blur();
      win.addEventListener('blur', blur);
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
      ro?.observe(doc.body);
      detach = () => {
        listeners.forEach(([type, fn]) => doc.removeEventListener(type, fn));
        doc.removeEventListener('load', remeasure, true);
        win.removeEventListener('blur', blur);
        ro?.disconnect();
      };
      const html = waiting.current.edit;
      waiting.current.edit = '';
      if (html) {
        paint(frame, html);
        remeasure();
      }
    }
    attach();
    frame.addEventListener('load', attach);
    return () => {
      frame.removeEventListener('load', attach);
      detach?.();
    };
  }, []);

  // The preview frame only needs its height kept.
  useLayoutEffect(() => {
    const frame = previewFrame.current;
    let detach = null;
    function attach() {
      if (detach || !isReady(frame)) return;
      const doc = frame.contentDocument;
      const remeasure = () => on.current.measurePreview();
      doc.addEventListener('load', remeasure, true);
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
      ro?.observe(doc.body);
      detach = () => {
        doc.removeEventListener('load', remeasure, true);
        ro?.disconnect();
      };
      const html = waiting.current.preview;
      waiting.current.preview = '';
      if (html) {
        paint(frame, html);
        setShown(true);
        remeasure();
      }
    }
    attach();
    frame.addEventListener('load', attach);
    return () => {
      frame.removeEventListener('load', attach);
      detach?.();
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setStageWidth(el.clientWidth));
    ro.observe(el);
    setStageWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Redraw the editing view whenever anything drawn changes.
  useEffect(() => {
    const n = ++seq.current.edit;
    setPending(true);
    const timer = setTimeout(async () => {
      try {
        const html = await draw({ ...body, edit: true });
        if (n === seq.current.edit) showEdit(html);
      } catch { /* the last drawing stays up */ }
      if (n === seq.current.edit) setPending(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [key]);

  // The preview is only drawn while it is on.
  useEffect(() => {
    if (!previewing) return undefined;
    const n = ++seq.current.preview;
    const timer = setTimeout(async () => {
      try {
        const html = await draw({ ...body, snapshot: Boolean(snapshotWidth) });
        if (n === seq.current.preview) showPreview(html);
      } catch { /* the editing view stays up */ }
    }, 40);
    return () => clearTimeout(timer);
  }, [key, previewing, snapshotWidth]);

  useEffect(() => {
    if (previewing) finishTyping(true);
    else setShown(false);
  }, [previewing]);

  useLayoutEffect(() => { if (!previewing) measure(); }, [previewing]);
  useLayoutEffect(() => { if (shown) measurePreview(); }, [shown]);

  // --- the buttons drawn over the flyer -------------------------------------

  const tools = [];
  if (marks?.card && !previewing) {
    const { card, slots } = marks;
    const find = (k) => slots.find((s) => s.key === k);
    const pics = slots.filter((s) => /^image:\d+$/.test(s.key))
      .sort((a, b) => Number(a.key.slice(6)) - Number(b.key.slice(6)));

    for (const s of slots) {
      if (!lineOf(s.key)) continue;
      const name = nameOf(s.key, pics.length);
      const at = beside(s.end || s.box, card, TOOL);
      if (typing === s.key) {
        tools.push({
          id: s.key, kind: 'accept', icon: 'enter', label: `Keep the ${name} (Enter)`, ...at,
          press: () => { finishTyping(true); focusTool(s.key); },
        });
      } else {
        tools.push({
          id: s.key, kind: 'pencil', icon: 'pencil', label: `${s.ghost ? 'Add' : 'Change'} the ${name}`, ...at,
          press: () => startTyping(s.key),
        });
      }
    }

    // Pictures: an X on each, and an add button for the next one, which sits on
    // the faint tile when there are none yet and beside the last one after.
    pics.forEach((p, i) => tools.push({
      id: `remove:${i}`, kind: 'remove', icon: 'x',
      label: model.maxPictures === 1 ? 'Remove the picture' : `Remove the ${ORDINAL[i]} picture`,
      left: Math.round(p.box.x + 6), top: Math.round(p.box.y + 6), stale: pending,
      press: () => onRemovePicture(i),
    }));
    if (pics.length < model.maxPictures) {
      const tile = find('image-add');
      const label = pics.length ? `Add a ${ORDINAL[pics.length]} picture` : 'Add a picture';
      const add = { id: 'add', kind: 'add', icon: 'imagePlus', label, busy: model.uploading === 'picture', stale: pending, press: onAddPicture };
      if (tile) {
        tools.push({ ...add, left: Math.round(tile.box.x + tile.box.w / 2 - ADD / 2), top: Math.round(tile.box.y + tile.box.h / 2 - ADD / 2) });
      } else if (pics.length) {
        tools.push({ ...add, ...rightOf(pics[pics.length - 1].box, card, ADD) });
      }
    }

    // The photo templates' background: add or remove it from the flyer's
    // top-left corner, and fold it into the top half or spread it back out.
    const bg = find('bg');
    if (bg && model.takesBackground) {
      const corner = { left: Math.round(bg.box.x + 10), top: Math.round(bg.box.y + 10) };
      if (!model.background) {
        tools.push({
          id: 'bg', kind: 'add', icon: 'image', label: 'Add a background picture', ...corner,
          busy: model.uploading === 'background', stale: pending, press: onAddBackground,
        });
      } else {
        tools.push({ id: 'bg', kind: 'remove', icon: 'x', label: 'Remove the background picture', ...corner, stale: pending, press: onRemoveBackground });
        const photo = find('bg-photo');
        if (model.topHalf) {
          // On the line where the shrunk picture ends.
          const y = photo ? photo.box.y + photo.box.h - TOOL / 2 : bg.box.y + bg.box.h / 2;
          tools.push({
            id: 'bg-size', kind: 'pencil', icon: 'arrowDown', label: 'Spread the background over the whole flyer',
            left: corner.left, top: Math.round(y), stale: pending, press: () => onTopHalf(false),
          });
        } else {
          tools.push({
            id: 'bg-size', kind: 'pencil', icon: 'arrowUp', label: 'Fit the background into the top half',
            left: corner.left, top: Math.round(bg.box.y + bg.box.h - TOOL - 10), stale: pending, press: () => onTopHalf(true),
          });
        }
      }
    }
    // Tab through the buttons in reading order.
    tools.sort((a, b) => (a.top - b.top) || (a.left - b.left));
  }

  const showing = previewing && shown;
  const scale = snapshotWidth && stageWidth ? Math.min(1, (stageWidth - 24) / snapshotWidth) : 1;

  return (
    <div className="flyer-stage" ref={stageRef}>
      <iframe ref={editFrame} className="preview-frame" title="Flyer" srcDoc={BLANK} scrolling="no"
        style={{ height: height || undefined, display: showing ? 'none' : 'block' }} />
      {previewing ? null : (
        <div className="flyer-tools">
          {tools.map((t) => (
            <button key={t.id} type="button" className={`flyer-tool ${t.kind}`}
              ref={(el) => { if (el) toolEls.current[t.id] = el; else delete toolEls.current[t.id]; }}
              style={{ left: t.left, top: t.top }} aria-label={t.label} title={t.label}
              disabled={Boolean(t.busy || t.stale)}
              // Keep the focus where it is: a press on ⏎ must not first close
              // the open line by pulling the focus out of the flyer.
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.press}>
              {t.busy
                ? <span className="flyer-tool-spin" aria-hidden="true" />
                : <Icon name={t.icon} size={t.kind === 'add' ? 18 : 14} strokeWidth={t.kind === 'remove' ? 2.4 : 2} />}
            </button>
          ))}
        </div>
      )}
      <div className="flyer-preview" style={{
        display: showing ? 'block' : 'none',
        height: snapshotWidth ? Math.ceil(previewHeight * scale) + 44 : previewHeight + 2,
      }}>
        <iframe ref={previewFrame} title="Flyer preview" srcDoc={BLANK} scrolling="no" tabIndex={-1}
          className={snapshotWidth ? 'snap' : ''}
          style={snapshotWidth
            ? {
              width: snapshotWidth, height: previewHeight, transform: `scale(${scale})`,
              left: Math.max(12, Math.round((stageWidth - snapshotWidth * scale) / 2)), top: 22,
            }
            : { width: '100%', height: previewHeight }} />
      </div>
    </div>
  );
}
