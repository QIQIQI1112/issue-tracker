import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';
import { WorkspaceLayout } from '../src/ui/layout/WorkspaceLayout.tsx';
import { Issues } from '../src/ui/features/issues/Issues.tsx';
import { useIssueCollection } from '../src/ui/shared/useIssueCollection.ts';
import { IssueFixture } from './dropdown-fixture.ts';
import { activeJob, currentBlockers, executionContext, requirementProgress, waitingDependencies } from '../src/ui/workbench-state.ts';
import type { Issue } from '../src/domain.ts';
import type { Job, Requirement, Workbench as Data, WorkRun } from '../src/workflow.ts';

const now = '2026-10-15T00:00:00.000Z';
const repo = { id: 1, name: 'Dashboard repository', path: '/disposable/dashboard', targetBranch: 'main', createdAt: now };
const requirement = (id = 1, status: Requirement['status'] = 'draft'): Requirement => ({ id, repoId: 1, title: `Business requirement ${id}`, goal: `Original business goal ${id}`, status, createdAt: now, updatedAt: now });
const child = (id: number, requirementId = 1, status: Issue['status'] = 'open'): Issue => ({ id, title: `Child behavior ${id}`, description: 'Observable behavior.', status, priority: 'medium', labels: [], createdAt: now, updatedAt: now, work: { repoId: 1, requirementId, dependsOn: [], acceptance: ['The behavior works.'] } });
const job = (id: number, kind: Job['kind'], status: Job['status'], issueId: number | null = null, requirementId = 1): Job => ({ id, kind, status, issueId, requirementId, repoId: 1, payload: '{}', runId: `run-${id}`, reason: null, createdAt: now, updatedAt: now });
const run = (id: number, status: WorkRun['status'], issueId: number | null = null, requirementId = 1): WorkRun => ({ id: `run-${id}`, jobId: id, repoId: 1, requirementId, issueId, status, evidencePath: `/disposable/evidence/${id}`, reason: null, startedAt: now, completedAt: status === 'running' ? null : now });
const data = (changes: Partial<Data> = {}): Data => ({ repos: [repo], requirements: [requirement()], jobs: [], runs: [], ...changes });

function outcome(value: Data, issues: Issue[], expected: string, scenario: string) {
  assert.equal(requirementProgress(value, issues, value.requirements[0]).outcome, expected, scenario);
}

test('execution context identifies real repository requirement issue and standalone ownership', () => {
  const value = data();
  assert.equal(executionContext(value, [child(1)], run(1, 'merged', 1)), 'Dashboard repository · Business requirement 1 · #1 Child behavior 1');
  assert.equal(executionContext(value, [], { repoId: 1, requirementId: null, issueId: null }), 'Dashboard repository · Standalone issue');
  assert.equal(executionContext(value, [], { repoId: 2, requirementId: 2, issueId: 2 }), 'Repository #2 · Requirement #2 · #2 Issue');
});

test('workspace issue navigation retains an explicit initial active state', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceLayout, {
    repos: [repo], repoFilter: String(repo.id), selectedRepo: repo, subview: 'requirements', registryLoading: false, workbenchError: '',
    chooseRepository: () => {}, setSubview: () => {}, refreshRepositories: () => {}, children: createElement(IssueFixture),
  }));
  const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(item => item[0]);
  const active = buttons.find(button => button.includes(`aria-label="${repo.name}"`));
  assert.ok(active, repo.name);
  assert.match(active, /aria-pressed="true"/);
  assert.equal(buttons.filter(button => button.includes('aria-pressed="true"')).length, 1);
  const status = html.match(/<select[^>]*aria-label="Filter by status"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(status);
  for (const value of ['all', 'open', 'in_progress', 'done']) assert.match(status, new RegExp(`<option[^>]*value="${value}"`));
  assert.match(status, /<option[^>]*value="all"[^>]*selected=""/);
});

