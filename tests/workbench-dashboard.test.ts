import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workbench } from '../src/ui/Workbench.tsx';
import { App } from '../src/ui/App.tsx';
import type { Issue } from '../src/domain.ts';
import type { Job, Requirement, Workbench as Data, WorkRun } from '../src/workflow.ts';

const now = '2026-10-15T00:00:00.000Z';
const repo = { id: 1, name: 'Dashboard repository', path: '/disposable/dashboard', targetBranch: 'main', createdAt: now };
const requirement = (id = 1, status: Requirement['status'] = 'draft'): Requirement => ({ id, repoId: 1, title: `Business requirement ${id}`, goal: `Original business goal ${id}`, status, createdAt: now, updatedAt: now });
const child = (id: number, requirementId = 1, status: Issue['status'] = 'open'): Issue => ({ id, title: `Child behavior ${id}`, description: 'Observable behavior.', status, priority: 'medium', labels: [], createdAt: now, updatedAt: now, work: { repoId: 1, requirementId, dependsOn: [], acceptance: ['The behavior works.'] } });
const job = (id: number, kind: Job['kind'], status: Job['status'], issueId: number | null = null, requirementId = 1): Job => ({ id, kind, status, issueId, requirementId, repoId: 1, payload: '{}', runId: `run-${id}`, reason: null, createdAt: now, updatedAt: now });
const run = (id: number, status: WorkRun['status'], issueId: number | null = null, requirementId = 1): WorkRun => ({ id: `run-${id}`, jobId: id, repoId: 1, requirementId, issueId, status, evidencePath: `/disposable/evidence/${id}`, reason: null, startedAt: now, completedAt: status === 'running' ? null : now });
const data = (changes: Partial<Data> = {}): Data => ({ repos: [repo], requirements: [requirement()], jobs: [], runs: [], ...changes });
const render = (value: Data, issues: Issue[] = []) => renderToStaticMarkup(createElement(Workbench, { data: value, issues, refresh: () => {}, openIssue: () => {} }));
const text = (html: string) => html.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replace(/\s+/g, ' ').trim();

function named(html: string, name: string): string {
  const tokens = [...html.matchAll(/<(\/?)([a-z][\w-]*)\b[^>]*>/g)];
  const index = tokens.findIndex(token => !token[1] && token[0].includes(`aria-label="${name}"`));
  assert.ok(index >= 0, `Dashboard must expose the separately named ${name} element.`);
  const opening = tokens[index];
  let depth = 1;
  for (const token of tokens.slice(index + 1)) {
    if (token[2] !== opening[2]) continue;
    depth += token[1] ? -1 : 1;
    if (!depth) return html.slice(opening.index, token.index! + token[0].length);
  }
  assert.fail(`${name} must be a complete rendered element.`);
}

function outcome(value: Data, issues: Issue[], expected: string, scenario: string) {
  assert.equal(text(named(render(value, issues), 'Whole-requirement outcome')), expected, `${scenario}: whole-goal outcome must be independent of titles, child progress, and planning approval.`);
}

test('Workbench renders execution content before collapsed manual creation and repository setup', () => {
  const html = render(data({ requirements: [], repos: [] }));
  assert.match(html, /<h1>Workbench<\/h1>/, 'The execution page must identify Workbench.');
  const headings = ['Execution summary', 'Requirements', 'Execution queue', 'Current blockers', 'Delivery history', 'Create requirement manually', 'Repositories'];
  let previous = -1;
  for (const heading of headings) {
    const position = html.indexOf(`>${heading}<`);
    assert.ok(position > previous, `${heading} must follow the preceding execution section.`);
    previous = position;
  }
  assert.match(html, /<details\b(?![^>]*\bopen)[^>]*>\s*<summary[^>]*>Create requirement manually<\/summary>/, 'Manual creation must start collapsed in a native disclosure.');
  assert.match(text(html), /submit.{0,80}business goal.{0,80}Codex|Codex.{0,80}business goal/i, 'Empty execution guidance must describe submitting a business goal from Codex.');
  assert.match(text(html), /without.{0,40}(form|manual)|no.{0,30}(website form|form required)/i, 'Empty guidance must explain that website form entry is optional.');
  const populated = render(data({ requirements: [requirement(1, 'done'), requirement(2, 'blocked'), requirement(3, 'queued'), requirement(4, 'running')] }));
  const order = [...populated.matchAll(/<h3[^>]*>Business requirement (\d)<\/h3>/g)].map(match => Number(match[1]));
  assert.deepEqual(order, [4, 3, 2, 1], 'Current running, queued, and blocked requirements must precede completed history.');
});

test('workspace navigation exposes a Workbench control with an explicit inactive state', () => {
  const html = renderToStaticMarkup(createElement(App));
  const navigation = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match => text(match[0]) === 'Workbench')?.[0];
  assert.ok(navigation, 'Workspace navigation must expose a Workbench button.');
  assert.match(navigation, /aria-pressed="false"/, 'Workbench navigation must have an accessible inactive state in the initial Issues view.');
  assert.match(html, /aria-pressed="true"[^>]*>.*?All issues/s, 'Initial issue navigation must remain selected.');
});

