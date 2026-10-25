import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { App } from '../src/ui/App.tsx';
import type { Issue } from '../src/domain.ts';
import type { Delivery, Workbench } from '../src/workflow.ts';
import { Fixture, choose, issue, job, now, repo, requirement, run } from './dropdown-fixture.ts';

const otherRepo = { ...repo, id: 2, name: 'Other repository', path: '/disposable/other' };
const sibling = { ...requirement, id: 2, title: 'Sibling goal' };
const foreign = { ...requirement, id: 3, repoId: 2, title: 'Foreign goal' };
const report: Delivery = {
  schemaVersion: 1, runId: 'run-1', taskId: 'issue-37', title: 'Recorded inspection', goal: 'Inspect recorded execution',
  status: 'passed', startedAt: now, completedAt: now, baseline: 'baseline-37', sourceHash: 'source-37',
  defaults: [], changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 1,
  review: null, integration: null, limitations: [], evidence: [],
};

function setup(records: Issue[]) {
  const fixture = new Fixture();
  const state = {
    data: { repos: [repo, otherRepo], requirements: [requirement, sibling, foreign], jobs: [], runs: [] } as Workbench,
    issues: records,
    error: '',
  };
  const methods: string[] = [];
  const fetchBoundary = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    methods.push(init?.method ?? 'GET');
    if (String(input) === '/api/workbench' && state.error) {
      fixture.requests.push(String(input));
      return Promise.resolve(Response.json({ error: state.error }, { status: 503 }));
    }
    return fetchBoundary(input, init);
  };
  fixture.response = url => {
    if (url === '/api/workbench') return state.data;
    if (url === '/api/issues') return { issues: state.issues };
    if (url === '/api/issues/37') return { issue: state.issues.find(item => item.id === 37), runs: state.data.runs };
    const selected = state.data.runs.find(item => url === `/api/runs/${item.id}`);
    if (selected) return { run: selected, delivery: { ...report, runId: selected.id, summary: `${selected.id} recorded result` } };
    assert.fail(`Unexpected metadata recovery read: ${url}`);
  };
  return { fixture, state, methods };
}

function control(root: ParentNode, name: string) {
  const found = [...root.querySelectorAll<HTMLElement>('button, a')].find(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name);
  assert.ok(found, `Fixture readiness requires the production ${name} control.`);
  return found;
}

async function inspectRequirement(fixture: Fixture) {
  await fixture.mount(createElement(App));
  await fixture.settle();
  assert.ok(fixture.requests.includes('/api/workbench') && fixture.requests.includes('/api/issues'), 'Fixture readiness requires successful registry and issue reads.');
  const main = fixture.root.querySelector('main')!;
  assert.equal(main.querySelector('h1')?.textContent, 'Repositories', 'Initial load remains directory-first.');
  await fixture.click(control(main, repo.name));
  await fixture.click(control(main, `Inspect requirement ${requirement.title}`));
  const inspection = fixture.named('Requirement inspection');
  assert.ok(inspection, 'Fixture readiness requires deliberate owned requirement inspection.');
  assert.equal(inspection.querySelector('[data-testid="requirement-identity"]')?.textContent, 'Requirement #1');
  assert.equal(inspection.querySelector('[data-testid="requirement-repository-identity"]')?.textContent, 'Repository #1');
  return inspection;
}

function issueIds(fixture: Fixture) {
  const list = fixture.named('Issue list');
  assert.ok(list, 'Selected requirement browsing must retain its actual child list.');
  return [...list.querySelectorAll('li[data-testid^="issue-"]')].map(node => node.getAttribute('data-testid'));
}

