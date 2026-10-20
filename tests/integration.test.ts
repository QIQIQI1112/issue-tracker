import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { runController } from '../factory/controller.ts';
import { git } from '../factory/workspace.ts';
import type { Delivery } from '../src/workflow.ts';
import { recoverMerge } from '../factory/recovery.ts';

const task = { schemaVersion: 1, id: 'auto-merge', title: 'Return ready', goal: 'The value is ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 30000 }, notes: 'Disposable auto-integration fixture.' };

for (const mode of ['merge', 'advanced-target', 'integration-rejected', 'dirty', 'review-mutates'] as const) {
  test(`automatic integration handles ${mode} with verified evidence`, { timeout: 30000 }, async () => {
    const root = evidenceDirectory(`integration-${mode}`);
    const repository = fixtureRepository(join(root, 'repo'));
    const original = git(repository, ['rev-parse', 'HEAD']).trim();
    const delegate = fixtureAgent();
    let advanced = false;
    if (mode === 'dirty') writeFileSync(join(repository, 'local.txt'), 'Preserve user work.');
    const state = await runController({ repository, task, mergeTarget: 'main', baseRef: 'main', agent: { run: async input => {
      if (input.phase === 'review' && mode === 'advanced-target' && !advanced) {
        writeFileSync(join(repository, 'src/unrelated.ts'), "export const unrelated = 'preserved';\n");
        git(repository, ['add', '.']);
        git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Concurrent target change']);
        advanced = true;
      }
      if (input.cwd.endsWith('integration-workspace') && input.phase === 'review') {
        if (mode === 'review-mutates') writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'tampered';\n");
        if (mode === 'integration-rejected') return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'Integrated candidate rejected.', findings: ['Blocking integrated review.'] };
      }
      return delegate.run(input);
    } } });
    const delivery = JSON.parse(readFileSync(join(state.runDirectory, 'delivery.json'), 'utf8')) as Delivery;
    assert.equal(delivery.status, state.status);
    if (mode === 'merge' || mode === 'advanced-target') {
      assert.equal(state.status, 'merged', state.reason ?? 'Expected a verified merge.');
      assert.equal(delivery.nodePassed, 1);
      assert.equal(delivery.browserPassed, 1);
      assert.equal(delivery.integration?.commit, git(repository, ['rev-parse', 'HEAD']).trim());
      assert.equal(readFileSync(join(repository, 'src/value.ts'), 'utf8'), "export const value = 'ready';\n");
      assert.ok(delivery.evidence.some(item => item.path.endsWith('summary.json')));
      assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'integration-owner.json'), 'utf8')).pid, process.pid);
      assert.ok(!existsSync(join(repository, '.git/loop-integration.lock')));
      const workerSummary = delivery.workerObservations === undefined
        ? delivery.summary
        : delivery.workerObservations.find(observation => observation.attempt === 1)?.summary;
      assert.match(workerSummary!, /Prepared the fixture candidate/);
      assert.equal(workerSummary, JSON.parse(readFileSync(join(state.runDirectory, 'worker-1.json'), 'utf8')).summary);
      if (mode === 'advanced-target') assert.ok(existsSync(join(repository, 'src/unrelated.ts')));
      if (mode === 'merge') {
        assert.equal(recoverMerge(repository, state.runDirectory), true);
        const receipt = JSON.parse(readFileSync(join(state.runDirectory, 'state.json'), 'utf8'));
        receipt.integration.review.approved = false;
        writeFileSync(join(state.runDirectory, 'state.json'), JSON.stringify(receipt));
        assert.equal(recoverMerge(repository, state.runDirectory), false);
      }
    } else {
      assert.equal(state.status, 'blocked');
      assert.equal(git(repository, ['rev-parse', 'HEAD']).trim(), original);
      assert.equal(readFileSync(join(repository, 'src/value.ts'), 'utf8'), "export const value = 'broken';\n");
    }
    if (existsSync(join(state.workspace, '.git'))) git(repository, ['worktree', 'remove', '--force', state.workspace]);
  });
}
