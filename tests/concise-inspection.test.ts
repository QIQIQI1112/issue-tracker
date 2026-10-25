import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';
import { Requirements } from '../src/ui/features/requirements/Requirements.tsx';
import { IssueDetails } from '../src/ui/features/issues/IssueDetails.tsx';
import { DeliveryView } from '../src/ui/features/reports/DeliveryView.tsx';
import { SelectedReport } from '../src/ui/features/reports/SelectedReport.tsx';
import { RepositoryHarness } from '../src/ui/features/harness/RepositoryHarness.tsx';
import type { Delivery } from '../src/workflow.ts';
import type { RepositoryHarness as HarnessData } from '../src/harness.ts';
import { Fixture, IssueFixture, choose, issue, job, now, repo, requirement, run } from './dropdown-fixture.ts';

test('inspection surfaces omit decorative and workflow prose while preserving recorded content and functional states', async () => {
  const fixture = new Fixture();
  const child = issue(37, { description: 'Original issue description', status: 'closed', closure: { reason: 'Recorded closure reason', closedAt: now } });
  const goal = { ...requirement, goal: 'Original requirement business goal' };
  const execution = run(1, 37, { status: 'blocked', reason: 'Recorded execution failure' });
  const data = { repos: [repo], requirements: [goal], jobs: [{ ...job(1), status: 'blocked' as const, reason: 'Recorded job failure' }], runs: [execution] };
  const delivery: Delivery = {
    schemaVersion: 1, runId: execution.id, taskId: 'issue-37', title: 'Recorded delivery', goal: 'Original report business goal', summary: 'Recorded controller outcome',
    status: 'blocked', startedAt: now, completedAt: now, baseline: 'recorded-baseline', sourceHash: 'recorded-source',
    defaults: [{ decision: 'Recorded decision', reason: 'Recorded decision reason' }], changes: [], checks: [{ name: 'Recorded behavior check', status: 'passed' }],
    nodePassed: 7, browserPassed: 0, attempts: 1, review: { approved: false, summary: 'Recorded independent rejection' }, integration: null,
    limitations: ['Recorded limitation'], workerObservations: [{ attempt: 1, summary: 'Recorded historical observation' }],
    evidence: [{ path: 'audit.log', bytes: 16, sha256: 'a'.repeat(64) }],
    execution: { profile: 'adaptive-v2', route: 'standard', coverageMode: 'extend', reason: 'Recorded coverage rationale' },
    efficiency: { elapsedMs: 1000, agentInvocations: 2, testAuthoringInvocations: 1, verificationExecutions: 1, verificationRetries: 0, verificationReuses: 0, durations: { planningMs: 0, testAuthoringMs: 0, acceptanceReviewMs: 0, implementationMs: 0, verificationMs: 0, codeReviewMs: 0 } },
  };
  const harnessExplanation = 'Configured checks are not execution or pass evidence. Reading these sources does not run commands.';
  const harness: HarnessData = {
    repository: repo, status: 'available', commit: 'recorded-commit', message: 'Recorded committed read result',
    sources: [{ path: 'README.md', commit: 'recorded-commit', blob: 'recorded-blob', status: 'available', message: 'Recorded source availability', bytes: 123, content: harnessExplanation }],
  };
  fixture.response = url => {
    if (url === '/api/issues') return { issues: [child] };
    if (url === '/api/workbench') return data;
    if (url === '/api/issues/37') return { issue: child, runs: [execution] };
    if (url === '/api/runs/run-1') return { run: execution, delivery };
    if (url === '/api/runs/run-1/evidence?file=audit.log') return 'Recorded log text';
    if (url === '/api/repos/1/harness') return harness;
    assert.fail(`Unexpected inspection read: ${url}`);
  };
  const surfaces: { name: string; text: string; forbidden: string[] }[] = [];
  const capture = (name: string, forbidden: string[]) => surfaces.push({ name, text: (fixture.root.textContent ?? '').replace(/\s+/g, ' '), forbidden });
  const pending = renderToStaticMarkup(createElement(App));
  try {
    await fixture.mount(createElement(App));
    await fixture.settle();
    assert.ok(fixture.requests.includes('/api/workbench') && fixture.requests.includes('/api/issues'), 'Workspace setup completes actual production reads before copy assertions.');
    capture('workspace chrome', ['Local issue tracker', 'Local workspace', 'SQLite persistence', 'A little structure for what comes next.', 'Private by default. Local by design.', 'Loop / Local workspace']);

    await fixture.mount(createElement(IssueFixture, { records: [child] }));
    assert.ok(fixture.named('Inspect issue Neutral 37'), 'The issue surface renders a real issue opener.');
    capture('issue collection', ['A little structure for what comes next.', 'Private by default. Local by design.', 'Loop / Local workspace']);
    await choose(fixture, 'Filter by status', 'Open');
    assert.match(fixture.root.textContent ?? '', /No matching issues/);
    assert.ok(fixture.all().some(node => node.matches('button') && node.textContent === 'Reset filters'), 'The concise empty state retains its recovery control.');
    capture('filtered issue empty state', ['Try another search or reset your filters to see all issues.']);
    await fixture.mount(createElement(IssueFixture, { key: 'empty', records: [] }));
    assert.match(fixture.root.textContent ?? '', /No issues yet|No matching issues/, 'The empty collection retains a truthful empty state.');
    capture('empty issue collection', ['Ask your agent to create and manage issues. Inspect issues and execution evidence here.']);

    await fixture.mount(createElement(Requirements, { repo, data, issues: [child], loading: false, error: null, onIssue: () => {} }));
    await fixture.click(fixture.named(`Inspect requirement ${goal.title}`)!);
    assert.equal(fixture.named('Original goal')?.querySelector('p')?.textContent, goal.goal, 'Original requirement content remains intact.');
    assert.equal(fixture.named('Whole-goal acceptance')?.querySelector('[role="status"]')?.textContent, 'Unverified', 'The current acceptance observation remains explicit.');
    assert.equal(fixture.named('Final delivery')?.querySelector('[role="status"]')?.textContent, 'Incomplete', 'A blocked child cannot become delivered through concise copy.');
    assert.match(fixture.named('Current blockers')?.textContent ?? '', /Recorded job failure/);
    capture('requirement inspection', [`Inspect original goals and recorded delivery evidence for ${repo.name}.`, 'Only the exact completed latest verification job and passed run establish acceptance.', 'Delivery requires child merges and whole-goal acceptance.', 'Historical reports describe their own attempt. They do not replace current progress or blockers.']);

    await fixture.mount(createElement(IssueDetails, { id: child.id, workbench: data, issues: [child] }));
    await fixture.settle();
    for (const value of [child.description, goal.goal, 'Recorded closure reason', 'Recorded job failure']) assert.ok(fixture.root.textContent?.includes(value), `Diagnostics retains ${value}.`);
    assert.match(fixture.named('Closure context')?.textContent ?? '', /Recorded closure reason/);
    assert.match(fixture.named('Selected report')?.textContent ?? '', /Run run-1 · blocked/);
    capture('issue diagnostics', ['Closure does not establish successful delivery.', 'Delivery requires recorded execution evidence, regardless of issue status.']);

    await fixture.mount(createElement(DeliveryView, { runId: execution.id, delivery }));
    const reportText = fixture.named('Delivery report')?.textContent ?? '';
    for (const value of [delivery.goal, delivery.summary!, 'Recorded decision', 'Recorded decision reason', 'Recorded behavior check', 'Recorded independent rejection', 'Recorded limitation', 'Recorded historical observation', 'recorded-baseline', 'recorded-source', 'Recorded coverage rationale']) assert.ok(reportText.includes(value), `Report retains ${value}.`);
    assert.match(reportText, /rejected/, 'Stored rejection remains distinguishable from approval.');
    assert.match(reportText, /7 Node cases/);
    assert.ok(fixture.named('Select evidence artifact'), 'Evidence selection retains its accessible name.');
    capture('delivery report and artifact selection', ['These observations precede the controller\'s final verification and decision.', 'separate from cumulative budget usage and whole requirement delivery.', 'Agent invocations include test-authoring invocations.', 'Verification duration includes focused checks. Stage durations need not sum to elapsed time.', 'Coverage mode describes the recorded test coverage decision.', 'Select a manifest-listed artifact to read text inline.']);
    await choose(fixture, 'Select evidence artifact', 'audit.log · 16 bytes');
    await fixture.settle();
    assert.equal(fixture.named('Evidence preview')?.querySelector('pre')?.textContent, 'Recorded log text', 'Actual evidence text survives concise inspection.');
    assert.equal(fixture.root.querySelector('a[download]')?.getAttribute('href'), '/api/runs/run-1/evidence?file=audit.log');

    fixture.response = url => url === '/api/runs/run-1' ? { run: execution, delivery: null } : harness;
    await fixture.mount(createElement(SelectedReport, { runId: execution.id }));
    await fixture.settle();
    assert.match(fixture.named('Selected report')?.textContent ?? '', /Delivery report unavailable for this execution\./, 'A missing report keeps its functional unavailable state.');
    await fixture.mount(createElement(RepositoryHarness, { repoId: repo.id }));
    await fixture.settle();
    assert.ok(fixture.requests.includes('/api/repos/1/harness'), 'Harness setup reads the current repository before copy assertions.');
    const harnessText = fixture.named('Repository harness')?.textContent ?? '';
    for (const value of ['recorded-commit', 'recorded-blob', 'Recorded source availability', 'README.md']) assert.ok(harnessText.includes(value), `Harness retains ${value}.`);
    assert.equal(fixture.named('README.md committed source')?.textContent, harnessExplanation, 'Raw source text is retained even when it resembles removed application prose.');
    const generatedParagraphs = [...fixture.root.querySelectorAll('p')].map(node => node.textContent).join(' ');
    surfaces.push({ name: 'harness generated copy', text: generatedParagraphs, forbidden: [harnessExplanation] });

    assert.match(pending, /role="status"/, 'The initial pending read retains a meaningful status announcement.');
    assert.ok(!pending.includes('Opening your local workspace.'), 'Pending reads omit decorative workflow prose.');
    for (const surface of surfaces) for (const text of surface.forbidden) assert.ok(!surface.text.includes(text), `${surface.name} must omit redundant application copy: ${text}`);
  } finally { await fixture.dispose(); }
});