function readWarning(fixture: Fixture, error: string) {
  const alert = [...fixture.root.querySelectorAll<HTMLElement>('main [role="alert"]')].find(node => node.textContent?.includes(error));
  assert.ok(alert, 'A failed metadata read must expose the actual server error through an accessible alert beside retained browsing.');
  assert.match(alert.textContent ?? '', /retrying automatically|automatic(?:ally)? retry/i, 'The metadata warning must explain automatic retry.');
  assert.match(fixture.root.querySelector('main')?.textContent ?? '', /previously loaded|last (?:successful|loaded)|cached/i, 'Retained metadata must be identified as previously loaded rather than fresh.');
  assert.equal(fixture.named('Repository directory'), undefined, 'A read error is not successful proof that the selected repository is absent.');
}

test('background registry failures retain scoped child browsing and focus until in-place recovery', async () => {
  const matching = Array.from({ length: 11 }, (_, index) => issue(1001 + index, { title: `Shared child ${String(index + 1).padStart(2, '0')}`, labels: ['inside'], status: 'blocked' }));
  const { fixture, state, methods } = setup([
    ...matching,
    issue(2001, { title: 'Unrelated search', labels: ['inside'], status: 'blocked' }),
    issue(2002, { title: 'Shared closed', labels: ['inside'], status: 'closed' }),
    issue(2003, { title: 'Shared other label', labels: ['outside'], status: 'blocked' }),
    issue(2004, { title: 'Shared sibling', labels: ['inside'], status: 'blocked', work: { repoId: 1, requirementId: 2, dependsOn: [], acceptance: [] } }),
    issue(2005, { title: 'Shared foreign', labels: ['inside'], status: 'blocked', work: { repoId: 2, requirementId: 1, dependsOn: [], acceptance: [] } }),
  ]);
  try {
    const inspection = await inspectRequirement(fixture);
    const input = fixture.named('Search issues') as HTMLInputElement;
    assert.ok(input?.matches('input'), 'Fixture readiness requires the actual controlled issue search input.');
    await fixture.focus(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(fixture.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Shared');
      input.dispatchEvent(new fixture.dom.window.Event('input', { bubbles: true }));
    });
    await choose(fixture, 'Filter by status', 'Blocked');
    await choose(fixture, 'Filter by label', 'inside');
    await choose(fixture, 'Sort issues', 'Title A–Z');
    await fixture.click(control(fixture.named('Issue pages')!, 'Next page'));
    assert.deepEqual(issueIds(fixture), ['issue-1011'], 'Fixture readiness requires search, status, label, ownership and sorting before the later page.');
    const list = fixture.named('Issue list');
    const row = list!.querySelector('[data-testid="issue-1011"]');
    await fixture.focus(input);
    await fixture.key(input, 'Tab');
    const before = JSON.stringify({ data: state.data, issues: state.issues });
    for (const error of ['Registry temporarily unavailable', 'Registry still unavailable']) {
      state.error = error;
      const reads = fixture.requests.filter(url => url === '/api/workbench').length;
      await fixture.refresh();
      assert.equal(fixture.requests.filter(url => url === '/api/workbench').length, reads + 1, 'Existing automatic polling must attempt each background registry read.');
      assert.equal(fixture.named('Requirement inspection'), inspection, 'A failed background registry read must preserve the same mounted requirement inspection.');
      assert.equal(fixture.named('Issue list'), list, 'A failed registry read must retain the existing child list.');
      assert.equal(fixture.named('Search issues'), input, 'A failed registry read must retain the exact search input.');
      assert.equal(fixture.document.activeElement, input, 'Metadata warnings must not move focus from the child search control.');
      assert.equal(fixture.document.documentElement.dataset.focusIntent, 'keyboard');
      assert.equal(input.value, 'Shared');
      assert.deepEqual(issueIds(fixture), ['issue-1011'], 'Repeated failures must preserve the filtered later page and exclude other ownership.');
      assert.equal(list!.querySelector('[data-testid="issue-1011"]'), row);
      assert.match(fixture.named('Issue pages')?.textContent ?? '', /11–11 of 11 issues/);
      assert.equal(fixture.combobox('Filter by status').textContent, 'Blocked');
      assert.equal(fixture.combobox('Filter by label').textContent, 'inside');
      assert.equal(fixture.combobox('Sort issues').textContent, 'Title A–Z');
      readWarning(fixture, error);
      assert.equal(JSON.stringify({ data: state.data, issues: state.issues }), before, 'Rejected registry reads cannot mutate supplied business state.');
    }
    state.error = '';
    state.data.repos = [{ ...repo, name: 'Recovered repository' }, otherRepo];
    state.data.requirements = [{ ...requirement, title: 'Recovered goal', goal: 'Current original goal', status: 'blocked' }, sibling, foreign];
    state.issues = state.issues.map(item => item.id === 1011 ? { ...item, title: 'Shared child 11 recovered' } : item);
    await fixture.refresh();
    assert.equal(fixture.named('Requirement inspection'), inspection, 'Successful recovery updates the retained requirement in place.');
    assert.equal(fixture.named('Issue list'), list);
    assert.equal(fixture.named('Search issues'), input);
    assert.equal(fixture.document.activeElement, input, 'Successful automatic recovery must preserve search focus.');
    assert.equal(input.value, 'Shared');
    assert.deepEqual(issueIds(fixture), ['issue-1011'], 'Recovery must preserve active filters and page.');
    assert.equal(list!.querySelector('[data-testid="issue-1011"]'), row);
    assert.match(row?.textContent ?? '', /Shared child 11 recovered/, 'The retained child row must consume current issue data.');
    assert.equal(inspection.querySelector('h2')?.textContent, 'Recovered goal');
    assert.equal(inspection.querySelector('[data-testid="requirement-recorded-status"]')?.textContent, 'blocked');
    assert.equal(fixture.named('Original goal')?.querySelector('p')?.textContent, 'Current original goal');
    assert.equal(fixture.root.querySelector('nav[aria-label="Repository views"] strong')?.textContent, 'Recovered repository');
    assert.equal(fixture.root.querySelector('main [role="alert"]'), null, 'A successful registry read clears the transient metadata error.');
    assert.ok(methods.length > 0 && methods.every(method => method === 'GET'), 'Failure polling and recovery remain GET-only.');
  } finally { await fixture.dispose(); }
});

