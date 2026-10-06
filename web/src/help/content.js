// What the Help panel says on each page, keyed by the page's route. A section
// may name a scene: a small moving picture of the screen, drawn in
// src/help/scenes under the same name. A section may also be limited to one
// role, so a member is not told about controls only an admin has.
//
// Plain data, so the smoke test can check it without a browser.

const EVENT_WIZARD = {
  title: 'Creating an event',
  intro: 'The wizard has five steps, listed down the left. Continue saves the step you are on and moves to the next. Save & exit keeps everything as a draft to finish later.',
  sections: [
    {
      heading: '1. Event details',
      steps: [
        'Type the title. Guests see it on the flyer and in the email subject.',
        'Pick the date, and the start and end times.',
        'Choose a saved place from the Venue list to fill in its name and address, or type the details of a one-off place.',
        'Add a description if you like. It shows on the event’s public page.',
      ],
      points: [
        'The start and end times come from Settings, under Event defaults, so a regular meeting time only needs setting once.',
        'Save these details as a reusable venue adds a place you typed to your venues.',
      ],
      scene: 'wizard-details',
    },
    {
      heading: '2. RSVP options',
      text: [
        'Collect RSVPs gives every guest Accept and Decline buttons, and you see who is coming. Open event sends the invitation as a notice, with nothing to reply to.',
      ],
      points: [
        'RSVP deadline: replies close after this date.',
        'Capacity: the most people who can come, counting plus-ones. Accepting stops once it is full.',
        'Allow plus-ones: guests say how many people they are bringing, up to the largest party size you set.',
        'Show the guest list: the event page lists the first names of everyone coming.',
        'Shareable link: anyone with the event’s link can reply, not only the people you invited.',
      ],
      scene: 'wizard-rsvp',
    },
    {
      heading: '3. Writing the invitation',
      text: [
        'Start from a template, or write the message yourself. Every invitation ends with the event’s details and the Accept and Decline buttons, so you never add those.',
        'The grey buttons under the message are placeholders. Click one to put it in the message, and it fills in for each guest. Guest first name becomes Fred in Fred P.’s copy.',
      ],
      points: [
        'Include flyer in email adds a picture of the flyer under the buttons.',
        'Preview email shows the message the way a guest will see it.',
      ],
      scene: 'wizard-email',
    },
    {
      heading: '3. Designing the flyer',
      text: [
        'The flyer is the top of the event’s public page. There are six templates. Classic, Dark, Light and Retro are tall, and Spotlight and Panel are wide.',
        'You type every line straight onto the flyer. Click the pencil beside a line and type. Press Enter or the return button to keep it, or Esc to put the line back.',
      ],
      points: [
        'Faint lines such as Tagline and Footnote stand in for lines you have not written yet.',
        'The picture button adds up to three photos to a tall flyer, such as the candidates who are speaking. The X on a photo removes it.',
        'On Dark and Light, the button in the top-left corner adds a background photo. The arrow at the bottom left shrinks it into the top half.',
        'Preview shows the flyer the way the email picture looks, without the pencils and placeholders. Click it again to keep editing.',
        'Reset flyer clears every line and photo, once you confirm.',
      ],
      scene: 'wizard-flyer',
    },
    {
      heading: '4. Guests',
      steps: [
        'Click a group to invite everyone in it.',
        'Untick anyone to leave them out.',
        'Tick more people from the list one at a time.',
        'To invite someone new, click Add a person. They are saved to your contacts as well.',
      ],
      text: [
        'The blue box underneath counts who will be added. Nobody is ever invited twice.',
      ],
      scene: 'wizard-guests',
    },
    {
      heading: '5. Review & send',
      text: ['The last step shows what goes out, when, and to how many people.'],
      steps: [
        'Click Send test email. The test goes to your own address unless you type another.',
        'Click Send invitations.',
        'Click Yes, send.',
      ],
      points: [
        'Sending puts the event page online and emails every guest who has not had an invitation yet.',
        'Publish without sending puts the event page online, and on your website if one is connected, and emails nobody. Use it for a save-the-date. You can send invitations later.',
        'Save draft keeps the event and its guest list, and sends nothing.',
      ],
      scene: 'wizard-send',
    },
  ],
};

