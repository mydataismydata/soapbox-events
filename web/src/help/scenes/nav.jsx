import React from 'react';
import Scene from '../Scene.jsx';
import { PageHead, Screen } from '../mock.jsx';
import { Icon, Stat, StatGrid } from '../../ui.jsx';
import { ORG } from '../data.js';

const start = { menu: false };
const steps = [
  { at: 600, point: 'tab-Events', say: 'Events: meetings people reply to' },
  { at: 2200, point: 'tab-Broadcasts', say: 'Broadcasts: news with nothing to reply to' },
  { at: 3800, point: 'tab-Contacts', say: 'Contacts and Groups: your people' },
  { at: 5400, tap: 'acct', say: 'Your name opens the rest', side: 'left', set: { menu: true } },
  { at: 7000, point: 'menu-Email log', say: 'Venues, templates, the email log and settings', side: 'left' },
  { at: 9000, set: { menu: false } },
  { at: 9100, point: 'help', say: 'Help explains the page you are on', side: 'below' },
];

export default function Nav() {
  return (
    <Scene width={560} height={300} length={11500} start={start} steps={steps}
      label="Getting around. The tabs along the top are Dashboard, Events, Broadcasts, Contacts and Groups. Clicking your name at the top right opens a menu with Venues, Templates, Email log, Settings and Sign out. Help sits just left of your name.">
      {(s) => (
        <Screen tab="Dashboard" menu={s.menu}>
          <PageHead title="Welcome back, Joe" sub={`Here's what's happening at ${ORG}.`}
            actions={<span className="btn btn-primary"><Icon name="plus" size={15} /> New event</span>} />
          <StatGrid>
            <Stat label="Upcoming events" value="1" sub="0 drafts" />
            <Stat label="Contacts" value="7" sub="2 groups" />
            <Stat label="Emails this month" value="21" sub="via SMTP2GO" />
            <Stat label="Email quota left" value="979" sub="21 of 1000 used" />
          </StatGrid>
        </Screen>
      )}
    </Scene>
  );
}
