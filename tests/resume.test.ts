import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { runController } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { git } from '../factory/workspace.ts';

const task = () => parseTask({ schemaVersion: 1, id: 'resume', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 1000, totalTimeoutMs: 30000 }, notes: '' });

test('a new run restores an accepted draft including new files and reruns verification', async () => {
  const root = evidenceDirectory('resume-draft');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') {
      writeFileSync(join(input.cwd, 'src/saved.ts'), "export const saved = 'retained';\n");
      throw new Error('Injected interruption after partial implementation.');
    }
    return await delegate.run(input);
  } } });
  assert.equal(first.status, 'blocked');
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  const phases: string[] = [];
  const second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, budgetKey: 'shared', agent: { run: async input => {
    phases.push(input.phase);
    if (input.phase === 'repair') assert.match(readFileSync(join(input.cwd, 'src/saved.ts'), 'utf8'), /retained/);
    return await delegate.run(input);
  } } });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.ok(!phases.includes('plan') && !phases.includes('tests') && !phases.includes('acceptance-review'));
    assert.ok(phases.includes('repair') && phases.includes('review'));
    assert.equal(second.resume?.fromRunId, first.runId);
    assert.equal(second.verification?.status, 'passed');
    assert.match(readFileSync(join(second.runDirectory, 'patch.diff'), 'utf8'), /src\/saved.ts/);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});

test('changed criteria and corrupted checkpoints cannot reuse prior approvals', async () => {
  const root = evidenceDirectory('resume-identity');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Stop with accepted tests.');
    return await delegate.run(input);
  } } });
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  writeFileSync(join(first.runDirectory, 'checkpoint.patch'), 'corrupted');
  let planned = false;
  const changed = task(); changed.acceptance[0].description = 'A revised acceptance criterion.';
  const second = await runController({ repository, task: changed, evidenceRoot: root, budgetKey: 'revised-contract', resumeFrom: first.runDirectory, agent: { run: async input => {
    if (input.phase === 'plan') planned = true;
    return await delegate.run(input);
  } } });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(planned, true);
    assert.equal(second.resume?.reused, false);
    assert.match(second.resume?.reason ?? '', /identity|hash|criteria/i);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});

test('retry runs share a durable implementation-attempt budget', async () => {
  const root = evidenceDirectory('resume-budget');
  const repository = fixtureRepository(join(root, 'repo'));
  const spec = task(); spec.budget.maxAttempts = 1;
  const delegate = fixtureAgent();
  let implementations = 0;
  const agent = { run: async (input: Parameters<typeof delegate.run>[0]) => {
    if (input.phase === 'implement' || input.phase === 'repair') { implementations += 1; throw new Error('Injected worker failure.'); }
    return await delegate.run(input);
  } };
  const first = await runController({ repository, task: spec, evidenceRoot: root, budgetKey: 'one-issue', agent });
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  const second = await runController({ repository, task: spec, evidenceRoot: root, budgetKey: 'one-issue', resumeFrom: first.runDirectory, agent });
  assert.equal(second.status, 'blocked');
  assert.match(second.reason ?? '', /budget.*exhausted/i);
  assert.equal(implementations, 1);
  if (second.baseCommit) git(repository, ['worktree', 'remove', '--force', second.workspace]);
});

test('integration review rejection repairs within the same frozen-check budget', async () => {
  const root = evidenceDirectory('integration-repair');
  const repository = fixtureRepository(join(root, 'repo'));
  const before = git(repository, ['rev-parse', 'main']).trim();
  const delegate = fixtureAgent();
  let integrationReviews = 0;
  let repaired = false;
  const state = await runController({ repository, task: task(), evidenceRoot: root, mergeTarget: 'main', agent: { run: async input => {
    if (input.phase === 'review' && input.feedback.includes('integratedCandidate')) {
      integrationReviews += 1;
      assert.equal(git(repository, ['rev-parse', 'main']).trim(), before);
      if (integrationReviews === 1) return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'One additional case is needed.', findings: ['Record the repaired implementation detail.'] };
    }
    if (input.phase === 'repair') {
      assert.match(input.feedback, /Record the repaired implementation detail/);
      repaired = true;
      writeFileSync(join(input.cwd, 'src/repair.ts'), "export const repair = 'reviewed';\n");
    }
    return await delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'merged', state.reason ?? 'No failure reason');
    assert.equal(repaired, true);
    assert.equal(integrationReviews, 2);
    assert.equal(state.attempts.length, 2);
    assert.match(readFileSync(join(repository, 'src/repair.ts'), 'utf8'), /reviewed/);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

test('same-contract patch tampering invalidates reuse and runs fresh acceptance review', async () => {
  const root = evidenceDirectory('resume-tamper');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Stop with accepted checks.');
    return await delegate.run(input);
  } } });
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  writeFileSync(join(first.runDirectory, 'checkpoint.patch'), 'corrupted patch');
  let reviews = 0;
  const second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: { run: async input => {
    if (input.phase === 'acceptance-review') reviews += 1;
    return await delegate.run(input);
  } } });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, false);
    assert.match(second.resume?.reason ?? '', /patch hash/);
    assert.equal(reviews, 1);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});

