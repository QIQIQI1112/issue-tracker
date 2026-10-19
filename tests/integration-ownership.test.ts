import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runController } from '../factory/controller.ts';
import type { Agent } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { SerialQueue } from '../factory/queue.ts';
import { IssueStore } from '../src/storage.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

function uncooperativeReviewer() {
  const delegate = fixtureAgent();
  let release: (() => void) | undefined;
  const agent: Agent = { run: async input => {
    if (input.phase === 'review' && JSON.parse(input.feedback).purpose === 'integrated-code') return await new Promise(resolve => {
      release = () => resolve({ schemaVersion: 1, taskId: input.task.id, approved: true, summary: 'Reviewer eventually settled.', findings: [] });
    });
    return await delegate.run(input);
  } };
  return { agent, settle: async () => { release?.(); await new Promise(resolve => setImmediate(resolve)); } };
}

async function cleanup(repository: string, directory: string) {
  for (const name of ['integration-workspace', 'workspace']) if (existsSync(join(directory, name, '.git'))) git(repository, ['worktree', 'remove', '--force', join(directory, name)]);
}

test('an unsettled final reviewer retains integration worktree through both cleanup paths', async () => {
  const root = evidenceDirectory('unsettled-integration');
  const repository = fixtureRepository(join(root, 'repo'));
  const before = git(repository, ['rev-parse', 'main']).trim();
  const task = parseTask({ schemaVersion: 1, id: 'unsettled-review', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 20000 } });
  const reviewer = uncooperativeReviewer();
  const state = await runController({ repository, task, evidenceRoot: root, mergeTarget: 'main', agent: reviewer.agent });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(state.cleanupSafe, false);
    assert.equal(git(repository, ['rev-parse', 'main']).trim(), before);
    assert.equal(existsSync(join(state.runDirectory, 'integration-workspace', '.git')), true, 'The still-active reviewer must retain its exact working directory.');
    assert.match(readFileSync(join(state.runDirectory, 'integration-cleanup.json'), 'utf8'), /retained|unsafe/i);
  } finally { await reviewer.settle(); await cleanup(repository, state.runDirectory); }
});

test('queue cleanup preserves both owned worktrees when final reviewer settlement is unknown', async () => {
  const root = evidenceDirectory('queue-unsettled-integration');
  const repository = fixtureRepository(join(root, 'repo'));
  const store = new IssueStore(join(root, 'state.sqlite'));
  const reviewer = uncooperativeReviewer();
  let directory = '';
  try {
    const repo = store.work.addRepo({ name: 'Owned fixture', path: repository, targetBranch: 'main' });
    const issue = store.create({ title: 'Ready value', description: 'Return ready.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['The value is ready.'] } });
    store.work.startIssue(issue.id);
    const cancellation = new AbortController();
    const boundedQueue = new SerialQueue(store, { evidenceRoot: join(root, 'evidence'), signal: cancellation.signal, agent: { run: async input => {
      if (input.phase === 'review') setTimeout(() => cancellation.abort(), 100);
      return await reviewer.agent.run(input);
    } } });
    assert.equal(await boundedQueue.processNext(), true);
    const run = store.work.runs().find(run => run.issueId === issue.id)!;
    directory = run.evidencePath;
    assert.equal(run.status, 'blocked');
    for (const name of ['workspace', 'integration-workspace']) assert.equal(existsSync(join(directory, name, '.git')), true, `Unsafe queue cleanup must retain ${name}.`);
  } finally { await reviewer.settle(); if (directory) await cleanup(repository, directory); store.close(); }
});

test('settled successful and rejected integrated reviews remove their temporary worktree', async () => {
  for (const approved of [true, false]) {
    const root = evidenceDirectory(`settled-integration-${approved}`);
    const repository = fixtureRepository(join(root, 'repo'));
    const delegate = fixtureAgent();
    const task = parseTask({ schemaVersion: 1, id: 'settled-review', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 20000 } });
    const state = await runController({ repository, task, evidenceRoot: root, mergeTarget: 'main', agent: { run: async input => {
      if (input.phase === 'review') return { schemaVersion: 1, taskId: input.task.id, approved, summary: 'Settled final review.', findings: approved ? [] : ['A blocking candidate finding.'] };
      return await delegate.run(input);
    } } });
    try {
      assert.equal(state.status, approved ? 'merged' : 'blocked');
      assert.equal(existsSync(join(state.runDirectory, 'integration-workspace')), false);
    } finally { await cleanup(repository, state.runDirectory); }
  }
});
