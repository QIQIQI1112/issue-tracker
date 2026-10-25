import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';
import { IssueRow } from '../src/ui/IssueRow.tsx';
import { DeliveryView } from '../src/ui/DeliveryView.tsx';
import type { Delivery } from '../src/workflow.ts';
import { IssueFixture } from './dropdown-fixture.ts';

const timestamp = '2026-10-15T00:00:00.000Z';
const delivery: Delivery = {
  schemaVersion: 1, runId: 'diagnostic-run', taskId: 'diagnostics', title: 'Stored audit', goal: 'Inspect recorded behavior.',
  status: 'blocked', startedAt: timestamp, completedAt: timestamp, baseline: null, sourceHash: null,
  defaults: [], changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 1,
  review: null, integration: null, limitations: [], evidence: [],
};

test('issue title and identifier controls open inspection without edit actions', () => {
  const issue = { id: 13, title: 'Inspect this issue', description: 'Read only.', status: 'open' as const, priority: 'high' as const, labels: ['diagnostics'], createdAt: timestamp, updatedAt: timestamp };
  const row = { issue, onDetails: () => {}, onEdit: () => {}, onDelete: () => {} };
  const html = renderToStaticMarkup(createElement(IssueRow, row));
  assert.match(html, /aria-label="View issue Inspect this issue"/, 'The identifier retains its inspection entry point.');
  assert.match(html, /aria-label="Inspect issue Inspect this issue"/, 'The title exposes an inspection action.');
  assert.doesNotMatch(html, /aria-label="Edit |Save changes|contenteditable/, 'Issue rows must not offer editing.');
});

test('issue workspace omits Workbench navigation and manual administration', () => {
  const workspace = renderToStaticMarkup(createElement(App));
  const html = renderToStaticMarkup(createElement(IssueFixture));
  for (const surface of [workspace, html]) assert.doesNotMatch(surface, /Workbench|Register repository|Create requirement/, 'Issue inspection replaces the Workbench administration view.');
  for (const name of ['Search issues', 'Filter by status', 'Filter by label', 'Sort issues']) assert.ok(html.includes(`aria-label="${name}"`), `Retain ${name}.`);
  assert.match(workspace, /aria-label="(?:Filter by repository|Repositories)"/, 'Repository selection remains accessible.');
  assert.match(html, /<h1>Issues<\/h1>/, 'The inspection workspace retains its main heading.');
});

test('delivery audits distinguish approved rejected and missing independent review', () => {
  for (const approved of [true, false, null]) {
    const html = renderToStaticMarkup(createElement(DeliveryView, { runId: delivery.runId, delivery: { ...delivery, review: approved === null ? null : { approved, summary: 'Neutral recorded assessment.' } } }));
    const section = html.split('Independent agent review</h4>')[1]?.split('<h4>')[0] ?? '';
    assert.match(section, approved === null ? /No completed review|Unavailable|not recorded/i : approved ? /\bapproved\b/i : /\brejected\b/i, `Independent review must explicitly identify ${approved === null ? 'missing review' : approved ? 'approval' : 'rejection'} from stored fields.`);
    if (approved === null) assert.doesNotMatch(section, /\bapproved\b/i, 'Missing review cannot imply approval.');
  }
});

test('manifest evidence exposes bounded text preview controls and unchanged download URLs', () => {
  const html = renderToStaticMarkup(createElement(DeliveryView, { runId: delivery.runId, delivery: { ...delivery, evidence: [{ path: 'logs/unsafe & real.log', bytes: 1048576, sha256: 'a'.repeat(64) }, { path: 'screen.png', bytes: 40, sha256: 'b'.repeat(64) }] } }));
  assert.match(html, /aria-label="Select evidence artifact"/, 'Manifest evidence must expose an accessible artifact selector.');
  assert.match(html, /Evidence preview/, 'Manifest text evidence must offer an inline preview.');
  assert.ok(html.includes('/api/runs/diagnostic-run/evidence?file=logs%2Funsafe%20%26%20real.log'), 'Downloads retain the existing manifest-verified URL.');
  assert.match(html, /download=""/, 'Evidence retains download links.');
});

const recordedEfficiency: NonNullable<Delivery['efficiency']> = {
  elapsedMs: 187000, agentInvocations: 7, testAuthoringInvocations: 2,
  verificationExecutions: 3, verificationRetries: 1, verificationReuses: 4,
  durations: { planningMs: 125, testAuthoringMs: 2500, acceptanceReviewMs: 45000, implementationMs: 125000, verificationMs: 65250, codeReviewMs: 750 },
};

function reportText(report: Delivery) {
  return renderToStaticMarkup(createElement(DeliveryView, { runId: report.runId, delivery: report })).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

const efficiencyCounterLabels = [
  ['agentInvocations', 'Agent (?:invocations|calls)'],
  ['testAuthoringInvocations', 'Test[- ]authoring (?:invocations|calls)'],
  ['verificationExecutions', 'Full verifi(?:cation|er) (?:executions|runs)'],
  ['verificationRetries', 'Verification retries'],
  ['verificationReuses', 'Verification (?:proof )?reuses'],
] as const;

function assertRecordedCounters(text: string, efficiency: NonNullable<Delivery['efficiency']>) {
  for (const [field, label] of efficiencyCounterLabels) assert.match(text, new RegExp(`${label}\\s*:?\\s*${efficiency[field]}\\b`, 'i'), `${field} must display its recorded value ${efficiency[field]}, including zero.`);
}

function assertRecordedDuration(text: string, label: string, milliseconds: number) {
  const unit = '(?:milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)';
  const token = `\\d+(?:\\.\\d+)?\\s*${unit}\\b`;
  const match = text.match(new RegExp(`${label}\\s*:?\\s*(${token}(?:\\s+${token})*)`, 'i'));
  assert.ok(match, `${label} must display a recorded duration with readable time units.`);
  let actual = 0;
  for (const part of match[1].matchAll(/(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/gi)) {
    const scale = /^ms$|^millisecond/i.test(part[2]) ? 1 : /^s/i.test(part[2]) ? 1000 : /^m/i.test(part[2]) ? 60000 : 3600000;
    actual += Number(part[1]) * scale;
  }
  assert.equal(actual, milliseconds, `${label} must use the recorded milliseconds, rather than cumulative budget, timestamps, or a sum of stages.`);
}

function assertRecordedStages(text: string, efficiency: NonNullable<Delivery['efficiency']>) {
  for (const [field, label] of [
    ['planningMs', 'Planning'], ['testAuthoringMs', 'Test[- ]authoring'], ['acceptanceReviewMs', 'Acceptance review'],
    ['implementationMs', 'Implementation'], ['verificationMs', 'Verification'], ['codeReviewMs', 'Code review'],
  ] as const) assertRecordedDuration(text, `${label}(?: duration| time)?`, efficiency.durations[field]);
}

test('delivery efficiency renders recorded counters stage durations and selected-run context', () => {
  const text = reportText({
    ...delivery, startedAt: timestamp, completedAt: '2026-10-15T00:09:00.000Z',
    efficiency: recordedEfficiency,
    execution: { profile: 'adaptive-v2', route: 'standard', coverageMode: 'extend', reason: 'Distinct retained route rationale.' },
    budget: { usedMs: 901000, implementationAttempts: 2, acceptanceAttempts: 1, maxAttempts: 3, totalTimeoutMs: 3600000 },
    checks: [{ name: 'Full verification', status: 'passed' }], nodePassed: 101, browserPassed: 29,
  });
  assertRecordedCounters(text, recordedEfficiency);
  assertRecordedDuration(text, '(?:Selected[- ]run |Run )?Elapsed(?: time)?', recordedEfficiency.elapsedMs);
  assertRecordedStages(text, recordedEfficiency);
  assert.match(text, /selected[- ](?:execution|run)|this (?:execution|run)/i, 'Application text must identify metrics as the selected run cost.');
  assert.match(text, /(?:execution )?route\s*:?\s*standard/i, 'The recorded execution route must be labelled.');
  assert.match(text, /coverage(?: mode)?\s*:?\s*extend/i, 'Coverage mode must remain distinct from verification proof reuse.');
  assert.match(text, /Distinct retained route rationale\./, 'The recorded route reason remains available.');
});

test('delivery efficiency handles independent optional fields zero values and proof reuse', () => {
  const zero: NonNullable<Delivery['efficiency']> = {
    elapsedMs: 0, agentInvocations: 0, testAuthoringInvocations: 0, verificationExecutions: 0, verificationRetries: 0, verificationReuses: 1,
    durations: { planningMs: 0, testAuthoringMs: 0, acceptanceReviewMs: 0, implementationMs: 0, verificationMs: 0, codeReviewMs: 0 },
  };
  const reused = reportText({ ...delivery, taskId: 'requirement-13', efficiency: zero, checks: [{ name: 'Full verification', status: 'passed' }, { name: 'Production build', status: 'passed' }], nodePassed: 37, browserPassed: 19 });
  assertRecordedCounters(reused, zero);
  assertRecordedDuration(reused, '(?:Selected[- ]run |Run )?Elapsed(?: time)?', 0);
  assertRecordedStages(reused, zero);
  assert.match(reused, /Full verification\s*:\s*passed/, 'Copied successful check evidence must remain available separately from the actual execution count.');
  const execution: NonNullable<Delivery['execution']> = { profile: 'adaptive-v2', route: 'light', coverageMode: 'reuse', reason: 'Recorded baseline coverage rationale.' };
  for (const fields of [{ execution }, {}]) {
    const report = { ...delivery, ...fields };
    const html = renderToStaticMarkup(createElement(DeliveryView, { runId: report.runId, delivery: report }));
    const text = reportText(report);
    assert.match(text, /(?:efficiency|metrics)[^.]* (?:unavailable|not (?:recorded|available))|(?:unavailable|not (?:recorded|available))[^.]* (?:efficiency|metrics)/i, 'Reports without efficiency must explain unavailable metrics rather than invent zeros.');
    for (const [, label] of efficiencyCounterLabels) assert.doesNotMatch(text, new RegExp(`${label}\\s*:?\\s*\\d+`, 'i'), 'Absent counters must not be fabricated from passed checks or attempts.');
    const headings = [...html.matchAll(/<h4[^>]*>(.*?)<\/h4>/g)].map(match => match[1]);
    const legacy = ['Business goal', 'Result', 'What changed', 'Decisions', 'Verification', 'Independent agent review', 'Automatic integration'];
    assert.deepEqual(headings.filter(heading => legacy.includes(heading)), legacy, 'Legacy audit headings retain their original sequence.');
    if ('execution' in fields) {
      assert.match(text, /(?:execution )?route\s*:?\s*light/i, 'Execution context remains available without efficiency.');
      assert.match(text, /coverage(?: mode)?\s*:?\s*reuse/i, 'Coverage reuse does not manufacture verification reuse metrics.');
      assert.match(text, /Recorded baseline coverage rationale\./, 'Execution-only reports retain their recorded reason.');
    }
  }
});
