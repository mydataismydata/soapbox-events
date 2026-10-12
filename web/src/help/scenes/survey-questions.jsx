import React from 'react';
import Scene, { typing } from '../Scene.jsx';
import { Input, Screen, Select, SURVEY_STEPS, Wizard, WizardFoot } from '../mock.jsx';
import { Card, Icon } from '../../ui.jsx';
import { SURVEY } from '../data.js';

const KINDS = [
  ['yes_no', 'Yes / No', 'Two buttons'],
  ['single', 'Single choice', 'Pick one'],
  ['multi', 'Multiple choice', 'Pick any'],
  ['ranking', 'Ranking', 'Put in order'],
  ['scale', 'Preference scale', 'From low to high'],
  ['text', 'Written answer', 'Free text'],
];
const SPEAKERS = ['Sean G.', 'Sandra F.', 'Congressman JR'];

const start = { added: false, prompt: '', choices: 0, focus: '' };
const steps = [
  { at: 500, point: 'q1', say: 'Each question is a card, answered in this order' },
  { at: 2300, point: 'kind-1', say: 'Its type sets how people answer', side: 'below' },
  { at: 4100, tap: 'add-ranking', say: 'Add a ranking question', side: 'above', set: { added: true, focus: 'prompt' } },
  ...typing(4900, 'prompt', SURVEY.speakers, 32),
  { at: 6400, set: { focus: '', choices: 1 } },
  { at: 6700, set: { choices: 2 } },
  { at: 7000, set: { choices: 3 } },
  { at: 7200, point: 'choices-2', say: 'People tap these in order of preference', side: 'above' },
  { at: 9000, point: 'req-2', say: 'Untick Required to let people skip it', side: 'left' },
  { at: 10800, tap: 'continue', say: 'On to the invitation', side: 'left' },
];

function Head({ n, kind, req = true }) {
  return (
    <div className="qe-head">
      <span className="qe-n">Q{n}</span>
      <Select t={`kind-${n}`} value={kind} style={{ minWidth: 150 }} />
      <label className="qe-required" data-t={`req-${n}`}>
        <input type="checkbox" checked={req} readOnly tabIndex={-1} /> Required
      </label>
      <div className="qe-tools">
        {['arrowUp', 'arrowDown', 'copy', 'trash'].map((i) => (
          <span key={i} className="btn btn-icon btn-sm"><Icon name={i} size={14} /></span>
        ))}
      </div>
    </div>
  );
}

export default function SurveyQuestions() {
  return (
    <Scene width={560} height={970} length={12800} start={start} steps={steps}
      label="Step 2 of the survey wizard. The first question, Should we keep meeting on the third Monday?, is a Yes / No question. Ranking is picked from Add a question, and a second card appears. The question Put these speakers in order of preference is typed, with the choices Sean G., Sandra F. and Congressman JR. Required is ticked on both. Continue moves on to the invitation.">
      {(s) => (
        <Screen bare>
          <Wizard labels={SURVEY_STEPS} step={1}>
            <Card title="Questions" sub="People answer them in this order.">
              <div className="qe">
                <div className="qe-q" data-t="q1">
                  <Head n={1} kind="Yes / No" />
                  <div className="field" style={{ marginBottom: 6 }}>
                    <label>Question</label>
                    <Input value="Should we keep meeting on the third Monday?" />
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>Answered with a Yes or a No button.</p>
                </div>
                {s.added ? (
                  <div className="qe-q" data-t="q2">
                    <Head n={2} kind="Ranking" />
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label>Question</label>
                      <Input t="prompt" value={s.prompt} placeholder="Put these speakers in order of preference" focus={s.focus === 'prompt'} />
                    </div>
                    <div className="qe-choices" data-t="choices-2">
                      <div className="qe-label">Choices</div>
                      {SPEAKERS.map((name, i) => (
                        <div className="qe-choice" key={name}>
                          <span className="qe-mark">{i + 1}</span>
                          <Input value={i < s.choices ? name : ''} placeholder={`Choice ${i + 1}`} style={{ flex: 1 }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="qe-add">
                  <div className="qe-label">Add a question</div>
                  <div className="qe-add-grid">
                    {KINDS.map(([k, t, sub]) => (
                      <span key={k} className="qe-add-btn" data-t={`add-${k}`}><span className="t">{t}</span><span className="s">{sub}</span></span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
            <WizardFoot />
          </Wizard>
        </Screen>
      )}
    </Scene>
  );
}
