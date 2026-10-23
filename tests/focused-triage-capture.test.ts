import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runController } from '../factory/controller.ts';
import type { AgentInput, ControllerState } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { captureInterruptedDraft, digest, environmentIdentity, loadCheckpoint } from '../factory/checkpoint.ts';
import { snapshot } from '../factory/evidence.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('interrupted draft capture preserves a held triage checkpoint when persisted state predates the hold', { timeout: 60000 }, async () => {
  const root = evidenceDirectory('focused-triage-capture');
  const repository = fixtureRepository(join(root, 'repo'));
  const before = git(repository, ['rev-parse', 'main']).trim();
  const frozen = snapshot(repository).files.filter(file => /^(tests|acceptance)\//.test(file.path));
  const task = parseTask({ schemaVersion: 2, id: 'capture-held-triage', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 3000, totalTimeoutMs: 60000 }, notes: 'Disposable capture ordering fixture.' });
  const delegate = fixtureAgent();
  let earlierState: Buffer | undefined;
  const agent = { run: async (input: AgentInput) => {
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'The named baseline check observes the ready value.' }, assumptions: [], slices: [{ id: 'ready', goal: input.task.goal, acceptanceIds: ['ready'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    if (input.phase === 'implement') earlierState = readFileSync(join(dirname(input.directory), 'state.json'));
    if (input.phase === 'implement' || input.phase === 'repair') return { schemaVersion: 1, taskId: input.task.id, summary: 'Keep the candidate unchanged pending independent disposition.', blockers: [] };
    if (input.phase === 'acceptance-review') {
      const context = JSON.parse(input.feedback);
      assert.equal(context.purpose, 'focused-failure-triage');
      assert.equal(context.check.title, 'value is ready');
      assert.match(readFileSync(context.check.reportPath, 'utf8'), /ERR_ASSERTION/);
      return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'The failure remains held for owner inspection.', findings: ['Unknown failure cause requires owner maintenance.'] };
    }
    return delegate.run(input);
  } };
  const first = await runController({ repository, task, evidenceRoot: root, mergeTarget: 'main', agent });
  let second: ControllerState | undefined;
  try {
    assert.equal(first.status, 'blocked');
    assert.ok(earlierState);
    const genuineEarlier = JSON.parse(earlierState.toString('utf8'));
    assert.equal(genuineEarlier.phase, 'implement');
    assert.equal(genuineEarlier.pendingFailureTriage, undefined);
    const statePath = join(first.runDirectory, 'state.json');
    const settledState = readFileSync(statePath);
    const checkpointPath = join(first.runDirectory, 'checkpoint.json');
    const heldCheckpoint = readFileSync(checkpointPath);
    const checkpoint = JSON.parse(heldCheckpoint.toString('utf8'));
    assert.ok(checkpoint.accepted && checkpoint.pendingFailureTriage);
    const proofs = checkpoint.proofs.map((proof: { path: string; hash: string }) => ({ ...proof, bytes: readFileSync(join(first.runDirectory, proof.path)) }));
    for (const proof of proofs) assert.equal(digest(proof.bytes), proof.hash);
    writeFileSync(join(root, 'genuine-earlier-state.json'), earlierState);
    writeFileSync(join(root, 'held-checkpoint-before-capture.json'), heldCheckpoint);
    writeFileSync(statePath, earlierState);
    try { captureInterruptedDraft(first.runDirectory); }
    finally { writeFileSync(statePath, settledState); }
    const capturedCheckpoint = readFileSync(checkpointPath);
    const loaded = loadCheckpoint(first.runDirectory, root, task, environmentIdentity(repository, process.cwd()));
    const calls: string[] = [];
    second = await runController({ repository, task, evidenceRoot: root, mergeTarget: 'main', resumeFrom: first.runDirectory, agent: { run: async input => { calls.push(input.phase); return agent.run(input); } } });
    assert.equal(digest(capturedCheckpoint), digest(heldCheckpoint), 'An older genuine state.json must not erase the authoritative checkpoint hold or its proof inventory.');
    assert.deepEqual(loaded.pendingFailureTriage, checkpoint.pendingFailureTriage);
    for (const proof of proofs) assert.deepEqual(readFileSync(join(first.runDirectory, proof.path)), proof.bytes);
    assert.deepEqual(calls, ['acceptance-review'], 'Native recovery must independently dispose of the held failure before invoking repair.');
    assert.equal(second.status, 'blocked');
    assert.equal(second.resume?.reused, true);
    assert.equal(first.budget?.implementationAttempts, 1);
    assert.equal(second.budget?.implementationAttempts, first.budget?.implementationAttempts);
    assert.equal(second.attempts.length, 0);
    assert.equal(second.efficiency?.verificationExecutions, 0);
    assert.equal(git(repository, ['rev-parse', 'main']).trim(), before);
    assert.deepEqual(snapshot(second.workspace).files.filter(file => /^(tests|acceptance)\//.test(file.path)), frozen);
  } finally {
    for (const state of [first, second]) if (state && existsSync(join(state.workspace, '.git'))) git(repository, ['worktree', 'remove', '--force', state.workspace]);
  }
});
