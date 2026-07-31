import React from 'react';
import { useFlyerSnapshot } from './useFlyerSnapshot.js';

// "Include flyer in email" lives with the email, not with the flyer design —
// it decides what the invitation contains, not what the flyer looks like.
//
// It owns the snapshot hook while step 3 is on screen, the way the designer
// used to; the wizard's FlyerSnapshotKeeper takes over on every other step so
// a change of date or venue still re-renders the picture.
export default function FlyerEmailOption({ eventBasics, flyer, onChange }) {
  const snapshot = useFlyerSnapshot({ eventBasics, flyer, onChange });

  const note = snapshot === 'working'
    ? <em>Preparing the picture…</em>
    : snapshot === 'error'
      ? <em>The picture could not be prepared, so the email will go out without it.</em>
      : flyer.flyerImageToken ? <em>Ready — it matches the flyer below.</em> : null;

  return (
    <label className="checkbox">
      <input type="checkbox" checked={!!flyer.includeFlyerImage}
        onChange={(e) => onChange({ ...flyer, includeFlyerImage: e.target.checked })} />
      <span><span className="cb-label">Include flyer in email</span>
        <div className="cb-sub">
          Adds a picture of the flyer to the invitation, below the Accept / Decline buttons.
          Otherwise the email is just your message.
          {flyer.includeFlyerImage ? <> {note}</> : null}
        </div></span>
    </label>
  );
}
