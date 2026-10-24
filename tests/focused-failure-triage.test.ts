import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runController } from '../factory/controller.ts';
import type { AgentInput, ControllerState } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { digest, environmentIdentity, loadCheckpoint } from '../factory/checkpoint.ts';
import { inspectNodeReport, snapshot } from '../factory/evidence.ts';
import type { RedCheck } from '../factory/regression.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const nodeCheck = { file: 'tests/value.test.ts', title: 'value is ready' };
const incidentalCheck = { file: 'tests/incidental.test.ts', title: 'ready value preserves initial incidental state' };
const ownerFinding = 'The assertion requires incidental initial state; owner maintenance must review the test contract.';
const task = () => parseTask({ schemaVersion: 2, id: 'focused-triage', title: 'Ready value', goal: 'Return the ready value regardless of incidental active state.', acceptance: [{ id: 'ready', description: 'The business value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 3000, totalTimeoutMs: 90000 }, notes: 'Disposable focused failure fixture.' });

function setup(incidental = false) {
  const root = evidenceDirectory('focused-failure-triage');
  const repository = fixtureRepository(join(root, 'repo'));
  if (incidental) {
    writeFileSync(join(repository, 'src/active.ts'), "export const active = 'initial';\n");
    writeFileSync(join(repository, 'tests/incidental.test.ts'), `import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.ts';\nimport {active} from '../src/active.ts';\ntest(${JSON.stringify(incidentalCheck.title)},()=>{assert.equal(value,'ready');assert.equal(active,'initial');});\n`);
    git(repository, ['add', 'src/active.ts', 'tests/incidental.test.ts']);
    git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Prepare incidental-state fixture']);
  }
  const before = git(repository, ['rev-parse', 'main']).trim();
  const frozen = snapshot(repository).files.filter(file => /^(tests|acceptance)\//.test(file.path));
  return { root, repository, before, frozen, delegate: fixtureAgent() };
}

function plan(input: AgentInput, incidental = false) {
  return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'Existing named checks observe the business value.' }, assumptions: [], slices: [{ id: 'ready', goal: input.task.goal, acceptanceIds: ['ready'], checks: incidental ? [incidentalCheck] : [nodeCheck] }], browserChecks: [] };
}

function assertFailure(input: AgentInput, expected: typeof nodeCheck): RedCheck {
  const context = JSON.parse(input.feedback);
  assert.equal(context.purpose, 'focused-failure-triage');
  assert.equal(context.sourceHash, snapshot(input.cwd).hash, 'The independent disposition must bind the actual failed candidate.');
  const check = context.check as RedCheck;
  assert.equal(check.file, expected.file);
  assert.equal(check.title, expected.title);
  assert.equal(check.status, 'expected_failure');
  assert.ok(check.reportPath && existsSync(check.logPath));
  const raw = readFileSync(check.reportPath, 'utf8');
  const records = raw.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(records.some(event => event.type === 'test:fail' && event.data.name === expected.title));
  assert.match(raw, /ERR_ASSERTION/);
  return check;
}

function assertFrozen(fixture: ReturnType<typeof setup>, state: ControllerState) {
  assert.deepEqual(snapshot(state.workspace).files.filter(file => /^(tests|acceptance)\//.test(file.path)), fixture.frozen);
  assert.deepEqual(snapshot(fixture.repository).files.filter(file => /^(tests|acceptance)\//.test(file.path)), fixture.frozen);
}

function cleanup(fixture: ReturnType<typeof setup>, ...states: (ControllerState | undefined)[]) {
  for (const state of states) if (state && existsSync(join(state.workspace, '.git'))) git(fixture.repository, ['worktree', 'remove', '--force', state.workspace]);
}

test('focused Node overconstraint requires independent owner disposition before repair', { timeout: 90000 }, async () => {
  const fixture = setup(true);
  let implementations = 0;
  let repairs = 0;
  let triages = 0;
  const state = await runController({ repository: fixture.repository, task: task(), evidenceRoot: fixture.root, mergeTarget: 'main', agent: { run: async input => {
    if (input.phase === 'plan') return plan(input, true);
    if (input.phase === 'implement') {
      implementations++;
      writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'ready';\n");
      writeFileSync(join(input.cwd, 'src/active.ts'), "export const active = 'focused';\n");
    }
    if (input.phase === 'repair') repairs++;
    if (input.phase === 'acceptance-review') {
      triages++;
      assertFailure(input, incidentalCheck);
      return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'The business result is correct; the incidental-state assertion is overconstrained.', findings: [ownerFinding] };
    }
    return fixture.delegate.run(input);
  } } });
  try {
    assert.equal(triages, 1, 'A real named focused assertion failure must receive independent triage.');
    assert.equal(state.status, 'blocked');
    assert.equal(implementations, 1);
    assert.equal(repairs, 0);
    assert.equal(state.budget?.implementationAttempts, 1);
    assert.equal(state.efficiency?.verificationExecutions, 0);
    assert.match(state.reason ?? '', /owner maintenance|incidental|test.contract/i);
    assert.equal(git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
    assertFrozen(fixture, state);
    const triage = JSON.parse(readFileSync(join(state.runDirectory, 'failure-triage-1.json'), 'utf8'));
    assert.equal(triage.status, 'owner-maintenance-required');
    assert.equal(triage.sourceHash, snapshot(state.workspace).hash);
    const checkpoint = JSON.parse(readFileSync(join(state.runDirectory, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.accepted, true);
    const pending = checkpoint.pendingFailureTriage as { check: RedCheck; receipt: { purpose: string; sourceHash: string; planHash: string; criteriaHash: string; contractHash: string; evidencePath: string; approved: boolean } };
    assert.ok(pending);
    assert.equal(pending.check.title, incidentalCheck.title);
    assert.equal(pending.receipt.purpose, 'focused-failure-triage');
    assert.equal(pending.receipt.approved, false);
    assert.equal(pending.receipt.sourceHash, snapshot(state.workspace).hash);
    for (const key of ['planHash', 'criteriaHash', 'contractHash'] as const) assert.match(pending.receipt[key], /^[a-f0-9]{64}$/);
    const focused = JSON.parse(readFileSync(join(state.runDirectory, 'focused-1.json'), 'utf8')).checks.find((check: RedCheck) => check.status === 'expected_failure');
    assert.equal(digest(readFileSync(pending.check.reportPath!)), digest(readFileSync(focused.reportPath)));
    for (const path of [pending.check.logPath, pending.check.reportPath!, pending.receipt.evidencePath]) {
      const proof = checkpoint.proofs.find((proof: { path: string }) => proof.path === basename(path));
      assert.ok(proof, `Held failure evidence must be included in checkpoint integrity: ${path}`);
      assert.equal(proof.hash, digest(readFileSync(join(state.runDirectory, proof.path))));
    }
    const environment = environmentIdentity(fixture.repository, process.cwd());
    assert.doesNotThrow(() => loadCheckpoint(state.runDirectory, fixture.root, task(), environment));
    const manifestPath = join(state.runDirectory, 'checkpoint.json');
    const original = readFileSync(manifestPath, 'utf8');
    delete checkpoint.pendingFailureTriage;
    writeFileSync(manifestPath, JSON.stringify(checkpoint));
    try { assert.throws(() => loadCheckpoint(state.runDirectory, fixture.root, task(), environment), /triage|orphan|pending/i); }
    finally { writeFileSync(manifestPath, original); }
  } finally { cleanup(fixture, state); }
});

test('independently confirmed focused product defects use ordinary repair and fresh final verification', { timeout: 90000 }, async () => {
  const fixture = setup();
  const calls: string[] = [];
  const state = await runController({ repository: fixture.repository, task: task(), evidenceRoot: fixture.root, mergeTarget: 'main', agent: { run: async input => {
    calls.push(input.phase);
    if (input.phase === 'plan') return plan(input);
    if (input.phase === 'implement') return { schemaVersion: 1, taskId: input.task.id, summary: 'The first candidate still returns the broken product value.', blockers: [] };
    if (input.phase === 'acceptance-review') {
      assertFailure(input, nodeCheck);
      return { schemaVersion: 1, taskId: input.task.id, approved: true, summary: 'The named assertion correctly exposes the missing ready value; ordinary product repair is required.', findings: [] };
    }
    return fixture.delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'merged', state.reason ?? 'No failure reason');
    assert.deepEqual(calls, ['plan', 'implement', 'acceptance-review', 'repair', 'review']);
    assert.equal(state.budget?.implementationAttempts, 2);
    assert.equal(state.budget?.acceptanceAttempts, 0);
    const triage = JSON.parse(readFileSync(join(state.runDirectory, 'failure-triage-1.json'), 'utf8'));
    assert.equal(triage.status, 'repair-approved');
    assert.equal(state.reviewReceipts?.filter(receipt => receipt.purpose === 'focused-failure-triage' && receipt.approved).length, 1);
    assert.equal(state.integration?.verification?.status, 'passed');
    assert.equal(state.integration?.review?.approved, true);
    assert.equal(state.efficiency?.verificationExecutions, 1);
    assert.ok(state.integration?.commit);
    const verification = state.integration!.verification!;
    assert.equal(inspectNodeReport(join(verification.runDirectory, 'node-results.jsonl')).passed, 1);
    assertFrozen(fixture, state);
    assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'checkpoint.json'), 'utf8')).pendingFailureTriage, undefined);
  } finally { cleanup(fixture, state); }
});

test('held focused failures are retriaged on checkpoint reuse before consuming another implementation attempt', { timeout: 90000 }, async () => {
  const fixture = setup();
  let firstTriages = 0;
  const interruptedTriage = { run: async (input: AgentInput) => {
    if (input.phase === 'plan') return plan(input);
    if (input.phase === 'implement' || input.phase === 'repair') return { schemaVersion: 1, taskId: input.task.id, summary: 'Retain the candidate until independent failure disposition.', blockers: [] };
    if (input.phase === 'acceptance-review') {
      firstTriages++;
      assertFailure(input, nodeCheck);
      return { schemaVersion: 1, taskId: input.task.id, approved: true, summary: 'A malformed disposition cannot release the held failure.', findings: ['This positive commentary makes the approval invalid.'] };
    }
    return fixture.delegate.run(input);
  } };
  const first = await runController({ repository: fixture.repository, task: task(), evidenceRoot: fixture.root, mergeTarget: 'main', agent: interruptedTriage });
  let second: ControllerState | undefined;
  try {
    const priorReport = readFileSync(join(first.runDirectory, 'focused-1.json'), 'utf8');
    const priorCheck = JSON.parse(priorReport).checks[0] as RedCheck;
    const originalFailure = digest(readFileSync(priorCheck.reportPath!));
    const checkpoint = JSON.parse(readFileSync(join(first.runDirectory, 'checkpoint.json'), 'utf8'));
    const calls: string[] = [];
    second = await runController({ repository: fixture.repository, task: task(), evidenceRoot: fixture.root, mergeTarget: 'main', resumeFrom: first.runDirectory, agent: { run: async input => {
      calls.push(input.phase);
      if (input.phase === 'acceptance-review') {
        const check = assertFailure(input, nodeCheck);
        assert.equal(digest(readFileSync(check.reportPath!)), originalFailure);
        return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'The failure cause needs owner inspection.', findings: ['Unknown failure cause requires owner maintenance.'] };
      }
      return interruptedTriage.run(input);
    } } });
    assert.equal(firstTriages, 2, 'Malformed triage gets one bounded response correction while the failure remains held.');
    assert.equal(first.status, 'blocked');
    assert.equal(checkpoint.accepted, true);
    assert.ok(checkpoint.pendingFailureTriage?.check);
    assert.equal(checkpoint.pendingFailureTriage.receipt, undefined, 'A malformed response must never become an approval receipt.');
    assert.equal(checkpoint.pendingFailureTriage.sourceHash, snapshot(first.workspace).hash);
    assert.equal(digest(readFileSync(checkpoint.pendingFailureTriage.check.reportPath)), originalFailure);
    for (const path of [checkpoint.pendingFailureTriage.check.logPath, checkpoint.pendingFailureTriage.check.reportPath]) {
      const proof = checkpoint.proofs.find((proof: { path: string }) => proof.path === basename(path));
      assert.ok(proof, 'The held failure must be checkpointed before any valid review response exists.');
      assert.equal(proof.hash, digest(readFileSync(join(first.runDirectory, proof.path))));
    }
    assert.deepEqual(calls, ['acceptance-review'], 'Native checkpoint reuse must resolve the held failure before any new repair, plan or test phase.');
    assert.equal(second.status, 'blocked');
    assert.equal(second.resume?.reused, true);
    assert.equal(first.budget?.implementationAttempts, 1);
    assert.equal(second.budget?.implementationAttempts, first.budget?.implementationAttempts);
    assert.equal(second.budget?.acceptanceAttempts, first.budget?.acceptanceAttempts);
    assert.equal(second.attempts.length, 0);
    assert.equal(second.efficiency?.verificationExecutions, 0);
    assert.equal(readFileSync(join(first.runDirectory, 'focused-1.json'), 'utf8'), priorReport);
    assert.equal(digest(readFileSync(priorCheck.reportPath!)), originalFailure);
    assert.equal(git(fixture.repository, ['rev-parse', 'main']).trim(), fixture.before);
    assertFrozen(fixture, second);
  } finally { cleanup(fixture, first, second); }
});
