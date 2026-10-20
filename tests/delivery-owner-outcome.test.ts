import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runController } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { saveDelivery } from '../factory/delivery.ts';
import { SerialQueue } from '../factory/queue.ts';
import { IssueStore } from '../src/storage.ts';
import { DeliveryView } from '../src/ui/DeliveryView.tsx';
import type { Delivery } from '../src/workflow.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

const task = () => parseTask({ schemaVersion: 1, id: 'delivery-outcome', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 3000, totalTimeoutMs: 90000 }, notes: '' });
const historical = 'Worker sandbox EPERM prevented browser execution; controller browser and full verification remain pending.';

for (const merged of [true, false]) test(`final ${merged ? 'merged' : 'blocked'} delivery presents the owner outcome rather than pre-verification worker prose`, { timeout: 90000 }, async () => {
  const root = evidenceDirectory(`delivery-owner-${merged}`);
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const state = await runController({ repository, task: task(), evidenceRoot: root, ...(merged ? { mergeTarget: 'main' } : {}), agent: { run: async input => {
    if (input.phase === 'implement') {
      if (merged) await delegate.run(input);
      return { schemaVersion: 1, taskId: input.task.id, summary: historical, blockers: [] };
    }
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, merged ? 'merged' : 'blocked', state.reason ?? 'No failure reason');
    const delivery = JSON.parse(readFileSync(join(state.runDirectory, 'delivery.json'), 'utf8')) as Delivery;
    const html = renderToStaticMarkup(createElement(DeliveryView, { delivery, runId: state.runId }));
    const visibleResult = html.match(/<h4>Result<\/h4><p>([\s\S]*?)<\/p>/)?.[1] ?? '';
    const markdown = readFileSync(join(state.runDirectory, 'delivery.md'), 'utf8');
    const markdownResult = markdown.match(/## Result\n\n([\s\S]*?)\n\n##/)?.[1] ?? '';
    assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'worker-1.json'), 'utf8')).summary, historical);
    if (merged) {
      assert.equal(state.integration?.verification?.status, 'passed');
      assert.equal(state.integration?.review?.approved, true);
      assert.ok(state.integration?.commit);
      assert.match(delivery.summary ?? '', /merg|integrat/i);
      assert.doesNotMatch(delivery.summary ?? '', /EPERM|sandbox|pending/i);
      assert.deepEqual(delivery.limitations, [], 'Completed owner proofs must retire worker-only pending limitations.');
      assert.match(visibleResult, /merg|integrat/i);
      assert.doesNotMatch(visibleResult, /EPERM|sandbox|pending/i);
      assert.match(markdownResult, /merg|integrat/i);
      assert.doesNotMatch(markdownResult, /EPERM|sandbox|pending/i);
      assert.match(html, /historical/i, 'Worker observations remain readable as history rather than current blockers.');
      assert.match(html, /Worker sandbox EPERM prevented browser execution/);
    } else {
      assert.ok(state.reason?.includes('verification failed'));
      assert.ok(delivery.summary?.includes(state.reason!), 'The actual owner failure reason must take precedence over a successful worker proposal.');
      assert.ok(delivery.limitations.includes(state.reason!));
      assert.ok(!delivery.limitations.includes(historical));
      assert.match(visibleResult, /verification failed/i);
      assert.doesNotMatch(visibleResult, /remain pending/i);
    }
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

test('legacy delivery reports remain readable without a historical observations field', () => {
  const delivery: Delivery = { schemaVersion: 1, runId: 'legacy', taskId: 'legacy', title: 'Legacy delivery', goal: 'Keep original records readable.', summary: 'Recorded legacy result.', status: 'blocked', startedAt: '2026-01-01', completedAt: '2026-01-01', baseline: null, sourceHash: null, defaults: [], changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 1, review: null, integration: null, limitations: ['Recorded legacy blocker.'], evidence: [] };
  const html = renderToStaticMarkup(createElement(DeliveryView, { delivery, runId: delivery.runId }));
  assert.match(html, /Recorded legacy result/);
  assert.match(html, /Recorded legacy blocker/);
});

test('queue recovery replaces a ready proposal result with its final owner blocker', () => {
  const root = evidenceDirectory('delivery-queue-blocker');
  const repository = fixtureRepository(join(root, 'repo'));
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: repository, targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Ready', goal: 'Return ready.' });
    store.create({ title: 'Ready', description: 'Return ready.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['The value is ready.'] } });
    store.work.startRequirement(requirement.id);
    const claim = store.work.claim(root)!;
    mkdirSync(claim.run.evidencePath, { recursive: true });
    saveDelivery(claim.run.evidencePath, { schemaVersion: 1, runId: claim.run.id, taskId: `issue-${claim.job.issueId}`, title: 'Ready', goal: 'Return ready.', summary: 'The candidate is ready for integration.', status: 'ready', startedAt: claim.run.startedAt, completedAt: claim.run.startedAt, baseline: null, sourceHash: null, defaults: [], changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 1, review: null, integration: null, limitations: [] });
    new SerialQueue(store, { evidenceRoot: root }).recover();
    const run = store.work.run(claim.run.id)!;
    const delivery = JSON.parse(readFileSync(join(claim.run.evidencePath, 'delivery.json'), 'utf8')) as Delivery;
    assert.equal(run.status, 'blocked');
    assert.ok(run.reason);
    assert.equal(delivery.status, 'blocked');
    assert.ok(delivery.summary?.includes(run.reason), 'A later owner blocker must replace the earlier ready proposal in Result.');
    assert.ok(delivery.limitations.includes(run.reason));
  } finally { store.close(); }
});
