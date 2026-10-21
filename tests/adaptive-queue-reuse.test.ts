import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IssueStore } from '../src/storage.ts';
import type { SerialQueue } from '../factory/queue.ts';

test('adaptive serial queue completes an exact sole-child requirement using its real integrated verification and whole-goal review', { timeout: 30000 }, async () => {
  const policyPath = '../factory/optimization.ts';
  const policy = await import(policyPath).catch(() => null) as { executionPolicy?: unknown } | null;
  assert.ok(policy && typeof policy.executionPolicy === 'function', 'Serial delivery needs controller-owned adaptive routing and evidence reuse.');
  const queueModule = await import('../factory/queue.ts').catch(() => null);
  const storage = await import('../src/storage.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(queueModule && storage && fixtures && subprocess && workspace, 'The integration proof must use the real queue, database and verifier fixtures.');
  const root = subprocess.evidenceDirectory('adaptive-queue-reuse');
  const repository: string = fixtures.fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode: 'adaptive-v2' }));
  workspace.git(repository, ['add', 'factory/execution-policy.json']);
  workspace.git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Owner adaptive policy']);
  const store: IssueStore = new storage.IssueStore(join(root, 'state.sqlite'));
  const delegate = fixtures.fixtureAgent();
  const calls: string[] = [];
  const reviews: unknown[] = [];
  let plannerCalls = 0;
  try {
    const repo = store.work.addRepo({ name: 'Adaptive fixture', path: repository, targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Ready value', goal: 'Return ready as the complete original requirement.' });
    const issue = store.create({ title: 'Ready value', description: requirement.goal, status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: requirement.id, acceptance: ['The value is ready.'], dependsOn: [] } });
    store.work.startRequirement(requirement.id);
    const queue: SerialQueue = new queueModule.SerialQueue(store, { evidenceRoot: join(root, 'evidence'), planner: {
      decompose: async () => { plannerCalls += 1; throw new Error('An admitted sole-child goal does not need another decomposition.'); },
      review: async () => { plannerCalls += 1; throw new Error('An exact source-bound sole-child whole-goal approval must be reused.'); },
    }, agent: { run: async input => {
      calls.push(input.phase);
      if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'Existing named tests observe the complete ready-value behavior.' }, assumptions: [], slices: [{ id: 'ready', goal: input.task.goal, acceptanceIds: input.task.acceptance.map(item => item.id), checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
      if (input.phase === 'review') reviews.push(JSON.parse(input.feedback));
      return await delegate.run(input);
    } } });
    assert.equal(await queue.processNext(), true);
    const child = store.work.runs().find(run => run.issueId === issue.id)!;
    assert.equal(child.status, 'merged');
    const childState = JSON.parse(readFileSync(join(child.evidencePath, 'state.json'), 'utf8'));
    assert.equal(childState.integration.verification.status, 'passed');
    const summaryPath = join(childState.integration.verification.runDirectory, 'summary.json');
    const summaryBytes = readFileSync(summaryPath);
    const original = JSON.parse(summaryBytes.toString('utf8'));
    const nodeBytes = readFileSync(join(childState.integration.verification.runDirectory, 'node-results.jsonl'));
    const browserBytes = readFileSync(join(childState.integration.verification.runDirectory, 'browser-results.json'));
    assert.equal(await queue.processNext(), true);
    assert.equal(await queue.processNext(), false);
    assert.equal(store.work.requirement(requirement.id)?.status, 'done');
    assert.equal(store.get(issue.id)?.status, 'done');
    assert.equal(plannerCalls, 0);
    assert.deepEqual(calls, ['plan', 'implement', 'review']);
    assert.equal(reviews.length, 1);
    assert.ok(JSON.stringify(reviews[0]).includes(requirement.goal));
    assert.ok(JSON.stringify(reviews[0]).includes(`"requirementId":${requirement.id}`));
    const final = store.work.runs().find(run => run.issueId === null)!;
    assert.equal(final.status, 'passed');
    const report = JSON.parse(readFileSync(join(final.evidencePath, 'delivery.json'), 'utf8'));
    assert.equal(report.goal, requirement.goal);
    assert.equal(report.nodePassed, 1);
    assert.equal(report.browserPassed, 1);
    assert.equal(report.review.approved, true);
    assert.equal(report.efficiency.verificationExecutions, 0);
    assert.equal(report.efficiency.verificationReuses, 1);
    assert.equal(report.efficiency.agentInvocations, 0);
    const provenance = JSON.parse(readFileSync(join(final.evidencePath, 'verification-reuse.json'), 'utf8'));
    assert.equal(provenance.eligible, true);
    assert.equal(provenance.runId, child.id);
    assert.equal(provenance.verificationRunId, original.runId);
    assert.equal(provenance.startedAt, original.startedAt);
    assert.equal(provenance.completedAt, original.completedAt);
    assert.equal(provenance.reviewReused, true);
    assert.equal(provenance.certificatePath, join(child.evidencePath, 'integrated-verification-certificate.json'));
    assert.deepEqual(readFileSync(join(final.evidencePath, 'verification/summary.json')), summaryBytes, 'Reuse must retain the original report bytes rather than fabricate a fresh verification run.');
    assert.equal(JSON.parse(readFileSync(join(final.evidencePath, 'verification/summary.json'), 'utf8')).runId, original.runId);
    assert.equal(JSON.parse(readFileSync(join(final.evidencePath, 'verification/summary.json'), 'utf8')).completedAt, original.completedAt);
    assert.deepEqual(readFileSync(summaryPath), summaryBytes);
    assert.deepEqual(readFileSync(join(childState.integration.verification.runDirectory, 'node-results.jsonl')), nodeBytes);
    assert.deepEqual(readFileSync(join(childState.integration.verification.runDirectory, 'browser-results.json')), browserBytes);
  } finally { store.close(); }
});
