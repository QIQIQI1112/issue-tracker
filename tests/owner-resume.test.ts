import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { executionBudget } from '../factory/budget.ts';
import { digest, taskIdentity } from '../factory/checkpoint.ts';
import { parseTask } from '../factory/contracts.ts';
import type { Task } from '../factory/contracts.ts';
import type { Agent } from '../factory/controller.ts';
import { acquireExecutionLease } from '../factory/lease.ts';
import { runProcess } from '../factory/process.ts';
import { processEnvironment } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

async function blockedFixture(exhausted = false) {
  const root = evidenceDirectory('owner-resume');
  const repository = fixtureRepository(join(root, 'repo'));
  const databasePath = join(root, 'state.sqlite');
  const store = new IssueStore(databasePath);
  const repo = store.work.addRepo({ name: 'Fixture', path: repository, targetBranch: 'main' });
  const issue = store.create({ title: 'Ready', description: 'Return ready.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['The value is ready.'] } });
  store.work.startIssue(issue.id);
  const delegate = fixtureAgent();
  const queue = new SerialQueue(store, { agent: { run: async input => {
    if (input.phase === 'implement' || input.phase === 'repair') {
      if (!exhausted) throw new Error('Intentional interruption after accepted checks.');
      return { schemaVersion: 1, taskId: input.task.id, summary: 'Retain the broken value to exhaust native attempts.', blockers: [] };
    }
    return delegate.run(input);
  } } });
  assert.equal(await queue.processNext(), true);
  const run = store.work.runs().find(run => run.issueId === issue.id)!;
  assert.equal(run.status, 'blocked');
  const canonical = JSON.parse(readFileSync(join(run.evidencePath, 'task.json'), 'utf8')) as Task;
  const ledgerPath = join(queue.evidenceRoot, 'budgets', `${digest(`repo-${repo.id}:issue-${issue.id}`)}.json`);
  const request = { schemaVersion: 1, requestId: randomUUID(), databasePath, issueId: issue.id, additionalAttempts: 1, additionalTimeMs: 60000, reason: 'Owner-authorized bounded continuation of the unchanged goal.' };
  return { root, repository, store, repo, issue, run, canonical, ledgerPath, request };
}

async function recoveryApi(fixture: Awaited<ReturnType<typeof blockedFixture>>) {
  const path = join(fixture.root, 'resume-request.json');
  writeFileSync(path, JSON.stringify(fixture.request));
  const result = await runProcess({ command: process.execPath, args: ['--import', 'tsx', resolve('factory/cli.ts'), 'owner-resume', path, '--validate'], cwd: process.cwd(), env: processEnvironment({}), logPath: join(fixture.root, 'validate.log'), timeoutMs: 15000 });
  assert.equal(result.status, 'passed', `The existing factory CLI must validate an explicit owner continuation without executing it. ${result.output}`);
  return await import('../factory/' + 'owner-recovery.ts');
}

async function rejected(action: () => Promise<unknown>) {
  let result: unknown;
  try { result = await action(); } catch { return; }
  assert.ok(result && ['blocked', 'rejected', 'denied'].includes((result as { status: string }).status), 'Unsafe continuation must fail closed.');
}

test('owner continuation grants one bounded native retry for only the selected issue and replays without execution', { timeout: 90000 }, async () => {
  const fixture = await blockedFixture(true);
  try {
    const before = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    assert.equal(before.implementationAttempts, fixture.canonical.budget.maxAttempts);
    const sibling = fixture.store.create({ title: 'Other work', description: 'Do not execute this queued sibling.', status: 'open', priority: 'medium', labels: [], work: { repoId: fixture.repo.id, requirementId: null, dependsOn: [], acceptance: ['Other work remains queued.'] } });
    const siblingJob = fixture.store.work.startIssue(sibling.id);
    const api = await recoveryApi(fixture);
    const delegate = fixtureAgent();
    const tasks: string[] = [];
    const agent: Agent = { run: async input => { tasks.push(input.task.id); return delegate.run(input); } };
    const result = await api.ownerResume(fixture.request, { agent });
    assert.ok(result.runId && result.jobId);
    assert.equal(fixture.store.work.run(result.runId)?.status, 'merged');
    assert.equal(fixture.store.get(fixture.issue.id)?.status, 'done');
    assert.equal(fixture.store.work.jobs().find(job => job.id === siblingJob.id)?.status, 'queued');
    assert.ok(tasks.length > 0 && tasks.every(id => id === `issue-${fixture.issue.id}`));
    const run = fixture.store.work.run(result.runId)!;
    const state = JSON.parse(readFileSync(join(run.evidencePath, 'state.json'), 'utf8'));
    assert.equal(state.resume.fromRunId, fixture.run.id);
    assert.equal(state.resume.reused, true);
    assert.equal(state.integration.verification.status, 'passed');
    assert.equal(state.integration.review.approved, true);
    assert.ok(state.integration.commit);
    const retained = JSON.parse(readFileSync(join(run.evidencePath, 'task.json'), 'utf8')) as Task;
    assert.equal(taskIdentity(retained), taskIdentity(fixture.canonical));
    assert.deepEqual(retained.budget, fixture.canonical.budget);
    const ledgerText = readFileSync(fixture.ledgerPath, 'utf8');
    const ledger = JSON.parse(ledgerText);
    assert.equal(ledger.implementationAttempts, before.implementationAttempts + 1);
    assert.equal(ledger.acceptanceAttempts, before.acceptanceAttempts);
    assert.ok(ledger.usedMs >= before.usedMs);
    const count = tasks.length;
    const replay = await api.ownerResume(fixture.request, { agent });
    assert.equal(replay.runId, result.runId);
    assert.equal(replay.jobId, result.jobId);
    assert.equal(tasks.length, count);
    assert.equal(readFileSync(fixture.ledgerPath, 'utf8'), ledgerText);
  } finally { fixture.store.close(); }
});

test('owner continuation refuses a live queue owner without granting or enqueuing work', { timeout: 30000 }, async () => {
  const fixture = await blockedFixture();
  try {
    const api = await recoveryApi(fixture);
    const before = readFileSync(fixture.ledgerPath, 'utf8');
    const jobs = JSON.stringify(fixture.store.work.jobs());
    const release = acquireExecutionLease(`${fixture.request.databasePath}.queue`, 'live-owner');
    try { await rejected(() => api.ownerResume(fixture.request, { agent: fixtureAgent() })); }
    finally { release(); }
    assert.equal(readFileSync(fixture.ledgerPath, 'utf8'), before);
    assert.equal(JSON.stringify(fixture.store.work.jobs()), jobs);
  } finally { fixture.store.close(); }
});

test('owner continuation rejects a changed original goal without mutating retained budgets or job history', { timeout: 30000 }, async () => {
  const fixture = await blockedFixture();
  try {
    const api = await recoveryApi(fixture);
    fixture.store.update(fixture.issue.id, { description: 'A different business goal.' });
    const before = readFileSync(fixture.ledgerPath, 'utf8');
    const jobs = JSON.stringify(fixture.store.work.jobs());
    await rejected(() => api.ownerResume(fixture.request, { agent: fixtureAgent() }));
    assert.equal(readFileSync(fixture.ledgerPath, 'utf8'), before);
    assert.equal(JSON.stringify(fixture.store.work.jobs()), jobs);
  } finally { fixture.store.close(); }
});

test('owner budget grants preserve canonical identity and crashed reservations while extending limits once', async () => {
  const root = evidenceDirectory('owner-budget-grant');
  const task = parseTask({ schemaVersion: 1, id: 'owner-budget', title: 'Budget', goal: 'Preserve bounded retries.', acceptance: [{ id: 'bounded', description: 'Retries remain bounded.' }], scope: ['src/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 2, workerTimeoutMs: 1000, totalTimeoutMs: 10000 } });
  const first = executionBudget(root, 'issue', task, 'first');
  first.consume('implementation'); first.consume('implementation'); first.close();
  const path = join(root, 'budgets', `${digest('issue')}.json`);
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, taskHash: taskIdentity(task), usedMs: 2000, implementationAttempts: 2, acceptanceAttempts: 1, active: { runId: 'dead', startedAt: 1, reservedMs: 3000 } }));
  const api = await import('../factory/' + 'budget.ts');
  assert.equal(typeof api.grantExecutionBudget, 'function', 'Explicit owner grants must extend effective limits without editing the canonical task or resetting consumed work.');
  const grant = { requestId: randomUUID(), fromRunId: 'dead', additionalAttempts: 1, additionalTimeMs: 5000, reason: 'Continue the unchanged task once.' };
  const active = readFileSync(path, 'utf8');
  await assert.rejects(async () => api.grantExecutionBudget(root, 'issue', task, grant), /active|settle|owner|reservation/i);
  assert.equal(readFileSync(path, 'utf8'), active);
  const settled = executionBudget(root, 'issue', task, 'settle');
  try { assert.ok(settled.report().usedMs >= 5000); assert.equal(settled.report().implementationAttempts, 2); }
  finally { settled.close(); }
  for (const invalid of [{ additionalAttempts: 0, additionalTimeMs: 0 }, { additionalAttempts: 6, additionalTimeMs: 0 }]) {
    await assert.rejects(async () => api.grantExecutionBudget(root, 'issue', task, { ...grant, ...invalid, requestId: randomUUID() }));
  }
  await api.grantExecutionBudget(root, 'issue', task, grant);
  const granted = readFileSync(path, 'utf8');
  await api.grantExecutionBudget(root, 'issue', task, grant);
  assert.equal(readFileSync(path, 'utf8'), granted);
  const second = executionBudget(root, 'issue', task, 'second');
  try {
    assert.equal(second.report().maxAttempts, 3);
    assert.equal(second.report().totalTimeoutMs, 15000);
    assert.ok(second.report().usedMs >= 5000);
    assert.ok(second.remaining() <= 10000);
    assert.equal(second.consume('implementation'), 3);
    assert.throws(() => second.consume('implementation'), /budget exhausted/);
    const ledger = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(ledger.taskHash, taskIdentity(task));
    assert.equal(ledger.acceptanceAttempts, 1);
    assert.equal(Object.values(ledger.ownerGrants).length, 1);
  } finally { second.close(); }
});
