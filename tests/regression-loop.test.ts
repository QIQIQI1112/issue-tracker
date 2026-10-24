import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runController } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

const task = () => parseTask({ schemaVersion: 1, id: 'regression-loop', title: 'Ready value', goal: 'Return ready, including the previously overlooked suffix.', acceptance: [{ id: 'ready', description: 'The value is ready with the expected suffix.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 3000, totalTimeoutMs: 90000 }, notes: '' });

for (const merge of [false, true]) test(`review regression tests are red, independently accepted and frozen before repair (${merge ? 'integrated' : 'delivery'})`, async () => {
  const root = evidenceDirectory('regression-loop');
  const repository = fixtureRepository(join(root, 'repo'));
  const original = readFileSync(join(repository, 'tests/value.test.ts'), 'utf8');
  const delegate = fixtureAgent();
  const phases: string[] = [];
  let reviews = 0;
  let regressionApproved = false;
  const state = await runController({ repository, task: task(), evidenceRoot: root, ...(merge ? { mergeTarget: 'main' } : {}), agent: { run: async input => {
    phases.push(input.phase);
    if (input.phase === 'review' && reviews++ === 0) return { schemaVersion: 1, taskId: input.task.id, approved: false, needsRegression: true, summary: 'Missing suffix coverage.', findings: ['The suffix is missing. Add deterministic coverage before repair.'] };
    if (input.phase === 'regression-tests') {
      assert.match(input.feedback, /suffix/);
      writeFileSync(join(input.cwd, 'tests/suffix.test.ts'), "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {suffix} from '../src/value.ts';\ntest('suffix survives delivery',()=>assert.equal(suffix,'!'));\n");
      return { schemaVersion: 1, taskId: input.task.id, summary: 'Added missing suffix coverage.', blockers: [], checks: [{ file: 'tests/suffix.test.ts', title: 'suffix survives delivery' }], browserChecks: [] };
    }
    if (input.phase === 'implement') {
      writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'ready';\nexport const suffix = '';\n");
      return { schemaVersion: 1, taskId: input.task.id, summary: 'Prepared candidate.', blockers: [] };
    }
    if (input.phase === 'acceptance-review' && JSON.parse(input.feedback).purpose === 'regression-coverage') {
      const context = JSON.parse(input.feedback);
      assert.equal(context.redChecks.length, 1);
      regressionApproved = true;
      assert.ok(context.redChecks.every((check: { status: string }) => check.status === 'expected_failure'));
      for (const proof of context.redChecks) assert.ok(readFileSync(proof.reportPath).length);
      assert.equal(readFileSync(join(input.cwd, 'src/value.ts'), 'utf8').includes("suffix = ''"), true);
    }
    if (input.phase === 'repair') {
      assert.equal(regressionApproved, true, 'Independent regression approval must precede repair.');
      assert.ok(phases.includes('regression-tests'), 'Repair must follow new independently reviewed regression tests.');
      writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'ready';\nexport const suffix = '!';\n");
      return { schemaVersion: 1, taskId: input.task.id, summary: 'Fixed suffix.', blockers: [] };
    }
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, merge ? 'merged' : 'ready', state.reason ?? 'No failure reason');
    assert.ok(phases.includes('regression-tests'), 'The rejected code review must enter the tests role.');
    assert.equal(readFileSync(join(state.workspace, 'tests/value.test.ts'), 'utf8'), original);
    assert.ok(state.reviewReceipts?.some(receipt => receipt.purpose === 'regression-coverage' && receipt.approved));
    assert.equal(state.verification?.node?.passed, 2);
    const checkpoint = JSON.parse(readFileSync(join(state.runDirectory, 'checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.regressions.length, 1);
    assert.ok(checkpoint.proofs.some((proof: { path: string }) => proof.path.includes('regression') && proof.path.endsWith('.json')));
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});
