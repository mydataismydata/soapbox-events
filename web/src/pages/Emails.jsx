// Every email the organization has sent, from every event and broadcast —
// the one place where the type and source columns earn their keep.
import React from 'react';
import { Card } from '../ui.jsx';
import EmailLog from '../components/EmailLog.jsx';

const KINDS = ['invitation', 'nudge', 'follow_up', 'cancellation', 'broadcast', 'test'];

export default function Emails() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Email log</h1>
          <p className="page-sub">Everything sent from this organization, newest first.</p>
        </div>
      </div>

      <Card flush>
        <EmailLog kinds={KINDS} showType showSource showSubject perPage={50}
          emptyHint="Emails from your events and broadcasts will show up here, with their exact content." />
      </Card>
    </div>
  );
}
