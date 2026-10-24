import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { IssueDetails } from '../src/ui/features/issues/IssueDetails.tsx';
import { Requirements } from '../src/ui/features/requirements/Requirements.tsx';
import { EvidencePreview } from '../src/ui/features/reports/EvidencePreview.tsx';
import { Fixture, IssueFixture, choose, issue, job, now, open, repo, run, workbench } from './dropdown-fixture.ts';

const artifacts = [{ path: 'current.txt', bytes: 12, sha256: 'a'.repeat(64) }, { path: 'nested/second.json', bytes: 2048, sha256: 'b'.repeat(64) }];
const executionLabel = (id: number, stage = 'Issue execution', status = 'passed') => `${stage} · run-${id} · ${now} · ${status} · completed ${now}`;

test('all six selector contexts use the shared custom dropdown with original names options groups and controlled values', async () => {
  let shared: unknown;
  const inspect = (fixture: Fixture, name: string, expected: string[], selected: string) => {
    const trigger = open(fixture, name);
    const panel = fixture.panel()!;
    assert.equal(String(trigger.props['aria-controls']), panel.id, `${name} identifies its own listbox.`);
    assert.deepEqual(fixture.options().map(option => option.textContent.trim()), expected, `${name} preserves actual option labels and order.`);
    assert.deepEqual(fixture.options().filter(option => String(option.props['aria-selected']) === 'true').map(option => option.textContent.trim()), [selected], `${name} exposes the exact controlled selection.`);
    if (shared === undefined) shared = panel.owner;
    assert.equal(panel.owner, shared, `${name} must use the same production dropdown primitive.`);
    const native = fixture.all().filter(node => node.tagName === 'select');
    for (const backing of native) {
      assert.equal(backing.props['aria-hidden'], true, 'Native backing is excluded from the accessibility tree.');
      assert.equal(backing.props.tabIndex, -1, 'Native backing is excluded from Tab traversal.');
      assert.ok(backing.props.hidden || backing.getClientRects().length === 0, 'Native backing cannot remain the active visual popup.');
    }
    fixture.key(trigger, 'Escape');
  };
  let fixture = new Fixture();
  try {
    fixture.mount(createElement(IssueFixture));
    assert.ok(fixture.all().some(node => node.props['aria-label'] === 'Issue list'), 'Issue setup reaches the real feature before new selector assertions.');
    inspect(fixture, 'Filter by status', ['All statuses', 'Open', 'In progress', 'Blocked', 'Closed', 'Done'], 'All statuses');
    inspect(fixture, 'Filter by label', ['All labels', 'alpha', 'beta'], 'All labels');
    inspect(fixture, 'Sort issues', ['Newest first', 'Priority', 'Title A–Z'], 'Newest first');
  } finally { fixture.dispose(); }
  fixture = new Fixture();
  try {
    fixture.mount(createElement(IssueDetails, { id: 37, workbench: workbench() }));
    await fixture.settle();
    assert.ok(fixture.requests.includes('/api/issues/37'), 'Issue details setup obtains actual response data.');
    assert.match(fixture.root.textContent, /LOC-037/, 'Issue details setup renders the requested issue identity.');
    inspect(fixture, 'Select execution run', [executionLabel(2), executionLabel(1), executionLabel(4, 'Whole-goal verification'), executionLabel(3, 'Plan review')], executionLabel(2));
    open(fixture, 'Select execution run');
    const groups = fixture.all().filter(node => node.props.role === 'group').map(node => node.props['aria-label']);
    assert.ok(groups.includes('Issue executions') && groups.includes('Requirement audits'), 'Issue execution and requirement audit grouping is preserved in the custom panel.');
  } finally { fixture.dispose(); }
  fixture = new Fixture();
  try {
    fixture.mount(createElement(Requirements, { repo, data: workbench(), issues: [issue()], loading: false, error: null, onIssue: () => {} }));
    const opener = fixture.named('Inspect requirement Scoped goal');
    assert.ok(opener, 'Requirement fixture exposes its existing inspection opener.');
    fixture.click(opener);
    inspect(fixture, 'Select execution run', ['Select a stage run', `Whole-goal verification · run-4 · ${now} · passed`, `Plan review · run-3 · ${now} · passed`], 'Select a stage run');
  } finally { fixture.dispose(); }
  fixture = new Fixture();
  try {
    fixture.mount(createElement(EvidencePreview, { runId: 'run-2', evidence: artifacts }));
    inspect(fixture, 'Select evidence artifact', ['Select an artifact', 'current.txt · 12 bytes', 'nested/second.json · 2,048 bytes'], 'Select an artifact');
  } finally { fixture.dispose(); }
});

