import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { App } from '../src/ui/App.tsx';
import type { Delivery, Workbench } from '../src/workflow.ts';
import { Fixture, choose, issue, job, now, repo, requirement, run } from './dropdown-fixture.ts';

const secondRepo = { ...repo, id: 2, name: 'Second repository', path: '/disposable/second' };
const emptyRepo = { ...repo, id: 3, name: 'Empty repository', path: '/disposable/empty' };
const foreignRequirement = { ...requirement, id: 3, repoId: 2, title: 'Foreign goal' };
const report: Delivery = {
  schemaVersion: 1, runId: 'run-1', taskId: 'issue-37', title: 'Directory audit', goal: 'Inspect recorded evidence',
  status: 'blocked', startedAt: now, completedAt: now, baseline: 'baseline-37', sourceHash: 'source-37',
  defaults: [], changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 1,
  review: { approved: false, summary: 'Directory recorded rejection' }, integration: null, limitations: [],
  evidence: [{ path: 'logs/owned.txt', bytes: 18, sha256: 'a'.repeat(64) }],
};

function setup() {
  const fixture = new Fixture();
  const state = {
    data: { repos: [repo, secondRepo, emptyRepo], requirements: [requirement, foreignRequirement], jobs: [job(1)], runs: [run(1)] } as Workbench,
    issues: [issue(37, { description: 'Directory owned description' }), issue(40, { title: 'Foreign child', work: { repoId: 2, requirementId: 3, dependsOn: [], acceptance: [] } })],
  };
  const methods: string[] = [];
  const fetchBoundary = globalThis.fetch;
  let registryResponse: (() => Promise<Response>) | undefined;
  let releasePending: (() => void) | undefined;
  globalThis.fetch = (input, init) => {
    methods.push(init?.method ?? 'GET');
    if (String(input) === '/api/workbench' && registryResponse) {
      fixture.requests.push(String(input));
      return registryResponse();
    }
    return fetchBoundary(input, init);
  };
  fixture.response = url => {
    if (url === '/api/workbench') return state.data;
    if (url === '/api/issues') return { issues: state.issues };
    if (url === '/api/issues/37') return { issue: state.issues[0], runs: [run(1)] };
    if (url === '/api/runs/run-1') return { run: run(1), delivery: report };
    if (url === '/api/runs/run-1/evidence?file=logs%2Fowned.txt') return 'Owned evidence log';
    assert.fail(`Unexpected directory inspection read: ${url}`);
  };
  function holdRegistry() {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    registryResponse = () => pending;
    releasePending = () => resolve(Response.json(state.data));
    return async (error?: string) => {
      registryResponse = undefined;
      await act(async () => { resolve(error ? Response.json({ error }, { status: 503 }) : Response.json(state.data)); });
      await fixture.settle();
    };
  }
  async function dispose() {
    await act(async () => { releasePending?.(); });
    await fixture.dispose();
  }
  return { fixture, state, methods, holdRegistry, dispose };
}

function findControl(root: ParentNode, name: string) {
  return [...root.querySelectorAll<HTMLElement>('button, a')].find(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name);
}

function control(root: ParentNode, name: string) {
  const found = findControl(root, name);
  assert.ok(found, `The current directory scope must expose the ${name} control.`);
  return found;
}

function main(fixture: Fixture) {
  const element = fixture.root.querySelector('main');
  assert.ok(element, 'Fixture readiness requires the production main content.');
  return element;
}

async function mount(fixture: Fixture) {
  await fixture.mount(createElement(App));
  await fixture.settle();
  assert.ok(fixture.requests.includes('/api/workbench') && fixture.requests.includes('/api/issues'), 'Fixture readiness requires both actual metadata requests.');
}

function fixedEntry(fixture: Fixture) {
  const navigation = fixture.root.querySelector('nav[aria-label="Workspace views"]');
  assert.ok(navigation, 'The production Workspace views navigation must be present.');
  const destinations = [...navigation.querySelectorAll('button, a')];
  assert.deepEqual(destinations.map(node => node.getAttribute('aria-label') ?? node.textContent?.trim()), ['Repositories'], 'Workspace views must contain exactly one fixed Repositories destination, with no registry or concrete repository controls.');
  assert.equal(destinations[0].getAttribute('aria-pressed'), 'true', 'Repositories remains the active primary destination in every subordinate scope.');
}

function directory(fixture: Fixture, names: string[]) {
  assert.equal(main(fixture).querySelector('h1')?.textContent?.trim(), 'Repositories', 'Main must display the Repositories directory instead of implicitly selecting a repository.');
  for (const name of names) control(main(fixture), name);
  assert.equal(fixture.named('Requirement list'), undefined, 'The directory must not expose an implicitly selected repository requirement list.');
  assert.equal(fixture.named('Issue list'), undefined, 'The directory must not expose an obsolete child collection.');
}

