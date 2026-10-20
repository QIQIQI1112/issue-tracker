import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { parseDecomposition } from '../factory/planner.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';

const decomposition = { assumptions: [], issues: [{ key: 'repair', title: 'Repair value', description: 'Return ready.', acceptance: ['The value is ready.'], dependsOn: [] }, { key: 'confirm', title: 'Confirm readiness', description: 'Confirm the integrated value remains ready.', acceptance: ['The integrated value is ready.'], dependsOn: ['repair'] }] };

test('serial queue decomposes, merges dependencies, verifies the whole goal, and persists reports', { timeout: 60000 }, async () => {
  const root = evidenceDirectory('serial-queue');
  const repoPath = fixtureRepository(join(root, 'repo'));
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: repoPath, targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Ready value', goal: 'Return ready and confirm it after integration.' });
    store.work.startRequirement(requirement.id);
    const queue = new SerialQueue(store, { agent: fixtureAgent(), planner: { decompose: async () => decomposition, review: async () => ({ approved: true, summary: 'The goal and dependencies are covered.', findings: [] }) } });
    assert.equal(await queue.processNext(), true);
    assert.equal(store.list().length, 2);
    const concurrent = await Promise.all([queue.processNext(), queue.processNext()]);
    assert.deepEqual(concurrent, [true, false]);
    assert.equal(store.work.runs().filter(run => run.status === 'merged').length, 1);
    assert.equal(await queue.processNext(), true);
    assert.equal(await queue.processNext(), true);
    assert.equal(await queue.processNext(), false);
    assert.equal(store.work.requirement(requirement.id)?.status, 'done');
    assert.equal(store.work.jobs().length, 4);
    assert.ok(store.work.jobs().every(job => job.status === 'completed'));
    assert.ok(store.list().every(issue => issue.status === 'done'));
    for (const run of store.work.runs()) {
      const delivery = JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8'));
      assert.equal(delivery.runId, run.id);
      assert.equal(delivery.status, run.status);
      assert.ok(delivery.evidence.length > 0);
    }
  } finally { store.close(); }
});

test('decomposition rejects cycles, missing dependencies, and duplicate keys', () => {
  assert.equal(parseDecomposition(decomposition).issues.length, 2);
  assert.throws(() => parseDecomposition({ ...decomposition, issues: decomposition.issues.map(issue => ({ ...issue, dependsOn: issue.key === 'repair' ? ['confirm'] : ['repair'] })) }), /Cyclic/);
  assert.throws(() => parseDecomposition({ ...decomposition, issues: [{ ...decomposition.issues[0], dependsOn: ['absent'] }] }), /Unknown/);
  assert.throws(() => parseDecomposition({ ...decomposition, issues: [decomposition.issues[0], decomposition.issues[0]] }), /Duplicate/);
});

test('dependency admission, editing guards, failed cascades, and interrupted recovery preserve state', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
    const another = store.work.addRepo({ name: 'Other', path: '/other', targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Goal', goal: 'A useful goal.' });
    const base = { title: 'First', description: 'First behavior.', labels: [], status: 'open' as const, priority: 'medium' as const };
    const work = { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['Observable behavior.'] };
    const first = store.create({ ...base, work });
    const second = store.create({ ...base, title: 'Second', work: { ...work, dependsOn: [first.id] } });
    assert.throws(() => store.update(first.id, { work: { ...work, dependsOn: [second.id] } }), /cycle/);
    assert.throws(() => store.create({ ...base, work: { ...work, repoId: another.id } }), /same repository/);
    store.work.startRequirement(requirement.id);
    assert.throws(() => store.update(first.id, { title: 'Changed after admission' }), /Queued/);
    assert.throws(() => store.delete(first.id), /Queued/);
    const claimed = store.work.claim('/evidence')!;
    assert.equal(claimed.job.issueId, first.id);
    assert.equal(store.work.claim('/evidence'), undefined);
    store.work.recoverInterrupted();
    assert.equal(store.work.run(claimed.run.id)?.status, 'blocked');
    assert.equal(store.work.jobs().find(job => job.issueId === second.id)?.status, 'blocked');
    assert.equal(store.work.requirement(requirement.id)?.status, 'blocked');
    assert.equal(store.get(first.id)?.status, 'blocked');
  } finally { store.close(); }
});

