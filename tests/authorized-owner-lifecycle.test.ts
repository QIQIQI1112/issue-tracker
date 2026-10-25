import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import type { Agent, AgentInput } from '../factory/controller.ts';
import { ownerResume } from '../factory/owner-recovery.ts';
import { maintenanceIdentity } from '../factory/maintenance.ts';
import { digest } from '../factory/checkpoint.ts';
import { snapshot } from '../factory/evidence.ts';
import { runProcess } from '../factory/process.ts';
import { git, processEnvironment } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

type Profile = 'harness' | 'acceptance_contract';
type QueueOptions = NonNullable<ConstructorParameters<typeof SerialQueue>[1]> & { ownerAuthorizationPath?: string };
const check = { file: 'tests/value.test.ts', title: 'value is ready' };

function fixture(profile: Profile) {
  const root = evidenceDirectory('authorized-owner-lifecycle');
  const repository = fixtureRepository(join(root, 'repo'));
  const scope = profile === 'harness' ? ['factory/value.ts'] : [check.file];
  writeFileSync(join(repository, 'src/value.ts'), profile === 'harness' ? "export {value} from '../factory/value.ts';\n" : "export const value = 'ready';\n");
  if (profile === 'harness') writeFileSync(join(repository, 'factory/value.ts'), "export const value = 'broken';\n");
  writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode: 'adaptive-v2' }));
  git(repository, ['add', '.']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Prepare the authorized profile fixture']);
  const store = new IssueStore(join(root, 'state.sqlite'));
  const repo = store.work.addRepo({ name: 'Authorized fixture', path: repository, targetBranch: 'main' });
  const issue = store.create({ title: 'Ready value maintenance', description: 'Return the ready value through the authorized profile.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['The value is ready.'], changeKind: profile } });
  const job = store.work.startIssue(issue.id);
  const engine = fileURLToPath(new URL('../', import.meta.url));
  const request = { schemaVersion: 1, requestId: randomUUID(), issueId: issue.id, issueHash: maintenanceIdentity(issue), profile, scope, authorization: 'The owner authorizes this bounded fixture maintenance and its existing quality gates.', engineSourceHash: snapshot(engine).hash, contractHash: digest(readFileSync(join(engine, 'factory/verification-contract.json'))), baseCommit: git(repository, ['rev-parse', 'main']).trim() };
  const authorizationPath = join(root, 'owner-authorization.json');
  writeFileSync(authorizationPath, JSON.stringify(request));
  const evidenceRoot = join(root, 'evidence');
  return { root, repository, store, repo, issue, job, request, authorizationPath, evidenceRoot };
}

type Fixture = ReturnType<typeof fixture>;
const report = (input: AgentInput) => ({ schemaVersion: 1, taskId: input.task.id, summary: 'Prepared the authorized candidate.', blockers: [] });
const plan = (input: AgentInput, mode: 'reuse' | 'extend') => ({ schemaVersion: 2, taskId: input.task.id, coverage: { mode, reason: 'The real frozen value check observes this bounded maintenance.' }, assumptions: [], slices: [{ id: 'ready', goal: input.task.goal, acceptanceIds: input.task.acceptance.map(item => item.id), checks: [check] }], browserChecks: [] });

function agent(fixture: Fixture, phases: string[], work: Agent['run']): Agent {
  return { run: async input => {
    const running = fixture.store.work.jobs().find(job => job.issueId === fixture.issue.id && job.status === 'running');
    assert.ok(running?.runId, 'The existing maintenance job must be claimed before any substantive agent phase.');
    assert.equal(fixture.store.work.run(running.runId)?.status, 'running');
    assert.equal(fixture.store.get(fixture.issue.id)?.status, 'in_progress');
    phases.push(input.phase);
    return await work(input);
  } };
}

function delivered(fixture: Fixture, phases: string[]) {
  const run = fixture.store.work.runs().find(run => run.issueId === fixture.issue.id && run.status === 'merged');
  assert.ok(run, 'Verified integration must finish the same native maintenance run.');
  const state = JSON.parse(readFileSync(join(run.evidencePath, 'run-state.json'), 'utf8'));
  const delivery = JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8'));
  assert.equal(state.profile, fixture.request.profile);
  assert.equal(state.runId, run.id);
  assert.equal(state.status, 'merged');
  assert.deepEqual(state.engine, { sourceHash: fixture.request.engineSourceHash, contractHash: fixture.request.contractHash }, 'The pre-change supervising engine and contract remain pinned through protected candidate changes.');
  assert.equal(fixture.store.get(fixture.issue.id)?.status, 'done');
  assert.equal(delivery.status, 'merged');
  assert.equal(delivery.integration.commit, git(fixture.repository, ['rev-parse', 'main']).trim());
  assert.equal(delivery.review.approved, true);
  assert.ok(delivery.phases.length > 0 && delivery.phases.every((phase: { status: string; durationMs: number }) => phase.status !== 'running' && Number.isFinite(phase.durationMs) && phase.durationMs >= 0));
  assert.equal(delivery.efficiency.agentInvocations, phases.length, 'Maintenance metrics count actual role calls rather than only final attestation.');
  assert.equal(delivery.efficiency.elapsedMs, Date.parse(delivery.completedAt) - Date.parse(delivery.startedAt));
  assert.ok(Date.parse(delivery.startedAt) >= Date.parse(run.startedAt));
  const summary = JSON.parse(readFileSync(resolve(run.evidencePath, state.proofs.verification.path), 'utf8'));
  assert.equal(summary.status, 'passed');
  assert.deepEqual(summary.checks.map((gate: { name: string; status: string }) => [gate.name, gate.status]), [['lint', 'passed'], ['typecheck', 'passed'], ['test', 'passed'], ['build', 'passed']]);
  assert.equal(summary.snapshot.hash, state.sourceHash);
  return run;
}

test('trusted harness authorization claims before roles and delivers pinned verified maintenance while ordinary and mismatched authority stay excluded', { timeout: 60000 }, async () => {
  const context = fixture('harness');
  const phases: string[] = [];
  const delegate = fixtureAgent();
  const worker = agent(context, phases, async input => {
    if (input.phase === 'plan') return plan(input, 'reuse');
    if (input.phase === 'implement' || input.phase === 'repair') { writeFileSync(join(input.cwd, 'factory/value.ts'), "export const value = 'ready';\n"); return report(input); }
    return await delegate.run(input);
  });
  try {
    assert.equal(await new SerialQueue(context.store, { evidenceRoot: context.evidenceRoot, agent: worker }).processNext(context.job.id), false, 'Classification alone cannot grant maintenance execution authority.');
    const before = { jobs: context.store.work.jobs(), runs: context.store.work.runs(), issue: context.store.get(context.issue.id) };
    for (const [name, patch] of [
      ['issue', { issueHash: '0'.repeat(64) }],
      ['engine', { engineSourceHash: '0'.repeat(64) }],
      ['scope', { scope: ['../outside'] }],
      ['contract', { contractHash: '0'.repeat(64) }],
      ['base', { baseCommit: git(context.repository, ['rev-parse', 'main^']).trim() }],
    ] as const) {
      const path = join(context.root, `invalid-${name}.json`);
      writeFileSync(path, JSON.stringify({ ...context.request, ...patch, requestId: randomUUID() }));
      const options: QueueOptions = { evidenceRoot: context.evidenceRoot, agent: worker, ownerAuthorizationPath: path };
      let processed = false;
      try { processed = await new SerialQueue(context.store, options).processNext(context.job.id); } catch (error) { assert.ok(error instanceof Error); }
      assert.equal(processed, false, `${name} mismatch cannot start authorized work.`);
      assert.deepEqual({ jobs: context.store.work.jobs(), runs: context.store.work.runs(), issue: context.store.get(context.issue.id) }, before);
      assert.deepEqual(phases, []);
    }
    const options: QueueOptions = { evidenceRoot: context.evidenceRoot, agent: worker, ownerAuthorizationPath: context.authorizationPath };
    assert.equal(await new SerialQueue(context.store, options).processNext(context.job.id), true, 'A valid trusted owner request must execute the selected queued maintenance job.');
    assert.ok(['plan', 'implement', 'review'].every(phase => phases.includes(phase)));
    delivered(context, phases);
    assert.equal(readFileSync(join(context.repository, 'factory/value.ts'), 'utf8'), "export const value = 'ready';\n");
  } finally { context.store.close(); }
});

test('authorized acceptance-contract revision is independently reviewed frozen implemented and verified through its separate profile', { timeout: 60000 }, async () => {
  const context = fixture('acceptance_contract');
  const phases: string[] = [];
  const delegate = fixtureAgent();
  const original = readFileSync(join(context.repository, check.file), 'utf8');
  const revised = original.replace("assert.equal(value,'ready')", "assert.deepEqual({value},{value:'ready'})");
  let accepted = false;
  const worker = agent(context, phases, async input => {
    if (input.phase === 'plan') return plan(input, 'extend');
    if (input.phase === 'tests') { writeFileSync(join(input.cwd, check.file), revised); return report(input); }
    if (input.phase === 'acceptance-review') { assert.equal(readFileSync(join(input.cwd, check.file), 'utf8'), revised); accepted = true; }
    if (input.phase === 'implement') { assert.equal(accepted, true, 'Independent revision approval precedes the retained implementation role.'); assert.equal(readFileSync(join(input.cwd, check.file), 'utf8'), revised); return report(input); }
    return await delegate.run(input);
  });
  try {
    assert.notEqual(revised, original, 'The fixture really revises an existing acceptance assertion while preserving its guarantee and identity.');
    const options: QueueOptions = { evidenceRoot: context.evidenceRoot, agent: worker, ownerAuthorizationPath: context.authorizationPath };
    assert.equal(await new SerialQueue(context.store, options).processNext(context.job.id), true, 'The explicitly authorized acceptance-contract job must execute through its own profile.');
    assert.ok(accepted && phases.includes('tests') && phases.includes('implement') && phases.includes('review'));
    delivered(context, phases);
    assert.equal(readFileSync(join(context.repository, check.file), 'utf8'), revised);
    assert.equal(readFileSync(join(context.repository, 'src/value.ts'), 'utf8'), "export const value = 'ready';\n");
  } finally { context.store.close(); }
});

test('settled authorized maintenance resumes through the native owner journal with pinned identity cumulative budget and idempotent delivery', { timeout: 90000 }, async () => {
  const context = fixture('harness');
  const phases: string[] = [];
  const delegate = fixtureAgent();
  const interrupted = agent(context, phases, async input => {
    if (input.phase === 'plan') return plan(input, 'reuse');
    if (input.phase === 'implement') { writeFileSync(join(input.cwd, 'factory/value.ts'), "export const value = 'ready';\n"); throw new Error('Intentional settled interruption after frozen coverage.'); }
    return await delegate.run(input);
  });
  try {
    const options: QueueOptions = { evidenceRoot: context.evidenceRoot, agent: interrupted, ownerAuthorizationPath: context.authorizationPath };
    assert.equal(await new SerialQueue(context.store, options).processNext(context.job.id), true, 'Authorized initial work must enter the same native lifecycle before testing continuation.');
    const first = context.store.work.runs().find(run => run.issueId === context.issue.id)!;
    assert.equal(first.status, 'blocked');
    assert.equal(JSON.parse(readFileSync(join(first.evidencePath, 'checkpoint.json'), 'utf8')).accepted, true);
    assert.equal(git(context.repository, ['rev-parse', 'main']).trim(), context.request.baseCommit);
    const ledgerPath = join(context.evidenceRoot, 'budgets', `${digest(`repo-${context.repo.id}:issue-${context.issue.id}`)}.json`);
    const before = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    const request = { schemaVersion: 1, requestId: randomUUID(), databasePath: context.store.path, issueId: context.issue.id, additionalAttempts: 1, additionalTimeMs: 60000, reason: 'The owner authorizes one bounded continuation of the unchanged maintenance.', ownerAuthorizationPath: context.authorizationPath };
    const wrong = join(context.root, 'wrong-resume-engine.json');
    writeFileSync(wrong, JSON.stringify({ ...context.request, requestId: randomUUID(), engineSourceHash: '0'.repeat(64) }));
    const jobs = context.store.work.jobs();
    const retainedLedger = readFileSync(ledgerPath, 'utf8');
    await assert.rejects(ownerResume({ ...request, requestId: randomUUID(), ownerAuthorizationPath: wrong }, { agent: delegate }), 'A continuation cannot silently upgrade or substitute the supervising engine.');
    assert.equal(readFileSync(ledgerPath, 'utf8'), retainedLedger, 'Identity rejection cannot grant or reset the issue budget.');
    assert.deepEqual(context.store.work.jobs(), jobs);
    const requestPath = join(context.root, 'resume.json');
    writeFileSync(requestPath, JSON.stringify(request));
    const preview = await runProcess({ command: process.execPath, args: ['--import', 'tsx', resolve('factory/cli.ts'), 'owner-resume', requestPath, '--validate'], cwd: process.cwd(), env: processEnvironment({}), logPath: join(context.root, 'resume-preview.log'), timeoutMs: 15000 });
    assert.equal(preview.status, 'passed', preview.output);
    assert.equal(preview.settled, true);
    const resumedPhases: string[] = [];
    const resumed = agent(context, resumedPhases, async input => {
      if (input.phase === 'implement' || input.phase === 'repair') { assert.equal(readFileSync(join(input.cwd, 'factory/value.ts'), 'utf8'), "export const value = 'ready';\n", 'The approved interrupted draft survives native reconstruction.'); return report(input); }
      return await delegate.run(input);
    });
    const result = await ownerResume(request, { agent: resumed });
    assert.equal(result.status, 'merged');
    assert.ok(!resumedPhases.some(phase => ['plan', 'tests', 'acceptance-review'].includes(phase)), 'A valid accepted checkpoint retains completed authoring and approval.');
    const run = delivered(context, resumedPhases);
    assert.equal(result.runId, run.id);
    const state = JSON.parse(readFileSync(join(run.evidencePath, 'state.json'), 'utf8'));
    assert.equal(state.resume.fromRunId, first.id);
    assert.equal(state.resume.reused, true);
    const after = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.equal(after.implementationAttempts, before.implementationAttempts + 1);
    assert.equal(after.acceptanceAttempts, before.acceptanceAttempts);
    assert.ok(after.usedMs >= before.usedMs);
    assert.equal(context.store.work.run(first.id)?.status, 'blocked');
    const calls = resumedPhases.length;
    const ledger = readFileSync(ledgerPath, 'utf8');
    const replay = await ownerResume(request, { agent: resumed });
    assert.equal(replay.runId, result.runId);
    assert.equal(resumedPhases.length, calls);
    assert.equal(readFileSync(ledgerPath, 'utf8'), ledger);
  } finally { context.store.close(); }
});
