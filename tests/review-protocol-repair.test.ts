import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runController } from '../factory/controller.ts';
import type { AgentInput } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

const task = (maxAttempts = 1) => parseTask({ schemaVersion: 1, id: 'review-protocol', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts, workerTimeoutMs: 1000, totalTimeoutMs: 30000 }, notes: '' });
const malformed = (input: AgentInput) => ({ schemaVersion: 1, taskId: input.task.id, approved: true, summary: 'Positive approval commentary.', findings: ['The implementation looks good.'] });

for (const phase of ['acceptance-review', 'review'] as const) test(`${phase} repairs one malformed report in place without repeating planning, tests, or implementation`, { timeout: 30000 }, async () => {
  const root = evidenceDirectory(`review-protocol-${phase}`);
  const repository = fixtureRepository(join(root, 'repo'));
  const original = readFileSync(join(repository, 'tests/value.test.ts'), 'utf8');
  const delegate = fixtureAgent();
  const counts = new Map<string, number>();
  let correctionFeedback = '';
  let originalAttempt: number | undefined;
  let reducedTimeout = false;
  const state = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    counts.set(input.phase, (counts.get(input.phase) ?? 0) + 1);
    if (input.phase === phase) {
      if (counts.get(phase) === 1) {
        originalAttempt = input.attempt;
        await new Promise(done => setTimeout(done, 250));
        return malformed(input);
      }
      assert.equal(input.attempt, originalAttempt);
      correctionFeedback = input.feedback;
      reducedTimeout = input.timeoutMs <= 800;
      assert.equal(readFileSync(join(input.cwd, 'tests/value.test.ts'), 'utf8'), original);
    }
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'ready', state.reason ?? 'No failure reason');
    assert.equal(counts.get('plan'), 1);
    assert.equal(counts.get('tests'), 1);
    assert.equal(counts.get('implement'), 1);
    assert.equal(counts.get(phase), 2);
    assert.equal(state.budget?.acceptanceAttempts, 1);
    assert.equal(state.budget?.implementationAttempts, 1);
    assert.ok((state.budget?.usedMs ?? 0) > 250);
    assert.equal(reducedTimeout, true, 'Protocol correction must use the remaining original phase deadline.');
    assert.match(correctionFeedback, /Approved reviews cannot contain blocking findings/);
    assert.match(correctionFeedback, /Positive approval commentary/);
    const errors = readdirSync(state.runDirectory).filter(name => name.startsWith('phase-')).map(name => join(state.runDirectory, name, 'contract-error.json'));
    const artifacts = errors.flatMap(path => { try { return [readFileSync(path, 'utf8')]; } catch { return []; } });
    assert.ok(artifacts.some(content => /Approved reviews cannot contain blocking findings/.test(content) && /Positive approval commentary/.test(content)), 'Retain the rejected response and validation error as review evidence.');
    assert.ok(state.reviewReceipts?.every(receipt => receipt.approved));
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

test('malformed review exhaustion is bounded inside the original acceptance generation', { timeout: 15000 }, async () => {
  const root = evidenceDirectory('review-protocol-exhausted');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const counts = new Map<string, number>();
  const state = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    counts.set(input.phase, (counts.get(input.phase) ?? 0) + 1);
    return input.phase === 'acceptance-review' ? malformed(input) : delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(counts.get('acceptance-review'), 2);
    assert.equal(counts.get('plan'), 1);
    assert.equal(counts.get('tests'), 1);
    assert.equal(counts.get('implement') ?? 0, 0);
    assert.equal(state.budget?.acceptanceAttempts, 1);
    assert.equal(state.budget?.implementationAttempts, 0);
    assert.match(state.reason ?? '', /review|protocol|format/i);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

test('a malformed review that mutates source is an integrity failure rather than a correctable report', { timeout: 15000 }, async () => {
  const root = evidenceDirectory('review-protocol-mutation');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  let reviews = 0;
  const state = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'acceptance-review') {
      reviews++;
      writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'reviewer mutation';\n");
      return malformed(input);
    }
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(state.failureKind, 'integrity');
    assert.match(state.reason ?? '', /read.only|changed during|changed after/i);
    assert.equal(reviews, 1);
    assert.equal(state.budget?.implementationAttempts, 0);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

test('valid acceptance rejection keeps the existing test repair and approval gate', { timeout: 30000 }, async () => {
  const root = evidenceDirectory('review-protocol-rejection');
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  let reviews = 0;
  let tests = 0;
  const state = await runController({ repository, task: task(2), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'tests') { tests++; if (tests === 2) assert.match(input.feedback, /Assert the business boundary/); }
    if (input.phase === 'acceptance-review' && ++reviews === 1) return { schemaVersion: 1, taskId: input.task.id, approved: false, summary: 'A business boundary is missing.', findings: ['Assert the business boundary.'] };
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'ready', state.reason ?? 'No failure reason');
    assert.equal(reviews, 2);
    assert.equal(tests, 2);
    assert.equal(state.budget?.acceptanceAttempts, 2);
    assert.equal(state.reviewReceipts?.filter(receipt => receipt.purpose === 'acceptance-coverage' && !receipt.approved).length, 1);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

for (const mode of ['timeout', 'cancelled'] as const) test(`review ${mode} is not retried as malformed output`, { timeout: 15000 }, async () => {
  const root = evidenceDirectory(`review-protocol-${mode}`);
  const repository = fixtureRepository(join(root, 'repo'));
  const delegate = fixtureAgent();
  const cancellation = new AbortController();
  let reviews = 0;
  const state = await runController({ repository, task: task(), evidenceRoot: root, signal: cancellation.signal, agent: { run: async input => {
    if (input.phase === 'acceptance-review') {
      reviews++;
      const timer = mode === 'cancelled' ? setTimeout(() => cancellation.abort(), 30) : undefined;
      try { await new Promise<void>(done => input.signal.addEventListener('abort', () => done(), { once: true })); }
      finally { if (timer) clearTimeout(timer); }
      return malformed(input);
    }
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(reviews, 1);
    assert.match(state.reason ?? '', /timed out|timeout|cancelled/i);
    assert.equal(state.budget?.acceptanceAttempts, 1);
    assert.equal(state.budget?.implementationAttempts, 0);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});
