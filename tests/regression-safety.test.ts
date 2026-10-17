import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { runController } from '../factory/controller.ts';
import type { Agent } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { loadCheckpoint, environmentIdentity } from '../factory/checkpoint.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

const task = () => parseTask({ schemaVersion: 1, id: 'regression-safety', title: 'Ready suffix', goal: 'Return ready with suffix.', acceptance: [{ id: 'ready', description: 'Ready includes the required suffix.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 3000, totalTimeoutMs: 90000 }, notes: '' });
function scenario(mode: string) {
  const root = evidenceDirectory('regression-safety');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const environment = environmentIdentity(repository, process.cwd());
  let reviews = 0;
  let interrupted = false;
  let regressions = 0;
  let repairs = 0;
  let approved = false;
  const agent: Agent = { run: async input => {
    if (input.phase === 'review' && reviews++ === 0) return { schemaVersion: 1, taskId: input.task.id, approved: false, needsRegression: mode !== 'ordinary', summary: 'Missing suffix.', findings: ['The suffix must be !.'] };
    if (input.phase === 'implement') {
      writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'ready';\nexport const suffix = '';\n");
      return { schemaVersion: 1, taskId: input.task.id, summary: 'Candidate.', blockers: [] };
    }
    if (input.phase === 'regression-tests') {
      regressions++;
      if (mode === 'pending-resume' && !interrupted) { interrupted = true; throw new Error('Interrupted before regression generation.'); }
      if (mode === 'product-edit') appendFileSync(join(input.cwd, 'src/value.ts'), "export const extra = true;\n");
      if (mode === 'old-test-edit') appendFileSync(join(input.cwd, 'tests/value.test.ts'), "test('extra',()=>assert.ok(true));\n");
      writeFileSync(join(input.cwd, 'tests/suffix.test.ts'), mode === 'import-error' ? "import './missing.ts';\n" : `import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value,suffix} from '../src/value.ts';\ntest('regression suffix',()=>assert.equal(${mode === 'already-green' ? "value,'ready'" : "suffix,'!'"}));\n`);
      return { schemaVersion: 1, taskId: input.task.id, summary: 'New suffix check.', blockers: [], checks: [{ file: 'tests/suffix.test.ts', title: 'regression suffix' }], browserChecks: [] };
    }
    if (input.phase === 'acceptance-review' && JSON.parse(input.feedback).purpose === 'regression-coverage') {
      approved = mode !== 'review-reject';
      return { schemaVersion: 1, taskId: input.task.id, approved, summary: approved ? 'Valid regression.' : 'Insufficient assertions.', findings: approved ? [] : ['Add the missing boundary assertion.'] };
    }
    if (input.phase === 'repair') {
      repairs++;
      if (mode !== 'ordinary') assert.equal(approved, true);
      if (mode === 'accepted-resume' && !interrupted) { interrupted = true; throw new Error('Interrupted after regression approval.'); }
      if (mode === 'frozen-edit') writeFileSync(join(input.cwd, 'tests/suffix.test.ts'), "import {test} from 'node:test';test('regression suffix',()=>{});\n");
      writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'ready';\nexport const suffix = '!';\n");
      return { schemaVersion: 1, taskId: input.task.id, summary: 'Repaired.', blockers: [] };
    }
    return delegate.run(input);
  } };
  const run = (resumeFrom?: string) => runController({ repository, task: task(), evidenceRoot: root, mergeTarget: 'main', agent, resumeFrom });
  const cleanup = (workspace: string) => git(repository, ['worktree', 'remove', '--force', workspace]);
  return { root, repository, environment, run, cleanup, counts: () => ({ regressions, repairs }) };
}

for (const mode of ['product-edit', 'old-test-edit', 'already-green', 'import-error', 'review-reject', 'frozen-edit']) test(`regression admission blocks ${mode} without merging`, async () => {
  const fixture = scenario(mode);
  const before = git(fixture.repository, ['rev-parse', 'main']).trim();
  const state = await fixture.run();
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(git(fixture.repository, ['rev-parse', 'main']).trim(), before);
    assert.match(state.reason ?? '', mode === 'product-edit' ? /existing file/ : mode === 'old-test-edit' || mode === 'frozen-edit' ? /Protected contract/ : mode === 'review-reject' ? /acceptance attempt budget exhausted/ : /named behavior assertion/);
    if (mode !== 'frozen-edit') assert.equal(fixture.counts().repairs, 0);
  } finally { fixture.cleanup(state.workspace); }
});

test('existing coverage uses ordinary repair without another tests phase', async () => {
  const fixture = scenario('ordinary');
  const state = await fixture.run();
  try { assert.equal(state.status, 'merged', state.reason ?? 'No failure reason'); assert.equal(fixture.counts().regressions, 0); }
  finally { fixture.cleanup(state.workspace); }
});

for (const mode of ['pending-resume', 'accepted-resume']) test(`retry preserves ${mode} and cumulative budget without bypassing approval`, async () => {
  const fixture = scenario(mode);
  const first = await fixture.run();
  assert.equal(first.status, 'blocked');
  if (mode === 'pending-resume') {
    const path = join(first.runDirectory, 'checkpoint.json');
    const original = readFileSync(path, 'utf8');
    const damaged = JSON.parse(original);
    delete damaged.pendingRegression;
    writeFileSync(path, JSON.stringify(damaged));
    try { assert.throws(() => loadCheckpoint(first.runDirectory, fixture.root, task(), fixture.environment), /orphan regression/i); }
    finally { writeFileSync(path, original); }
  }
  const generated = fixture.counts().regressions;
  const second = await fixture.run(first.runDirectory);
  try {
    assert.equal(second.status, 'merged', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, true);
    assert.equal(fixture.counts().regressions, mode === 'accepted-resume' ? generated : generated + 1);
    assert.equal(second.budget?.acceptanceAttempts, 3 - Number(mode === 'accepted-resume'));
    assert.equal(second.budget?.implementationAttempts, mode === 'accepted-resume' ? 3 : 2);
    const checkpoint = JSON.parse(readFileSync(join(second.runDirectory, 'checkpoint.json'), 'utf8'));
    const manifestPath = join(second.runDirectory, 'checkpoint.json');
    const manifest = readFileSync(manifestPath, 'utf8');
    const damaged = { ...checkpoint };
    delete damaged.regressions;
    writeFileSync(manifestPath, JSON.stringify(damaged));
    try { assert.throws(() => loadCheckpoint(second.runDirectory, fixture.root, task(), fixture.environment), /orphan regression/i); }
    finally { writeFileSync(manifestPath, manifest); }
    const proof = checkpoint.proofs.find((proof: { path: string }) => proof.path.startsWith('regression-red-') && proof.path.endsWith('.jsonl'));
    appendFileSync(join(second.runDirectory, proof.path), '\n');
    assert.throws(() => loadCheckpoint(second.runDirectory, fixture.root, task(), fixture.environment), /proof hash mismatch/);
  } finally { fixture.cleanup(first.workspace); fixture.cleanup(second.workspace); }
});
