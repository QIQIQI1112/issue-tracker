import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runController } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';
import { DeliveryView } from '../src/ui/DeliveryView.tsx';
import type { Delivery } from '../src/workflow.ts';

const task = () => parseTask({ schemaVersion: 1, id: 'review-flow', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 30000 }, notes: '' });

test('owner red proofs precede check review and integrated execution has one final code review', async () => {
  const root = evidenceDirectory('review-flow');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  let codeReviews = 0;
  const state = await runController({ repository, task: task(), evidenceRoot: root, mergeTarget: 'main', agent: { run: async input => {
    if (input.phase === 'acceptance-review') {
      const context = JSON.parse(input.feedback);
      assert.equal(context.purpose, 'acceptance-coverage');
      assert.equal(context.redChecks[0].status, 'expected_failure');
      assert.match(readFileSync(context.redChecks[0].reportPath, 'utf8'), /value is ready/);
    }
    if (input.phase === 'review') {
      codeReviews += 1;
      const context = JSON.parse(input.feedback);
      assert.equal(context.purpose, 'integrated-code');
      assert.equal(context.integratedCandidate, true);
    }
    return await delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'merged', state.reason ?? 'No failure reason');
    assert.equal(codeReviews, 1);
    assert.equal(state.reviewReceipts?.length, 2);
    assert.equal(state.reviewReceipts?.[1].sourceHash, state.integration?.verification?.snapshot.hash);
    assert.ok(state.reviewReceipts?.every(receipt => receipt.criteriaHash && receipt.contractHash && receipt.approved));
    assert.ok(state.phases?.some(phase => phase.name === 'verify' && phase.durationMs > 0));
    const delivery = JSON.parse(readFileSync(join(state.runDirectory, 'delivery.json'), 'utf8')) as Delivery;
    const html = renderToStaticMarkup(createElement(DeliveryView, { delivery, runId: state.runId }));
    assert.match(html, /Execution timeline/);
    assert.match(html, /integrated-code/);
    assert.ok(delivery.phases?.every(phase => phase.status !== 'running'));
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

test('a failed final integrated review cannot advance the target', async () => {
  const root = evidenceDirectory('final-reject');
  const repository = fixtureRepository(join(root, 'repo'));
  const before = git(repository, ['rev-parse', 'main']).trim();
  const delegate = fixtureAgent();
  const state = await runController({ repository, task: task(), evidenceRoot: root, mergeTarget: 'main', agent: { run: async input => {
    if (input.phase === 'review') return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'Blocking final review.', findings: ['The final candidate does not meet the approved default.'] };
    return await delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(git(repository, ['rev-parse', 'main']).trim(), before);
    assert.ok(state.reviewReceipts?.some(receipt => receipt.purpose === 'integrated-code' && !receipt.approved));
    assert.ok(state.phases?.some(phase => phase.status === 'failed'));
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});
