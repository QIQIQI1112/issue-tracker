import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent, AgentInput } from '../factory/controller.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const goal = 'Return ready without changing the accepted test inventory.';
const taskInput = () => ({ schemaVersion: 2, id: 'adaptive-controller', title: 'Ready value', goal, wholeGoal: { requirementId: 7, goal }, acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 2000, totalTimeoutMs: 30000 }, notes: 'Disposable adaptive execution fixture.' });
const check = { file: 'tests/value.test.ts', title: 'value is ready' };
const extension = { file: 'tests/adaptive-extra.test.ts', title: 'ready remains a stable value' };

async function setup() {
  const contracts = await import('../factory/contracts.ts').catch(() => null);
  const controller = await import('../factory/controller.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(contracts && controller && fixtures && workspace, 'Adaptive execution requires the real controller, runtime contracts and isolated fixture helpers.');
  let task: ReturnType<typeof contracts.parseTask> | undefined;
  assert.doesNotThrow(() => { task = contracts.parseTask(taskInput()); }, 'Adaptive execution must accept version-two task contracts.');
  assert.ok(task);
  const root = evidenceDirectory('adaptive-controller');
  const repository = fixtures.fixtureRepository(join(root, 'repo'));
  const baseline = new Map(['tests/value.test.ts', 'acceptance/value.spec.ts'].map(path => [path, readFileSync(join(repository, path), 'utf8')]));
  const before = workspace.git(repository, ['rev-parse', 'main']).trim();
  const delegate = fixtures.fixtureAgent();
  return { controller, workspace, root, repository, task, baseline, before, delegate };
}

function plan(input: AgentInput, mode: 'reuse' | 'extend' = 'reuse', nodeChecks = [check]) {
  return { schemaVersion: 2, taskId: input.task.id, coverage: { mode, reason: mode === 'reuse' ? 'The existing named checks observe the ready value.' : 'One additional invariant requires scoped coverage.' }, assumptions: [], slices: [{ id: 'value', goal: input.task.goal, acceptanceIds: ['ready'], checks: nodeChecks }], browserChecks: [] };
}

async function execute(fixture: Awaited<ReturnType<typeof setup>>, run: Agent['run']) {
  return await fixture.controller.runController({ repository: fixture.repository, task: fixture.task, evidenceRoot: fixture.root, mergeTarget: 'main', agent: { run } });
}

function cleanup(fixture: Awaited<ReturnType<typeof setup>>, workspace: string) {
  if (existsSync(join(workspace, '.git'))) fixture.workspace.git(fixture.repository, ['worktree', 'remove', '--force', workspace]);
}

test('adaptive reuse freezes baseline tests and performs one fresh integrated verification and independent whole-goal review', { timeout: 30000 }, async () => {
  const fixture = await setup();
  const calls: string[] = [];
  const state = await execute(fixture, async input => {
    calls.push(input.phase);
    if (input.phase === 'plan') return plan(input);
    if (input.phase === 'tests' || input.phase === 'acceptance-review') assert.fail('Baseline-only reuse must not invoke test authoring or new-test acceptance review.');
    if (input.phase === 'review') {
      const context = JSON.parse(input.feedback);
      assert.equal(context.integratedCandidate, true);
      assert.equal(context.verification.status, 'passed');
      assert.equal(context.verification.node.passed, 1);
      assert.equal(context.verification.browser.passed, 1);
      assert.ok(JSON.stringify(context).includes(goal), 'The final reviewer must explicitly receive the original whole goal.');
      assert.match(JSON.stringify(context), /"requirementId":7/, 'The combined review must bind the exact requirement identity.');
    }
    return await fixture.delegate.run(input);
  });
  try {
    assert.equal(state.status, 'merged', state.reason ?? 'Adaptive integrated delivery must succeed.');
    assert.deepEqual(calls, ['plan', 'implement', 'review']);
    assert.equal(state.redChecks[0].title, check.title);
    assert.equal(state.redChecks[0].status, 'expected_failure');
    assert.match(readFileSync(state.redChecks[0].reportPath!, 'utf8'), /value is ready/);
    for (const [path, original] of fixture.baseline) assert.equal(readFileSync(join(fixture.repository, path), 'utf8'), original);
    const inventory = JSON.parse(readFileSync(join(state.runDirectory, 'accepted-checks.json'), 'utf8')) as { path: string; hash: string }[];
    assert.deepEqual(inventory.filter(item => /^(tests|acceptance)\//.test(item.path)).map(item => item.path).sort(), [...fixture.baseline.keys()].sort());
    assert.ok(inventory.every(item => /^[a-f0-9]{64}$/.test(item.hash)));
    const verifierDirectories = readdirSync(state.runDirectory).filter(name => /^(verification|integration-verification)-/.test(name) && existsSync(join(state.runDirectory, name, 'summary.json')));
    assert.equal(verifierDirectories.length, 1, 'Adaptive integration must run one fresh full verifier on the final integrated candidate.');
    const summary = JSON.parse(readFileSync(join(state.runDirectory, verifierDirectories[0], 'summary.json'), 'utf8'));
    assert.equal(summary.status, 'passed');
    assert.equal(summary.snapshot.hash, state.integration?.verification?.snapshot.hash);
    assert.equal(summary.checks.length, 5);
    assert.ok(summary.checks.every((item: { status: string }) => item.status === 'passed'));
    assert.equal(state.integration?.review?.approved, true);
    assert.ok(state.reviewReceipts?.some(receipt => receipt.purpose === 'baseline-coverage-reuse'), 'Baseline reuse requires a distinct source-bound controller receipt.');
    assert.ok(!state.reviewReceipts?.some(receipt => receipt.purpose === 'acceptance-coverage'), 'Baseline reuse must not fabricate an independent acceptance-review approval.');
    assert.notEqual(fixture.workspace.git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
    const report = JSON.parse(readFileSync(join(state.runDirectory, 'delivery.json'), 'utf8'));
    assert.equal(report.execution.profile, 'adaptive-v2');
    assert.equal(report.execution.coverageMode, 'reuse');
    assert.equal(report.execution.route, 'light');
    assert.ok(report.execution.reason.trim());
    assert.equal(report.efficiency.agentInvocations, calls.length);
    assert.equal(report.efficiency.testAuthoringInvocations, 0);
    assert.equal(report.efficiency.verificationExecutions, 1);
    assert.equal(report.efficiency.verificationRetries, 0);
    assert.equal(report.efficiency.verificationReuses, 0);
    assert.equal(report.efficiency.elapsedMs, Date.parse(state.completedAt!) - Date.parse(state.startedAt));
    for (const field of ['planningMs', 'testAuthoringMs', 'acceptanceReviewMs', 'implementationMs', 'verificationMs', 'codeReviewMs']) assert.ok(Number.isFinite(report.efficiency.durations[field]) && report.efficiency.durations[field] >= 0, `Missing truthful duration ${field}.`);
    assert.equal(report.efficiency.durations.testAuthoringMs, 0);
    assert.equal(report.efficiency.durations.acceptanceReviewMs, 0);
  } finally { cleanup(fixture, state.workspace); }
});

test('adaptive reuse still implements requested changes when baseline checks already pass', { timeout: 30000 }, async () => {
  const fixture = await setup();
  writeFileSync(join(fixture.repository, 'src/value.ts'), "export const value = 'ready';\n");
  fixture.workspace.git(fixture.repository, ['add', 'src/value.ts']);
  fixture.workspace.git(fixture.repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Passing baseline']);
  let implemented = false;
  const state = await execute(fixture, async input => {
    if (input.phase === 'plan') return plan(input);
    if (input.phase === 'implement') {
      implemented = true;
      writeFileSync(join(input.cwd, 'src/ready-label.ts'), "export const label = 'Ready';\n");
    }
    return await fixture.delegate.run(input);
  });
  try {
    assert.equal(state.status, 'merged', state.reason ?? 'Adaptive integrated delivery must succeed.');
    assert.equal(implemented, true, 'Passing baseline coverage must not skip the requested implementation.');
    assert.equal(state.redChecks[0].status, 'already_passed');
    assert.equal(readFileSync(join(fixture.repository, 'src/ready-label.ts'), 'utf8'), "export const label = 'Ready';\n");
  } finally { cleanup(fixture, state.workspace); }
});

test('adaptive reuse rejects absent named checks before implementation or target advancement', { timeout: 30000 }, async () => {
  const fixture = await setup();
  const calls: string[] = [];
  const state = await execute(fixture, async input => {
    calls.push(input.phase);
    if (input.phase === 'plan') return plan(input, 'reuse', [{ ...check, title: 'a check that does not exist' }]);
    return await fixture.delegate.run(input);
  });
  try {
    assert.equal(state.status, 'blocked');
    assert.deepEqual(calls, ['plan']);
    assert.match(state.reason ?? '', /named|missing|check|proof/i);
    assert.equal(fixture.workspace.git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
  } finally { cleanup(fixture, state.workspace); }
});

for (const mutation of ['existing-test', 'new-test', 'outside-scope'] as const) {
  test(`adaptive reuse cannot authorize ${mutation} mutation`, { timeout: 30000 }, async () => {
    const fixture = await setup();
    const state = await execute(fixture, async input => {
      if (input.phase === 'plan') return plan(input);
      if (input.phase === 'implement') {
        if (mutation === 'existing-test') writeFileSync(join(input.cwd, check.file), "import {test} from 'node:test';test('value is ready',()=>{});\n");
        if (mutation === 'new-test') writeFileSync(join(input.cwd, 'tests/unapproved.test.ts'), "import {test} from 'node:test';test('unapproved behavior',()=>{});\n");
        if (mutation === 'outside-scope') writeFileSync(join(input.cwd, 'factory/verification-contract.json'), '{}');
      }
      return await fixture.delegate.run(input);
    });
    try {
      assert.equal(state.status, 'blocked');
      assert.match(state.reason ?? '', /protected|scope|inventory|contract/i);
      assert.equal(fixture.workspace.git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
      for (const [path, original] of fixture.baseline) assert.equal(readFileSync(join(fixture.repository, path), 'utf8'), original);
    } finally { cleanup(fixture, state.workspace); }
  });
}

test('adaptive extension independently reviews new checks after owner red proofs and before repair', { timeout: 30000 }, async () => {
  const fixture = await setup();
  const calls: string[] = [];
  let accepted = false;
  const state = await execute(fixture, async input => {
    calls.push(input.phase);
    if (input.phase === 'plan') return plan(input, 'extend', [extension]);
    if (input.phase === 'tests') writeFileSync(join(input.cwd, extension.file), "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.ts';\ntest('ready remains a stable value',()=>assert.equal(value,'ready'));\n");
    if (input.phase === 'acceptance-review') {
      const feedback = JSON.parse(input.feedback);
      assert.equal(feedback.redChecks[0].title, extension.title);
      assert.equal(feedback.redChecks[0].status, 'expected_failure');
      assert.match(readFileSync(feedback.redChecks[0].reportPath, 'utf8'), /ready remains a stable value/);
      accepted = true;
    }
    if (input.phase === 'implement') assert.equal(accepted, true, 'Implementation may begin only after independent coverage acceptance.');
    return await fixture.delegate.run(input);
  });
  try {
    assert.equal(state.status, 'merged', state.reason ?? 'Adaptive integrated delivery must succeed.');
    assert.deepEqual(calls, ['plan', 'tests', 'acceptance-review', 'implement', 'review']);
    assert.equal(state.integration?.verification?.node?.passed, 2);
    assert.ok(state.reviewReceipts?.some(receipt => receipt.purpose === 'acceptance-coverage' && receipt.approved));
    for (const [path, original] of fixture.baseline) assert.equal(readFileSync(join(fixture.repository, path), 'utf8'), original);
    const report = JSON.parse(readFileSync(join(state.runDirectory, 'delivery.json'), 'utf8'));
    assert.equal(report.execution.route, 'standard');
    assert.equal(report.efficiency.testAuthoringInvocations, 1);
    assert.equal(report.efficiency.verificationExecutions, 1);
  } finally { cleanup(fixture, state.workspace); }
});

test('adaptive final review rejection cannot advance the integration target', { timeout: 30000 }, async () => {
  const fixture = await setup();
  const state = await execute(fixture, async input => {
    if (input.phase === 'plan') return plan(input);
    if (input.phase === 'review') return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'The final candidate does not satisfy the original goal.', findings: ['The requested behavior is incomplete.'] };
    return await fixture.delegate.run(input);
  });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(state.integration?.verification?.status, 'passed');
    assert.equal(state.integration?.review?.approved, false);
    assert.equal(fixture.workspace.git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
  } finally { cleanup(fixture, state.workspace); }
});