test('requirement metadata counts distinct owned merged child runs', () => {
  const cases = [
    { name: 'zero children', issues: [], runs: [], merged: 0, count: 0 },
    { name: 'manual Done', issues: [child(1, 1, 'done'), child(2)], runs: [], merged: 0, count: 2 },
    { name: 'partial distinct merges', issues: [child(1), child(2), child(3, 2)], runs: [run(1, 'merged', 1), run(2, 'merged', 1), run(3, 'passed', 2), run(4, 'merged', 3, 2)], merged: 1, count: 2 },
    { name: 'unrelated ownership', issues: [child(1)], runs: [{ ...run(1, 'merged', 1), repoId: 2 }, run(2, 'merged', 1, 2)], merged: 0, count: 1 },
    { name: 'all children merged', issues: [child(1), child(2)], runs: [run(1, 'merged', 1), run(2, 'merged', 2)], merged: 2, count: 2 },
  ];
  for (const item of cases) {
    const state = requirementProgress(data({ runs: item.runs }), item.issues, requirement());
    assert.equal(state.merged, item.merged, item.name);
    assert.equal(state.children.length, item.count, item.name);
  }
});

test('whole-requirement outcome requires completed final verification after child merges', () => {
  const issues = [child(1, 1, 'done')];
  const base = data({ requirements: [{ ...requirement(1, 'done'), title: 'Verified title must not count', goal: 'Verified original goal must not count' }], jobs: [job(1, 'issue', 'completed', 1), job(2, 'plan_review', 'completed')], runs: [run(1, 'merged', 1), run(2, 'passed')] });
  outcome(base, issues, 'Whole goal not yet verified', 'Passed plan_review and all child merges');
  outcome(data({ requirements: [requirement(1, 'done')] }), [], 'Whole goal not yet verified', 'Zero children and manually selected Done');
  for (const [status, expected] of [['queued', 'Whole-goal verification queued'], ['running', 'Whole-goal verification running'], ['blocked', 'Whole-goal verification blocked']] as const) {
    outcome({ ...base, jobs: [...base.jobs, job(3, 'requirement_verify', status)], runs: [...base.runs, run(3, status === 'running' ? 'running' : 'blocked')] }, issues, expected, `Latest final verification ${status}`);
  }
  const verified = { ...base, jobs: [...base.jobs, job(3, 'requirement_verify', 'completed')], runs: [...base.runs, run(3, 'passed')] };
  outcome(verified, issues, 'Whole goal verified', 'Owned completed final verification and every child merged');
  outcome(verified, [...issues, child(2)], 'Whole goal not yet verified', 'Final pass cannot cover an unmerged child');
  outcome(verified, [], 'Whole goal not yet verified', 'Final pass with zero children');
  for (const override of [{ repoId: 2 }, { requirementId: 2 }, { jobId: 99 }]) {
    outcome({ ...verified, runs: [run(1, 'merged', 1), { ...run(3, 'passed'), ...override }] }, issues, 'Whole goal not yet verified', 'Unrelated final run ownership');
  }
  for (const override of [{ repoId: 2 }, { requirementId: 2 }]) {
    outcome({ ...verified, jobs: [job(1, 'issue', 'completed', 1), { ...job(3, 'requirement_verify', 'completed'), ...override }] }, issues, 'Whole goal not yet verified', 'Unrelated final job ownership');
  }
  outcome({ ...verified, jobs: [...verified.jobs, job(4, 'requirement_verify', 'completed')] }, issues, 'Whole goal not yet verified', 'Latest completed final job has no passed run');
  for (const [status, expected] of [['queued', 'Whole-goal verification queued'], ['running', 'Whole-goal verification running'], ['blocked', 'Whole-goal verification blocked']] as const) {
    outcome({ ...verified, jobs: [...verified.jobs, job(4, 'requirement_verify', status)] }, issues, expected, `Older passed final attempt cannot override newer ${status} attempt`);
  }
});

test('queue metadata distinguishes running ready and dependency-waiting work', () => {
  const first = child(1, 1, 'done');
  const waiting = { ...child(3), work: { ...child(3).work!, dependsOn: [1] } };
  const value = data({ jobs: [job(1, 'issue', 'running', 2), job(2, 'issue', 'queued', 4), job(3, 'issue', 'queued', 3)] });
  const issues = [first, child(2), waiting, child(4)];
  assert.deepEqual(value.jobs.filter(activeJob).map(item => item.status), ['running', 'queued', 'queued']);
  assert.deepEqual(waitingDependencies(value, issues, value.jobs[1]), []);
  assert.deepEqual(waitingDependencies(value, issues, value.jobs[2]), [1]);
  assert.deepEqual(waitingDependencies({ ...value, runs: [run(4, 'merged', 1)] }, issues, value.jobs[2]), []);
});

