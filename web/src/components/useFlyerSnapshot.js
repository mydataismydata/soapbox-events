// Keeps the picture-of-the-flyer that "Include flyer in email" sends in step
// with the design. The flyer shows the event's own title, date and venue, so a
// change on any wizard step can make the picture stale — which is why this
// lives in a hook the wizard can keep mounted, not just in the designer.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { flyerToJpeg } from './flyerSnapshot.js';

// How long to sit still before re-rendering, so typing doesn't fire off a
// capture per keystroke.
const SETTLE_MS = 900;

export function useFlyerSnapshot({ eventBasics, flyer, mode = 'event', onChange }) {
  const [status, setStatus] = useState(''); // '' | 'working' | 'error'

  // The token is left out of the signature: writing it back is the last step,
  // and including it would start the whole thing over again.
  const key = mode === 'event' && flyer?.includeFlyerImage
    ? JSON.stringify([eventBasics, { ...flyer, flyerImageToken: '' }])
    : '';

  useEffect(() => {
    if (!key) { setStatus(''); return undefined; }
    let cancelled = false;
    setStatus('working');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/flyer/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'sjc-vite' },
          credentials: 'same-origin',
          body: JSON.stringify({ event: eventBasics, flyer, mode, snapshot: true }),
        });
        if (!res.ok) throw new Error('The flyer could not be rendered.');
        const jpeg = await flyerToJpeg(await res.text());
        if (cancelled) return;
        const up = await api.post('/api/uploads', {
          name: 'flyer.jpg', data: jpeg, replace: flyer.flyerImageToken || '',
        });
        if (cancelled) return;
        onChange({ ...flyer, flyerImageToken: up.token });
        setStatus('');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }, SETTLE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key]);

  return status;
}

// Renders nothing — it exists so the wizard can keep the snapshot current
// while the flyer designer itself is off-screen on another step.
export default function FlyerSnapshotKeeper(props) {
  useFlyerSnapshot(props);
  return null;
}
