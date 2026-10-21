import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceDirectory } from './helpers/subprocess.ts';
import type { IssueStore } from '../src/storage.ts';
import type { SerialQueue } from '../factory/queue.ts';

test('serial queue follows owner policy and blocks malformed policy before invoking a worker', { timeout: 30000 }, async () => {
  const policyPath = '../factory/optimization.ts';
  const policy = await import(policyPath).catch(() => null) as { executionPolicy?: unknown } | null;
  assert.ok(policy && typeof policy.executionPolicy === 'function', 'Persistent queue routing requires the controller-owned execution policy.');
  const queueModule = await import('../factory/queue.ts').catch(() => null);
  const storage = await import('../src/storage.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(queueModule && storage && fixtures && workspace, 'Owner policy must route the existing persistent serial queue.');
  for (const mode of ['absent', 'legacy-v1', 'adaptive-v2', 'malformed']) {
    const root = evidenceDirectory('policy-queue');
    const repository: string = fixtures.fixtureRepository(join(root, 'repo'));
    if (mode !== 'absent') {
      writeFileSync(join(repository, 'factory/execution-policy.json'), mode === 'malformed' ? '{' : JSON.stringify({ schemaVersion: 1, mode }));
      workspace.git(repository, ['add', 'factory/execution-policy.json']);
      workspace.git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Owner execution policy']);
    }
    const store: IssueStore = new storage.IssueStore(join(root, 'state.sqlite'));
    let observed: number | undefined;
    try {
      const repo = store.work.addRepo({ name: 'Policy fixture', path: repository, targetBranch: 'main' });
      const issue = store.create({ title: 'Ready value', description: 'Return ready.', labels: [], status: 'open', priority: 'medium', work: { repoId: repo.id, requirementId: null, acceptance: ['The value is ready.'], dependsOn: [] } });
      store.work.startIssue(issue.id);
      const queue: SerialQueue = new queueModule.SerialQueue(store, { evidenceRoot: join(root, 'evidence'), agent: { run: async input => { observed = input.task.schemaVersion; throw new Error('Stop after observing the selected task profile.'); } } });
      assert.equal(await queue.processNext(), true);
      assert.equal(observed, mode === 'malformed' ? undefined : mode === 'adaptive-v2' ? 2 : 1, `Incorrect routing for owner policy ${mode}.`);
      assert.equal(store.work.runs()[0].status, 'blocked');
      if (mode === 'malformed') assert.match(store.work.runs()[0].reason ?? '', /policy|JSON|Unexpected/i);
      assert.equal(readFileSync(join(repository, 'src/value.ts'), 'utf8'), "export const value = 'broken';\n");
    } finally { store.close(); }
  }
});