test('quiescent interrupted implementation is captured before workspace cleanup', async () => {
  const { captureInterruptedDraft } = await import('../factory/checkpoint.ts');
  const root = evidenceDirectory('interrupted-draft');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Stop before implementation.');
    return await delegate.run(input);
  } } });
  writeFileSync(join(first.workspace, 'src/interrupted.ts'), "export const retained = true;\n");
  captureInterruptedDraft(first.runDirectory);
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  const second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: delegate });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, true);
    assert.match(readFileSync(join(second.workspace, 'src/interrupted.ts'), 'utf8'), /retained/);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});

test('changed repository controls invalidate checkpoint approvals', async () => {
  const root = evidenceDirectory('changed-controls');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Stop before implementation.');
    return await delegate.run(input);
  } } });
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  writeFileSync(join(repository, 'AGENTS.md'), 'Revised owner instructions.\n');
  const second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: delegate });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, false);
    assert.match(second.resume?.reason ?? '', /environment identity/);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});

test('accepted draft restoration preserves tracked deletions alongside added source', async () => {
  const root = evidenceDirectory('resume-deletion');
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'src/obsolete.ts'), "export const obsolete = true;\n");
  git(repository, ['add', 'src/obsolete.ts']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Add obsolete fixture source']);
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') {
      rmSync(join(input.cwd, 'src/obsolete.ts'));
      writeFileSync(join(input.cwd, 'src/replacement.ts'), "export const replacement = true;\n");
      throw new Error('Interrupted source replacement.');
    }
    return await delegate.run(input);
  } } });
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  const second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: delegate });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, true);
    assert.equal(existsSync(join(second.workspace, 'src/obsolete.ts')), false);
    assert.equal(existsSync(join(second.workspace, 'src/replacement.ts')), true);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});

test('damaged acceptance receipt metadata cannot be reused against intact proof bytes', async () => {
  const root = evidenceDirectory('receipt-metadata');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Stop with an acceptance receipt.');
    return await delegate.run(input);
  } } });
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  const path = join(first.runDirectory, 'checkpoint.json');
  const checkpoint = JSON.parse(readFileSync(path, 'utf8'));
  checkpoint.acceptanceReceipt.sourceHash = 'damaged metadata';
  writeFileSync(path, JSON.stringify(checkpoint));
  const second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: delegate });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, false);
    assert.match(second.resume?.reason ?? '', /receipt metadata/);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});

test('a changed plan cannot inherit approval for different defaults or check mapping', async () => {
  const root = evidenceDirectory('plan-identity');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const first = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'implement') throw new Error('Stop with an approved plan.');
    return await delegate.run(input);
  } } });
  git(repository, ['worktree', 'remove', '--force', first.workspace]);
  const path = join(first.runDirectory, 'checkpoint.json');
  const checkpoint = JSON.parse(readFileSync(path, 'utf8'));
  checkpoint.plan.assumptions[0].decision = 'Silently alter the approved default.';
  writeFileSync(path, JSON.stringify(checkpoint));
  const second = await runController({ repository, task: task(), evidenceRoot: root, resumeFrom: first.runDirectory, agent: delegate });
  try {
    assert.equal(second.status, 'ready', second.reason ?? 'No failure reason');
    assert.equal(second.resume?.reused, false);
    assert.match(second.resume?.reason ?? '', /plan identity/);
  } finally { git(repository, ['worktree', 'remove', '--force', second.workspace]); }
});
