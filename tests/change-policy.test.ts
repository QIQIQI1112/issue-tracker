import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmission } from '../src/submission.ts';
import { assignment } from '../src/workflow.ts';
import { IssueStore } from '../src/storage.ts';
import { protectedPath } from '../factory/workspace.ts';

const legacy = { schemaVersion: 1, submissionId: 'legacy-policy', repoId: 1, requirement: { title: 'Goal', goal: 'Deliver observable behavior.' }, source: { kind: 'codex', reference: 'conversation', summary: 'Authorized business goal.' }, assumptions: [], issues: [{ key: 'feature', title: 'Feature', description: 'Deliver behavior.', acceptance: ['Behavior is observable.'], dependsOn: [] }] };

test('versioned change kinds preserve legacy identity and reject client execution authority', () => {
  assert.deepEqual(parseSubmission(legacy), legacy);
  const plan = { ...legacy, schemaVersion: 2, issues: legacy.issues.map(issue => ({ ...issue, changeKind: 'harness' })) };
  assert.equal(parseSubmission(plan).issues[0].changeKind, 'harness');
  assert.throws(() => parseSubmission({ ...plan, issues: [{ ...plan.issues[0], scope: ['factory/'] }] }), /Unknown/);
  assert.throws(() => parseSubmission({ ...legacy, issues: plan.issues }), /Unknown/);
  assert.throws(() => parseSubmission({ ...plan, issues: [{ ...plan.issues[0], changeKind: 'admin' }] }), /change kind/i);
  assert.equal(assignment({ repoId: 1, requirementId: null, dependsOn: [], acceptance: ['A'], changeKind: 'acceptance_contract' }).changeKind, 'acceptance_contract');
});

test('control-plane paths are protected independently of a task declaration', () => {
  for (const path of ['src/workflow-store.ts', 'src/submission.ts', 'src/evidence-files.ts', 'src/target-safety.ts', 'src/instance.ts']) assert.equal(protectedPath(path, new Set()), true, path);
  assert.equal(protectedPath('src/ui/Workbench.tsx', new Set()), false);
});

test('maintenance issues remain separately queued and cannot run through the feature executor', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Owned', path: '/owned', targetBranch: 'main' });
    const req = store.work.addRequirement({ repoId: repo.id, title: 'Maintenance first', goal: 'Maintain quality gates before delivering the feature.' });
    const work = { repoId: repo.id, requirementId: req.id, dependsOn: [], acceptance: ['Gates remain effective.'], changeKind: 'harness' as const };
    const maintenance = store.create({ title: 'Repair verifier', description: 'Repair a detector.', status: 'open', priority: 'high', labels: [], work });
    store.create({ title: 'Feature', description: 'Use the repaired detector.', status: 'open', priority: 'medium', labels: [], work: { ...work, changeKind: 'feature', dependsOn: [maintenance.id] } });
    const jobs = store.work.startRequirement(req.id);
    assert.equal(jobs.find(job => job.issueId === maintenance.id)!.kind, 'maintenance');
    assert.equal(store.work.claim('/evidence'), undefined, 'Ordinary queue cannot claim maintenance or its dependent.');
    assert.equal(store.get(maintenance.id)!.work!.changeKind, 'harness');
    const waiting = jobs.find(job => job.issueId === maintenance.id)!;
    assert.equal(waiting.status, 'queued');
    assert.equal(waiting.runId, null);
    assert.deepEqual(store.work.runs(), [], 'Waiting maintenance cannot fabricate execution or verification evidence.');
    assert.throws(() => store.work.startRequirement(req.id), /active/);
  } finally { store.close(); }
});
