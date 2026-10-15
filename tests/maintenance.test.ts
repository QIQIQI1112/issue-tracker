import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { runController } from '../factory/controller.ts';
import { commitSnapshot, recordMaintenance, maintenanceIdentity } from '../factory/maintenance.ts';
import { git } from '../factory/workspace.ts';

test('owner maintenance records only an independently approved verified merged source', { timeout: 30000 }, async () => {
  const root = evidenceDirectory('maintenance-receipt');
  const repository = fixtureRepository(join(root, 'repo'));
  const task = { schemaVersion: 1, id: 'maintenance-proof', title: 'Ready', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'Value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 20000 }, notes: 'Disposable owner proof.' };
  const state = await runController({ repository, task, mergeTarget: 'main', agent: fixtureAgent() });
  assert.equal(state.status, 'merged', state.reason ?? 'Expected verified fixture integration.');
  const commit = state.integration!.commit!;
  const verificationPath = join(state.integration!.verification!.runDirectory, 'summary.json');
  const hash = commitSnapshot(repository, commit).hash;
  assert.equal(hash, state.integration!.verification!.snapshot.hash);
  const reviewPath = join(root, 'owner-review.json');
  writeFileSync(reviewPath, JSON.stringify({ approved: false, findings: ['A blocking finding.'], sourceHash: hash, summary: 'Review blocked.' }));
  const store = new IssueStore(join(root, 'platform.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Owned', path: repository, targetBranch: 'main' });
    const issue = store.create({ title: 'Ready value maintenance', description: 'Return ready.', status: 'open', priority: 'high', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Value is ready.'], changeKind: 'harness' } });
    store.work.startIssue(issue.id);
    const input = { issueId: issue.id, commit, verificationPath, reviewPath };
    assert.throws(() => recordMaintenance(store, input), /independent approval/);
    assert.equal(store.work.runs().length, 0, 'Rejected evidence cannot claim or complete work.');
    writeFileSync(reviewPath, JSON.stringify({ approved: true, findings: [], sourceHash: 'wrong', summary: 'Wrong source.' }));
    assert.throws(() => recordMaintenance(store, input), /exact source/);
    writeFileSync(reviewPath, JSON.stringify({ approved: true, findings: [], sourceHash: hash, summary: 'Independent owner review approved the exact source.' }));
    assert.throws(() => recordMaintenance(store, input), /exact issue and acceptance/);
    writeFileSync(reviewPath, JSON.stringify({ approved: true, findings: [], sourceHash: hash, summary: 'Independent owner review approved the ready-value goal and criteria.', coveredIssues: [{ issueId: issue.id, contractHash: maintenanceIdentity(issue) }] }));
    const delivery = recordMaintenance(store, input);
    assert.equal(delivery.status, 'merged');
    assert.equal(store.get(issue.id)!.status, 'done');
    assert.equal(delivery.integration!.commit, git(repository, ['rev-parse', 'main']).trim());
    assert.ok(delivery.evidence.some(item => item.path === 'node-results.jsonl'));
    const summary = JSON.parse(readFileSync(verificationPath, 'utf8'));
    assert.equal(delivery.nodePassed, summary.node.passed);
    assert.throws(() => recordMaintenance(store, input), /queued/);
    assert.equal(store.work.runs().length, 1);
  } finally {
    store.close();
    git(repository, ['worktree', 'remove', '--force', state.workspace]);
  }
});
