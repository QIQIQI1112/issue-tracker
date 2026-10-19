import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runController } from '../factory/controller.ts';
import { captureInterruptedDraft, saveCheckpoint, digest } from '../factory/checkpoint.ts';
import { parseTask } from '../factory/contracts.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { snapshot } from '../factory/evidence.ts';
import { git } from '../factory/workspace.ts';

const task = () => parseTask({ schemaVersion: 1, id: 'test-inventory', title: 'Ready value', goal: 'Return ready with an approved and frozen test inventory.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 3000, totalTimeoutMs: 90000 }, notes: '' });
const worker = (taskId: string) => ({ schemaVersion: 1, taskId, summary: 'Prepared the fixture candidate.', blockers: [] });

for (const phase of ['implement', 'repair']) for (const file of ['tests/late.test.ts', 'acceptance/late.spec.ts']) test(`${phase} cannot add an unapproved ${file} after coverage approval`, async () => {
  const root = evidenceDirectory('inventory-phase');
  const repository = fixtureRepository(join(root, 'repo'));
  const before = git(repository, ['rev-parse', 'main']).trim();
  const delegate = fixtureAgent();
  let injected = false;
  const state = await runController({ repository, task: task(), evidenceRoot: root, mergeTarget: 'main', agent: { run: async input => {
    if (input.phase === 'implement' && phase === 'repair') return worker(input.task.id);
    if (input.phase === phase) {
      const source = file.startsWith('tests/')
        ? "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\ntest('unapproved late case',()=>assert.equal(1,1));\n"
        : `import {test,expect} from ${JSON.stringify(join(repository, 'node_modules/@playwright/test/index.mjs'))};\ntest('unapproved late case',()=>expect(1).toBe(1));\n`;
      writeFileSync(join(input.cwd, file), source);
      injected = true;
    }
    return delegate.run(input);
  } } });
  try {
    assert.equal(injected, true);
    assert.equal(state.status, 'blocked', 'An unapproved test file must not reach merge.');
    assert.equal(state.failureKind, 'integrity');
    assert.match(state.reason ?? '', /Protected test inventory/);
    assert.equal(git(repository, ['rev-parse', 'main']).trim(), before);
    const checkpoint = JSON.parse(readFileSync(join(state.runDirectory, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.acceptedChecks.some((check: { path: string }) => check.path === file), false);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

for (const operation of ['checkpoint', 'interrupted-capture']) test(`${operation} cannot promote new test helpers and preserves the last approved checkpoint`, async () => {
  const root = evidenceDirectory('inventory-recovery');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const spec = task();
  const state = await runController({ repository, task: spec, evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Stop after accepting the original inventory.');
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'blocked');
    const checkpointPath = join(state.runDirectory, 'checkpoint.json');
    const patchPath = join(state.runDirectory, 'checkpoint.patch');
    const originalManifest = readFileSync(checkpointPath, 'utf8');
    const originalPatch = readFileSync(patchPath);
    const checkpoint = JSON.parse(originalManifest);
    assert.equal(checkpoint.accepted, true);
    for (const file of ['tests/late-helper.ts', 'acceptance/late-helper.ts']) {
      writeFileSync(join(state.workspace, file), "export const unapproved = true;\n");
      const capture = () => operation === 'checkpoint' ? saveCheckpoint(state, spec, checkpoint.environment, true) : captureInterruptedDraft(state.runDirectory);
      assert.throws(capture, /Protected test inventory/);
      assert.equal(readFileSync(checkpointPath, 'utf8'), originalManifest);
      assert.deepEqual(readFileSync(patchPath), originalPatch);
      assert.equal(existsSync(join(state.runDirectory, 'recovered-draft.json')), false);
      rmSync(join(state.workspace, file));
    }
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

test('reviewed initial Node and browser additions remain frozen and survive checkpoint retry', async () => {
  const root = evidenceDirectory('inventory-approved');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  let coverageReviewed = false;
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') {
      const plan = await delegate.run(input) as { slices: { checks: { file: string; title: string }[] }[]; browserChecks: { file: string; title: string }[] };
      plan.slices[0].checks.push({ file: 'tests/approved.test.ts', title: 'approved value is ready' });
      plan.browserChecks.push({ file: 'approved.spec.ts', title: 'approved readiness is observable' });
      return plan;
    }
    if (input.phase === 'tests') {
      writeFileSync(join(input.cwd, 'tests/approved.test.ts'), "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.ts';\ntest('approved value is ready',()=>assert.equal(value,'ready'));\n");
      writeFileSync(join(input.cwd, 'acceptance/approved.spec.ts'), `import {test,expect} from ${JSON.stringify(join(repository, 'node_modules/@playwright/test/index.mjs'))};\nimport {value} from '../src/value.ts';\ntest('approved readiness is observable',()=>expect(value).toBe('ready'));\n`);
    }
    if (input.phase === 'acceptance-review') {
      const feedback = JSON.parse(input.feedback);
      assert.equal(feedback.redChecks.length, 2);
      assert.ok(feedback.redChecks.every((check: { status: string }) => check.status === 'expected_failure'));
      coverageReviewed = true;
    }
    if (input.phase === 'implement') {
      assert.equal(coverageReviewed, true);
      throw new Error('Interrupt after legitimate additions were reviewed and frozen.');
    }
    return delegate.run(input);
  } } });
  let second: Awaited<ReturnType<typeof runController>> | undefined;
  try {
    assert.equal(first.status, 'blocked');
    const hashes = JSON.parse(readFileSync(join(first.runDirectory, 'checkpoint.json'), 'utf8')).acceptedChecks;
    for (const file of ['tests/approved.test.ts', 'acceptance/approved.spec.ts']) assert.ok(hashes.some((check: { path: string }) => check.path === file));
    second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: { run: async input => {
      assert.ok(!['plan', 'tests', 'acceptance-review'].includes(input.phase), 'A valid retry must reuse approved coverage.');
      return delegate.run(input);
    } } });
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, true);
    assert.equal(second.verification?.node?.passed, 2);
    assert.equal(second.verification?.browser?.passed, 2);
    assert.equal(second.budget?.acceptanceAttempts, 1);
    assert.equal(second.budget?.implementationAttempts, 2);
  } finally {
    git(repository, ['worktree', 'remove', '--force', first.workspace]);
    if (second?.baseCommit) git(repository, ['worktree', 'remove', '--force', second.workspace]);
  }
});


test('retry rejects a previously promoted test inventory before executing its unreviewed helper', async () => {
  const root = evidenceDirectory('inventory-promoted');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Retain a valid approval before the old capture bug.');
    return delegate.run(input);
  } } });
  let second: Awaited<ReturnType<typeof runController>> | undefined;
  const checkpointPath = join(first.runDirectory, 'checkpoint.json');
  const patchPath = join(first.runDirectory, 'checkpoint.patch');
  const inventoryPath = join(first.runDirectory, 'accepted-checks.json');
  const originalManifest = readFileSync(checkpointPath, 'utf8');
  const originalPatch = readFileSync(patchPath);
  const originalInventory = readFileSync(inventoryPath, 'utf8');
  try {
    const checkpoint = JSON.parse(originalManifest);
    const helper = 'tests/promoted-helper.ts';
    writeFileSync(join(first.workspace, helper), "export const unreviewed = true;\n");
    git(first.workspace, ['add', '-N', '--', helper]);
    const patch = git(first.workspace, ['diff', '--binary', checkpoint.baselineTree, '--']);
    const source = snapshot(first.workspace);
    checkpoint.sourceHash = source.hash;
    checkpoint.patchHash = digest(patch);
    checkpoint.acceptedChecks = source.files.filter(file => /^(tests|acceptance)\//.test(file.path));
    writeFileSync(patchPath, patch);
    writeFileSync(checkpointPath, JSON.stringify(checkpoint));
    assert.equal(readFileSync(inventoryPath, 'utf8'), originalInventory);
    second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: { run: async input => {
      if (input.phase === 'implement' || input.phase === 'repair') assert.equal(existsSync(join(input.cwd, helper)), false, 'An unreviewed helper must not enter resumed execution.');
      return delegate.run(input);
    } } });
    assert.equal(second.resume?.reused, false);
    assert.match(second.resume?.reason ?? '', /Protected test inventory/);
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(readFileSync(inventoryPath, 'utf8'), originalInventory);
  } finally {
    writeFileSync(checkpointPath, originalManifest);
    writeFileSync(patchPath, originalPatch);
    git(repository, ['worktree', 'remove', '--force', first.workspace]);
    if (second?.baseCommit) git(repository, ['worktree', 'remove', '--force', second.workspace]);
  }
});