const BROADCAST_WIZARD = {
  title: 'Writing a broadcast',
  intro: 'The broadcast wizard has four steps, listed down the left. It saves as you go, and Save & exit keeps a draft.',
  sections: [
    {
      heading: '1. Details',
      text: [
        'The title names the broadcast in your list and heads its web version. The email subject is what people see in their inbox. Leave the subject empty to use the title.',
        'Publish a web version puts a View this email online link in the email. Some mail programs cut off a long email, and the link shows all of it.',
      ],
      scene: 'broadcast-details',
    },
    {
      heading: '2. Message',
      text: [
        'Write the message in the box. The toolbar sets bold, italics, underline, the font and the size, and adds links and pictures.',
        'First name, Full name and Organization under the box are placeholders. Each one fills in for every person the broadcast goes to.',
      ],
      points: [
        'Soapbox adds an unsubscribe link to the end of every broadcast.',
        'Attach a file adds one file of up to 5 MB, such as a PDF. Every email the broadcast sends carries it.',
        'With the web version on, this step also designs the masthead at the top of the web page. You type its lines straight onto it, the same way as an event’s flyer.',
      ],
      scene: 'broadcast-message',
    },
    {
      heading: '3 and 4. Recipients, then send',
      steps: [
        'Click a group, or tick people one at a time.',
        'Click Continue.',
        'Check the number of recipients, and click Send broadcast.',
        'Click Yes, send.',
      ],
      points: [
        'People who have unsubscribed are left out, and the count says how many.',
        'Send test email, on the last step, sends you a copy first.',
      ],
      scene: 'broadcast-send',
    },
  ],
};

