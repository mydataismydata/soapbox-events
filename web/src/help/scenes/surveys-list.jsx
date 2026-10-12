import React from 'react';
import Scene from '../Scene.jsx';
import { PageHead, Screen } from '../mock.jsx';
import { Badge, Card, Icon } from '../../ui.jsx';
import { SURVEY } from '../data.js';

const start = {};
const steps = [
  { at: 600, point: 'open', say: 'Open surveys are taking answers now' },
  { at: 2400, point: 'counts-fall', say: 'Responses, and how many of those asked have answered', side: 'below' },
  { at: 4400, tap: 'row-fall', say: 'Click one to see its results' },
  { at: 6200, tap: 'new', say: 'New survey starts the wizard', side: 'left' },
];

function Row({ id, title, sub, state, counts, when }) {
  const badge = state === 'open' ? <Badge tone="green" dot>Open</Badge>
    : state === 'closed' ? <Badge tone="gray" dot>Closed</Badge> : <Badge tone="amber" dot>Draft</Badge>;
  return (
    <tr data-t={`row-${id}`}>
      <td><span className="t-main">{title}</span><div className="t-sub">{sub}</div></td>
      <td>{badge}</td>
      <td className="t-sub nowrap" data-t={`counts-${id}`}>{counts}</td>
      <td className="t-sub nowrap">{when}</td>
      <td style={{ width: 20 }}><Icon name="chevronRight" size={16} className="row-chevron" /></td>
    </tr>
  );
}

const answered = (n, of) => (
  <><span><strong style={{ color: 'var(--c-ok)' }}>{n}</strong> responses</span><div>{n} of {of} asked</div></>
);

export default function SurveysList() {
  return (
    <Scene width={560} height={550} length={8800} start={start} steps={steps}
      label="The Surveys page. Open holds Fall priorities, closing October 30, with 7 responses from the 9 people asked. Drafts holds Holiday party ideas, not sent yet. Closed holds Summer picnic date, with 11 responses from 14 asked. New survey at the top right starts the wizard.">
      {() => (
        <Screen tab="Surveys">
          <PageHead title="Surveys" sub="Ask your contacts questions and see what they think."
            actions={<span className="btn btn-primary" data-t="new"><Icon name="plus" size={15} /> New survey</span>} />
          <div data-t="open">
            <Card flush title="Open" sub="1 survey">
              <table className="table hs-tight"><tbody>
                <Row id="fall" title={SURVEY.title} sub="By invitation · Named · 3 questions" state="open"
                  counts={answered(7, 9)} when="Closes Oct 30, 2026" />
              </tbody></table>
            </Card>
          </div>
          <div style={{ marginTop: 12 }}>
            <Card flush title="Drafts" sub="1 survey">
              <table className="table hs-tight"><tbody>
                <Row id="party" title="Holiday party ideas" sub="Public · Anonymous · 2 questions" state="draft"
                  counts="Not sent" when="1h ago" />
              </tbody></table>
            </Card>
          </div>
          <div style={{ marginTop: 12 }}>
            <Card flush title="Closed" sub="1 survey">
              <table className="table hs-tight"><tbody>
                <Row id="picnic" title="Summer picnic date" sub="By invitation · Named · 1 question" state="closed"
                  counts={answered(11, 14)} when="2026-06-30" />
              </tbody></table>
            </Card>
          </div>
        </Screen>
      )}
    </Scene>
  );
}
