import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Issue } from '../src/domain.ts';
import type { Requirement, WorkRun } from '../src/workflow.ts';
import type { Verification } from '../factory/controller.ts';

type Reuse = { verification: Verification; review?: { approved: boolean; summary: string; findings: string[] }; provenance: { runId: string; certificatePath: string; verificationRunId: string; startedAt: string; completedAt: string; reviewReused: boolean } };
type ReuseInput = { repository: string; cwd: string; branch: string; requirement: Requirement; children: Issue[]; runs: WorkRun[] };
type ReuseModule = { reusableRequirementVerification: (input: ReuseInput) => Reuse | undefined; captureIntegratedVerification: (input: { repository: string; runDirectory: string; branch: string; commit: string; wholeGoal?: { requirementId: number; goal: string } }) => unknown };

async function merged() {
  const path = '../factory/verification-reuse.ts';
  const reuse = await import(path).catch(() => null) as ReuseModule | null;
  assert.ok(reuse && typeof reuse.reusableRequirementVerification === 'function' && typeof reuse.captureIntegratedVerification === 'function', 'Whole-requirement reuse requires artifact-backed verification eligibility and capture.');
  const controller = await import('../factory/controller.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(controller && fixtures && subprocess && workspace, 'Reuse proofs must originate from the real isolated integration controller.');
  const root = subprocess.evidenceDirectory('verification-reuse');
  const repository = fixtures.fixtureRepository(join(root, 'repo'));
  const goal = 'Return the ready value for the original complete requirement.';
  const task = { schemaVersion: 2, id: 'issue-3', title: 'Ready value', goal, wholeGoal: { requirementId: 7, goal }, acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 2000, totalTimeoutMs: 30000 }, notes: 'Real full verifier evidence for requirement reuse.' };
  const delegate = fixtures.fixtureAgent();
  const state = await controller.runController({ repository, task, mergeTarget: 'main', evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'Existing named checks observe the ready value.' }, assumptions: [], slices: [{ id: 'ready', goal, acceptanceIds: ['ready'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    return await delegate.run(input);
  } } });
  assert.equal(state.status, 'merged', state.reason ?? 'The artifact source must actually pass full integration and independent review.');
  const certificatePath = join(state.runDirectory, 'integrated-verification-certificate.json');
  assert.equal(existsSync(certificatePath), true, 'The integration owner must capture eligible evidence without test-side fabricated summaries.');
  const stamp = state.completedAt!;
  const requirement: Requirement = { id: 7, repoId: 1, title: 'Original goal', goal, status: 'running', createdAt: state.startedAt, updatedAt: stamp };
  const child: Issue = { id: 3, title: task.title, description: goal, status: 'done', priority: 'medium', labels: [], createdAt: state.startedAt, updatedAt: stamp, work: { repoId: 1, requirementId: 7, acceptance: ['The value is ready.'], dependsOn: [] } };
  const run: WorkRun = { id: state.runId, jobId: 11, repoId: 1, requirementId: 7, issueId: 3, status: 'merged', evidencePath: state.runDirectory, reason: null, startedAt: state.startedAt, completedAt: stamp };
  const input: ReuseInput = { repository, cwd: repository, branch: 'main', requirement, children: [child], runs: [run] };
  return { reuse, workspace, state, input, certificatePath };
}

function restore(path: string, operation: () => void, check: () => void) {
  const original = readFileSync(path);
  try { operation(); check(); }
  finally { writeFileSync(path, original); }
}

