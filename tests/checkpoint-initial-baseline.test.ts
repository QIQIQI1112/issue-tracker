import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runController } from '../factory/controller.ts';
import type { ControllerState } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

const task = () => parseTask({ schemaVersion: 1, id: 'initial-baseline', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 3000, totalTimeoutMs: 90000 }, notes: '' });

test('accepted delivery-only retries restore dirty initial baseline and saved additions and deletions before fresh proofs', { timeout: 90000 }, async () => {
  const root = evidenceDirectory('checkpoint-initial-baseline');
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'src/local.ts'), "export const local = 'committed';\n");
  writeFileSync(join(repository, 'src/deleted.ts'), "export const removed = 'baseline';\n");
  git(repository, ['add', 'src/']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Prepare committed baseline files']);
  const modified = "export const local = 'uncommitted modification';\n";
  const untracked = "export const original = 'untracked initial work';\n";
  writeFileSync(join(repository, 'src/local.ts'), modified);
  writeFileSync(join(repository, 'src/original.ts'), untracked);
  const frozen = readFileSync(join(repository, 'tests/value.test.ts'));
  const delegate = fixtureAgent();
  let first: ControllerState | undefined;
  let second: ControllerState | undefined;
  try {
    first = await runController({ repository, task: task(), evidenceRoot: root, budgetKey: 'one-issue', agent: { run: async input => {
      if (input.phase === 'implement') {
        writeFileSync(join(input.cwd, 'src/saved.ts'), "export const saved = 'interrupted draft';\n");
        rmSync(join(input.cwd, 'src/deleted.ts'));
        throw new Error('Intentional interruption after accepted checks.');
      }
      return delegate.run(input);
    } } });
    assert.equal(first.status, 'blocked');
    assert.equal(JSON.parse(readFileSync(join(first.runDirectory, 'checkpoint.json'), 'utf8')).accepted, true);
    assert.equal(first.budget?.acceptanceAttempts, 1);
    assert.equal(first.budget?.implementationAttempts, 1);
    git(repository, ['worktree', 'remove', '--force', first.workspace]);
    const phases: string[] = [];
    second = await runController({ repository, task: task(), evidenceRoot: root, budgetKey: 'one-issue', resumeFrom: first.runDirectory, agent: { run: async input => {
      phases.push(input.phase);
      if (input.phase === 'repair') {
        assert.equal(readFileSync(join(input.cwd, 'src/local.ts'), 'utf8'), modified);
        assert.equal(readFileSync(join(input.cwd, 'src/original.ts'), 'utf8'), untracked);
        assert.match(readFileSync(join(input.cwd, 'src/saved.ts'), 'utf8'), /interrupted draft/);
        assert.equal(existsSync(join(input.cwd, 'src/deleted.ts')), false);
        assert.deepEqual(readFileSync(join(input.cwd, 'tests/value.test.ts')), frozen);
      }
      return delegate.run(input);
    } } });
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, true);
    assert.equal(second.resume?.fromRunId, first.runId);
    assert.deepEqual(phases, ['repair', 'review']);
    assert.equal(second.verification?.status, 'passed');
    assert.ok(second.verification?.checks.length === 5 && second.verification.checks.every(check => check.status === 'passed'));
    assert.equal(second.review?.approved, true);
    assert.notEqual(second.verification?.runDirectory, first.verification?.runDirectory);
    assert.equal(second.budget?.acceptanceAttempts, 1);
    assert.equal(second.budget?.implementationAttempts, 2);
    assert.ok((second.budget?.usedMs ?? 0) >= (first.budget?.usedMs ?? 0));
    const patch = readFileSync(join(second.runDirectory, 'patch.diff'), 'utf8');
    assert.doesNotMatch(patch, /src\/(?:local|original)\.ts/, 'Unchanged initial user work must not become task-owned delivery changes.');
    assert.match(patch, /src\/saved\.ts/);
    assert.match(patch, /src\/deleted\.ts/);
    assert.ok(!second.changes?.some(change => ['src/local.ts', 'src/original.ts'].includes(change.path)));
    assert.deepEqual(readFileSync(join(second.workspace, 'tests/value.test.ts')), frozen);
    assert.equal(readFileSync(join(repository, 'src/local.ts'), 'utf8'), modified);
    assert.equal(readFileSync(join(repository, 'src/original.ts'), 'utf8'), untracked);
    assert.equal(existsSync(join(repository, 'src/saved.ts')), false);
    assert.equal(existsSync(join(repository, 'src/deleted.ts')), true);
  } finally {
    for (const state of [first, second]) if (state && existsSync(join(state.workspace, '.git'))) git(repository, ['worktree', 'remove', '--force', state.workspace]);
  }
});

test('a failed accepted-draft reconstruction never reports successful checkpoint reuse', { timeout: 90000 }, async () => {
  const root = evidenceDirectory('checkpoint-reuse-outcome');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, budgetKey: 'one-issue', agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Interrupt after acceptance.');
    return delegate.run(input);
  } } });
  let second: ControllerState | undefined;
  try {
    assert.equal(first.status, 'blocked');
    const path = join(first.runDirectory, 'checkpoint.json');
    const checkpoint = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(checkpoint.accepted, true);
    checkpoint.sourceHash = '0'.repeat(64);
    writeFileSync(path, JSON.stringify(checkpoint));
    second = await runController({ repository, task: task(), evidenceRoot: root, budgetKey: 'one-issue', resumeFrom: first.runDirectory, agent: delegate });
    assert.equal(second.status, 'blocked');
    assert.match(second.reason ?? '', /restor|source hash/i);
    assert.equal(second.resume?.reused, false, 'Loading metadata alone cannot establish successful source reconstruction.');
    assert.equal(second.budget?.acceptanceAttempts, 1);
    assert.equal(second.budget?.implementationAttempts, 1);
  } finally {
    for (const state of [first, second]) if (state && existsSync(join(state.workspace, '.git'))) git(repository, ['worktree', 'remove', '--force', state.workspace]);
  }
});