function registryAction(fixture: Fixture, name: string) {
  const action = control(main(fixture), name);
  assert.ok(action.closest('header, .page-header, nav, [role="toolbar"]'), `${name} belongs in the directory upper toolbar.`);
  for (const repository of ['Dropdown fixture', 'Second repository', 'Empty repository']) {
    const entry = findControl(main(fixture), repository);
    if (entry) assert.ok(action.compareDocumentPosition(entry) & fixture.dom.window.Node.DOCUMENT_POSITION_FOLLOWING, `${name} precedes the repository directory records.`);
  }
  return action as HTMLButtonElement;
}

function cleanInspection(fixture: Fixture) {
  for (const name of ['Requirement inspection', 'Issue list', 'Selected report', 'Evidence preview']) {
    assert.equal(fixture.named(name), undefined, `Returning to Repositories must unmount obsolete ${name}.`);
  }
  assert.equal(fixture.root.querySelector('dialog'), null, 'Returning to Repositories must clear the previous issue dialog.');
  assert.doesNotMatch(main(fixture).textContent ?? '', /Directory owned description|Directory recorded rejection|Owned evidence log/, 'Previous owned observations cannot remain in the directory or another repository.');
}

test('Workspace views contains one fixed Repositories destination for empty populated loading and failed registries', async () => {
  const { fixture, state, holdRegistry, dispose } = setup();
  const release = holdRegistry();
  try {
    await mount(fixture);
    fixedEntry(fixture);
    await release('Registry fixture unavailable');
    fixedEntry(fixture);
    state.data = { repos: [], requirements: [], jobs: [], runs: [] };
    await fixture.refresh();
    fixedEntry(fixture);
    state.data.repos = [repo, secondRepo, emptyRepo];
    await fixture.refresh();
    fixedEntry(fixture);
    await fixture.click(control(main(fixture), 'Second repository'));
    fixedEntry(fixture);
  } finally { await dispose(); }
});

