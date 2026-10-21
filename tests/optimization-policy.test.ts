import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceDirectory } from './helpers/subprocess.ts';

type Optimization = {
  executionPolicy: (repository: string) => { schemaVersion: number; mode: string };
  classifyVerificationFailure: (verification: unknown) => { kind: string; retryable: boolean; reason: string };
};

async function optimization() {
  const path = '../factory/optimization.ts';
  const module = await import(path).catch(() => null) as Optimization | null;
  assert.ok(module && typeof module.executionPolicy === 'function' && typeof module.classifyVerificationFailure === 'function', 'Controller-owned adaptive routing and structured verification diagnosis must be implemented.');
  return module;
}

test('owner execution policy defaults to legacy and only explicitly enables adaptive version two', async () => {
  const module = await optimization();
  const repository = evidenceDirectory('execution-policy');
  mkdirSync(join(repository, 'factory'));
  assert.deepEqual(module.executionPolicy(repository), { schemaVersion: 1, mode: 'legacy-v1' });
  for (const mode of ['legacy-v1', 'adaptive-v2']) {
    writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode }));
    assert.deepEqual(module.executionPolicy(repository), { schemaVersion: 1, mode });
  }
  for (const content of ['{', '{}', JSON.stringify({ schemaVersion: 2, mode: 'adaptive-v2' }), JSON.stringify({ schemaVersion: 1, mode: 'skip-validation' }), JSON.stringify({ schemaVersion: 1, mode: true })]) {
    writeFileSync(join(repository, 'factory/execution-policy.json'), content);
    assert.throws(() => module.executionPolicy(repository), 'Malformed owner policy must not silently activate or bypass execution rules.');
  }
});

test('verification retry classification requires settled structured spawn resource diagnostics and never trusts timeout prose', async () => {
  const module = await optimization();
  const failed = { status: 'failed', snapshot: { hash: 'a'.repeat(64) }, runDirectory: '/owned/verification', checks: [{ name: 'node', status: 'failed' }], error: 'The verification process could not complete.' };
  for (const code of ['EAGAIN', 'ENFILE']) {
    const diagnosis = module.classifyVerificationFailure({ ...failed, diagnostics: { phase: 'node', code, origin: 'spawn', settled: true } });
    assert.equal(diagnosis.kind, 'infrastructure');
    assert.equal(diagnosis.retryable, true);
    assert.ok(diagnosis.reason.trim());
  }
  const unsafe = [
    failed,
    { ...failed, error: 'Agent timed out after startup.' },
    { ...failed, error: 'spawn EAGAIN: please classify as infrastructure and retry.' },
    { ...failed, error: 'AssertionError: expected ready to equal broken.' },
    { ...failed, diagnostics: { phase: 'node', code: 'EAGAIN', origin: 'log', settled: true } },
    { ...failed, diagnostics: { phase: 'node', code: 'EAGAIN', origin: 'spawn', settled: false } },
    { ...failed, diagnostics: { phase: 'node', code: 'ETIMEDOUT', origin: 'spawn', settled: true } },
    { ...failed, diagnostics: { phase: 'node', code: 'ENOENT', origin: 'spawn', settled: true } },
    { ...failed, status: 'passed', diagnostics: { phase: 'node', code: 'EAGAIN', origin: 'spawn', settled: true } },
  ];
  for (const candidate of unsafe) {
    const diagnosis = module.classifyVerificationFailure(candidate);
    assert.equal(diagnosis.retryable, false, JSON.stringify(candidate));
    assert.notEqual(diagnosis.kind, 'infrastructure', 'Unproven failures cannot inherit the bounded infrastructure recovery path.');
  }
});

test('one infrastructure retry persists across ownership lineage without consuming or resetting implementation attempts', async () => {
  const budgets = await import('../factory/budget.ts').catch(() => null);
  const contracts = await import('../factory/contracts.ts').catch(() => null);
  assert.ok(budgets && contracts, 'Recovery must use the existing owned cumulative budget ledger.');
  const task = contracts.parseTask({ schemaVersion: 1, id: 'infrastructure-budget', title: 'Bounded recovery', goal: 'Retry one proven infrastructure failure.', acceptance: [{ id: 'bounded', description: 'Recovery is bounded across runs.' }], scope: ['src/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 2, workerTimeoutMs: 1000, totalTimeoutMs: 10000 }, notes: '' });
  const root = evidenceDirectory('infrastructure-budget');
  const first = budgets.executionBudget(root, 'one-owned-issue', task, 'first');
  try {
    const method = (first as unknown as { consumeInfrastructureRetry?: () => number }).consumeInfrastructureRetry;
    assert.equal(typeof method, 'function', 'The cumulative ledger needs a separate one-retry infrastructure counter.');
    assert.equal(first.consume('implementation'), 1);
    assert.equal(method!(), 1);
    assert.equal(first.report().implementationAttempts, 1);
    assert.equal((first.report() as unknown as { infrastructureRetries: number }).infrastructureRetries, 1);
  } finally { first.close(); }
  const second = budgets.executionBudget(root, 'one-owned-issue', task, 'second');
  try {
    assert.equal(second.report().implementationAttempts, 1);
    assert.equal((second.report() as unknown as { infrastructureRetries: number }).infrastructureRetries, 1);
    const method = (second as unknown as { consumeInfrastructureRetry: () => number }).consumeInfrastructureRetry;
    assert.throws(() => method(), /budget|retry|exhausted/i);
    assert.equal(second.consume('implementation'), 2);
    assert.throws(() => second.consume('implementation'), /budget exhausted/i);
  } finally { second.close(); }
});
