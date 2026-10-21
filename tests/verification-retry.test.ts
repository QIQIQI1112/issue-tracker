import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceDirectory } from './helpers/subprocess.ts';
import type { Verification } from '../factory/controller.ts';

type RetryVerification = Verification & { diagnostics?: { phase: string; code: string; origin: string; settled: boolean }; startedAt?: string; completedAt?: string };
type RetryOptions = { execute: (attempt: number) => Promise<RetryVerification>; identity: () => string; budget: { consumeInfrastructureRetry: () => number }; record?: (attempt: number, verification: RetryVerification) => void };
type RetryModule = { verifyWithRecovery: (options: RetryOptions) => Promise<{ verification: RetryVerification; attempts: RetryVerification[]; retries: number }> };

async function fixture() {
  const path = '../factory/verification-retry.ts';
  const module = await import(path).catch(() => null) as RetryModule | null;
  assert.ok(module && typeof module.verifyWithRecovery === 'function', 'Owned verification recovery must orchestrate one classified same-identity retry and retain every result.');
  const budgets = await import('../factory/budget.ts').catch(() => null);
  const contracts = await import('../factory/contracts.ts').catch(() => null);
  assert.ok(budgets && contracts);
  const task = contracts.parseTask({ schemaVersion: 1, id: 'retry-orchestration', title: 'Bounded verification retry', goal: 'Keep source identity, attempts and original failure evidence.', acceptance: [{ id: 'bounded', description: 'Recovery is bounded and retains its original failure.' }], scope: ['src/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 10000 }, notes: 'Synthetic structured outcomes exercise only orchestration; integration tests execute the real verifier.' });
  const budget = budgets.executionBudget(evidenceDirectory('verification-retry'), 'owned-issue', task, 'run');
  const consume = (budget as unknown as { consumeInfrastructureRetry?: () => number }).consumeInfrastructureRetry;
  assert.equal(typeof consume, 'function');
  const first: RetryVerification = { status: 'failed', snapshot: { hash: 'a'.repeat(64) }, runDirectory: '/owned/verification-1', checks: [{ name: 'test', status: 'failed' }], error: 'Process spawn resource exhaustion.', diagnostics: { phase: 'test', code: 'EAGAIN', origin: 'spawn', settled: true }, startedAt: '2026-10-21T00:00:00.000Z', completedAt: '2026-10-21T00:00:01.000Z' };
  const second: RetryVerification = { status: 'passed', snapshot: { hash: first.snapshot.hash }, runDirectory: '/owned/verification-2', checks: [{ name: 'test', status: 'passed' }], startedAt: '2026-10-21T00:00:02.000Z', completedAt: '2026-10-21T00:00:03.000Z' };
  return { module, budget, retryBudget: { consumeInfrastructureRetry: consume! }, first, second };
}

test('verification recovery retains both exact structured outcomes and uses a separate retry budget on identical source', async () => {
  const state = await fixture();
  const recorded: { attempt: number; verification: RetryVerification }[] = [];
  let executions = 0;
  try {
    assert.equal(state.budget.consume('implementation'), 1);
    const result = await state.module.verifyWithRecovery({ identity: () => 'same-source-engine-runtime-contract', budget: state.retryBudget, execute: async attempt => {
      executions += 1;
      assert.equal(attempt, executions);
      return attempt === 1 ? state.first : state.second;
    }, record: (attempt, verification) => { recorded.push({ attempt, verification }); } });
    assert.equal(executions, 2);
    assert.deepEqual(recorded, [{ attempt: 1, verification: state.first }, { attempt: 2, verification: state.second }]);
    assert.deepEqual(result.attempts, [state.first, state.second]);
    assert.deepEqual(result.verification, state.second);
    assert.equal(result.retries, 1);
    assert.equal(state.budget.report().implementationAttempts, 1);
    assert.equal((state.budget.report() as unknown as { infrastructureRetries: number }).infrastructureRetries, 1);
    assert.equal(result.attempts[0].completedAt, '2026-10-21T00:00:01.000Z');
    assert.equal(result.attempts[0].status, 'failed');
  } finally { state.budget.close(); }
});

test('verification recovery never retries unknown timeouts or assertion failures', async () => {
  const state = await fixture();
  try {
    for (const error of ['Agent timed out after startup.', 'AssertionError: expected the new behavior.']) {
      let executions = 0;
      const failed = { ...state.first };
      delete failed.diagnostics;
      const result = await state.module.verifyWithRecovery({ identity: () => 'same-source', budget: state.retryBudget, execute: async () => { executions += 1; return { ...failed, error }; } });
      assert.equal(executions, 1);
      assert.equal(result.verification.status, 'failed');
      assert.equal(result.attempts.length, 1);
      assert.equal(result.retries, 0);
    }
    assert.equal((state.budget.report() as unknown as { infrastructureRetries: number }).infrastructureRetries, 0);
  } finally { state.budget.close(); }
});

test('verification recovery rejects changed source environment or contract identity before rerunning', async () => {
  const state = await fixture();
  let identity = 'original-source-engine-runtime-contract';
  let executions = 0;
  const recorded: RetryVerification[] = [];
  try {
    await assert.rejects(() => state.module.verifyWithRecovery({ identity: () => identity, budget: state.retryBudget, execute: async () => {
      executions += 1;
      identity = 'changed-source-or-controls';
      return state.first;
    }, record: (_attempt, verification) => { recorded.push(verification); } }), /identity|source|changed|contract/i);
    assert.equal(executions, 1);
    assert.deepEqual(recorded, [state.first]);
  } finally { state.budget.close(); }
});

test('repeated structured infrastructure failures cannot produce a third verification execution', async () => {
  const state = await fixture();
  let executions = 0;
  const recorded: RetryVerification[] = [];
  let result: Awaited<ReturnType<RetryModule['verifyWithRecovery']>> | undefined;
  let rejected: unknown;
  try {
    try {
      result = await state.module.verifyWithRecovery({ identity: () => 'same-source', budget: state.retryBudget, execute: async attempt => {
        executions += 1;
        assert.ok(attempt <= 2, 'One infrastructure retry cannot become an unbounded loop.');
        return { ...state.first, runDirectory: `/owned/verification-${attempt}` };
      }, record: (_attempt, verification) => { recorded.push(verification); } });
    } catch (error) { rejected = error; }
    assert.equal(executions, 2);
    assert.equal(recorded.length, 2);
    assert.ok(recorded.every(verification => verification.status === 'failed'));
    assert.ok(rejected instanceof Error || result?.verification.status === 'failed', 'Repeated infrastructure failure must remain blocked.');
    if (result) assert.equal(result.retries, 1);
    assert.equal((state.budget.report() as unknown as { infrastructureRetries: number }).infrastructureRetries, 1);
  } finally { state.budget.close(); }
});
