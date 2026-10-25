import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { App } from '../src/ui/App.tsx';
import type { Issue } from '../src/domain.ts';
import type { Delivery, Workbench } from '../src/workflow.ts';
import { Fixture, choose, issue, job, now, open, repo, requirement, run } from './dropdown-fixture.ts';

const secondRepo = { ...repo, id: 2, name: 'Second repository', path: '/disposable/second' };
const emptyRepo = { ...repo, id: 3, name: 'Empty repository', path: '/disposable/empty' };
const secondRequirement = { ...requirement, id: 2, title: 'Second goal' };
const foreignRequirement = { ...requirement, id: 3, repoId: 2, title: 'Foreign goal' };
const owned = (id: number, repoId: number, requirementId: number | null, changes: Partial<Issue> = {}) => issue(id, {
  title: `Owned item ${id}`, description: `Recorded description ${id}`, labels: [`scope-${repoId}-${requirementId}`],
  work: { repoId, requirementId, dependsOn: [], acceptance: [`Recorded acceptance ${id}`] }, ...changes,
});
const records = () => [owned(37, 1, 1), owned(38, 1, 2), owned(39, 2, 1), owned(40, 2, 3), owned(41, 1, null), owned(42, 2, null), issue(43, { work: undefined }), owned(44, 1, 999)];
const report: Delivery = {
  schemaVersion: 1, runId: 'run-1', taskId: 'issue-37', title: 'Recorded audit', goal: 'Recorded audit goal',
  status: 'blocked', startedAt: now, completedAt: now, baseline: 'baseline-37', sourceHash: 'source-37',
  defaults: [], changes: [], checks: [{ name: 'Recorded Node behavior', status: 'passed' }], nodePassed: 1, browserPassed: 0, attempts: 1,
  review: { approved: false, summary: 'Recorded review rejection' }, integration: null, limitations: ['Recorded execution limitation'],
  evidence: [{ path: 'logs/owned.txt', bytes: 18, sha256: 'a'.repeat(64) }],
};

function setup(initial = records()) {
  const fixture = new Fixture();
  const state: { issues: Issue[]; data: Workbench } = {
    issues: initial,
    data: { repos: [repo, secondRepo, emptyRepo], requirements: [requirement, secondRequirement, foreignRequirement], jobs: [job(1)], runs: [run(1)] },
  };
  const methods: string[] = [];
  const fetchBoundary = globalThis.fetch;
  globalThis.fetch = (input, init) => { methods.push(init?.method ?? 'GET'); return fetchBoundary(input, init); };
  fixture.response = url => {
    if (url === '/api/issues') return { issues: state.issues };
    if (url === '/api/workbench') return state.data;
    if (url === '/api/runs/run-1/evidence?file=logs%2Fowned.txt') return 'Owned evidence log';
    if (url === '/api/runs/run-1') return { run: run(1), delivery: report };
    if (/^\/api\/issues\/\d+$/.test(url)) {
      const id = Number(url.split('/').at(-1));
      return { issue: state.issues.find(item => item.id === id), runs: state.data.runs.filter(item => item.issueId === id) };
    }
    if (/^\/api\/repos\/\d+\/harness$/.test(url)) {
      const selected = state.data.repos.find(item => item.id === Number(url.split('/')[3]))!;
      return { repository: selected, status: 'unavailable', message: 'Committed revision unavailable.', sources: [] };
    }
    assert.fail(`Unexpected inspection read: ${url}`);
  };
  return { fixture, state, methods };
}

function control(root: ParentNode, name: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('button, a')].find(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name);
  assert.ok(found, `The current inspection scope must expose the ${name} control.`);
  return found;
}

async function mount(fixture: Fixture) {
  await fixture.mount(createElement(App));
  await fixture.settle();
  assert.ok(fixture.requests.includes('/api/issues') && fixture.requests.includes('/api/workbench'), 'Fixture readiness requires both production metadata reads.');
}