test('whole-requirement reuse preserves original full report timestamps and exact sole-child goal review', { timeout: 30000 }, async () => {
  const fixture = await merged();
  try {
    const reused = fixture.reuse.reusableRequirementVerification(fixture.input);
    assert.ok(reused, 'Unchanged approved integrated evidence must be reusable.');
    assert.equal(reused.verification.status, 'passed');
    assert.equal(reused.verification.snapshot.hash, fixture.state.integration?.verification?.snapshot.hash);
    assert.equal(reused.verification.node?.passed, 1);
    assert.equal(reused.verification.browser?.passed, 1);
    assert.equal(reused.review?.approved, true);
    assert.deepEqual(reused.review?.findings, []);
    assert.equal(reused.provenance.runId, fixture.state.runId);
    assert.equal(reused.provenance.reviewReused, true);
    assert.equal(reused.provenance.certificatePath, fixture.certificatePath);
    const original = JSON.parse(readFileSync(join(reused.verification.runDirectory, 'summary.json'), 'utf8'));
    assert.equal(reused.provenance.verificationRunId, original.runId);
    assert.equal(reused.provenance.startedAt, original.startedAt);
    assert.equal(reused.provenance.completedAt, original.completedAt);
    const changedGoal = fixture.reuse.reusableRequirementVerification({ ...fixture.input, requirement: { ...fixture.input.requirement, goal: 'A materially different original goal.' } });
    assert.equal(changedGoal?.review, undefined, 'A changed goal needs a fresh independent whole-goal review.');
    const multiple = fixture.reuse.reusableRequirementVerification({ ...fixture.input, children: [...fixture.input.children, { ...fixture.input.children[0], id: 4 }] });
    assert.equal(multiple?.review, undefined, 'A sole-child review cannot approve a multi-child requirement.');
    const wrongRequirement = fixture.reuse.reusableRequirementVerification({ ...fixture.input, requirement: { ...fixture.input.requirement, id: 8 } });
    assert.equal(wrongRequirement, undefined, 'Evidence owned by one requirement cannot authorize another.');
  } finally { if (existsSync(join(fixture.state.workspace, '.git'))) fixture.workspace.git(fixture.input.repository, ['worktree', 'remove', '--force', fixture.state.workspace]); }
});

test('verification reuse rejects changed source controls reports and source-bound review artifacts', { timeout: 30000 }, async () => {
  const fixture = await merged();
  try {
    const original = fixture.reuse.reusableRequirementVerification(fixture.input);
    assert.ok(original, 'Tamper probes require a valid real baseline certificate.');
    const summaryPath = join(original.verification.runDirectory, 'summary.json');
    const receipt = fixture.state.reviewReceipts?.find(item => item.purpose === 'integrated-code-and-whole-goal');
    assert.ok(receipt, 'Combined review eligibility must be bound to an explicit whole-goal receipt.');
    const paths = [summaryPath, join(original.verification.runDirectory, 'node-results.jsonl'), join(original.verification.runDirectory, 'browser-results.json'), join(fixture.state.runDirectory, receipt.evidencePath), fixture.certificatePath, join(fixture.input.repository, 'src/value.ts'), join(fixture.input.repository, 'factory/verification-contract.json')];
    for (const path of paths) restore(path, () => { writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('\nchanged outside owner verification\n')])); }, () => {
      assert.equal(fixture.reuse.reusableRequirementVerification(fixture.input), undefined, `Changed underlying artifact or identity must force fresh verification: ${path}`);
    });
    assert.ok(fixture.reuse.reusableRequirementVerification(fixture.input), 'Restoring exact original bytes restores eligibility without issuing a fresh certificate.');
    assert.equal(fixture.reuse.reusableRequirementVerification({ ...fixture.input, runs: [{ ...fixture.input.runs[0], status: 'blocked' }] }), undefined);
    assert.equal(fixture.reuse.reusableRequirementVerification({ ...fixture.input, branch: 'unrelated-target' }), undefined);
    assert.equal(fixture.reuse.reusableRequirementVerification({ ...fixture.input, runs: [{ ...fixture.input.runs[0], repoId: 2 }] }), undefined);
    restore(join(fixture.input.repository, 'AGENTS.md'), () => { writeFileSync(join(fixture.input.repository, 'AGENTS.md'), 'Owner controls changed after integrated verification.\n'); }, () => {
      assert.equal(fixture.reuse.reusableRequirementVerification(fixture.input), undefined);
    });
  } finally { if (existsSync(join(fixture.state.workspace, '.git'))) fixture.workspace.git(fixture.input.repository, ['worktree', 'remove', '--force', fixture.state.workspace]); }
});
