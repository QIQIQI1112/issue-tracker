import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IssueStore } from '../src/storage.ts';

test('an interrupted whole-goal approval cannot trap a requirement in publication retry', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Recovery fixture', path: '/fixture', targetBranch: 'main', github: { repository: 'fixture/project', remote: 'origin', workflow: 'verify.yml' } });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Recover approval', goal: 'Retain whole-goal review after an interrupted metadata write.' });
    store.create({ title: 'Child', description: 'Store admission fixture.', labels: [], status: 'open', priority: 'medium', work: { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['The child has recorded integration.'] } });
    store.work.startRequirement(requirement.id);
    const child = store.work.claim('/fixture/evidence')!; store.work.finish(child.run.id, 'merged');
    const whole = store.work.claim('/fixture/evidence')!;
    assert.equal(whole.job.kind, 'requirement_verify');
    store.work.updatePublication(requirement.id, { headCommit: 'a'.repeat(40), verifiedRunId: whole.run.id, state: 'awaiting_ci' });
    store.work.recoverInterrupted();
    assert.equal(store.work.run(whole.run.id)?.status, 'blocked');
    const retry = store.work.startRequirement(requirement.id);
    assert.equal(retry[0].kind, 'requirement_verify', 'A partial metadata write is not a passed whole-goal approval.');
  } finally { store.close(); }
});
