import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executionBudget } from '../factory/budget.ts';
import { digest, taskIdentity } from '../factory/checkpoint.ts';
import { parseTask } from '../factory/contracts.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const task = parseTask({ schemaVersion: 1, id: 'budget', title: 'Budget', goal: 'Preserve bounded retries.', acceptance: [{ id: 'bounded', description: 'Retries remain bounded.' }], scope: ['src/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 2, workerTimeoutMs: 1000, totalTimeoutMs: 10000 } });

test('a crashed phase conservatively spends its reserved time and keeps attempt counts', () => {
  const root = evidenceDirectory('crash-budget');
  const first = executionBudget(root, 'issue', task, 'first');
  first.consume('implementation'); first.close();
  const path = join(root, 'budgets', `${digest('issue')}.json`);
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, taskHash: taskIdentity(task), usedMs: 2000, implementationAttempts: 1, acceptanceAttempts: 1, active: { runId: 'dead', startedAt: 1, reservedMs: 3000 } }));
  const second = executionBudget(root, 'issue', task, 'second');
  try {
    assert.ok(second.remaining() <= 5000);
    assert.equal(second.consume('implementation'), 2);
    assert.throws(() => second.consume('implementation'), /budget exhausted/);
  } finally { second.close(); }
});

test('a live budget lease prevents concurrent runs for one issue', () => {
  const root = evidenceDirectory('budget-lease');
  const first = executionBudget(root, 'issue', task, 'first');
  try { assert.throws(() => executionBudget(root, 'issue', task, 'second'), /locked/); }
  finally { first.close(); }
});

test('stale lease reclamation cannot enter another acquisition critical section', async () => {
  const { acquireDatabaseLock } = await import('../src/instance.ts');
  const { acquireExecutionLease } = await import('../factory/lease.ts');
  const { readFileSync } = await import('node:fs');
  const root = evidenceDirectory('stale-admission');
  const path = join(root, 'issue');
  const stale = JSON.stringify({ pid: 2147483647, instanceId: 'dead' });
  writeFileSync(`${path}.lock`, stale);
  const guard = acquireDatabaseLock(`${path}.admission`, 'other-acquirer');
  try {
    assert.throws(() => acquireExecutionLease(path, 'racing-acquirer'), /locked/);
    assert.equal(readFileSync(`${path}.lock`, 'utf8'), stale);
  } finally { guard(); }
  const release = acquireExecutionLease(path, 'new-owner');
  try { assert.throws(() => acquireExecutionLease(path, 'second-owner'), /locked/); }
  finally { release(); }
});
