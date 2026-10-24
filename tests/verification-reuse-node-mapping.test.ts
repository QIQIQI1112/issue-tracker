import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Issue } from '../src/domain.ts';
import type { Requirement, WorkRun } from '../src/workflow.ts';
import { runController } from '../factory/controller.ts';
import type { ControllerState } from '../factory/controller.ts';
import { captureIntegratedVerification, reusableRequirementVerification } from '../factory/verification-reuse.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';

const mappedCheck = { file: 'tests/mapped-value.test.ts', title: 'mapped ready value is externally observable' };

async function mergedFixture() {
  mkdirSync(resolve('.runs'), { recursive: true });
  const root = mkdtempSync(resolve('.runs/verification-reuse-Node-mapping-'));
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, mappedCheck.file), `import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.ts';\ntest(${JSON.stringify(mappedCheck.title)},()=>assert.equal(value,'ready'));\n`);
  git(repository, ['add', 'tests']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Frozen mapped Node behavior']);
  const goal = 'Return ready and expose the same value for the original complete requirement.';
  const task = { schemaVersion: 2, id: 'issue-3', title: 'Mapped ready value', goal, wholeGoal: { requirementId: 7, goal }, acceptance: [{ id: 'ready', description: 'The value is ready.' }, { id: 'visible', description: 'The ready value is externally observable.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 2000, totalTimeoutMs: 30000 }, notes: 'Real version-two Node acceptance mappings must retain exact-source verification reuse.' };
  const delegate = fixtureAgent();
  const state = await runController({ repository, task, mergeTarget: 'main', evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'Frozen named Node checks observe the complete ready-value behavior.' }, assumptions: [], slices: [{ id: 'ready', goal, acceptanceIds: ['ready', 'visible'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }, mappedCheck] }], browserChecks: [] };
    return await delegate.run(input);
  } } });
  const stamp = state.completedAt!;
  const requirement: Requirement = { id: 7, repoId: 1, title: 'Original mapped goal', goal, status: 'running', createdAt: state.startedAt, updatedAt: stamp };
  const child: Issue = { id: 3, title: task.title, description: goal, status: 'done', priority: 'medium', labels: [], createdAt: state.startedAt, updatedAt: stamp, work: { repoId: 1, requirementId: 7, acceptance: task.acceptance.map(item => item.description), dependsOn: [] } };
  const run: WorkRun = { id: state.runId, jobId: 11, repoId: 1, requirementId: 7, issueId: 3, status: 'merged', evidencePath: state.runDirectory, reason: null, startedAt: state.startedAt, completedAt: stamp };
  const input = { repository, cwd: repository, branch: 'main', requirement, children: [child], runs: [run] };
  return { root, repository, state, input, certificatePath: join(state.runDirectory, 'integrated-verification-certificate.json') };
}

type Fixture = Awaited<ReturnType<typeof mergedFixture>>;

function approvedEvidence(fixture: Fixture) {
  assert.equal(fixture.state.status, 'merged', fixture.state.reason ?? `Controller integration must pass before reuse is inspected: ${fixture.root}`);
  assert.deepEqual(fixture.state.plan?.browserChecks, []);
  assert.equal(fixture.state.integration?.verification?.status, 'passed');
  assert.equal(fixture.state.integration?.verification?.node?.passed, 2);
  assert.equal(fixture.state.integration?.review?.approved, true);
  assert.ok(fixture.state.reviewReceipts?.some(item => item.purpose === 'integrated-code-and-whole-goal' && item.approved));
  assert.equal(existsSync(fixture.certificatePath), true, `Real approved version-two Node evidence must acquire its owner certificate: ${fixture.state.runDirectory}`);
  const reused = reusableRequirementVerification(fixture.input);
  assert.ok(reused, 'The unchanged mapped Node evidence must be eligible before reuse or tamper checks.');
  return reused;
}

function cleanup(fixture: Fixture) {
  if (existsSync(join(fixture.state.workspace, '.git'))) git(fixture.repository, ['worktree', 'remove', '--force', fixture.state.workspace]);
}