async function selectRepository(fixture: Fixture, name = repo.name) {
  const reachable = [...fixture.root.querySelectorAll<HTMLElement>('button, a')].find(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name);
  if (reachable) {
    await fixture.click(reachable);
    return;
  }
  await fixture.click(control(fixture.root, 'Repositories'));
  const main = fixture.root.querySelector('main');
  assert.ok(main, 'The repository directory must expose its actual main-content controls.');
  await fixture.click(control(main, name));
}

async function selectRequirement(fixture: Fixture, name = requirement.title) {
  await fixture.click(control(fixture.root, 'Requirements'));
  await fixture.click(control(fixture.root, `Inspect requirement ${name}`));
}

function issueIds(fixture: Fixture) {
  const list = fixture.named('Issue list');
  assert.ok(list, 'A selected requirement or Unassigned destination must expose the existing filterable Issue list.');
  return [...list.querySelectorAll<HTMLElement>('li[data-testid^="issue-"]')].map(node => node.getAttribute('data-testid')!);
}

async function search(fixture: Fixture, value: string) {
  const input = fixture.named('Search issues') as HTMLInputElement;
  assert.ok(input?.matches('input'), 'Scoped browsing retains the controlled Search issues input.');
  await fixture.focus(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(fixture.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new fixture.dom.window.Event('input', { bubbles: true }));
  });
  return input;
}

test('repository selection opens only its requirements with subordinate destinations in the upper toolbar', async () => {
  const { fixture } = setup();
  try {
    await mount(fixture);
    assert.equal(fixture.document.activeElement, fixture.document.body, 'Initial metadata loading must not move focus.');
    await selectRepository(fixture);
    const primary = fixture.root.querySelector('aside nav');
    assert.ok(primary, 'The workspace retains its primary navigation.');
    for (const name of ['All repositories', 'Issues', 'Requirements', 'Repo harness', 'Unassigned']) {
      assert.equal([...primary.querySelectorAll('button, a')].some(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name), false, `${name} cannot be a primary destination.`);
    }
    const main = fixture.root.querySelector('main')!;
    for (const name of ['Requirements', 'Repo harness', 'Unassigned']) control(main, name);
    const requirementIds = () => [...fixture.root.querySelectorAll<HTMLElement>('li[data-testid^="requirement-"]')].map(node => node.dataset.testid).sort();
    assert.deepEqual(requirementIds(), ['requirement-1', 'requirement-2'], 'The selected repository landing contains only its actual requirements.');
    assert.equal(fixture.named('Issue list'), undefined, 'A repository landing must not expose a global issue collection.');
    await selectRepository(fixture, secondRepo.name);
    assert.deepEqual(requirementIds(), ['requirement-3'], 'Repository switching opens only the new repository requirements.');
    await fixture.click(control(main, 'Repo harness'));
    await fixture.settle();
    assert.ok(fixture.requests.includes('/api/repos/2/harness'), 'The subordinate harness destination reads the selected repository.');
    await selectRepository(fixture, emptyRepo.name);
    assert.deepEqual(requirementIds(), [], 'An empty repository never inherits another repository requirements.');
    assert.match(main.textContent ?? '', /No requirements/, 'Empty repository requirements have a truthful empty state.');
  } finally { await fixture.dispose(); }
});

