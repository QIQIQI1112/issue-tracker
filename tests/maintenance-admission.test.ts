import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordMaintenance } from '../factory/maintenance.ts';
import { IssueStore } from '../src/storage.ts';
import type { Job } from '../src/workflow.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

function fixture() {
  const root = evidenceDirectory('maintenance-admission');
  const store = new IssueStore(join(root, 'platform.sqlite'));
  const database = new DatabaseSync(store.path, { readOnly: true });
  const repo = store.work.addRepo({ name: 'Admission fixture', path: join(root, 'missing-repository'), targetBranch: 'main' });
  const issue = (title: string, dependsOn: number[] = [], maintenance = true) => store.create({ title, description: 'Check admission before evidence access.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn, acceptance: ['Preserve the current queue and evidence.'], changeKind: maintenance ? 'harness' : 'feature' } });
  const snapshot = () => JSON.stringify(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => {
    const name = String(row.name);
    assert.match(name, /^[a-z_]+$/i);
    return [name, database.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()];
  }));
  const record = (issueId: number) => recordMaintenance(store, { issueId, commit: 'a'.repeat(40), verificationPath: join(root, 'missing-verification.json'), reviewPath: join(root, 'missing-review.json'), evidenceRoot: join(root, 'new-evidence') });
  return { root, store, issue, snapshot, record, close: () => { database.close(); store.close(); } };
}

function refusal(action: () => unknown): string {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  assert.ok(error instanceof Error, 'An ineligible completion must be refused.');
  return error.message;
}

function identifies(message: string, kind: 'issue' | 'job', id: number) {
  assert.match(message, new RegExp(`\\b${kind}\\s*#?${id}\\b`, 'i'), `Diagnostic must identify ${kind} ${id}.`);
}

function admission(store: IssueStore, issueId: number): Job {
  const method = (store.work as typeof store.work & { maintenanceAdmission?: (id: number) => Job }).maintenanceAdmission;
  assert.equal(typeof method, 'function', 'Read-only admission must be available independently of a transactional claim.');
  return method!.call(store.work, issueId);
}

test('unqueued maintenance refuses completion before repository or evidence access without changing state', () => {
  const context = fixture();
  try {
    const issue = context.issue('Unqueued owner work');
    const before = context.snapshot();
    const files = readdirSync(context.root).sort();
    const message = refusal(() => context.record(issue.id));
    identifies(message, 'issue', issue.id);
    assert.match(message, /not queued|unqueued|no .*queued|must be queued/i);
    assert.match(message, /queue|enqueue/i);
    assert.match(message, /API|start/i, 'An unqueued issue needs the existing explicit start path.');
    assert.equal(context.snapshot(), before, 'Refusal cannot enqueue, claim, change status or add execution history.');
    assert.deepEqual(readdirSync(context.root).sort(), files, 'Refusal cannot create locks, repositories or evidence directories.');
  } finally { context.close(); }
});

test('blocked and completed maintenance diagnostics identify retained history without restarting work', () => {
  const outcomes: { issueId: number; jobId: number; outcome: string; message: string; before: string; after: string; filesBefore: string[]; filesAfter: string[] }[] = [];
  for (const outcome of ['blocked', 'passed'] as const) {
    const context = fixture();
    try {
      const issue = context.issue(`Owner work ending ${outcome}`);
      const job = context.store.work.startIssue(issue.id);
      const claim = context.store.work.claimMaintenance(issue.id, join(context.root, 'retained-evidence'));
      context.store.work.finish(claim.run.id, outcome, 'Retained diagnostic history.');
      const before = context.snapshot();
      const files = readdirSync(context.root).sort();
      const message = refusal(() => context.record(issue.id));
      outcomes.push({ issueId: issue.id, jobId: job.id, outcome, message, before, after: context.snapshot(), filesBefore: files, filesAfter: readdirSync(context.root).sort() });
    } finally { context.close(); }
  }
  for (const item of outcomes) {
    identifies(item.message, 'issue', item.issueId);
    identifies(item.message, 'job', item.jobId);
    assert.match(item.message, item.outcome === 'blocked' ? /blocked/i : /completed/i);
    assert.match(item.message, /inspect|review/i, 'Terminal history needs inspection rather than automatic requeue.');
    assert.match(item.message, /run|history|evidence|recover/i);
    assert.equal(item.after, item.before, 'Terminal admission refusal must retain jobs, run lineage and outcomes.');
    assert.deepEqual(item.filesAfter, item.filesBefore);
  }
});

test('maintenance admission names unmet dependencies and the running job while preserving the serial queue', () => {
  const context = fixture();
  try {
    const dependency = context.issue('Unmerged dependency', [], false);
    const issue = context.issue('Waiting owner work', [dependency.id]);
    const job = context.store.work.startIssue(issue.id);
    const beforeDependency = context.snapshot();
    const dependencyMessage = refusal(() => context.record(issue.id));
    const afterDependency = context.snapshot();
    const activeIssue = context.issue('Other running execution', [], false);
    const activeJob = context.store.work.startIssue(activeIssue.id);
    const active = context.store.work.claim(join(context.root, 'other-evidence'), activeJob.id)!;
    assert.equal(active.job.id, activeJob.id);
    const beforeRunning = context.snapshot();
    const runningMessage = refusal(() => context.record(issue.id));
    identifies(dependencyMessage, 'issue', issue.id);
    identifies(dependencyMessage, 'job', job.id);
    assert.match(dependencyMessage, /dependenc/i);
    assert.match(dependencyMessage, new RegExp(`(?:#|\\b)${dependency.id}\\b`), 'The unmet dependency ID must be actionable.');
    assert.match(dependencyMessage, /merge|verified/i, 'A dependency needs verified merge evidence.');
    assert.equal(afterDependency, beforeDependency);
    identifies(runningMessage, 'issue', issue.id);
    identifies(runningMessage, 'job', activeJob.id);
    identifies(runningMessage, 'issue', activeIssue.id);
    assert.match(runningMessage, /running|active/i);
    assert.match(runningMessage, /wait|settle|finish|complete/i);
    assert.equal(context.snapshot(), beforeRunning, 'The global serial guard must refuse without claiming the waiting maintenance job.');
    assert.equal(context.store.work.jobs().find(item => item.id === job.id)!.status, 'queued');
  } finally { context.close(); }
});

test('eligible maintenance admission is read-only and transactional claim rechecks a later serial blocker', () => {
  const context = fixture();
  try {
    const issue = context.issue('Eligible owner work');
    const job = context.store.work.startIssue(issue.id);
    const before = context.snapshot();
    assert.deepEqual(admission(context.store, issue.id), job);
    assert.deepEqual(admission(context.store, issue.id), job);
    assert.equal(context.snapshot(), before, 'Admission must not create a run or update timestamps and sequences.');
    const otherIssue = context.issue('New execution after preflight', [], false);
    const otherJob = context.store.work.startIssue(otherIssue.id);
    assert.equal(context.store.work.claim(join(context.root, 'other-evidence'), otherJob.id)!.job.id, otherJob.id);
    const beforeClaim = context.snapshot();
    const message = refusal(() => context.store.work.claimMaintenance(issue.id, join(context.root, 'new-evidence')));
    identifies(message, 'issue', issue.id);
    identifies(message, 'job', otherJob.id);
    assert.match(message, /running|active/i);
    assert.equal(context.snapshot(), beforeClaim, 'Transactional admission must recheck live eligibility rather than trust earlier preflight.');
    assert.equal(context.store.work.jobs().find(item => item.id === job.id)!.status, 'queued');
  } finally { context.close(); }
});