function withRestoredFiles(paths: string[], mutate: () => void, check: () => void) {
  const original = paths.map(path => ({ path, bytes: readFileSync(path) }));
  try { mutate(); check(); }
  finally { for (const file of original) writeFileSync(file.path, file.bytes); }
}

test('version-two Node acceptance mappings preserve integrated certificates and original whole-goal evidence', { timeout: 30000 }, async () => {
  const fixture = await mergedFixture();
  try {
    const reused = approvedEvidence(fixture);
    assert.deepEqual(reused.verification, fixture.state.integration?.verification, 'Reuse must return the original complete machine report unchanged.');
    assert.deepEqual(reused.review, fixture.state.integration?.review, 'The exact sole-child original goal retains its independent review.');
    assert.equal(reused.provenance.reviewReused, true);
    assert.equal(reused.provenance.runId, fixture.state.runId);
    assert.equal(reused.provenance.certificatePath, fixture.certificatePath);
    const original = JSON.parse(readFileSync(join(reused.verification.runDirectory, 'summary.json'), 'utf8'));
    assert.equal(reused.provenance.verificationRunId, original.runId);
    assert.equal(reused.provenance.startedAt, original.startedAt);
    assert.equal(reused.provenance.completedAt, original.completedAt);
    const captured = captureIntegratedVerification({ repository: fixture.repository, runDirectory: fixture.state.runDirectory, branch: 'main', commit: fixture.state.integration!.commit!, wholeGoal: { requirementId: fixture.input.requirement.id, goal: fixture.input.requirement.goal } });
    assert.equal(captured.verification.runId, original.runId, 'Explicit owner capture must also accept the real mapped contract without replacing verification.');
    assert.deepEqual(reusableRequirementVerification(fixture.input)?.verification, reused.verification);
  } finally { cleanup(fixture); }
});

test('version-two Node certificate reuse rejects changed acceptance mappings required cases and actual reports', { timeout: 30000 }, async () => {
  const fixture = await mergedFixture();
  try {
    const reused = approvedEvidence(fixture);
    const planPath = join(fixture.state.runDirectory, 'plan.json');
    const statePath = join(fixture.state.runDirectory, 'state.json');
    withRestoredFiles([planPath, statePath], () => {
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as ControllerState;
      state.plan!.slices[0].acceptanceIds = ['ready'];
      writeFileSync(planPath, JSON.stringify(state.plan));
      writeFileSync(statePath, JSON.stringify(state));
    }, () => {
      assert.equal(reusableRequirementVerification(fixture.input), undefined, 'Even a valid mutually consistent changed mapping needs a fresh source-bound plan approval.');
    });
    const certificate = JSON.parse(readFileSync(fixture.certificatePath, 'utf8')) as { verification: { contractPath: string; nodePath: string } };
    const contractPath = join(fixture.state.runDirectory, certificate.verification.contractPath);
    withRestoredFiles([contractPath], () => {
      const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as { requiredNodeTests: { file: string; title: string }[] };
      const check = contract.requiredNodeTests.find(item => item.file === mappedCheck.file);
      assert.ok(check, 'The effective owner contract must include the planned Node case.');
      check.title = 'an unexecuted replacement Node case';
      writeFileSync(contractPath, JSON.stringify(contract));
    }, () => {
      assert.equal(reusableRequirementVerification(fixture.input), undefined, 'A substituted required case cannot reuse reports for the original case.');
    });
    const nodePath = join(fixture.state.runDirectory, certificate.verification.nodePath);
    withRestoredFiles([nodePath], () => {
      const records = readFileSync(nodePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      let changed = 0;
      for (const event of records) if (event.type === 'test:pass' && event.data.name === mappedCheck.title) { event.data.name = 'a different passing Node case'; changed += 1; }
      assert.equal(changed, 1, 'Tamper probes must change the actual named passing event.');
      writeFileSync(nodePath, records.map(event => JSON.stringify(event)).join('\n') + '\n');
    }, () => {
      assert.equal(reusableRequirementVerification(fixture.input), undefined, 'Passing totals cannot replace required actual Node evidence.');
    });
    assert.deepEqual(reusableRequirementVerification(fixture.input)?.verification, reused.verification, 'Only the exact restored approved evidence regains eligibility.');
  } finally { cleanup(fixture); }
});
