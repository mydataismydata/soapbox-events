import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, useToast, Icon } from '../ui.jsx';

// The venue block used inside the event wizard: pick a saved venue to fill the
// fields, edit freely for a one-off, or save what you've typed to the venue
// library without leaving the wizard. `value` holds the event's four venue
// fields; `onChange` patches them on the event.
export default function VenuePicker({ value, onChange }) {
  const [venues, setVenues] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    try { setVenues((await api.get('/api/venues')).venues); } catch { /* non-fatal */ }
  }
  useEffect(() => { load(); }, []);

  function pick(id) {
    setSelectedId(id);
    const venue = venues.find((x) => String(x.id) === String(id));
    if (venue) {
      onChange({
        venue_name: venue.name || '', venue_address: venue.address || '',
        venue_phone: venue.phone || '', venue_map_url: venue.map_url || '',
      });
    }
  }

  // A manual edit means the fields no longer necessarily match a saved venue.
  function edit(patch) {
    setSelectedId('');
    onChange(patch);
  }

  const trimmedName = (value.venue_name || '').trim();
  const alreadySaved = venues.some((v) => v.name.toLowerCase() === trimmedName.toLowerCase());

  async function saveToLibrary() {
    if (!trimmedName) { toast('Add a venue name first', 'bad'); return; }
    setSaving(true);
    try {
      const { venue } = await api.post('/api/venues', {
        name: value.venue_name, address: value.venue_address,
        phone: value.venue_phone, map_url: value.venue_map_url,
      });
      await load();
      setSelectedId(String(venue.id));
      toast(`Saved “${venue.name}” to your venues`);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {venues.length > 0 ? (
        <Field label="Venue" hint="Pick a saved venue to fill the details below, or type a one-off.">
          <select value={selectedId} onChange={(e) => pick(e.target.value)}>
            <option value="">— Choose a saved venue —</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      ) : null}

      <div className="field-row">
        <Field label="Venue name">
          <input value={value.venue_name} maxLength={200} placeholder="Riverside Hall"
            onChange={(e) => edit({ venue_name: e.target.value })} />
        </Field>
        <Field label="Venue address">
          <input value={value.venue_address} maxLength={400} placeholder="12 River Rd, Springfield"
            onChange={(e) => edit({ venue_address: e.target.value })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Venue phone">
          <input value={value.venue_phone} maxLength={50} placeholder="(555) 123-4567"
            onChange={(e) => edit({ venue_phone: e.target.value })} />
        </Field>
        <Field label="Map link" hint="A Google Maps / directions URL — shown to guests as “Get directions.”">
          <input value={value.venue_map_url} maxLength={2000} placeholder="https://maps.google.com/…"
            onChange={(e) => edit({ venue_map_url: e.target.value })} />
        </Field>
      </div>

      {trimmedName && !alreadySaved ? (
        <button type="button" className="btn btn-sm" onClick={saveToLibrary} disabled={saving}>
          <Icon name="plus" size={14} />
          {saving ? 'Saving…' : 'Save these details as a reusable venue'}
        </button>
      ) : null}
    </div>
  );
}
