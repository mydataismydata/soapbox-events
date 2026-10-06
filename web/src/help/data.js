// The organization the Help pictures show: its people, groups, events and
// broadcasts. Every scene draws from here, so a name or a date is the same in
// all of them.

export const ORG = 'SJC Conservatives';
export const ME = { name: 'Joe S.', initials: 'JS', email: 'sjcc@example.com' };

// In the order the app lists them: by first name.
export const PEOPLE = [
  { id: 'eric', first: 'Eric', last: 'A.', email: 'erica@example.com' },
  { id: 'fred', first: 'Fred', last: 'P.', email: 'fredp@example.com' },
  { id: 'gloria', first: 'Gloria', last: 'N.', email: 'glorian@example.com' },
  { id: 'joe', first: 'Joe', last: 'S.', email: 'sjcc@example.com' },
  { id: 'michelle', first: 'Michelle', last: 'M.', email: 'michellem@example.com' },
  { id: 'mike', first: 'Mike', last: 'F.', email: 'mikef@example.com' },
  { id: 'sean', first: 'Sean', last: 'C.', email: 'seanc@example.com' },
].map((p) => ({ ...p, name: `${p.first} ${p.last}` }));

export const person = (id) => PEOPLE.find((p) => p.id === id);

export const EXECUTIVE = ['fred', 'joe', 'mike'];
export const GROUPS = [
  { id: 'all', name: 'All members', members: PEOPLE.map((p) => p.id) },
  { id: 'exec', name: 'Executive team', members: EXECUTIVE },
];

export const VENUE = { name: 'UF Health Building', address: 'Nocatee' };

export const OCTOBER = {
  title: 'October Meeting with Candidates Sean G. and Sandra F.',
  when: 'Monday, October 19, 2026 · 5:30 PM – 7:00 PM',
  date: '10/19/2026',
  iso: '2026-10-19',
  start: '05:30 PM',
  end: '07:00 PM',
};

export const SEPTEMBER = {
  title: 'September Meeting with Congressman JR',
  when: 'Monday, September 21, 2026 · 5:30 PM – 7:00 PM',
};

// Everyone but Joe, whose address is the organization's own, was invited to
// the October meeting. `party` counts the guest and anyone they bring.
export const OCTOBER_GUESTS = [
  { id: 'eric', response: null, party: 1 },
  { id: 'fred', response: 'yes', party: 2, ago: '2d ago' },
  { id: 'gloria', response: 'yes', party: 1, ago: '5h ago' },
  { id: 'michelle', response: 'no', party: 0, ago: '1d ago' },
  { id: 'mike', response: 'yes', party: 1, ago: '3d ago' },
  { id: 'sean', response: null, party: 1 },
].map((g) => ({ ...g, ...person(g.id), name: person(g.id).name }));

export const BOCC = {
  title: 'Board of County Commissioners special meeting Oct 28',
  subject: 'Special meeting Oct 28 at 9 AM',
  blurb: 'The County Commissioners are having a special meeting on Oct 28 at 9 AM to reconsider approvals for Agricultural Enclaves.',
  attachment: { name: 'Agenda Oct 28.pdf', size: '182 KB' },
};

export const SENT_BROADCASTS = [
  { id: 'election', title: 'Election Info', sent: '2026-08-16' },
  { id: 'endorse', title: 'County Endorsements', sent: '2026-08-02' },
];
