import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Issue } from '../src/domain.ts';
import type { Requirement, WorkRun } from '../src/workflow.ts';

type ReuseInput = { repository: string; cwd: string; branch: string; requirement: Requirement; children: Issue[]; runs: WorkRun[] };
type ReuseModule = { reusableRequirementVerification: (input: ReuseInput) => unknown; verificationInputIdentity?: (cwd: string) => string };

function ownedDependencies(repository: string) {
  const dependencies = join(repository, 'node_modules');
  rmSync(dependencies);
  mkdirSync(dependencies);
  for (const name of ['tsx', '@playwright']) symlinkSync(resolve('node_modules', name), join(dependencies, name), 'dir');
  const ownedPackage = join(dependencies, 'owned-ready');
  mkdirSync(ownedPackage);
  writeFileSync(join(ownedPackage, 'package.json'), JSON.stringify({ name: 'owned-ready', type: 'module', exports: './index.js' }));
  const ownedModule = join(ownedPackage, 'index.js');
  writeFileSync(ownedModule, "export const value = 'ready';\n");
  return { dependencies, ownedPackage, ownedModule };
}

async function fixture(changeDuringReview: boolean) {
  const reusePath = '../factory/verification-reuse.ts';
  const reuse = await import(reusePath).catch(() => null) as ReuseModule | null;
  assert.ok(reuse && typeof reuse.reusableRequirementVerification === 'function', 'Verification certificates must bind the inputs actually used by the full verifier.');
  const controller = await import('../factory/controller.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(controller && fixtures && subprocess && workspace);
  const root = subprocess.evidenceDirectory('verification-input-binding');
  const repository = fixtures.fixtureRepository(join(root, 'repo'));
  const { ownedModule } = ownedDependencies(repository);
  const before = workspace.git(repository, ['rev-parse', 'main']).trim();
  const goal = 'Return ready using the exact verified dependency input.';
  const task = { schemaVersion: 2, id: 'issue-3', title: 'Ready value', goal, wholeGoal: { requirementId: 7, goal }, acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 2000, totalTimeoutMs: 30000 }, notes: 'Owned disposable dependency package tests verification-time input identity; shared dependencies are never modified.' };
  const delegate = fixtures.fixtureAgent();
  let changed = false;
  const state = await controller.runController({ repository, task, evidenceRoot: root, mergeTarget: 'main', agent: { run: async input => {
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'reuse', reason: 'Existing named checks observe ready.' }, assumptions: [], slices: [{ id: 'ready', goal, acceptanceIds: ['ready'], checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    if (input.phase === 'review' && changeDuringReview) {
      const feedback = JSON.parse(input.feedback);
      assert.equal(feedback.integratedCandidate, true);
      assert.equal(feedback.verification.status, 'passed');
      writeFileSync(ownedModule, "export const value = 'broken';\n");
      changed = true;
    }
    const result = await delegate.run(input);
    if (input.phase === 'implement') writeFileSync(join(input.cwd, 'src/value.ts'), "export {value} from 'owned-ready';\n");
    return result;
  } } });
  const requirement: Requirement = { id: 7, repoId: 1, title: 'Original input-bound goal', goal, status: 'running', createdAt: state.startedAt, updatedAt: state.completedAt! };
  const child: Issue = { id: 3, title: task.title, description: goal, status: 'done', priority: 'medium', labels: [], createdAt: state.startedAt, updatedAt: state.completedAt!, work: { repoId: 1, requirementId: 7, acceptance: ['The value is ready.'], dependsOn: [] } };
  const run: WorkRun = { id: state.runId, jobId: 11, repoId: 1, requirementId: 7, issueId: 3, status: state.status === 'merged' ? 'merged' : 'blocked', evidencePath: state.runDirectory, reason: state.reason ?? null, startedAt: state.startedAt, completedAt: state.completedAt! };
  const input: ReuseInput = { repository, cwd: repository, branch: 'main', requirement, children: [child], runs: [run] };
  return { state, input, reuse, workspace, changed, before, ownedModule };
}

test('late owned dependency changes cannot acquire an eligible certificate for an earlier full verification', { timeout: 30000 }, async () => {
  const result = await fixture(true);
  try {
    assert.equal(result.changed, true, 'The owned dependency input must actually change after a real full verification.');
    assert.equal(result.state.integration?.verification?.status, 'passed');
    assert.equal(readFileSync(result.ownedModule, 'utf8'), "export const value = 'broken';\n", 'The reviewed dependency change must break the exact behavior previously verified.');
    assert.equal(result.reuse.reusableRequirementVerification(result.input), undefined, 'Fingerprinting inputs only during certificate capture must not sign a changed dependency environment as verified.');
    assert.equal(result.state.status, 'blocked', 'Changed unverified dependencies cannot advance the integration target.');
    assert.match(result.state.reason ?? '', /input|environment|dependenc|identity/i);
    assert.equal(result.workspace.git(result.input.repository, ['rev-parse', 'main']).trim(), result.before);
    assert.equal(existsSync(join(result.state.runDirectory, 'integrated-verification-certificate.json')), false);
  } finally { if (existsSync(join(result.state.workspace, '.git'))) result.workspace.git(result.input.repository, ['worktree', 'remove', '--force', result.state.workspace]); }
});

test('missing verification-time input stamp invalidates otherwise intact merged evidence', { timeout: 30000 }, async () => {
  const result = await fixture(false);
  try {
    assert.equal(result.state.status, 'merged', result.state.reason ?? 'The unchanged dependency fixture must integrate successfully.');
    assert.ok(result.reuse.reusableRequirementVerification(result.input), 'Missing-stamp rejection must start from eligible real evidence.');
    const stamp = join(result.state.integration!.verification!.runDirectory, 'verification-input.json');
    assert.equal(existsSync(stamp), true, 'The full verifier needs an input identity stamp at execution time.');
    rmSync(stamp);
    assert.equal(result.reuse.reusableRequirementVerification(result.input), undefined, 'Capture-time fingerprints cannot substitute for missing verification-time proof.');
  } finally { if (existsSync(join(result.state.workspace, '.git'))) result.workspace.git(result.input.repository, ['worktree', 'remove', '--force', result.state.workspace]); }
});

test('verification input identity ignores only root generated caches and still binds actual package contents', async () => {
  const reusePath = '../factory/verification-reuse.ts';
  const reuse = await import(reusePath).catch(() => null) as ReuseModule | null;
  assert.ok(reuse && typeof reuse.verificationInputIdentity === 'function', 'Verification input identity needs an explicit boundary between generated caches and actual dependencies.');
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  assert.ok(fixtures && subprocess);
  const root = subprocess.evidenceDirectory('verification-input-cache');
  const repository = fixtures.fixtureRepository(join(root, 'repo'));
  const { dependencies, ownedPackage, ownedModule } = ownedDependencies(repository);
  const before = reuse.verificationInputIdentity(repository);
  for (const name of ['.vite', '.vite-temp', '.cache']) {
    mkdirSync(join(dependencies, name));
    writeFileSync(join(dependencies, name, 'generated-data.json'), JSON.stringify({ generated: true, name }));
    assert.equal(reuse.verificationInputIdentity(repository), before, `A generated root ${name} cache must not invalidate otherwise identical inputs.`);
  }
  writeFileSync(ownedModule, "export const value = 'changed package contents';\n");
  const changed = reuse.verificationInputIdentity(repository);
  assert.notEqual(changed, before, 'Actual dependency package bytes must remain bound.');
  mkdirSync(join(ownedPackage, '.cache'));
  writeFileSync(join(ownedPackage, '.cache', 'package-data.json'), '{"packageOwned":true}\n');
  assert.notEqual(reuse.verificationInputIdentity(repository), changed, 'Only root generated cache folders are excluded; package-owned paths remain verified inputs.');
});
