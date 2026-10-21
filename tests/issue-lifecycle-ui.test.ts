import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';
import { IssueRow } from '../src/ui/IssueRow.tsx';
import { currentBlockers, requirementProgress, waitingDependencies } from '../src/ui/workbench-state.ts';
import { IssueStore } from '../src/storage.ts';

test('status filtering exposes Blocked and Closed independently and keeps All statuses as the default', () => {
  const html = renderToStaticMarkup(createElement(App));
  const select = html.match(/<select\b[^>]*aria-label="Filter by status"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(select, 'Lifecycle inspection must retain the accessible status selector.');
  const options = [...select.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
  assert.ok(options.some(option => /value="blocked"/.test(option[1]) && option[2] === 'Blocked'), 'The status filter must expose an independent Blocked option.');
  assert.ok(options.some(option => /value="closed"/.test(option[1]) && option[2] === 'Closed'), 'The status filter must expose an independent Closed option.');
  assert.deepEqual(options.map(option => [option[1].match(/value="([^"]*)"/)?.[1], option[2]]), [['all', 'All statuses'], ['open', 'Open'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['closed', 'Closed'], ['done', 'Done']], 'Lifecycle status options preserve existing statuses in domain order.');
  assert.deepEqual(options.filter(option => /\bselected=""/.test(option[1])).map(option => option[2]), ['All statuses'], 'All statuses remains the initial default.');
});

test('issue rows give all lifecycle statuses explicit text without mutation controls', () => {
  const labels = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', closed: 'Closed', done: 'Done' } as const;
  for (const status of Object.keys(labels) as (keyof typeof labels)[]) {
    const issue = { id: 37, title: 'Neutral row fixture', description: 'Read-only record.', status, priority: 'medium' as const, labels: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
    const html = renderToStaticMarkup(createElement(IssueRow, { issue, onDetails: () => {} }));
    const text = html.replace(/<[^>]*>/g, ' ');
    assert.match(text, new RegExp(`\\b${labels[status]}\\b`), `${status} must have an explicit status label independent of fixture title and description.`);
    assert.doesNotMatch(html, /<(?:form|input|textarea)\b|(?:aria-label|title)="(?:Close issue|Reopen|Supersede|Start|Retry|Create|Edit|Delete)\b/i, `${status} must not introduce operation controls.`);
  }
});

test('closed originals retain failed blockers and unmet requirements when replacements are merged', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Original ownership', path: '/lifecycle-ui-fixture', targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Original requirement', goal: 'Original acceptance still applies.' });
    const original = store.create({ title: 'Original child', description: '', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['Original behavior.'] } });
    store.work.startRequirement(requirement.id);
    const failed = store.work.claim('/lifecycle-ui-evidence')!;
    store.work.finish(failed.run.id, 'blocked', 'Original acceptance remains unmet.');
    const replacement = store.create({ title: 'Separate verified replacement', description: '', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Separate behavior.'] } });
    store.work.startIssue(replacement.id);
    const replacementRun = store.work.claim('/lifecycle-ui-evidence')!;
    store.work.finish(replacementRun.run.id, 'merged');
    store.closeIssue(original.id, { reason: 'Separate follow-up accepted.', supersededBy: replacement.id });
    const dependent = store.create({ title: 'Original dependency', description: '', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [original.id], acceptance: ['Original merge required.'] } });
    const waiting = store.work.startIssue(dependent.id);
    const data = { repos: store.work.repos(), requirements: store.work.requirements(), jobs: store.work.jobs(), runs: store.work.runs() };
    const issues = store.list();
    assert.deepEqual(currentBlockers(data, issues).map(job => job.id), [failed.job.id], 'Closing a failed original must retain its current blocker despite a merged replacement.');
    const progress = requirementProgress(data, issues, store.work.requirement(requirement.id)!);
    assert.equal(progress.verified, false, 'A replacement merge cannot establish the original goal as verified.');
    assert.equal(progress.merged, 0, 'Replacement merges do not count as original child merges.');
    assert.equal(progress.outcome, 'Whole goal not yet verified');
    assert.deepEqual(waitingDependencies(data, issues, waiting), [original.id], 'Read-only dependency diagnostics must retain the original closed prerequisite identity.');
    assert.equal(store.work.requirement(requirement.id)?.status, 'blocked');
  } finally { store.close(); }
});