export const HELP = {
  '/': {
    title: 'Dashboard',
    intro: 'The dashboard is the first page after you sign in. It shows your next events, the latest replies and how much email you have sent.',
    sections: [
      {
        heading: 'Getting around',
        text: [
          'The tabs along the top are for what you send and who you send it to: Events, Broadcasts, Contacts and Groups.',
          'Your name, at the top right, opens a menu with Venues, Templates, the Email log, Settings and Sign out.',
          'Help, beside it, explains the page you are on.',
        ],
        scene: 'nav',
      },
      {
        heading: 'What the dashboard shows',
        points: [
          'Each of the four numbers along the top opens the page it counts. Email quota left opens the email settings.',
          'Upcoming events lists your next events. Coming counts guests and the people they are bringing, and Waiting counts guests who have not answered.',
          'Recent responses shows the newest replies first, as guests click Accept or Decline.',
          'Broadcasts shows your latest email blasts and whether each has gone out.',
        ],
        scene: 'dashboard',
      },
      {
        heading: 'Signing in and out',
        text: [
          'An administrator creates your account and gives you a temporary password. Sign in with your email address and that password.',
          'Change your password in Settings, under Your account. Sign out is in the menu under your name.',
        ],
      },
    ],
  },

  '/events': {
    title: 'Events',
    intro: 'Events are the meetings and gatherings you invite people to. Each one has a date, a place, a flyer and a guest list.',
    sections: [
      {
        heading: 'Your events',
        text: [
          'Events are split into Upcoming, Drafts, and Past & cancelled. Upcoming lists the soonest first.',
          'Each row counts the people who said yes and no, the ones who have not answered, and everyone invited. Click a row to open the event.',
        ],
        scene: 'events-list',
      },
      {
        heading: 'Starting a new event',
        text: [
          'Click New event. A wizard takes you through five steps: the details, how people reply, the invitation and flyer, the guests, and a last check before sending.',
          'The wizard saves as you go. An event you leave part-way through waits under Drafts.',
        ],
      },
      {
        heading: 'Exporting',
        text: ['Export CSV downloads every event with its reply counts, for a spreadsheet.'],
      },
      {
        heading: 'Bringing in meetings from your website',
        roles: ['admin'],
        text: [
          'Import meetings reads a file made on the chapter’s website, for meetings that are on the website but not here.',
          'Each meeting comes in with its picture and keeps its web address, so the website shows it once. A meeting already here is skipped.',
          'Past meetings are published with their RSVPs closed.',
        ],
      },
    ],
  },

  '/events/new': EVENT_WIZARD,
  '/events/:id/edit': EVENT_WIZARD,

  '/events/:id': {
    title: 'An event',
    intro: 'An event’s page shows who is coming. Everything you send after the invitations starts here too.',
    sections: [
      {
        heading: 'Who is coming',
        text: [
          'The four numbers count the guests invited, attending, declined and still to answer. Attending includes the people guests are bringing.',
          'The Guests tab lists everyone invited, with their invitation and their reply.',
        ],
        points: [
          'Type a name, email or phone number into Filter by guest to find someone.',
          'The list beside it narrows the table to people who accepted, declined, have not replied, or were not emailed.',
          'Click a column heading to sort by it.',
        ],
      },
      {
        heading: 'Replies by phone',
        text: [
          'Someone who answers by phone or in person can be marked by hand. Click ✓ on their row for yes, or ✗ for no.',
          'The envelope on a row sends that one guest their invitation again.',
        ],
        scene: 'event-guests',
      },
      {
        heading: 'Adding guests later',
        steps: [
          'Click Add guests.',
          'Pick a group or people, and click Add to event.',
          'Click the green Send invitations button.',
        ],
        text: [
          'Adding someone does not email them. The green button then invites only the new guests, and nobody already emailed gets a second copy.',
        ],
        scene: 'event-add',
      },
      {
        heading: 'Reminders and updates',
        text: [
          'The Follow-ups & nudges tab has three messages ready to write: a reminder to everyone who has not replied, a note to everyone who accepted, and an update to everyone invited.',
          'Click Compose, change the words if you like, and click Send. A reminder carries the Accept and Decline buttons again.',
        ],
        scene: 'event-nudge',
      },
      {
        heading: 'The email log',
        text: [
          'The Email log tab lists every email sent for this event. View shows the exact email, and a failed one has a retry button.',
        ],
      },
      {
        heading: 'Sharing and changing the event',
        points: [
          'Shareable link: paste it into a newsletter or a text message. People who reply through it join the guest list, marked via link.',
          'View page opens the public event page.',
          'Edit reopens the wizard. Duplicate starts a new draft with the same flyer and settings and an empty guest list.',
          'Cancel event puts a notice on the event page and closes replies. It can email everyone who was invited.',
          'Export to site downloads the event and its replies as a file for the website’s events plugin.',
        ],
      },
    ],
  },

  '/broadcasts': {
    title: 'Broadcasts',
    intro: 'A broadcast is an email to your contacts with nothing to reply to, such as news, endorsements or a notice about a public meeting.',
    sections: [
      {
        heading: 'Your broadcasts',
        text: [
          'Drafts are broadcasts not sent yet. Sent lists the rest, with how many emails went out.',
          'Click a broadcast to see who it went to.',
        ],
        scene: 'broadcasts-list',
      },
      {
        heading: 'Writing one',
        text: [
          'Click New broadcast. The wizard has four steps: the title, the message, the recipients, and a last check before sending.',
        ],
      },
    ],
  },

  '/broadcasts/new': BROADCAST_WIZARD,
  '/broadcasts/:id/edit': BROADCAST_WIZARD,

  '/broadcasts/:id': {
    title: 'A broadcast',
    intro: 'A broadcast’s page shows how its sending went, one row per person.',
    sections: [
      {
        heading: 'Delivery',
        text: [
          'The four numbers count the recipients, and the emails sent, still queued and failed. The Email log below has a row for every recipient.',
          'View on a row shows the email exactly as that person got it. A failed email has a retry button.',
        ],
        scene: 'broadcast-detail',
      },
      {
        heading: 'The buttons at the top',
        points: [
          'Preview shows the message for a sample recipient.',
          'View web version opens the broadcast’s web page. The Web version link card has its address to copy.',
          'Send a copy emails the broadcast to one more address.',
          'Duplicate starts a new draft from this broadcast.',
          'Edit reopens the wizard. Sending it again sends everyone a fresh copy.',
        ],
      },
    ],
  },

  '/contacts': {
    title: 'Contacts',
    intro: 'Contacts is your address book. Every event and broadcast picks its people from here.',
    sections: [
      {
        heading: 'Adding someone',
        steps: [
          'Click Add contact.',
          'Type a first name, and a last name if you have one.',
          'Type their email address.',
          'Click Save.',
        ],
        text: ['A person without an email address can still be invited, but not emailed.'],
        scene: 'contacts-add',
      },
      {
        heading: 'Importing a spreadsheet',
        text: [
          'Import CSV adds many people at once. Choose a CSV file, or copy the rows from a spreadsheet and paste them into the box.',
          'The first row names the columns: first name, last name, email, phone and notes, in any order. A single name column works too.',
          'Anyone whose email address is already in your contacts is skipped, so importing the same file twice adds nobody twice.',
        ],
        scene: 'contacts-import',
      },
      {
        heading: 'Putting people in a group',
        steps: ['Tick the people.', 'Open Bulk actions.', 'Pick the group.'],
        text: ['Bulk actions can also delete everyone ticked.'],
        scene: 'contacts-group',
      },
      {
        heading: 'Other things on this page',
        points: [
          'Search finds people by name, email or phone.',
          'The copy button beside an email address copies it.',
          'The pencil opens a contact to change. Mark unsubscribed, at the bottom of that window, is for someone who asks not to be emailed.',
          'Unsubscribed people are marked in the list, left out of every send, and taken out of their groups.',
          'Export CSV downloads everyone.',
        ],
      },
    ],
  },

  '/groups': {
    title: 'Groups',
    intro: 'A group is a saved list of people, such as the executive team. The event and broadcast wizards invite a whole group with one click.',
    sections: [
      {
        heading: 'Making a group',
        steps: ['Click New group.', 'Type its name.', 'Tick the people in it.', 'Click Save group.'],
        scene: 'groups-new',
      },
      {
        heading: 'Copying a group’s email addresses',
        text: [
          'View members lists everyone in the group, all ticked. Copy emails copies the ticked addresses, separated by commas, ready to paste into your own email program.',
          'Untick someone to leave them out of the copy. Unticking never takes anyone out of the group.',
        ],
        scene: 'groups-copy',
      },
      {
        heading: 'Changing a group',
        text: [
          'Edit members lists the people in the group first, then everyone else. Tick or untick people, then click Save group.',
          'The trash can deletes a group. The people in it stay in your contacts.',
        ],
      },
    ],
  },

  '/venues': {
    title: 'Venues',
    intro: 'Venues are the places you meet. Save a place once and pick it for any event.',
    sections: [
      {
        heading: 'Saving a venue',
        steps: [
          'Click New venue.',
          'Type the name and address.',
          'Add a phone number and a map link if you have them.',
          'Click Save venue.',
        ],
        text: ['A map link is a Google Maps address. The event page shows it as Get directions.'],
        scene: 'venues-add',
      },
      {
        heading: 'Using a venue',
        text: [
          'In the event wizard’s first step, pick the venue from the Venue list. Its name, address, phone and map link fill in.',
          'Changing or deleting a venue here leaves the events that already use it as they are.',
        ],
      },
    ],
  },

  '/templates': {
    title: 'Invitation templates',
    intro: 'A template is invitation wording you can reuse. The default template fills in the email of every new event.',
    sections: [
      {
        heading: 'Writing a template',
        steps: [
          'Click New template.',
          'Give it a name.',
          'Write the subject and the message.',
          'Click a grey placeholder button to put in a detail that fills in for each event and guest.',
          'Click Save template.',
        ],
        scene: 'templates-new',
      },
      {
        heading: 'The default template',
        text: [
          'Make default picks the template every new event starts with. Another one can still be chosen in the wizard, from Start from a template.',
        ],
      },
      {
        heading: 'Placeholders',
        text: ['Each placeholder turns into the real detail when the email is sent.'],
        points: [
          'Guest first name and Guest full name: the name of the person getting the email.',
          'Event title, Event date, Event time and Event description: from the event’s first step.',
          'Venue name, Venue address and Venue phone: where it is.',
          'Host name: the event’s host, or your organization’s name.',
          'Organization name: your organization’s name, as set in Settings.',
          'RSVP deadline: the date replies close.',
          'Event page link and Personal RSVP link: the public page, and the guest’s own page for replying.',
        ],
      },
    ],
  },

  '/emails': {
    title: 'Email log',
    intro: 'The email log lists every email your organization has sent, from every event and broadcast, newest first.',
    sections: [
      {
        heading: 'Finding an email',
        text: [
          'Type a name or address into Filter by recipient. The two lists beside it pick the type of email, such as Invitation or Broadcast, and its status.',
          'View opens the email exactly as it was sent.',
        ],
        scene: 'email-log',
      },
      {
        heading: 'What the statuses mean',
        points: [
          'Queued: waiting its turn. Soapbox sends about 60 emails a minute.',
          'Sent: handed to SMTP2GO to deliver.',
          'Simulated: written and logged but not delivered, because no SMTP2GO key is set.',
          'Failed: not sent. The reason shows under the status, and the circular arrow tries again.',
        ],
      },
    ],
  },

  '/settings': {
    title: 'Settings',
    intro: 'Settings hold your organization’s name, how its email is sent, and who can sign in.',
    sections: [
      {
        heading: 'Email sending',
        roles: ['admin'],
        text: [
          'Soapbox sends email through SMTP2GO. Until an API key is saved here it runs in simulation mode, where every email is written and logged and none is delivered.',
        ],
        steps: [
          'Type the sender name people see, such as SJC Conservatives.',
          'Type a sender email on the domain you verified in SMTP2GO.',
          'Paste the API key from SMTP2GO.',
          'Click Save sending settings.',
        ],
        points: [
          'With a key saved, the green box shows how many emails are left in this SMTP2GO billing cycle.',
          'Send broadcasts from a different address gives broadcasts their own sender, such as a newsletter address.',
        ],
        scene: 'settings-sending',
      },
      {
        heading: 'Team members',
        roles: ['admin'],
        steps: [
          'Click Add user.',
          'Type their name and email address.',
          'Choose Member or Admin.',
          'Click Create user.',
          'Give them the temporary password. It is shown only once.',
        ],
        points: [
          'A member can do everything except change settings and team members.',
          'Reset password makes a new temporary password.',
          'Deactivate stops someone signing in, and keeps everything they made.',
        ],
        scene: 'settings-team',
      },
      {
        heading: 'Your organization',
        roles: ['admin'],
        points: [
          'Organization: the name guests see on event pages and in emails.',
          'App icon: your logo, shown beside Soapbox at the top of every page. A square image works best.',
          'Event defaults: the start and end times every new event begins with.',
          'Publish to a website: keeps a website’s meetings calendar up to date by itself, using the address and token the website gives you.',
        ],
      },
      {
        heading: 'Settings for administrators',
        roles: ['member'],
        text: [
          'Only administrators can change the organization’s settings. You can see them here, and change your own password.',
        ],
      },
      {
        heading: 'Your account',
        text: [
          'Change your password here. Type the current one, then a new one of at least 10 characters.',
        ],
      },
      {
        heading: 'Export your data',
        text: [
          'The buttons download your contacts, groups, venues, events, broadcasts and email log as spreadsheets. Full JSON backup downloads everything as one file.',
        ],
      },
    ],
  },
};

// The help for a page's address, such as /events/12. A route with a fixed
// word beats one with a placeholder, so /events/new is the wizard and not an
// event called "new".
export function helpFor(pathname) {
  const parts = String(pathname || '/').split('/').filter(Boolean);
  let best = null;
  let bestFixed = -1;
  for (const route of Object.keys(HELP)) {
    const want = route.split('/').filter(Boolean);
    if (want.length !== parts.length) continue;
    let fixed = 0;
    const fits = want.every((w, i) => {
      if (w.startsWith(':')) return true;
      fixed++;
      return w === parts[i];
    });
    if (fits && fixed > bestFixed) {
      best = HELP[route];
      bestFixed = fixed;
    }
  }
  return best;
}

// The sections a page shows someone with this role.
export function sectionsFor(page, role) {
  return (page?.sections || []).filter((s) => !s.roles || s.roles.includes(role));
}

// Every scene the help names.
export function allScenes() {
  return [...new Set(Object.values(HELP).flatMap((p) => p.sections.map((s) => s.scene).filter(Boolean)))];
}