test('initial metadata preserves focus and opens the repository directory before explicit repository selection', async () => {
  const { fixture, holdRegistry, dispose } = setup();
  const release = holdRegistry();
  try {
    await mount(fixture);
    const focused = control(fixture.root, 'Expand navigation rail');
    await fixture.focus(focused);
    await fixture.key(focused, 'Tab');
    await release();
    assert.equal(fixture.document.activeElement, focused, 'Initial metadata resolution must retain the exact focused keyboard control.');
    directory(fixture, ['Dropdown fixture', 'Second repository', 'Empty repository']);
    await fixture.click(control(main(fixture), 'Second repository'));
    assert.deepEqual([...main(fixture).querySelectorAll('li[data-testid^="requirement-"]')].map(node => node.getAttribute('data-testid')), ['requirement-3'], 'Explicit directory selection opens only the selected repository requirements.');
    const toolbar = main(fixture).querySelector('nav[aria-label="Repository views"]');
    assert.ok(toolbar, 'Selected repository destinations stay in the upper toolbar.');
    for (const name of ['Requirements', 'Repo harness', 'Unassigned']) control(toolbar, name);
    assert.equal(control(toolbar, 'Requirements').getAttribute('aria-current'), 'page', 'Explicit repository selection starts in Requirements.');
    assert.match(toolbar.textContent ?? '', /Second repository/, 'The upper toolbar identifies the actual selected repository name.');
    assert.match(toolbar.textContent ?? '', /Repository #2|\/disposable\/second/, 'The upper toolbar exposes the actual selected repository identity.');
    assert.equal(fixture.named('Issue list'), undefined, 'Repository selection does not open a global child collection.');
    fixedEntry(fixture);
  } finally { await dispose(); }
});

test('directory Refresh and Retry perform read-only registry recovery with truthful loading empty and error states', async () => {
  const { fixture, state, methods, holdRegistry, dispose } = setup();
  const original = JSON.stringify(state);
  try {
    await mount(fixture);
    const refresh = registryAction(fixture, 'Refresh repositories');
    const release = holdRegistry();
    const reads = fixture.requests.filter(url => url === '/api/workbench').length;
    await fixture.click(refresh);
    assert.equal(fixture.requests.filter(url => url === '/api/workbench').length, reads + 1, 'Directory Refresh must actually request fresh registry metadata.');
    assert.equal(refresh.disabled, true, 'A pending directory refresh cannot be activated again.');
    assert.equal(refresh.getAttribute('aria-busy'), 'true', 'The shared refresh control reports its pending read.');
    assert.ok([...main(fixture).querySelectorAll('[role="status"]')].some(node => /Loading repositories/.test(node.textContent ?? '')), 'Pending registry metadata has an accessible loading state in main.');
    assert.equal(findControl(main(fixture), 'Dropdown fixture'), undefined, 'Pending refresh cannot expose stale repository selection.');
    await release('Registry fixture unavailable');
    assert.ok([...main(fixture).querySelectorAll('[role="alert"]')].some(node => /Registry fixture unavailable/.test(node.textContent ?? '')), 'A failed registry read exposes its actual recoverable error in main.');
    assert.equal(findControl(main(fixture), 'Second repository'), undefined, 'Failed registry metadata cannot expose stale repository details.');
    const retry = registryAction(fixture, 'Retry repositories');
    const retryReads = fixture.requests.filter(url => url === '/api/workbench').length;
    await fixture.click(retry);
    await fixture.settle();
    assert.equal(fixture.requests.filter(url => url === '/api/workbench').length, retryReads + 1, 'Directory Retry must perform a new registry GET.');
    directory(fixture, ['Dropdown fixture', 'Second repository', 'Empty repository']);
    assert.equal(main(fixture).querySelector('[role="alert"]'), null, 'Successful retry clears the obsolete metadata error.');
    assert.equal(JSON.stringify(state), original, 'Refresh and Retry do not mutate actual supplied records.');
    await fixture.click(control(main(fixture), 'Dropdown fixture'));
    state.data = { repos: [secondRepo], requirements: [foreignRequirement], jobs: [], runs: [] };
    await fixture.refresh();
    directory(fixture, ['Second repository']);
    assert.equal(findControl(main(fixture), 'Dropdown fixture'), undefined, 'A removed selected repository cannot remain available or trigger implicit fallback selection.');
    cleanInspection(fixture);
    state.data = { repos: [], requirements: [], jobs: [], runs: [] };
    await fixture.click(registryAction(fixture, 'Refresh repositories'));
    await fixture.settle();
    directory(fixture, []);
    assert.match(main(fixture).textContent ?? '', /No enrolled repositories/, 'An empty registry is distinct from loading and failure.');
    assert.equal(findControl(main(fixture), 'Second repository'), undefined, 'An empty registry retains no previous repository selector.');
    state.data.repos = [emptyRepo];
    await fixture.click(registryAction(fixture, 'Refresh repositories'));
    await fixture.settle();
    directory(fixture, ['Empty repository']);
    assert.ok(methods.length > 0 && methods.every(method => method === 'GET'), 'Directory recovery and selection perform only read requests.');
    assert.deepEqual(state.data.requirements, [], 'Directory recovery never creates a synthetic requirement.');
  } finally { await dispose(); }
});

test('returning to Repositories clears owned inspection before another repository is selected', async () => {
  const { fixture, state, methods, dispose } = setup();
  const original = JSON.stringify(state);
  try {
    await mount(fixture);
    await fixture.click(control(fixture.root, 'Dropdown fixture'));
    await fixture.click(control(main(fixture), 'Inspect requirement Scoped goal'));
    await fixture.click(control(fixture.named('Issue list')!, 'Inspect issue Neutral 37'));
    await fixture.settle();
    assert.match(fixture.root.querySelector('dialog')?.textContent ?? '', /Issue #37 · LOC-037/, 'Fixture readiness requires the actual owned issue diagnostics.');
    assert.match(fixture.named('Selected report')?.textContent ?? '', /Directory recorded rejection/, 'Fixture readiness requires the actual owned report response.');
    await choose(fixture, 'Select evidence artifact', 'logs/owned.txt · 18 bytes');
    await fixture.settle();
    assert.equal(fixture.named('Evidence preview')?.querySelector('pre')?.textContent, 'Owned evidence log', 'Fixture readiness requires the actual owned evidence response.');
    await fixture.click(control(fixture.root.querySelector('nav[aria-label="Workspace views"]')!, 'Repositories'));
    directory(fixture, ['Dropdown fixture', 'Second repository', 'Empty repository']);
    cleanInspection(fixture);
    const reads = fixture.requests.length;
    await fixture.refresh();
    assert.ok(fixture.requests.slice(reads).every(url => !url.startsWith('/api/issues/37') && !url.startsWith('/api/runs/')), 'Returning to the directory stops obsolete issue report and evidence readers.');
    await fixture.click(control(main(fixture), 'Second repository'));
    cleanInspection(fixture);
    assert.deepEqual([...main(fixture).querySelectorAll('li[data-testid^="requirement-"]')].map(node => node.getAttribute('data-testid')), ['requirement-3'], 'Another directory selection exposes only its actual requirements.');
    await fixture.click(control(main(fixture), 'Inspect requirement Foreign goal'));
    assert.deepEqual([...fixture.named('Issue list')!.querySelectorAll('li[data-testid^="issue-"]')].map(node => node.getAttribute('data-testid')), ['issue-40'], 'The new repository cannot inherit the previous repository children.');
    await fixture.click(control(main(fixture), 'Unassigned'));
    await fixture.click(control(fixture.root.querySelector('nav[aria-label="Workspace views"]')!, 'Repositories'));
    await fixture.click(control(main(fixture), 'Dropdown fixture'));
    assert.equal(control(main(fixture), 'Requirements').getAttribute('aria-current'), 'page', 'Returning to the directory resets the next repository selection to Requirements.');
    assert.equal(fixture.named('Requirement inspection'), undefined, 'Reopening the original repository does not restore obsolete requirement selection.');
    assert.equal(fixture.named('Issue list'), undefined, 'Reopening the original repository does not restore obsolete child filters or Unassigned.');
    assert.equal(JSON.stringify(state), original, 'Navigation preserves supplied repositories requirements and issue ownership.');
    assert.ok(methods.length > 0 && methods.every(method => method === 'GET'), 'Directory return diagnostics evidence and reselection perform only GET reads.');
  } finally { await dispose(); }
});
