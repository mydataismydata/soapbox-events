// A small moving picture of one of Soapbox's screens, for the Help panel.
//
// The screen is drawn with the app's own styles, so it stays sharp at any
// size and changes along with the real thing. A script of steps moves a
// pointer to named parts of the picture, presses them, changes what the
// picture shows, and puts a caption right beside the action. The picture
// plays while it is on screen and loops. Anyone who has asked for less motion
// sees the end of the story, standing still.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// How long the pointer takes to reach its target, and how long a press holds.
// A step's `set` lands with the press, so a click changes the screen the
// moment it happens.
const MOVE = 600;
const PRESS = 200;

// Steps that type `text` into one key of the scene's state, a letter at a
// time, after whatever `before` already holds.
export function typing(at, key, text, every = 55, before = '') {
  return [...text].map((_, i) => ({
    at: at + i * every,
    set: { [key]: before + [...text].slice(0, i + 1).join('') },
  }));
}

// One step of a scene's script. `at` is when it starts, in ms from the start
// of the loop.
//   tap    move the pointer to this part and press it; `set` lands with the press
//   point  move the pointer to this part without pressing
//   say    a caption beside the part; null takes the caption away
//   near   the part the caption sits beside, when it is not the pointer's
//   side   where the caption sits: below (the default), above, left or right
//   set    change what the scene shows
//   hide   take the pointer away
// A part is named by its data-t attribute, or by a CSS selector starting
// with [ . or #.
export default function Scene({ width, height, label, start, steps, length, children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const noteRef = useRef(null);
  const [s, setS] = useState(start);
  const [ptr, setPtr] = useState({ x: 0, y: 0, on: false, down: false, jump: false });
  const [note, setNote] = useState(null);
  const [notePos, setNotePos] = useState(null);
  const [fading, setFading] = useState(false);
  const [scale, setScale] = useState(1);

  // The picture is drawn at its full size and shrunk as a whole to fit, so it
  // keeps its layout on a phone. The frame's 1px border sits outside it.
  useLayoutEffect(() => {
    const el = outerRef.current;
    const fit = () => setScale(Math.min(1, (el.clientWidth || width) / width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  useEffect(() => {
    const inner = innerRef.current;
    // Nothing in the picture can be clicked, focused or read out; the frame's
    // label describes it instead.
    inner.inert = true;
    let timers = [];
    const later = (ms, fn) => { timers.push(setTimeout(fn, ms)); };

    const find = (name) => inner.querySelector(/^[[.#]/.test(name) ? name : `[data-t="${name}"]`);

    // Where a part sits, in the picture's own unscaled pixels.
    function boxOf(name) {
      const el = name ? find(name) : null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const b = inner.getBoundingClientRect();
      const k = b.width / width || 1;
      return { x: (r.left - b.left) / k, y: (r.top - b.top) / k, w: r.width / k, h: r.height / k };
    }

    function reset() {
      for (const t of timers) clearTimeout(t);
      timers = [];
      setS(start);
      setPtr((p) => ({ ...p, on: false, down: false }));
      setNote(null);
    }

    // A step can name a part that the step before it has only just asked
    // for, such as a button in a dialog that is still opening. A slow
    // computer, or a browser saving effort on a tab in the background, may
    // not have drawn it yet, so the step waits a moment and looks again. A
    // part that never turns up is a broken script, and it says so.
    function play(step, tries = 0) {
      const target = step.tap ?? step.point;
      const missing = [target, step.say ? step.near ?? target : null].find((name) => name && !find(name));
      if (missing) {
        if (tries < 10) {
          later(50, () => play(step, tries + 1));
          return;
        }
        console.warn(`Help scene "${label}": nothing named ${missing}`);
      }
      if (step.hide) setPtr((p) => ({ ...p, on: false }));
      if (target) {
        const b = boxOf(target);
        if (b) {
          // A pointer that was hidden appears where it is going, rather than
          // sliding in from wherever it last was.
          setPtr((p) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, on: true, down: false, jump: !p.on }));
          later(40, () => setPtr((p) => ({ ...p, jump: false })));
        }
      }
      if (step.say !== undefined) {
        const b = boxOf(step.near ?? target);
        setNote(step.say && b ? { text: step.say, box: b, side: step.side ?? 'below' } : null);
      }
      if (step.tap) {
        later(MOVE, () => {
          setPtr((p) => ({ ...p, down: true }));
          if (step.set) setS((cur) => ({ ...cur, ...step.set }));
          later(PRESS, () => setPtr((p) => ({ ...p, down: false })));
        });
      } else if (step.set) {
        setS((cur) => ({ ...cur, ...step.set }));
      }
    }

    function run() {
      reset();
      setFading(false);
      for (const step of steps) later(step.at, () => play(step));
      later(length - 400, () => setFading(true));
      later(length, run);
    }

    // The finished picture, for anyone who asked for less motion.
    function still() {
      reset();
      setFading(false);
      setS(steps.reduce((acc, step) => (step.set ? { ...acc, ...step.set } : acc), start));
    }

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let seen = false;
    let playing = false;
    const decide = () => {
      if (calm.matches) {
        playing = false;
        still();
      } else if (seen && !playing) {
        playing = true;
        run();
      } else if (!seen && playing) {
        playing = false;
        reset();
      }
    };
    const io = new IntersectionObserver(([e]) => {
      seen = e.isIntersecting;
      decide();
    });
    io.observe(outerRef.current);
    calm.addEventListener('change', decide);
    decide();
    return () => {
      io.disconnect();
      calm.removeEventListener('change', decide);
      for (const t of timers) clearTimeout(t);
    };
  }, [start, steps, length, width, label]);

  // Keeps the caption inside the picture, on the side its step asked for.
  useLayoutEffect(() => {
    const el = noteRef.current;
    if (!note || !el) { setNotePos(null); return; }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const { box, side } = note;
    const gap = 10;
    let x = box.x + box.w / 2 - w / 2;
    let y = box.y + box.h + gap;
    if (side === 'above') y = box.y - h - gap;
    if (side === 'left') { x = box.x - w - gap; y = box.y + box.h / 2 - h / 2; }
    if (side === 'right') { x = box.x + box.w + gap; y = box.y + box.h / 2 - h / 2; }
    setNotePos({
      x: Math.max(6, Math.min(width - w - 6, x)),
      y: Math.max(6, Math.min(height - h - 6, y)),
    });
  }, [note, width, height]);

  const ptrClass = ['hs-ptr', ptr.on && 'on', ptr.down && 'down', ptr.jump && 'jump'].filter(Boolean).join(' ');
  return (
    <div ref={outerRef} className="hs-scene" role="img" aria-label={label}
      style={{ width: width + 2, height: Math.round(height * scale) + 2 }}>
      <div ref={innerRef} className={`hs-inner${fading ? ' is-fading' : ''}`} aria-hidden="true"
        style={{ width, height, transform: `scale(${scale})` }}>
        {children(s)}
        <span className={ptrClass} style={{ transform: `translate(${ptr.x}px, ${ptr.y}px)` }} />
        {note ? (
          <span ref={noteRef} key={note.text} className="hs-note"
            style={notePos ? { left: notePos.x, top: notePos.y } : { visibility: 'hidden' }}>
            {note.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