test('custom selections preserve issue filtering sorting and report and artifact inspection across refreshed data', async () => {
  let fixture = new Fixture();
  try {
    const records = [issue(37, { title: 'Zulu', status: 'blocked', priority: 'high', labels: ['alpha'] }), issue(38, { title: 'Alpha', status: 'closed', labels: ['beta'] }), issue(39, { title: 'Beta', status: 'blocked', priority: 'low', labels: ['alpha'] }), issue(40, { status: 'blocked', work: { repoId: 2, requirementId: null, dependsOn: [], acceptance: [] } })];
    fixture.mount(createElement(IssueFixture, { records }));
    choose(fixture, 'Filter by status', 'Blocked');
    const ids = () => fixture.all().filter(node => node.tagName === 'li' && String(node.props['data-testid']).startsWith('issue-')).map(node => node.props['data-testid']);
    assert.deepEqual(ids().sort(), ['issue-37', 'issue-39'], 'Custom status callbacks filter actual owned issue identities, excluding Closed and another repository.');
    assert.deepEqual(ids(), ['issue-39', 'issue-37'], 'Newest first initially orders the filtered owned issues by recency.');
    choose(fixture, 'Sort issues', 'Priority');
    assert.deepEqual(ids(), ['issue-37', 'issue-39'], 'Custom priority sorting reverses the initial row order through the real callback.');
    const sortTrigger = open(fixture, 'Sort issues');
    assert.deepEqual(fixture.options().filter(option => String(option.props['aria-selected']) === 'true').map(option => option.textContent.trim()), ['Priority'], 'The controlled sort selection retains Priority when reopened.');
    fixture.key(sortTrigger, 'Escape');
    choose(fixture, 'Filter by label', 'beta');
    assert.deepEqual(ids(), [], 'Custom label selection combines with the current status filter.');
    fixture.mount(createElement(IssueFixture, { records: [...records, issue(41, { status: 'blocked', labels: ['beta'] })] }));
    assert.deepEqual(ids(), ['issue-41'], 'Refresh preserves the chosen status and label while admitting new matching data.');
    assert.equal(fixture.panel(), undefined, 'Background refresh does not open any panel.');
  } finally { fixture.dispose(); }
  fixture = new Fixture();
  try {
    fixture.mount(createElement(IssueDetails, { id: 37, workbench: workbench() }));
    await fixture.settle();
    choose(fixture, 'Select execution run', executionLabel(1));
    await fixture.settle();
    const selectedReport = () => fixture.named('Selected report')?.textContent ?? '';
    assert.match(selectedReport(), /Run run-1 · passed/, 'The custom issue-run callback loads the chosen report identity and current status.');
    fixture.response = url => url.startsWith('/api/issues/') ? { issue: issue(), runs: [run(1), run(2), run(5)] } : { run: run(Number(url.split('-').at(-1))), delivery: null };
    await fixture.refresh();
    assert.match(selectedReport(), /Run run-1 · passed/, 'A newer issue run does not replace the selected report.');
    fixture.response = url => url.startsWith('/api/issues/') ? { issue: issue(), runs: [run(5)] } : { run: run(Number(url.split('-').at(-1))), delivery: null };
    await fixture.refresh();
    assert.match(selectedReport(), /Run run-5 · passed/, 'A removed issue run falls back to the latest available owned run.');
  } finally { fixture.dispose(); }
  fixture = new Fixture();
  try {
    let data = workbench();
    const mount = () => fixture.mount(createElement(Requirements, { repo, data, issues: [issue()], loading: false, error: null, onIssue: () => {} }));
    mount();
    fixture.click(fixture.named('Inspect requirement Scoped goal')!);
    choose(fixture, 'Select execution run', `Plan review · run-3 · ${now} · passed`);
    await fixture.settle();
    assert.match(fixture.named('Selected report')?.textContent ?? '', /Run run-3 · passed/, 'Requirement selection loads the exact selected stage report.');
    data = { ...data, jobs: [...data.jobs, job(6, 'requirement_verify', null)], runs: [...data.runs, run(6, null)] };
    mount();
    assert.match(fixture.combobox('Select execution run').textContent, /run-3/, 'Requirement refresh retains an available selected stage.');
    data = { ...data, jobs: data.jobs.filter(value => value.id !== 3), runs: data.runs.filter(value => value.id !== 'run-3') };
    mount();
    assert.match(fixture.combobox('Select execution run').textContent, /Select a stage run/, 'Removed requirement stages revert to the feature-owned empty placeholder.');
  } finally { fixture.dispose(); }
  fixture = new Fixture();
  try {
    fixture.response = () => 'observed current artifact body';
    fixture.mount(createElement(EvidencePreview, { runId: 'run-2', evidence: artifacts }));
    choose(fixture, 'Select evidence artifact', 'current.txt · 12 bytes');
    await fixture.settle();
    assert.ok(fixture.requests.includes('/api/runs/run-2/evidence?file=current.txt'), 'The custom artifact callback requests the selected manifest path.');
    assert.match(fixture.named('Evidence preview')?.textContent ?? '', /observed current artifact body/, 'Artifact content comes from the response, not fixture labels.');
    fixture.mount(createElement(EvidencePreview, { runId: 'run-2', evidence: [artifacts[1]] }));
    assert.match(fixture.combobox('Select evidence artifact').textContent, /Select an artifact/, 'A removed artifact returns to its empty placeholder.');
    assert.doesNotMatch(fixture.named('Evidence preview')?.textContent ?? '', /observed current artifact body/, 'Removed artifact content cannot remain current.');
  } finally { fixture.dispose(); }
});