test('requirement cards count distinct merged child runs and retain original context', () => {
  const contextual = { ...requirement(), submission: { id: 'conversation-id', planHash: 'hash', source: { kind: 'codex' as const, reference: 'codex://original-conversation', summary: 'Conversation source summary' } } };
  const cases = [
    { name: 'zero children', issues: [], runs: [], expected: '0 of 0 child issues merged' },
    { name: 'manual Done', issues: [child(1, 1, 'done'), child(2)], runs: [], expected: '0 of 2 child issues merged' },
    { name: 'partial distinct merges', issues: [child(1), child(2), child(3, 2)], runs: [run(1, 'merged', 1), run(2, 'merged', 1), run(3, 'passed', 2), run(4, 'merged', 3, 2)], expected: '1 of 2 child issues merged' },
    { name: 'unrelated ownership', issues: [child(1)], runs: [{ ...run(1, 'merged', 1), repoId: 2 }, run(2, 'merged', 1, 2)], expected: '0 of 1 child issues merged' },
    { name: 'all children merged', issues: [child(1), child(2)], runs: [run(1, 'merged', 1), run(2, 'merged', 2)], expected: '2 of 2 child issues merged' },
  ];
  for (const item of cases) {
    const html = render(data({ requirements: [contextual], runs: item.runs }), item.issues);
    assert.equal(text(named(html, 'Verified child progress')), item.expected, `${item.name}: only distinct owned recorded merges count.`);
    for (const context of [contextual.goal, repo.name, contextual.submission.source.reference, contextual.submission.source.summary, contextual.submission.id]) assert.ok(text(html).includes(context), `Original requirement context must retain ${context}.`);
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

test('queue presentation distinguishes running, ready and dependency-waiting jobs', () => {
  const first = child(1, 1, 'done');
  const waiting = { ...child(3), work: { ...child(3).work!, dependsOn: [1] } };
  const value = data({ requirements: [requirement(1, 'running')], jobs: [job(1, 'issue', 'running', 2), job(2, 'issue', 'queued', 4), job(3, 'issue', 'queued', 3)] });
  const html = named(render(value, [first, child(2), waiting, child(4)]), 'Execution queue');
  for (const expected of ['Child behavior 2', 'Running', 'Child behavior 4', 'Ready', 'Child behavior 3', 'Waiting for dependencies', 'Business requirement 1', repo.name, '#1']) assert.ok(text(html).includes(expected), `Queue must expose ${expected}, including waiting when a prerequisite is manually Done.`);
  const ready = named(render({ ...value, runs: [run(4, 'merged', 1)] }, [first, child(2), waiting, child(4)]), 'Execution queue');
  assert.ok(!text(ready).includes('Waiting for dependencies'), 'A recorded prerequisite merge must release dependency waiting.');
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
  const html = render(value, [child(1), child(2)]);
  const blockers = text(named(html, 'Current blockers'));
  for (const reason of ['Unresolved sibling failure', 'Current decomposition failure', 'Current whole-goal failure', 'Current planning failure']) assert.ok(blockers.includes(reason), `Current blockers must retain ${reason}.`);
  for (const reason of ['Recovered child failure', 'Recovered planning failure']) assert.ok(!blockers.includes(reason), `Recovered attempts must not remain current blockers: ${reason}.`);
  assert.match(html, /<button\b(?![^>]*\bdisabled)[^>]*aria-label="Retry requirement Business requirement 1"/, 'Inactive blocked requirements must offer an enabled retry action.');
  const active = render({ ...value, jobs: [...jobs, job(9, 'issue', 'queued', 2)] }, [child(1), child(2)]);
  assert.match(active, /<button\b[^>]*disabled=""[^>]*aria-label="(?:Retry|Start) requirement Business requirement 1"|<button\b[^>]*aria-label="(?:Retry|Start) requirement Business requirement 1"[^>]*disabled=""/, 'A queued retry must disable duplicate starts.');
  for (const kind of ['decompose', 'plan_review', 'requirement_verify'] as const) {
    const failed = { ...job(1, kind, 'blocked'), reason: `Recovered ${kind} failure` };
    const recovered = data({ jobs: [failed, job(2, kind, 'completed')], runs: [run(1, 'blocked'), run(2, 'passed')] });
    assert.ok(!text(named(render(recovered, [child(1)]), 'Current blockers')).includes(failed.reason), `A successful ${kind} retry must supersede its historical failure.`);
  }
});

test('delivery history retains run ownership and historical failed attempts', () => {
  const value = data({ jobs: [job(1, 'issue', 'blocked', 1), job(2, 'issue', 'completed', 1), job(3, 'requirement_verify', 'completed')], runs: [run(2, 'merged', 1), run(1, 'blocked', 1), run(3, 'passed')] });
  const html = named(render(value, [child(1)]), 'Delivery history');
  for (const id of [1, 2, 3]) assert.match(html, new RegExp(`<option[^>]*value="run-${id}"`), `Real indexed run ${id} must remain selectable.`);
  for (const expected of [repo.name, 'Business requirement 1', 'Child behavior 1', 'blocked', 'merged', 'requirement_verify']) assert.ok(text(html).includes(expected), `Delivery history must expose associated ${expected}.`);
});

test('Workbench sections and manual controls expose accessible names and status semantics', () => {
  const html = render(data());
  for (const section of ['Execution summary', 'Requirements', 'Execution queue', 'Current blockers', 'Delivery history']) assert.match(named(html, section), /^<section\b|^<[^>]+\brole="region"/, `${section} must be an accessible dashboard region.`);
  assert.match(html, /role="status"/, 'Mutation notices must retain live status semantics.');
  for (const label of ['Requirement repository', 'Requirement title', 'Business goal', 'Repository name', 'Local repository path', 'Target branch']) assert.match(html, new RegExp(`<label[^>]*>${label}<(input|textarea|select)`), `Existing labelled ${label} control must remain available inside secondary disclosures.`);
});
