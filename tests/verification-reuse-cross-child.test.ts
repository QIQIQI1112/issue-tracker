import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Issue } from '../src/domain.ts';
import type { Requirement, WorkRun } from '../src/workflow.ts';
import { runController } from '../factory/controller.ts';
import { reusableRequirementVerification } from '../factory/verification-reuse.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('requirement verification reuses the current feature certificate despite a higher-job earlier maintenance child', { timeout: 30000 }, async context => {
  const root = evidenceDirectory('verification-reuse-cross-child');
  const repository = fixtureRepository(join(root, 'repo'));
  const goal = 'Return the ready value for the original complete requirement.';
  const task = { schemaVersion: 2, id: 'issue-3', title: 'Ready value', goal, wholeGoal: { requirementId: 7, goal }, acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 2000, totalTimeoutMs: 30000 }, notes: 'Real integration evidence for cross-child certificate selection.' };
  const delegate = fixtureAgent();
  const state = await runController({ repository, task, mergeTarget: 'main', evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'Existing named coverage observes the ready value.' }, assumptions: [], slices: [{ id: 'ready', goal, acceptanceIds: ['ready'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    return await delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'merged', state.reason ?? `Real integration must succeed: ${root}`);
    assert.equal(state.integration?.verification?.status, 'passed');
    const certificatePath = join(state.runDirectory, 'integrated-verification-certificate.json');
    assert.equal(existsSync(certificatePath), true, 'The controller must produce the certificate from actual integrated verification.');
    const stamp = state.completedAt!;
    const requirement: Requirement = { id: 7, repoId: 1, title: 'Original goal', goal, status: 'running', createdAt: state.startedAt, updatedAt: stamp };
    const child: Issue = { id: 3, title: task.title, description: goal, status: 'done', priority: 'medium', labels: [], createdAt: state.startedAt, updatedAt: stamp, work: { repoId: 1, requirementId: 7, acceptance: ['The value is ready.'], dependsOn: [], changeKind: 'feature' } };
    const run: WorkRun = { id: state.runId, jobId: 11, repoId: 1, requirementId: 7, issueId: 3, status: 'merged', evidencePath: state.runDirectory, reason: null, startedAt: state.startedAt, completedAt: stamp };
    const input = { repository, cwd: repository, branch: 'main', requirement, children: [child], runs: [run] };
    const original = reusableRequirementVerification(input);
    assert.ok(original, 'The exact current-target certificate must be reusable before adding the earlier maintenance metadata.');
    assert.deepEqual(original.verification, state.integration?.verification);
    assert.equal(original.provenance.reviewReused, true);
    context.diagnostic(JSON.stringify({ baselineReusable: true, runId: state.runId, certificatePath, verificationRunId: original.provenance.verificationRunId }));

    const maintenanceStamp = new Date(Date.parse(state.startedAt) - 1000).toISOString();
    const maintenance: Issue = { ...child, id: 4, title: 'Earlier harness maintenance', description: 'Complete the prerequisite harness maintenance.', createdAt: maintenanceStamp, updatedAt: maintenanceStamp, work: { ...child.work!, changeKind: 'harness', acceptance: ['The prerequisite maintenance is integrated.'] } };
    const maintenanceEvidence = join(root, 'earlier-maintenance');
    mkdirSync(maintenanceEvidence);
    const maintenanceRun: WorkRun = { ...run, id: 'earlier-maintenance-run', jobId: 12, issueId: maintenance.id, evidencePath: maintenanceEvidence, startedAt: maintenanceStamp, completedAt: maintenanceStamp };
    assert.equal(existsSync(join(maintenanceEvidence, 'integrated-verification-certificate.json')), false);
    const multiple = { ...input, children: [child, maintenance], runs: [run, maintenanceRun] };
    assert.equal(reusableRequirementVerification({ ...multiple, runs: [...multiple.runs, { ...run, id: 'blocked-feature-followup', jobId: 13, status: 'blocked' }] }), undefined, 'A latest blocked child must still prevent whole-requirement reuse.');
    const rejected: string[] = [];
    const reused = reusableRequirementVerification({ ...multiple, onRejected: reason => rejected.push(reason) });
    assert.ok(reused, `The unchanged current-target feature certificate must remain eligible with an earlier higher-job maintenance child: ${rejected.join('; ')}`);
    assert.deepEqual(reused.verification, original.verification, 'Reuse must retain the original complete machine report.');
    const summary = JSON.parse(readFileSync(join(original.verification.runDirectory, 'summary.json'), 'utf8'));
    assert.equal(reused.provenance.runId, state.runId);
    assert.equal(reused.provenance.certificatePath, certificatePath);
    assert.equal(reused.provenance.verificationRunId, summary.runId);
    assert.equal(reused.provenance.startedAt, summary.startedAt);
    assert.equal(reused.provenance.completedAt, summary.completedAt);
    assert.equal(reused.review, undefined, 'A sole-child whole-goal review cannot approve two children.');
    assert.equal(reused.provenance.reviewReused, false);
  } finally {
    if (existsSync(join(state.workspace, '.git'))) git(repository, ['worktree', 'remove', '--force', state.workspace]);
  }
});
