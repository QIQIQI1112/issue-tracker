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

const browserCheck = { file: 'mapped-value.spec.ts', title: 'mapped ready value is externally observable', acceptanceIds: ['visible'] };

async function mergedFixture() {
  mkdirSync(resolve('.runs'), { recursive: true });
  const root = mkdtempSync(resolve('.runs/verification-reuse-browser-mapping-'));
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'acceptance', browserCheck.file), `import {test,expect} from ${JSON.stringify(resolve('node_modules/@playwright/test/index.mjs'))};\nimport {value} from '../src/value.ts';\ntest(${JSON.stringify(browserCheck.title)},()=>expect(value).toBe('ready'));\n`);
  git(repository, ['add', 'acceptance']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Frozen mapped browser behavior']);
  const goal = 'Return ready and expose the same value for the original complete requirement.';
  const task = { schemaVersion: 2, id: 'issue-3', title: 'Mapped ready value', goal, wholeGoal: { requirementId: 7, goal }, acceptance: [{ id: 'ready', description: 'The value is ready.' }, { id: 'visible', description: 'The ready value is externally observable.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 2000, totalTimeoutMs: 30000 }, notes: 'Real version-two browser acceptance mappings must retain exact-source verification reuse.' };
  const delegate = fixtureAgent();
  const state = await runController({ repository, task, mergeTarget: 'main', evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'Frozen named Node and browser checks observe the complete ready-value behavior.' }, assumptions: [], slices: [{ id: 'ready', goal, acceptanceIds: ['ready', 'visible'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [browserCheck] };
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
  assert.deepEqual(fixture.state.plan?.browserChecks, [browserCheck]);
  assert.equal(fixture.state.integration?.verification?.status, 'passed');
  assert.equal(fixture.state.integration?.verification?.node?.passed, 1);
  assert.equal(fixture.state.integration?.verification?.browser?.passed, 2);
  assert.equal(fixture.state.integration?.review?.approved, true);
  assert.ok(fixture.state.reviewReceipts?.some(item => item.purpose === 'integrated-code-and-whole-goal' && item.approved));
  assert.equal(existsSync(fixture.certificatePath), true, `Real approved version-two browser evidence must acquire its owner certificate: ${fixture.state.runDirectory}`);
  const reused = reusableRequirementVerification(fixture.input);
  assert.ok(reused, 'The unchanged mapped browser evidence must be eligible before reuse or tamper checks.');
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

test('version-two browser acceptance mappings preserve integrated certificates and original whole-goal evidence', { timeout: 30000 }, async () => {
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

test('version-two browser certificate reuse rejects changed acceptance mappings required cases and actual reports', { timeout: 30000 }, async () => {
  const fixture = await mergedFixture();
  try {
    const reused = approvedEvidence(fixture);
    const planPath = join(fixture.state.runDirectory, 'plan.json');
    const statePath = join(fixture.state.runDirectory, 'state.json');
    withRestoredFiles([planPath, statePath], () => {
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as ControllerState;
      state.plan!.browserChecks[0].acceptanceIds = ['ready'];
      writeFileSync(planPath, JSON.stringify(state.plan));
      writeFileSync(statePath, JSON.stringify(state));
    }, () => {
      assert.equal(reusableRequirementVerification(fixture.input), undefined, 'Even a valid mutually consistent changed mapping needs a fresh source-bound plan approval.');
    });
    const certificate = JSON.parse(readFileSync(fixture.certificatePath, 'utf8')) as { verification: { contractPath: string; browserPath: string } };
    const contractPath = join(fixture.state.runDirectory, certificate.verification.contractPath);
    withRestoredFiles([contractPath], () => {
      const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as { requiredBrowserTests: { file: string; title: string }[] };
      const check = contract.requiredBrowserTests.find(item => item.file === browserCheck.file);
      assert.ok(check, 'The effective owner contract must include the planned browser case.');
      check.title = 'an unexecuted replacement browser case';
      writeFileSync(contractPath, JSON.stringify(contract));
    }, () => {
      assert.equal(reusableRequirementVerification(fixture.input), undefined, 'A substituted required case cannot reuse reports for the original case.');
    });
    const browserPath = join(fixture.state.runDirectory, certificate.verification.browserPath);
    withRestoredFiles([browserPath], () => {
      const report = JSON.parse(readFileSync(browserPath, 'utf8'));
      type Suite = { specs?: { title: string }[]; suites?: Suite[] };
      let changed = 0;
      const replace = (suites: Suite[]) => {
        for (const suite of suites) {
          for (const spec of suite.specs ?? []) if (spec.title === browserCheck.title) { spec.title = 'a different passing browser case'; changed += 1; }
          replace(suite.suites ?? []);
        }
      };
      replace(report.suites);
      assert.equal(changed, 1, 'Tamper probes must replace the real executed planned case while retaining valid JSON and passing totals.');
      writeFileSync(browserPath, JSON.stringify(report));
    }, () => {
      assert.equal(reusableRequirementVerification(fixture.input), undefined, 'Passing totals cannot replace the required actual browser evidence from the original certificate.');
    });
    assert.deepEqual(reusableRequirementVerification(fixture.input)?.verification, reused.verification, 'Only the exact restored approved evidence regains eligibility.');
  } finally { cleanup(fixture); }
});
