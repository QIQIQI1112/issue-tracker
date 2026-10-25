import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runController } from '../factory/controller.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

type Proof = { path: string; sha256: string; sourceHash: string };
type RunState = { schemaVersion: number; runId: string; taskId: string; profile: string; status: string; stage: string; engine: { sourceHash: string; contractHash: string }; sourceHash: string; proofs: { verification?: Proof; review?: Proof; acceptedChecks?: Proof }; failure?: { kind: string; message: string; stage: string } };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function execute(approved: boolean) {
  const root = evidenceDirectory('typed-run-state');
  const repository = fixtureRepository(join(root, 'repo'));
  const before = git(repository, ['rev-parse', 'main']).trim();
  const task = { schemaVersion: 2, id: 'typed-feature', title: 'Ready value', goal: 'Return the ready value.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 2000, totalTimeoutMs: 30000 } };
  const delegate = fixtureAgent();
  const observed: { phase: string; value?: RunState }[] = [];
  const state = await runController({ repository, task, evidenceRoot: root, mergeTarget: 'main', agent: { run: async input => {
    const path = join(input.directory, '..', 'run-state.json');
    observed.push({ phase: input.phase, ...(existsSync(path) ? { value: JSON.parse(readFileSync(path, 'utf8')) as RunState } : {}) });
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'The frozen named value check covers the goal.' }, assumptions: [], slices: [{ id: 'ready', goal: task.goal, acceptanceIds: ['ready'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    if (input.phase === 'review' && !approved) return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'The final source review blocks delivery.', findings: ['The implementation does not satisfy the accepted goal.'] };
    return await delegate.run(input);
  } } });
  return { repository, before, task, state, observed };
}

function durable(directory: string): RunState {
  const path = join(directory, 'run-state.json');
  assert.equal(existsSync(path), true, 'The actual controller must persist its typed stage state, not only the historical compatibility state.');
  return JSON.parse(readFileSync(path, 'utf8')) as RunState;
}

test('feature controller persists typed stage progress and exact integrated verification and review proofs', { timeout: 30000 }, async () => {
  const fixture = await execute(true);
  try {
    const { state } = fixture;
    assert.equal(state.status, 'merged', state.reason ?? 'The existing real integration fixture must pass before durable-state assertions.');
    assert.equal(state.integration?.verification?.status, 'passed');
    assert.equal(state.integration?.review?.approved, true);
    const value = durable(state.runDirectory);
    assert.equal(value.schemaVersion, 2);
    assert.equal(value.profile, 'feature');
    assert.equal(value.runId, state.runId);
    assert.equal(value.taskId, fixture.task.id);
    assert.equal(value.status, 'merged');
    assert.equal(value.stage, 'completed');
    assert.equal(value.failure, undefined);
    assert.match(value.engine.sourceHash, /^[a-f0-9]{64}$/);
    assert.match(value.engine.contractHash, /^[a-f0-9]{64}$/);
    assert.equal(value.sourceHash, state.integration!.verification!.snapshot.hash);
    for (const [phase, stage] of [['plan', 'planning'], ['implement', 'implementation'], ['review', 'source_review']]) {
      const progress = fixture.observed.find(item => item.phase === phase)?.value;
      assert.ok(progress, `${phase} must see already persisted current progress.`);
      assert.equal(progress.stage, stage);
      assert.equal(progress.status, 'running');
      assert.deepEqual(progress.engine, value.engine, 'One pinned supervisor identity must govern the whole run.');
    }
    const verification = value.proofs.verification;
    assert.ok(verification, 'Completion needs a durable actual verification proof.');
    assert.equal(resolve(state.runDirectory, verification.path), join(state.integration!.verification!.runDirectory, 'summary.json'));
    assert.equal(verification.sha256, digest(readFileSync(resolve(state.runDirectory, verification.path))));
    assert.equal(verification.sourceHash, value.sourceHash);
    const review = value.proofs.review;
    assert.ok(review, 'Completion needs the independently approved source-bound review artifact.');
    const receipt = state.reviewReceipts!.find(item => item.purpose === 'integrated-code')!;
    assert.ok(receipt?.approved);
    assert.equal(resolve(state.runDirectory, review.path), resolve(state.runDirectory, receipt.evidencePath));
    assert.equal(review.sha256, digest(readFileSync(resolve(state.runDirectory, review.path))));
    assert.equal(review.sourceHash, value.sourceHash);
    assert.notEqual(git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
    assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'state.json'), 'utf8')).runId, state.runId, 'Supported historical state remains readable for existing callers.');
  } finally { if (existsSync(join(fixture.state.workspace, '.git'))) git(fixture.repository, ['worktree', 'remove', '--force', fixture.state.workspace]); }
});

test('typed feature state records a structured source-review block without completion or target advancement', { timeout: 30000 }, async () => {
  const fixture = await execute(false);
  try {
    const { state } = fixture;
    assert.equal(state.status, 'blocked');
    assert.equal(state.integration?.verification?.status, 'passed', 'The real final verifier succeeds before the independent source-review refusal.');
    assert.equal(state.integration?.review?.approved, false);
    assert.equal(git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
    const value = durable(state.runDirectory);
    assert.equal(value.schemaVersion, 2);
    assert.equal(value.profile, 'feature');
    assert.equal(value.runId, state.runId);
    assert.equal(value.status, 'blocked');
    assert.equal(value.stage, 'blocked');
    assert.ok(value.failure, 'A failed run needs a structured failure.');
    assert.equal(value.failure.kind, 'review');
    assert.equal(value.failure.stage, 'source_review');
    assert.ok(value.failure.message.trim(), 'A persisted structured failure retains its actionable reason.');
    assert.equal(value.proofs.review, undefined, 'A rejected review cannot become an approving progression proof.');
    assert.equal(existsSync(join(state.runDirectory, 'integration.json')), false);
  } finally { if (existsSync(join(fixture.state.workspace, '.git'))) git(fixture.repository, ['worktree', 'remove', '--force', fixture.state.workspace]); }
});
