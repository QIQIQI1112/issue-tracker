import { test } from 'node:test';
import assert from 'node:assert/strict';

const taskInput = (schemaVersion = 2) => ({ schemaVersion, id: 'adaptive-contract', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 30000 }, notes: 'Disposable adaptive contract.' });
const nodeCheck = { file: 'tests/value.test.ts', title: 'value is ready' };
const browserCheck = { file: 'value.spec.ts', title: 'ready is externally observable', acceptanceIds: ['ready'] };
const planInput = (mode = 'reuse') => ({ schemaVersion: 2, taskId: 'adaptive-contract', coverage: { mode, reason: 'The named existing behavior checks observe the requested change.' }, assumptions: [], slices: [{ id: 'value', goal: 'Return ready.', acceptanceIds: ['ready'], checks: [nodeCheck] }], browserChecks: [] as typeof browserCheck[] });

async function contracts() {
  const module = await import('../factory/contracts.ts').catch(() => null);
  assert.ok(module && typeof module.parseTask === 'function' && typeof module.parsePlan === 'function', 'Adaptive contracts must expose the existing runtime parsers.');
  return module;
}

async function adaptiveTask() {
  const module = await contracts();
  let task: ReturnType<typeof module.parseTask> | undefined;
  assert.doesNotThrow(() => { task = module.parseTask(taskInput()); }, 'Version-two tasks must support risk-based named behavior coverage.');
  assert.ok(task);
  return { module, task };
}

test('adaptive contracts accept meaningful named Node coverage for every criterion', async () => {
  const { module, task } = await adaptiveTask();
  for (const mode of ['reuse', 'extend']) {
    const plan = planInput(mode);
    assert.equal(module.parsePlan(plan, task).schemaVersion, 2);
    const multiTask = module.parseTask({ ...taskInput(), acceptance: [...taskInput().acceptance, { id: 'visible', description: 'Ready is available.' }] });
    const mapped = { ...plan, slices: [...plan.slices, { id: 'visible', goal: 'Expose ready.', acceptanceIds: ['visible'], checks: [{ file: 'tests/exposed.test.ts', title: 'ready is exposed' }] }] };
    assert.equal(module.parsePlan(mapped, multiTask).slices.length, 2);
    assert.throws(() => module.parsePlan({ ...mapped, slices: [mapped.slices[0], { ...mapped.slices[1], checks: [] }] }, multiTask));
  }
});

test('adaptive contracts reject empty, uncovered, unknown and unsafe coverage', async () => {
  const { module, task } = await adaptiveTask();
  const plan = planInput();
  const invalid = [
    { ...plan, coverage: undefined },
    { ...plan, coverage: { mode: 'skip', reason: 'Skip work.' } },
    { ...plan, coverage: { mode: 'reuse', reason: ' ' } },
    { ...plan, slices: [] },
    { ...plan, slices: [{ ...plan.slices[0], checks: [] }] },
    { ...plan, slices: [{ ...plan.slices[0], checks: [] }], browserChecks: [{ ...browserCheck, acceptanceIds: [] }] },
    { ...plan, slices: [{ ...plan.slices[0], checks: [] }], browserChecks: [{ ...browserCheck, acceptanceIds: ['unknown'] }] },
    { ...plan, slices: [{ ...plan.slices[0], checks: [{ ...nodeCheck, file: '../outside.test.ts' }] }] },
    { ...plan, slices: [{ ...plan.slices[0], checks: [{ ...nodeCheck, title: '' }] }] },
    { ...plan, slices: [{ ...plan.slices[0], checks: [nodeCheck, nodeCheck] }] },
    { ...plan, browserChecks: [browserCheck, browserCheck] },
    { ...plan, browserChecks: [{ ...browserCheck, file: '../outside.spec.ts' }] },
    { ...plan, browserChecks: [{ ...browserCheck, file: 'factory/control.spec.ts' }] },
  ];
  for (const candidate of invalid) assert.throws(() => module.parsePlan(candidate, task), `Unsafe adaptive plan was accepted: ${JSON.stringify(candidate)}`);
  const restricted = module.parseTask({ ...taskInput(), scope: ['src/', 'tests/value.test.ts'] });
  assert.throws(() => module.parsePlan({ ...plan, browserChecks: [browserCheck] }, restricted));
  const twoCriteria = module.parseTask({ ...taskInput(), acceptance: [...taskInput().acceptance, { id: 'missing', description: 'An uncovered criterion.' }] });
  assert.throws(() => module.parsePlan(plan, twoCriteria));
});

test('adaptive task whole-goal identity is validated without weakening version-one contracts', async () => {
  const { module, task } = await adaptiveTask();
  const wholeGoal = { requirementId: 7, goal: 'The original complete business goal.' };
  const parsed = module.parseTask({ ...taskInput(), wholeGoal });
  assert.deepEqual((parsed as unknown as { wholeGoal?: unknown }).wholeGoal, wholeGoal);
  for (const invalid of [{ requirementId: 0, goal: wholeGoal.goal }, { requirementId: 7, goal: '' }, { requirementId: '7', goal: wholeGoal.goal }]) assert.throws(() => module.parseTask({ ...taskInput(), wholeGoal: invalid }));
  const legacy = module.parseTask(taskInput(1));
  const legacyPlan = { ...planInput(), schemaVersion: 1, browserChecks: [] };
  assert.equal(module.parsePlan(legacyPlan, legacy).schemaVersion, 1);
  assert.throws(() => module.parsePlan({ ...legacyPlan, browserChecks: [browserCheck] }, legacy));
  assert.throws(() => module.parsePlan({ ...legacyPlan, slices: [{ ...legacyPlan.slices[0], checks: [] }] }, legacy));
  assert.throws(() => module.parsePlan(planInput(), legacy));
  assert.throws(() => module.parsePlan(legacyPlan, task));
});
