import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IssueStore } from '../src/storage.ts';
import { parseCreateIssue } from '../src/domain.ts';
import { ConflictError } from '../src/workflow.ts';
import type { ChangeKind } from '../src/workflow.ts';

test('maintenance waits for cross-requirement GitHub delivery while same-requirement and published dependencies remain ready', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Dependency fixture', path: '/disposable/dependency-fixture', targetBranch: 'main', github: { repository: 'Fixture/Project', remote: 'origin', workflow: 'verify.yml' } });
    const upstream = store.work.addRequirement({ repoId: repo.id, title: 'Upstream', goal: 'Deliver the prerequisite.' });
    const downstream = store.work.addRequirement({ repoId: repo.id, title: 'Downstream', goal: 'Use the delivered prerequisite.' });
    const create = (title: string, requirementId: number, changeKind: ChangeKind, dependsOn: number[] = []) => store.create({ ...parseCreateIssue({ title }), work: { repoId: repo.id, requirementId, changeKind, dependsOn, acceptance: ['The prerequisite is ready.'] } });
    const prerequisite = create('Prerequisite', upstream.id, 'feature');
    const same = create('Same requirement maintenance', upstream.id, 'harness', [prerequisite.id]);
    const feature = create('Dependent feature', downstream.id, 'feature', [prerequisite.id]);
    const maintenance = create('Dependent maintenance', downstream.id, 'harness', [prerequisite.id]);
    const firstJob = store.work.startIssue(prerequisite.id);
    const firstRun = store.work.claim('/disposable/dependency-evidence', firstJob.id)!;
    assert.equal(firstRun.job.id, firstJob.id, 'The real store must admit the prerequisite before recording fixture merge metadata.');
    store.work.finish(firstRun.run.id, 'merged');
    assert.equal(store.get(prerequisite.id)?.status, 'done');
    assert.equal(store.work.requirement(upstream.id)?.publication?.state, 'pending');
    const sameJob = store.work.startIssue(same.id);
    assert.deepEqual(store.work.maintenanceAdmission(same.id), sameJob, 'A local child merge remains sufficient within its own requirement branch.');
    const featureJob = store.work.startIssue(feature.id);
    const maintenanceJob = store.work.startIssue(maintenance.id);
    const before = { issues: store.list(), jobs: store.work.jobs(), runs: store.work.runs(), requirements: store.work.requirements() };
    assert.equal(store.work.claim('/disposable/dependency-evidence', featureJob.id), undefined, 'The ordinary feature admission already waits for upstream publication.');
    assert.throws(() => store.work.maintenanceAdmission(maintenance.id), ConflictError, 'Owner maintenance must also wait for the different requirement to reach GitHub delivery.');
    assert.throws(() => store.work.claimMaintenance(maintenance.id, '/disposable/dependency-evidence'), ConflictError, 'Transactional owner claim must retain the same dependency boundary.');
    assert.deepEqual({ issues: store.list(), jobs: store.work.jobs(), runs: store.work.runs(), requirements: store.work.requirements() }, before, 'Refusal cannot claim jobs or rewrite retained metadata.');
    store.work.updatePublication(upstream.id, { state: 'merged', mergeCommit: 'a'.repeat(40) });
    assert.deepEqual(store.work.maintenanceAdmission(maintenance.id), maintenanceJob, 'Confirmed upstream publication releases read-only admission.');
    assert.equal(store.work.claimMaintenance(maintenance.id, '/disposable/dependency-evidence').job.id, maintenanceJob.id, 'The existing transactional claim becomes eligible after publication.');
  } finally { store.close(); }
});
