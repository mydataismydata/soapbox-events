# Event export for the WordPress plugin

Soapbox and the Event RSVP Manager WordPress plugin do the same job. The
plugin stays in place because it builds the event pages on the main website;
Soapbox does the inviting and collects the replies. This document is the
contract between them.

**Where:** an event's page → **Export for WordPress**. Downloads
`soapbox-<event-slug>-<date>.json`.

**What it is:** a complete snapshot of one event — its details, its invitation
email, every guest with their current reply, and a picture of the flyer.
It is not a diff. Exporting the same event a week later produces the same
shape with fresher replies, which is what makes one importer able to both
create an event and, later, sync the responses into it.

## Why the translation happens here

The two systems model the same things differently. Every conversion is done
in [`server/lib/wpExport.js`](../server/lib/wpExport.js), so when a field
stops lining up there is one file to look in:

| Soapbox | WordPress | In the document |
| --- | --- | --- |
| one `name` per contact | `first_name` + `last_name`, both NOT NULL | all three; split on the last space |
| `party_size` includes the invitee | `guest_count` is extras only | `party_size` **and** `extra_guests` |
| absolute `rsvp_deadline` | offset in days from the event | `rsvp_deadline` **and** `rsvp_deadline_offset_days` |
| `response` is `yes` / `no` / null | `accepted` / `declined` / `pending` | WordPress's vocabulary |
| flyer is rendered HTML | an image in the Media Library | a JPEG, base64 in `flyer_image` |

## Shape

```jsonc
{
  "format": "soapbox-event-export",   // check this before parsing
  "version": 1,
  "exported_at": "2026-07-31T14:02:11.000Z",

  "source": {
    "app": "Soapbox",
    "base_url": "https://invites.example.org",
    "org_slug": "demo",               // with soapbox_id, the identity to match on re-import
    "org_name": "Riverside Community Club"
  },

  "event": {
    "soapbox_id": 3,                  // stable; use with org_slug as the match key
    "slug": "q9fgz2frpt",
    "title": "Autumn Gala Dinner",
    "description": "Save the date — details coming soon.",
    "host_name": "The Events Committee",
    "status": "published",            // draft | published | cancelled
    "date": "2026-10-19",             // may be "" on a draft
    "start_time": "18:30",            // 24h, may be ""
    "end_time": "",
    "timezone": null,                 // Soapbox keeps wall-clock time; use the WordPress site zone
    "timezone_note": "",              // free text the host typed, e.g. "doors at 6"
    "venue": { "name": "Grand Hall", "address": "", "phone": "", "map_url": "" },
    "capacity": 0,                    // 0 = uncapped
    "rsvp_mode": "rsvp",              // rsvp | open
    "allow_plus_ones": true,
    "max_party_size": 5,              // includes the invitee
    "max_extra_guests": 4,            // excludes them — WordPress's number
    "rsvp_deadline": "",
    "rsvp_deadline_offset_days": null,// whole days before the event, or null
    "show_guest_list": false,
    "public_url": "https://invites.example.org/o/demo/e/q9fgz2frpt",
    "email": {
      "subject": "You're invited: {{event_title}}",
      "body": "Hi {{first_name}}, …",
      "placeholder_syntax": "soapbox" // {{tag}}; NOT translated — the importer decides
    },
    "flyer_style": "blue"
  },

  "flyer_image": {                    // null when no picture could be produced
    "filename": "flyer.jpg",
    "content_type": "image/jpeg",
    "bytes": 119251,
    "data_base64": "…",               // the whole file; sideload this
    "url": "https://…/o/demo/files/<token>"  // "" when freshly rendered
  },

  "guests": [
    {
      "name": "Elena Rossi",
      "first_name": "Elena",
      "last_name": "Rossi",
      "email": "elena@example.com",   // may be "" — see below
      "phone": "555-0104",
      "response": "accepted",         // accepted | declined | pending
      "party_size": 2,                // Soapbox: includes Elena
      "extra_guests": 1,              // WordPress: excludes her; 0 unless accepted
      "responded_at": "2026-07-26 18:04:11",
      "note": "",                     // free text the guest left with their reply
      "groups": ["Choir"],
      "unsubscribed": false,
      "invited_via": "email",         // email | link | manual
      "email_status": "sent"          // not_sent | queued | sent | failed
    }
  ],

  "counts": {
    "guests": 5, "accepted": 1, "declined": 0, "pending": 4,
    "seats": 2,                       // accepted parties only, invitees included
    "without_email": 0                // guests WordPress cannot store
  }
}
```

## Things the importer has to decide

- **Guests without an email.** Soapbox allows a phone-only contact; the
  WordPress invitee table keys on email. `counts.without_email` says how many
  are in the file so the import can report them rather than fail.
- **Placeholders are not translated.** `{{event_title}}` and friends are
  Soapbox's spelling. Translating them belongs to whichever system owns the
  template language.
- **The flyer may be absent.** `flyer_image` is null if the browser could not
  rasterize the flyer and no picture was stored. Import the rest.
- **Timezone.** Soapbox stores wall-clock time with no zone, on purpose: an
  event happens at 6:30pm at the venue. `timezone` is always null; the
  importer should supply the WordPress site's zone.

## Sending, once both systems hold the same event

Only one system should send. The plugin's per-event **sandbox mode** renders
and logs email without delivering it, which is exactly the state an imported
event wants: the WordPress side keeps a full record of what would have gone
out while Soapbox does the actual sending.
