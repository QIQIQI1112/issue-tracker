import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { ownerResume } from '../factory/owner-recovery.ts';
import { digest, taskIdentity } from '../factory/checkpoint.ts';
import type { Task } from '../factory/contracts.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

async function interrupted() {
  const root = evidenceDirectory('remaining-budget-recovery');
  const repository = fixtureRepository(join(root, 'repo'));
  const store = new IssueStore(join(root, 'state.sqlite'));
  const repo = store.work.addRepo({ name: 'Remaining budget', path: repository, targetBranch: 'main' });
  const issue = store.create({ title: 'Ready', description: 'Return ready.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['The value is ready.'] } });
  const job = store.work.startIssue(issue.id);
  const delegate = fixtureAgent();
  try {
    assert.equal(await new SerialQueue(store, { agent: { run: async input => {
      if (input.phase === 'implement') {
        writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'ready';\n");
        throw new Error('Intentional settled interruption after accepted checks.');
      }
      return delegate.run(input);
    } } }).processNext(job.id), true);
    const run = store.work.runs().find(item => item.jobId === job.id)!;
    assert.equal(run.status, 'blocked', 'Fixture setup must settle the actual native interruption.');
    assert.equal(existsSync(join(run.evidencePath, 'checkpoint.json')), true, `Fixture setup must reach accepted coverage before testing continuation: ${run.reason}`);
    assert.equal(JSON.parse(readFileSync(join(run.evidencePath, 'checkpoint.json'), 'utf8')).accepted, true, 'Fixture setup must retain real accepted coverage.');
    const task = JSON.parse(readFileSync(join(run.evidencePath, 'task.json'), 'utf8')) as Task;
    const evidenceRoot = join(root, 'evidence');
    const ledgerPath = join(evidenceRoot, 'budgets', `${digest(`repo-${repo.id}:issue-${issue.id}`)}.json`);
    const request = { schemaVersion: 1, requestId: randomUUID(), databasePath: store.path, issueId: issue.id, additionalAttempts: 0, additionalTimeMs: 0, reason: 'Continue the unchanged task using remaining original capacity.' };
    return { root, repository, store, repo, issue, run, task, evidenceRoot, ledgerPath, request };
  } catch (error) { store.close(); throw error; }
}

type Fixture = Awaited<ReturnType<typeof interrupted>>;
function retained(fixture: Fixture) {
  return { ledger: readFileSync(fixture.ledgerPath, 'utf8'), jobs: fixture.store.work.jobs(), runs: fixture.store.work.runs(), issue: fixture.store.get(fixture.issue.id) };
}

test('remaining-budget validation checks task-bound implementation and time capacity without side effects', { timeout: 60000 }, async () => {
  const fixture = await interrupted();
  try {
    const original = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    const request = fixture.request;
    for (const [name, patch, allowed] of [
      ['accepted checkpoint at acceptance limit', { acceptanceAttempts: fixture.task.budget.maxAttempts }, true],
      ['implementation exhausted', { implementationAttempts: fixture.task.budget.maxAttempts }, false],
      ['time exhausted', { usedMs: fixture.task.budget.totalTimeoutMs }, false],
      ['crashed reservation exhausts remaining time', { usedMs: fixture.task.budget.totalTimeoutMs - 1000, active: { runId: fixture.run.id, startedAt: 1, reservedMs: 1000 } }, false],
      ['crashed reservation leaves capacity', { active: { runId: fixture.run.id, startedAt: 1, reservedMs: 1000 } }, true],
      ['task identity changed', { taskHash: '0'.repeat(64) }, false],
    ] as const) {
      writeFileSync(fixture.ledgerPath, JSON.stringify({ ...original, ...patch }));
      const before = retained(fixture);
      let status: string | undefined;
      let failure: unknown;
      try { status = (await ownerResume(request, { validateOnly: true })).status; } catch (error) { failure = error; }
      assert.deepEqual(retained(fixture), before, `${name}: preview must not settle reservations, grant, enqueue or alter history.`);
      assert.equal(existsSync(join(fixture.evidenceRoot, 'owner-resumes', request.requestId)), false, `${name}: preview creates no journal.`);
      if (allowed) assert.equal(status, 'valid', `${name}: explicit zero/zero must validate remaining original capacity; ${String(failure)}`);
      else {
        assert.ok(failure instanceof Error, `${name}: unsafe capacity must be rejected.`);
        assert.match(failure.message, /budget|capacity|exhaust|identity|ledger/i, `${name}: rejection must come from task-bound capacity or identity validation.`);
        await assert.rejects(ownerResume(request, { agent: { run: async () => assert.fail('Rejected capacity must invoke no worker.') } }));
        assert.deepEqual(retained(fixture), before, `${name}: actual admission rejection must also be read-only.`);
        assert.equal(existsSync(join(fixture.evidenceRoot, 'owner-resumes', request.requestId)), false, `${name}: rejected admission creates no journal.`);
      }
    }
    const checkpointPath = join(fixture.run.evidencePath, 'checkpoint.json');
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    writeFileSync(checkpointPath, JSON.stringify({ ...checkpoint, accepted: false }));
    writeFileSync(fixture.ledgerPath, JSON.stringify({ ...original, acceptanceAttempts: fixture.task.budget.maxAttempts }));
    const before = retained(fixture);
    await assert.rejects(ownerResume(request, { validateOnly: true }), /acceptance|budget|capacity|exhaust/i, 'An unapproved draft still needs acceptance capacity.');
    assert.deepEqual(retained(fixture), before);
    assert.equal(existsSync(join(fixture.evidenceRoot, 'owner-resumes', request.requestId)), false);
  } finally { fixture.store.close(); }
});

test('remaining-budget admission rejects invalid accepted checkpoint proof before journaling or enqueueing', { timeout: 60000 }, async () => {
  const fixture = await interrupted();
  try {
    const proof = join(fixture.run.evidencePath, 'accepted-checks.json');
    writeFileSync(proof, `${readFileSync(proof, 'utf8')}\n`);
    const before = retained(fixture);
    for (const validateOnly of [true, false]) {
      let failure: unknown;
      try { await ownerResume(fixture.request, { validateOnly, agent: { run: async () => assert.fail('Invalid accepted proof cannot invoke an agent.') } }); }
      catch (error) { failure = error; }
      assert.deepEqual(retained(fixture), before, 'Invalid accepted proof cannot mutate budget, issue or job/run history.');
      assert.equal(existsSync(join(fixture.evidenceRoot, 'owner-resumes', fixture.request.requestId)), false, 'Invalid proof must be rejected before durable admission.');
      assert.ok(failure instanceof Error, 'Damaged claimed acceptance proof must fail closed.');
      assert.match(failure.message, /checkpoint|proof|inventory/i, 'Admission must inspect the damaged accepted checkpoint rather than reject zero/zero as a grant.');
    }
  } finally { fixture.store.close(); }
});

test('remaining-budget continuation retains native lineage and limits while replay and terminal requests execute no work', { timeout: 90000 }, async () => {
  const fixture = await interrupted();
  try {
    const sibling = fixture.store.create({ title: 'Queued sibling', description: 'Remain queued.', status: 'open', priority: 'medium', labels: [], work: { repoId: fixture.repo.id, requirementId: null, dependsOn: [], acceptance: ['Remain queued.'] } });
    const siblingJob = fixture.store.work.startIssue(sibling.id);
    const oldRun = fixture.store.work.run(fixture.run.id);
    const before = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    const delegate = fixtureAgent();
    const phases: string[] = [];
    const agent = { run: async (input: Parameters<typeof delegate.run>[0]) => {
      assert.equal(input.task.id, `issue-${fixture.issue.id}`, 'Selected-job continuation must not execute queued siblings.');
      phases.push(input.phase);
      if (input.phase === 'implement' || input.phase === 'repair') assert.equal(readFileSync(join(input.cwd, 'src/value.ts'), 'utf8'), "export const value = 'ready';\n", 'Native reconstruction retains the interrupted accepted draft.');
      return delegate.run(input);
    } };
    let result: Awaited<ReturnType<typeof ownerResume>> | undefined;
    await assert.doesNotReject(async () => { result = await ownerResume(fixture.request, { agent }); }, 'Explicit zero/zero must continue through the native selected-job lifecycle without a grant.');
    assert.equal(result?.status, 'merged');
    const run = fixture.store.work.run(result!.runId!)!;
    const state = JSON.parse(readFileSync(join(run.evidencePath, 'state.json'), 'utf8'));
    const task = JSON.parse(readFileSync(join(run.evidencePath, 'task.json'), 'utf8')) as Task;
    assert.equal(taskIdentity(task), taskIdentity(fixture.task));
    assert.deepEqual(task.budget, fixture.task.budget);
    assert.equal(state.resume.fromRunId, fixture.run.id);
    assert.equal(state.resume.reused, true);
    assert.equal(state.integration.verification.status, 'passed');
    assert.equal(state.integration.review.approved, true);
    assert.equal(state.integration.commit, git(fixture.repository, ['rev-parse', 'main']).trim());
    assert.equal(phases.some(phase => phase === 'implement' || phase === 'repair'), true);
    assert.equal(phases.includes('review'), true);
    assert.equal(phases.some(phase => ['plan', 'tests', 'acceptance-review'].includes(phase)), false);
    assert.deepEqual(fixture.store.work.run(fixture.run.id), oldRun, 'Continuation preserves the actual interrupted run history.');
    assert.equal(fixture.store.get(fixture.issue.id)?.status, 'done');
    assert.deepEqual(fixture.store.work.jobs().find(job => job.id === siblingJob.id), siblingJob);
    const after = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    assert.equal(after.implementationAttempts, before.implementationAttempts + 1);
    assert.equal(after.acceptanceAttempts, before.acceptanceAttempts);
    assert.ok(after.usedMs >= before.usedMs);
    assert.deepEqual(after.ownerGrants, before.ownerGrants, 'Remaining-capacity continuation must append no owner grant.');
    assert.equal(state.budget.maxAttempts, fixture.task.budget.maxAttempts);
    assert.equal(state.budget.totalTimeoutMs, fixture.task.budget.totalTimeoutMs);
    const settled = retained(fixture);
    const calls = [...phases];
    assert.deepEqual(await ownerResume(fixture.request, { agent }), result);
    assert.deepEqual(retained(fixture), settled, 'Exact replay creates no job, run or ledger write.');
    assert.deepEqual(phases, calls, 'Exact replay invokes no agent.');
    const terminal = { ...fixture.request, requestId: randomUUID() };
    await assert.rejects(ownerResume(terminal, { agent }), /blocked|terminal|completed|done/i, 'A new decision cannot restart completed work.');
    assert.deepEqual(retained(fixture), settled);
    assert.deepEqual(phases, calls);
    assert.equal(existsSync(join(fixture.evidenceRoot, 'owner-resumes', terminal.requestId)), false);
  } finally { fixture.store.close(); }
});
