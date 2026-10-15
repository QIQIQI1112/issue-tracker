import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runController } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { SerialQueue } from '../factory/queue.ts';
import { IssueStore } from '../src/storage.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

for (const mode of ['repair', 'exhausted', 'tamper'] as const) {
  test(`acceptance feedback ${mode} preserves the review gate and original checks`, { timeout: 30000 }, async () => {
    const repository = fixtureRepository(join(evidenceDirectory(`acceptance-${mode}`), 'repo'));
    const task = parseTask({ schemaVersion: 1, id: 'feedback', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 2, workerTimeoutMs: 1000, totalTimeoutMs: 25000 }, notes: 'Disposable feedback fixture.' });
    const original = readFileSync(join(repository, 'tests/value.test.ts'), 'utf8');
    const delegate = fixtureAgent();
    const feedback: string[] = [];
    let reviews = 0;
    let implemented = false;
    const state = await runController({ repository, task, agent: { run: async input => {
      if (input.phase === 'plan') {
        const plan = await delegate.run(input) as { slices: { checks: { file: string; title: string }[] }[] };
        plan.slices[0].checks.push({ file: 'tests/value.test.ts', title: 'reviewed extension' });
        return plan;
      }
      if (input.phase === 'tests') {
        feedback.push(input.feedback);
        writeFileSync(join(input.cwd, 'tests/value.test.ts'), mode === 'tamper' && feedback.length > 1 ? "import {test} from 'node:test'; test('value is ready',()=>{});\n" : `${original}test('reviewed extension',()=>assert.equal(${feedback.length === 1 ? 'true,true' : "value,'ready'"}));\n`);
        return { schemaVersion: 1, taskId: task.id, summary: 'Prepared scoped checks.', blockers: [] };
      }
      if (input.phase === 'acceptance-review') {
        reviews += 1;
        const approved = mode !== 'exhausted' && reviews > 1;
        return { schemaVersion: 1, taskId: task.id, approved, summary: approved ? 'Behavior assertion is now meaningful.' : 'The new assertion is vacuous.', findings: approved ? [] : ['Assert the returned value instead of a constant.'] };
      }
      if (input.phase === 'implement') implemented = true;
      return await delegate.run(input);
    } } });
    try {
      assert.equal(feedback.length, 2, 'Rejected new checks must receive one bounded repair attempt.');
      assert.match(feedback[1], /Assert the returned value instead of a constant/);
      if (mode === 'repair') {
        assert.equal(state.status, 'ready', state.reason ?? 'No blocker recorded.');
        assert.equal(reviews, 2);
        assert.equal(implemented, true);
        assert.equal(state.redChecks.length, 2);
        assert.ok(state.redChecks.every(check => check.status === 'expected_failure'));
        assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'acceptance-review-1.json'), 'utf8')).approved, false);
        assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'acceptance-review-2.json'), 'utf8')).approved, true);
        assert.ok(readFileSync(join(state.workspace, 'tests/value.test.ts'), 'utf8').startsWith(original));
      } else {
        assert.equal(state.status, 'blocked');
        assert.equal(implemented, false);
        assert.match(state.reason!, mode === 'tamper' ? /protected|contract/i : /acceptance review.*budget.*exhausted/i);
        assert.equal(reviews, mode === 'tamper' ? 1 : 2);
      }
      assert.equal(readFileSync(join(repository, 'tests/value.test.ts'), 'utf8'), original);
    } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
  });
}

test('queue retries carry the latest matching failure as diagnostic feedback', async () => {
  const root = evidenceDirectory('queue-feedback');
  const repository = fixtureRepository(join(root, 'repo'));
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Feedback repository', path: repository, targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Ready value', goal: 'Return ready.' });
    const issue = store.create({ title: 'Ready value', description: 'Return ready.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['The value is ready.'] } });
    store.work.startRequirement(requirement.id);
    const old = store.work.claim(join(root, 'evidence'))!;
    store.work.finish(old.run.id, 'blocked', 'Obsolete timeout.');
    store.work.startRequirement(requirement.id);
    const rejected = store.work.claim(join(root, 'evidence'))!;
    store.work.finish(rejected.run.id, 'blocked', 'Acceptance review: assert report state outside select options.');
    store.work.startRequirement(requirement.id);
    let notes = '';
    const delegate = fixtureAgent();
    const queue = new SerialQueue(store, { agent: { run: async input => {
      if (input.phase === 'plan') { notes = input.task.notes; return await delegate.run(input); }
      return { schemaVersion: 1, taskId: input.task.id, summary: 'Stop after inspecting retry context.', blockers: ['Disposable fixture stops before implementation.'] };
    } } });
    await queue.processNext();
    assert.match(notes, /assert report state outside select options/);
    assert.ok(notes.includes(rejected.run.id));
    assert.ok(!notes.includes('Obsolete timeout'));
    assert.match(notes, /diagnostic/i);
    assert.equal(store.get(issue.id)!.description, 'Return ready.');
  } finally { store.close(); }
});
