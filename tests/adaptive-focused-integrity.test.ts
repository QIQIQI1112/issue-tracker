import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('adaptive focused checks stop protected runtime mutation without granting another repair attempt', { timeout: 30000 }, async () => {
  const controller = await import('../factory/controller.ts').catch(() => null);
  const contracts = await import('../factory/contracts.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(controller && contracts && fixtures && subprocess && workspace, 'Focused diagnostics must run inside the real owned controller.');
  const input = { schemaVersion: 2, id: 'focused-integrity', title: 'Ready value', goal: 'Return ready while preserving controller-owned verification controls.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 2, workerTimeoutMs: 2000, totalTimeoutMs: 30000 }, notes: 'Adversarial runtime import exercises a protected mutation during the focused check.' };
  let task: ReturnType<typeof contracts.parseTask> | undefined;
  assert.doesNotThrow(() => { task = contracts.parseTask(input); }, 'Version-two focused feedback must retain the protected-file stop boundary.');
  assert.ok(task);
  const root = subprocess.evidenceDirectory('focused-integrity');
  const repository = fixtures.fixtureRepository(join(root, 'repo'));
  const before = workspace.git(repository, ['rev-parse', 'main']).trim();
  const originalContract = readFileSync(join(repository, 'factory/verification-contract.json'));
  const delegate = fixtures.fixtureAgent();
  const phases: string[] = [];
  const state = await controller.runController({ repository, task, evidenceRoot: root, mergeTarget: 'main', agent: { run: async phase => {
    phases.push(phase.phase);
    if (phase.phase === 'plan') return { schemaVersion: 2, taskId: phase.task.id, coverage: { mode: 'reuse', reason: 'The frozen Node check observes readiness.' }, assumptions: [], slices: [{ id: 'ready', goal: phase.task.goal, acceptanceIds: ['ready'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    const result = await delegate.run(phase);
    if (phase.phase === 'implement') writeFileSync(join(phase.cwd, 'src/value.ts'), "import {writeFileSync} from 'node:fs';\nwriteFileSync(new URL('../factory/verification-contract.json',import.meta.url),'{}');\nexport const value = 'ready';\n");
    return result;
  } } });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(state.failureKind, 'integrity');
    assert.match(state.reason ?? '', /protected|contract|integrity/i);
    assert.equal(phases.filter(phase => phase === 'repair').length, 0, 'A protected mutation detected during focused execution must never be routed to ordinary repair.');
    assert.deepEqual(phases, ['plan', 'implement']);
    assert.equal(state.budget?.implementationAttempts, 1);
    assert.equal(workspace.git(repository, ['rev-parse', 'main']).trim(), before);
    assert.deepEqual(readFileSync(join(repository, 'factory/verification-contract.json')), originalContract);
    assert.equal(readFileSync(join(state.workspace, 'factory/verification-contract.json'), 'utf8'), '{}', 'The protected write must actually occur during the focused process.');
    assert.equal(state.redChecks[0].status, 'expected_failure');
  } finally { if (existsSync(join(state.workspace, '.git'))) workspace.git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});