test('current blockers use the latest matching attempts and exclude recovered failures', () => {
  const jobs = [
    { ...job(1, 'issue', 'blocked', 1), reason: 'Recovered child failure' }, job(2, 'issue', 'completed', 1),
    { ...job(3, 'issue', 'blocked', 2), reason: 'Unresolved sibling failure' },
    { ...job(4, 'plan_review', 'blocked'), reason: 'Recovered planning failure' }, job(5, 'plan_review', 'completed'),
    { ...job(6, 'decompose', 'blocked', null, 2), reason: 'Current decomposition failure' },
    { ...job(7, 'requirement_verify', 'blocked', null, 3), reason: 'Current whole-goal failure' },
    { ...job(8, 'plan_review', 'blocked', null, 4), reason: 'Current planning failure' },
  ];
  const value = data({ requirements: [requirement(1, 'blocked'), requirement(2, 'blocked'), requirement(3, 'blocked'), requirement(4, 'blocked')], jobs, runs: [run(1, 'blocked', 1), run(2, 'merged', 1)] });
  const blockers = currentBlockers(value, [child(1), child(2)]).map(item => item.reason).join(' ');
  for (const reason of ['Unresolved sibling failure', 'Current decomposition failure', 'Current whole-goal failure', 'Current planning failure']) assert.ok(blockers.includes(reason), `Current blockers must retain ${reason}.`);
  for (const reason of ['Recovered child failure', 'Recovered planning failure']) assert.ok(!blockers.includes(reason), `Recovered attempts must not remain current blockers: ${reason}.`);
  assert.equal(value.jobs.some(activeJob), false, 'Inactive blocked work remains eligible for a guarded retry.');
  assert.equal([...value.jobs, job(9, 'issue', 'queued', 2)].some(activeJob), true, 'Queued work remains active and duplicate admission is checked through the real API.');
  for (const kind of ['decompose', 'plan_review', 'requirement_verify'] as const) {
    const failed = { ...job(1, kind, 'blocked'), reason: `Recovered ${kind} failure` };
    const recovered = data({ jobs: [failed, job(2, kind, 'completed')], runs: [run(1, 'blocked'), run(2, 'passed')] });
    assert.ok(!currentBlockers(recovered, [child(1)]).some(item => item.reason === failed.reason), `A successful ${kind} retry must supersede its historical failure.`);
  }
});

test('indexed delivery context preserves failed merged and whole-goal ownership', () => {
  const value = data({ jobs: [job(1, 'issue', 'blocked', 1), job(2, 'issue', 'completed', 1), job(3, 'requirement_verify', 'completed')], runs: [run(2, 'merged', 1), run(1, 'blocked', 1), run(3, 'passed')] });
  assert.deepEqual(value.runs.map(item => [item.id, item.status]), [['run-2', 'merged'], ['run-1', 'blocked'], ['run-3', 'passed']]);
  for (const item of value.runs) {
    const context = executionContext(value, [child(1)], item);
    assert.ok(context.includes(repo.name));
    assert.ok(context.includes('Business requirement 1'));
    if (item.issueId) assert.ok(context.includes('Child behavior 1'));
    assert.ok(value.jobs.some(job => job.id === item.jobId && job.runId === item.id));
  }
});

test('initial issue controls expose accessible names and live loading semantics', () => {
  function LoadingIssues() {
    const collection = useIssueCollection([], String(repo.id));
    return createElement(Issues, { collection, issues: [], loading: true, loadError: null, retryIssues: () => {}, resetFilters: collection.resetFilters, onIssue: () => {} });
  }
  const html = renderToStaticMarkup(createElement(LoadingIssues));
  const workspace = renderToStaticMarkup(createElement(App));
  for (const name of ['Search issues', 'Filter by status', 'Filter by label', 'Sort issues', 'Issue list']) assert.ok(html.includes(`aria-label="${name}"`), name);
  assert.match(workspace, /aria-label="(?:Filter by repository|Repositories)"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<h1>Issues<\/h1>/);
});