test('requirement issue browsing excludes other ownership and clears stale diagnostics across scope changes', async () => {
  const { fixture } = setup();
  try {
    await mount(fixture);
    await selectRepository(fixture);
    await selectRequirement(fixture);
    assert.deepEqual(issueIds(fixture), ['issue-37'], 'Both repository and requirement IDs must match; sibling, foreign, standalone and dangling records are excluded.');
    await fixture.click(control(fixture.named('Issue list')!, 'Inspect issue Owned item 37'));
    await fixture.settle();
    const dialog = fixture.root.querySelector('dialog')!;
    assert.ok(dialog?.open, 'The scoped issue opener retains read-only diagnostics.');
    assert.match(dialog.textContent ?? '', /Issue #37 · LOC-037/);
    assert.match(dialog.textContent ?? '', /Recorded description 37/);
    assert.match(fixture.named('Selected report')?.textContent ?? '', /Recorded review rejection/);
    assert.equal(dialog.querySelector('form, textarea, [contenteditable="true"]'), null, 'Scoped diagnostics remain read-only.');
    await choose(fixture, 'Select evidence artifact', 'logs/owned.txt · 18 bytes');
    await fixture.settle();
    assert.equal(fixture.named('Evidence preview')?.querySelector('pre')?.textContent, 'Owned evidence log', 'The owned report retains actual evidence preview access.');
    assert.equal(dialog.querySelector('a[download]')?.getAttribute('href'), '/api/runs/run-1/evidence?file=logs%2Fowned.txt');
    await selectRequirement(fixture, secondRequirement.title);
    assert.deepEqual(issueIds(fixture), ['issue-38'], 'Switching requirements replaces the child collection.');
    assert.equal(fixture.root.querySelector('dialog'), null, 'Changing requirement clears an active issue inspection from the previous scope.');
    assert.equal(fixture.named('Selected report'), undefined, 'A previous requirement report cannot remain selected.');
    assert.doesNotMatch(fixture.root.textContent ?? '', /Recorded description 37|Owned evidence log/);
    await fixture.click(control(fixture.named('Issue list')!, 'Inspect issue Owned item 38'));
    await fixture.settle();
    assert.match(fixture.root.querySelector('dialog')?.textContent ?? '', /Issue #38 · LOC-038/);
    assert.doesNotMatch(fixture.root.querySelector('dialog')?.textContent ?? '', /Recorded description 37|Recorded review rejection/);
    await selectRepository(fixture, secondRepo.name);
    assert.equal(fixture.named('Issue list'), undefined, 'Repository switching clears the old child scope.');
    assert.equal(fixture.root.querySelector('dialog'), null, 'Repository switching retains no obsolete issue inspection.');
    await selectRequirement(fixture, foreignRequirement.title);
    assert.deepEqual(issueIds(fixture), ['issue-40'], 'The new repository requirement excludes dangling and foreign requirement ownership.');
  } finally { await fixture.dispose(); }
});

test('Unassigned history contains only selected repository standalone issues and navigation performs only reads', async () => {
  const { fixture, state, methods } = setup();
  const before = JSON.stringify(state);
  try {
    await mount(fixture);
    await selectRepository(fixture);
    await fixture.click(control(fixture.root.querySelector('main')!, 'Unassigned'));
    assert.deepEqual(issueIds(fixture), ['issue-41'], 'Unassigned means exactly selected repository ownership and null requirement, excluding absent ownership and dangling references.');
    await fixture.click(control(fixture.named('Issue list')!, 'Inspect issue Owned item 41'));
    await fixture.settle();
    assert.match(fixture.root.querySelector('dialog')?.textContent ?? '', /Issue #41 · LOC-041/);
    await fixture.click(control(fixture.root, 'Close dialog'));
    await selectRepository(fixture, secondRepo.name);
    assert.equal(fixture.named('Issue list'), undefined, 'Repository switching returns to Requirements before opening Unassigned.');
    await fixture.click(control(fixture.root.querySelector('main')!, 'Unassigned'));
    assert.deepEqual(issueIds(fixture), ['issue-42']);
    await fixture.refresh();
    assert.deepEqual(issueIds(fixture), ['issue-42']);
    assert.ok(methods.length > 0 && methods.every(method => method === 'GET'), 'Navigation, diagnostics and refresh must issue only reads.');
    assert.equal(JSON.stringify(state), before, 'Inspection creates no synthetic requirement and mutates no supplied ownership or business data.');
  } finally { await fixture.dispose(); }
});

test('scoped issue inspection retains filtering pagination selection and keyboard focus across refresh', async () => {
  const children = Array.from({ length: 12 }, (_, index) => owned(1001 + index, 1, 1, { title: `Shared owned ${String(index + 1).padStart(2, '0')}`, labels: ['inside'], status: index === 11 ? 'closed' : 'blocked' }));
  const { fixture, state } = setup([...children, owned(2001, 1, 2, { title: 'Shared sibling', labels: ['sibling-only'], status: 'blocked' }), owned(2002, 2, 1, { title: 'Shared foreign', labels: ['foreign-only'], status: 'blocked' })]);
  try {
    await mount(fixture);
    await selectRepository(fixture);
    await selectRequirement(fixture);
    assert.equal(issueIds(fixture).length, 10, 'The requirement uses the existing ten-issue page.');
    assert.match(fixture.named('Issue pages')?.textContent ?? '', /1–10 of 12 issues/, 'Counts and pagination derive from owned children before paging.');
    const labels = await open(fixture, 'Filter by label');
    assert.deepEqual(fixture.options().map(node => node.textContent?.trim()), ['All labels', 'inside'], 'Label choices exclude other repositories and requirements.');
    await fixture.key(labels, 'Escape');
    await search(fixture, 'Shared');
    await choose(fixture, 'Filter by status', 'Blocked');
    await choose(fixture, 'Filter by label', 'inside');
    const sort = fixture.combobox('Sort issues');
    await fixture.key(sort, 'ArrowDown');
    await fixture.key(sort, 'End');
    await fixture.key(sort, 'Enter');
    assert.match(sort.textContent ?? '', /Title A–Z/, 'Scoped sorting retains the shared keyboard selection behavior.');
    await fixture.click(control(fixture.named('Issue pages')!, 'Next page'));
    assert.deepEqual(issueIds(fixture), ['issue-1011'], 'Search, status, labels and sorting all apply before scoped pagination.');
    const opener = control(fixture.named('Issue list')!, 'Inspect issue Shared owned 11');
    await fixture.click(opener);
    await fixture.settle();
    await fixture.refresh();
    assert.match(fixture.root.querySelector('dialog')?.textContent ?? '', /Issue #1011 · LOC-1011/, 'Same-scope refresh retains the selected issue.');
    await fixture.cancel(fixture.root.querySelector('dialog')!);
    assert.equal(fixture.document.activeElement, opener, 'Dialog dismissal returns focus to the scoped issue opener.');
    const input = fixture.named('Search issues') as HTMLInputElement;
    await fixture.focus(input);
    await fixture.key(input, 'Tab');
    state.issues = state.issues.map(item => item.id === 1011 ? { ...item, title: 'Shared owned 11 refreshed' } : item);
    await fixture.refresh();
    assert.equal(fixture.document.activeElement, input, 'Background refresh preserves the exact focused search control.');
    assert.equal(fixture.document.documentElement.dataset.focusIntent, 'keyboard');
    assert.equal(input.value, 'Shared');
    assert.deepEqual(issueIds(fixture), ['issue-1011'], 'Refresh retains the valid page and active filters.');
    assert.match(fixture.named('Issue list')?.textContent ?? '', /Shared owned 11 refreshed/, 'The retained page still consumes current response data.');
    assert.match(fixture.combobox('Filter by status').textContent ?? '', /Blocked/);
    assert.match(fixture.combobox('Filter by label').textContent ?? '', /inside/);
    assert.match(fixture.combobox('Sort issues').textContent ?? '', /Title A–Z/);
    await search(fixture, 'no matching child');
    assert.deepEqual(issueIds(fixture), []);
    await fixture.click(control(fixture.root, 'Reset filters'));
    assert.match(fixture.named('Issue pages')?.textContent ?? '', /1–10 of 12 issues/, 'Reset filters retains repository and requirement while returning to page one.');
    assert.ok(issueIds(fixture).every(id => !['issue-2001', 'issue-2002'].includes(id)), 'Reset filters cannot widen ownership.');
    await selectRequirement(fixture, secondRequirement.title);
    assert.deepEqual(issueIds(fixture), ['issue-2001'], 'Changing requirement clears obsolete filtering and pagination.');
  } finally { await fixture.dispose(); }
});
