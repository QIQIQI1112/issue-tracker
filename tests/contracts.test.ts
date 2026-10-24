import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('task contracts reject missing acceptance, unsafe scope, and unbounded budgets', async () => {
  const module = await import('../factory/contracts.ts').catch(() => null);
  assert.ok(module, 'Runtime task contracts are not implemented.');
  const task = JSON.parse(readFileSync('tickets/001-labels.json', 'utf8'));
  const parsed = module.parseTask(task);
  assert.equal(parsed.id, 'exercise-001');
  for (const value of [{ ...task, schemaVersion: 99 }, { ...task, acceptance: [] }, { ...task, scope: ['../outside'] }, { ...task, scope: ['factory/'] }, { ...task, budget: { ...task.budget, maxAttempts: 100 } }]) assert.throws(() => module.parseTask(value));
});

test('worker plans must cover every acceptance item with runnable scoped checks', async () => {
  const module = await import('../factory/contracts.ts').catch(() => null);
  assert.ok(module, 'Runtime worker plans are not implemented.');
  const task = module.parseTask(JSON.parse(readFileSync('tickets/001-labels.json', 'utf8')));
  const plan = { schemaVersion: 1, taskId: task.id, assumptions: [{ decision: 'Use short normalized labels', reason: 'Keep filtering predictable' }], slices: [{ id: 'labels', goal: 'Persist and filter labels', acceptanceIds: task.acceptance.map(item => item.id), checks: [{ file: 'tests/labels.test.ts', title: 'labels normalize and deduplicate without changing other issue defaults' }] }], browserChecks: [] };
  assert.equal(module.parsePlan(plan, task).taskId, task.id);
  assert.throws(() => module.parsePlan({ ...plan, browserChecks: [{ file: 'labels.spec.ts', title: 'retired browser check' }] }, task));
  assert.throws(() => module.parsePlan({ ...plan, slices: [] }, task));
  assert.throws(() => module.parsePlan({ ...plan, taskId: 'different' }, task));
  assert.throws(() => module.parsePlan({ ...plan, slices: [{ ...plan.slices[0], acceptanceIds: [] }] }, task));
  assert.throws(() => module.parsePlan({ ...plan, slices: [{ ...plan.slices[0], checks: [{ file: '../outside.test.ts', title: 'outside' }] }] }, task));
});