test('a failed sibling stays retryable after independent siblings finish and a retry can complete the goal', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Two behaviors', goal: 'Both behaviors work.' });
    for (const title of ['First', 'Second']) store.create({ title, description: title, status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: [title] } });
    store.work.startRequirement(requirement.id);
    const first = store.work.claim('/evidence')!;
    store.work.finish(first.run.id, 'blocked', 'First attempt failed.');
    const second = store.work.claim('/evidence')!;
    assert.equal(store.work.requirement(requirement.id)?.status, 'blocked');
    store.work.finish(second.run.id, 'merged');
    assert.equal(store.work.requirement(requirement.id)?.status, 'blocked');
    assert.ok(!store.work.jobs().some(job => ['queued', 'running'].includes(job.status)));
    store.work.startRequirement(requirement.id);
    const retry = store.work.claim('/evidence')!;
    assert.equal(retry.job.issueId, first.job.issueId);
    store.work.finish(retry.run.id, 'merged');
    const whole = store.work.claim('/evidence')!;
    assert.equal(whole.job.kind, 'requirement_verify');
    store.work.finish(whole.run.id, 'passed');
    assert.equal(store.work.requirement(requirement.id)?.status, 'done');
  } finally { store.close(); }
});

test('cross-requirement failure cascades update every affected requirement', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
    const first = store.work.addRequirement({ repoId: repo.id, title: 'Prerequisite', goal: 'Prerequisite behavior.' });
    const second = store.work.addRequirement({ repoId: repo.id, title: 'Dependent', goal: 'Dependent behavior.' });
    const input = { title: 'Issue', description: 'Behavior.', status: 'open' as const, priority: 'medium' as const, labels: [] };
    const prerequisite = store.create({ ...input, work: { repoId: repo.id, requirementId: first.id, dependsOn: [], acceptance: ['Prerequisite.'] } });
    store.create({ ...input, work: { repoId: repo.id, requirementId: second.id, dependsOn: [prerequisite.id], acceptance: ['Dependent.'] } });
    store.work.startRequirement(first.id); store.work.startRequirement(second.id);
    store.work.finish(store.work.claim('/evidence')!.run.id, 'blocked', 'Prerequisite failed.');
    assert.equal(store.work.requirement(first.id)?.status, 'blocked');
    assert.equal(store.work.requirement(second.id)?.status, 'blocked');
    assert.ok(!store.work.jobs().some(job => ['queued', 'running'].includes(job.status)));
  } finally { store.close(); }
});

test('requirement membership is frozen during whole-goal review and after completion', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Goal', goal: 'One verified behavior.' });
    const input = { title: 'Issue', description: 'Behavior.', status: 'open' as const, priority: 'medium' as const, labels: [] };
    const work = { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['Behavior.'] };
    const member = store.create({ ...input, work });
    const outside = store.create({ ...input, work: { ...work, requirementId: null } });
    store.work.startRequirement(requirement.id);
    store.work.finish(store.work.claim('/evidence')!.run.id, 'merged');
    const whole = store.work.claim('/evidence')!;
    assert.equal(whole.job.kind, 'requirement_verify');
    assert.throws(() => store.create({ ...input, work }), /membership is frozen/);
    assert.throws(() => store.update(outside.id, { work }), /membership is frozen/);
    assert.throws(() => store.delete(member.id), /immutable|frozen/);
    store.work.finish(whole.run.id, 'passed');
    assert.equal(store.work.requirement(requirement.id)?.status, 'done');
    assert.throws(() => store.create({ ...input, work }), /membership is frozen/);
    assert.equal(store.list().length, 2);
  } finally { store.close(); }
});