test('owned issue and selected historical report survive registry failures until confirmed repository removal', async () => {
  const { fixture, state, methods } = setup([issue(37, { description: 'Owned diagnostic description' })]);
  state.data.jobs = [job(1), job(2)];
  state.data.runs = [run(1), run(2)];
  try {
    const inspection = await inspectRequirement(fixture);
    await fixture.click(control(fixture.named('Issue list')!, 'Inspect issue Neutral 37'));
    await fixture.settle();
    const dialog = fixture.root.querySelector('dialog')!;
    assert.ok(dialog?.open, 'Fixture readiness requires the real owned issue dialog.');
    assert.match(dialog.textContent ?? '', /Issue #37 · LOC-037/);
    const selector = fixture.combobox('Select execution run');
    assert.match(selector.textContent ?? '', /run-2/, 'Fixture readiness requires a distinguishable latest run before selecting history.');
    await choose(fixture, 'Select execution run', `Issue execution · run-1 · ${now} · passed · completed ${now}`);
    await fixture.settle();
    const selectedReport = fixture.named('Selected report');
    assert.ok(selectedReport, 'Fixture readiness requires a loaded historical report.');
    assert.equal(selectedReport.querySelector('.selected-run-meta code')?.textContent, 'run-1');
    assert.match(selectedReport.textContent ?? '', /run-1 recorded result/);
    assert.doesNotMatch(selectedReport.textContent ?? '', /run-2 recorded result/);
    await fixture.focus(selector);
    state.error = 'Registry inspection read failed';
    await fixture.refresh();
    assert.equal(fixture.root.querySelector('dialog'), dialog, 'A failed registry read must preserve the same owned issue dialog rather than treating metadata unavailability as missing ownership.');
    assert.ok(dialog.open);
    assert.equal(fixture.named('Requirement inspection'), inspection);
    assert.equal(fixture.named('Selected report'), selectedReport, 'Metadata failure must not remount or reset the selected historical report.');
    assert.equal(fixture.combobox('Select execution run'), selector);
    assert.equal(fixture.document.activeElement, selector, 'Metadata failure must preserve the focused dialog control.');
    assert.equal(selectedReport.querySelector('.selected-run-meta code')?.textContent, 'run-1');
    assert.match(selectedReport.textContent ?? '', /run-1 recorded result/);
    assert.equal(fixture.named('Requirement context')?.querySelector('p')?.textContent, requirement.goal, 'Read failure retains actual owned requirement context.');
    readWarning(fixture, state.error);
    assert.match(dialog.textContent ?? '', /Execution metadata unavailable: Registry inspection read failed/, 'Owned diagnostics retain their real metadata-read warning.');
    state.error = '';
    state.data.requirements = [{ ...requirement, goal: 'Recovered diagnostic context' }, sibling, foreign];
    state.issues = [issue(37, { description: 'Recovered owned description' })];
    await fixture.refresh();
    assert.equal(fixture.root.querySelector('dialog'), dialog, 'Automatic recovery updates the same dialog without manual re-entry.');
    assert.equal(fixture.named('Requirement inspection'), inspection);
    assert.equal(fixture.named('Selected report'), selectedReport);
    assert.equal(fixture.document.activeElement, selector);
    assert.equal(selector.textContent, `Issue execution · run-1 · ${now} · passed · completed ${now}`, 'Recovery must not revert the explicit historical selection to the latest run.');
    assert.equal(selectedReport.querySelector('.selected-run-meta code')?.textContent, 'run-1');
    assert.match(selectedReport.textContent ?? '', /run-1 recorded result/);
    assert.equal(fixture.named('Requirement context')?.querySelector('p')?.textContent, 'Recovered diagnostic context');
    assert.match(dialog.textContent ?? '', /Recovered owned description/);
    assert.doesNotMatch(dialog.textContent ?? '', /Execution metadata unavailable|Registry inspection read failed/);
    assert.equal(fixture.root.querySelector('main [role="alert"]'), null);
    state.data.repos = [otherRepo];
    await fixture.refresh();
    assert.equal(fixture.root.querySelector('main h1')?.textContent, 'Repositories', 'A successful registry response confirming removal returns to the directory.');
    for (const name of ['Requirement inspection', 'Issue list', 'Selected report', 'Evidence preview']) {
      assert.equal(fixture.named(name), undefined, `Confirmed repository removal must clear obsolete ${name}.`);
    }
    assert.equal(fixture.root.querySelector('dialog'), null);
    assert.equal(fixture.named('Requirement list'), undefined, 'Removal cannot implicitly select the remaining repository.');
    const directory = fixture.named('Repository directory');
    assert.ok(directory);
    control(directory, otherRepo.name);
    const reads = fixture.requests.length;
    await fixture.refresh();
    assert.ok(fixture.requests.slice(reads).every(url => url !== '/api/issues/37' && !url.startsWith('/api/runs/')), 'Confirmed removal stops obsolete issue and report readers.');
    await fixture.click(control(directory, otherRepo.name));
    assert.equal(fixture.named('Requirement inspection'), undefined, 'A later explicit repository selection cannot resurrect removed requirement scope.');
    assert.deepEqual([...fixture.root.querySelectorAll('li[data-testid^="requirement-"]')].map(node => node.getAttribute('data-testid')), ['requirement-3']);
    assert.ok(methods.length > 0 && methods.every(method => method === 'GET'), 'Owned diagnostics, registry failures, recovery and removal perform GET reads only.');
  } finally { await fixture.dispose(); }
});
