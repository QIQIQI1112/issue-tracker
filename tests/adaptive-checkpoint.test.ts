import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function interrupted() {
  const controller = await import('../factory/controller.ts').catch(() => null);
  const contracts = await import('../factory/contracts.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(controller && contracts && fixtures && subprocess && workspace, 'Adaptive checkpoint recovery requires the real owned controller and fixtures.');
  const input = { schemaVersion: 2, id: 'adaptive-resume', title: 'Ready value', goal: 'Return ready and retain an interrupted source change.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 2000, totalTimeoutMs: 60000 }, notes: 'Disposable adaptive resume fixture.' };
  let task: ReturnType<typeof contracts.parseTask> | undefined;
  assert.doesNotThrow(() => { task = contracts.parseTask(input); }, 'Accepted baseline coverage reuse must support version-two checkpoint recovery.');
  assert.ok(task);
  const root = subprocess.evidenceDirectory('adaptive-checkpoint');
  const repository = fixtures.fixtureRepository(join(root, 'repo'));
  const delegate = fixtures.fixtureAgent();
  const agent = { run: async (phase: Parameters<typeof delegate.run>[0]) => {
    if (phase.phase === 'plan') return { schemaVersion: 2, taskId: phase.task.id, coverage: { mode: 'reuse', reason: 'Existing named tests observe ready.' }, assumptions: [], slices: [{ id: 'ready', goal: phase.task.goal, acceptanceIds: ['ready'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    assert.ok(!['tests', 'acceptance-review'].includes(phase.phase), 'Baseline reuse cannot invent test-authoring or independent acceptance invocations.');
    return await delegate.run(phase);
  } };
  const first = await controller.runController({ repository, task, evidenceRoot: root, budgetKey: 'same-owned-issue', agent: { run: async phase => {
    if (phase.phase === 'implement') {
      writeFileSync(join(phase.cwd, 'src/retained.ts'), "export const retained = 'owned interrupted change';\n");
      throw new Error('Stop after the owner froze baseline coverage.');
    }
    return await agent.run(phase);
  } } });
  assert.equal(first.status, 'blocked');
  const receipt = first.reviewReceipts?.find(item => item.purpose === 'baseline-coverage-reuse');
  assert.ok(receipt, 'A baseline checkpoint must carry an explicit controller-owned reuse receipt.');
  assert.equal(JSON.parse(readFileSync(join(first.runDirectory, 'checkpoint.json'), 'utf8')).accepted, true);
  workspace.git(repository, ['worktree', 'remove', '--force', first.workspace]);
  return { controller, workspace, root, repository, task, agent, first, receipt };
}

test('adaptive baseline checkpoints restore accepted source and inventory without rerunning authoring roles or resetting budgets', { timeout: 30000 }, async () => {
  const fixture = await interrupted();
  const calls: string[] = [];
  const second = await fixture.controller.runController({ repository: fixture.repository, task: fixture.task, evidenceRoot: fixture.root, budgetKey: 'same-owned-issue', resumeFrom: fixture.first.runDirectory, agent: { run: async phase => {
    calls.push(phase.phase);
    if (phase.phase === 'repair') assert.match(readFileSync(join(phase.cwd, 'src/retained.ts'), 'utf8'), /owned interrupted change/);
    return await fixture.agent.run(phase);
  } } });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'A valid baseline checkpoint must resume.');
    assert.equal(second.resume?.reused, true);
    assert.deepEqual(calls, ['repair', 'review']);
    assert.equal(second.verification?.status, 'passed');
    assert.equal(second.budget?.acceptanceAttempts, 0);
    assert.equal(second.budget?.implementationAttempts, 2);
    assert.deepEqual(JSON.parse(readFileSync(join(second.runDirectory, 'accepted-checks.json'), 'utf8')), JSON.parse(readFileSync(join(fixture.first.runDirectory, 'accepted-checks.json'), 'utf8')));
    assert.ok(second.reviewReceipts?.some(receipt => receipt.purpose === 'baseline-coverage-reuse' && receipt.reusedFromRunId === fixture.first.runId));
  } finally { if (existsSync(join(second.workspace, '.git'))) fixture.workspace.git(fixture.repository, ['worktree', 'remove', '--force', second.workspace]); }
});

for (const damage of ['missing', 'tampered'] as const) {
  test(`adaptive baseline checkpoint rejects ${damage} owner receipt and rebuilds coverage from untouched baseline`, { timeout: 30000 }, async () => {
    const fixture = await interrupted();
    const receiptPath = join(fixture.first.runDirectory, fixture.receipt.evidencePath);
    if (damage === 'missing') rmSync(receiptPath);
    else {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      receipt.sourceHash = '0'.repeat(64);
      writeFileSync(receiptPath, JSON.stringify(receipt));
    }
    const calls: string[] = [];
    const second = await fixture.controller.runController({ repository: fixture.repository, task: fixture.task, evidenceRoot: fixture.root, budgetKey: 'same-owned-issue', resumeFrom: fixture.first.runDirectory, agent: { run: async phase => {
      calls.push(phase.phase);
      if (phase.phase === 'implement') assert.equal(existsSync(join(phase.cwd, 'src/retained.ts')), false, 'Invalid receipt cannot restore the old partial implementation.');
      return await fixture.agent.run(phase);
    } } });
    try {
      assert.equal(second.status, 'ready', second.reason ?? 'Invalid reuse must fall back to fresh owned proofs.');
      assert.equal(second.resume?.reused, false);
      assert.match(second.resume?.reason ?? '', /receipt|proof|hash|ENOENT/i);
      assert.deepEqual(calls, ['plan', 'implement', 'review']);
      assert.equal(second.budget?.implementationAttempts, 2);
      assert.equal(second.budget?.acceptanceAttempts, 0);
      assert.ok(second.reviewReceipts?.some(receipt => receipt.purpose === 'baseline-coverage-reuse' && !receipt.reusedFromRunId));
    } finally { if (existsSync(join(second.workspace, '.git'))) fixture.workspace.git(fixture.repository, ['worktree', 'remove', '--force', second.workspace]); }
  });
}
