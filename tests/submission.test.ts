import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/api.ts';
import { IssueStore } from '../src/storage.ts';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SerialQueue } from '../factory/queue.ts';
import { runProcess } from '../factory/process.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const plan = (repoId: number) => ({ schemaVersion: 1, submissionId: 'conversation-ready-1', repoId, requirement: { title: 'Ready from conversation', goal: 'Return ready and confirm the integrated behavior.' }, source: { kind: 'codex', reference: 'conversation-fixture', summary: 'The user requested the ready value and its integration behavior.' }, assumptions: [{ decision: 'Two dependent slices', reason: 'Repair first, then confirm the integrated result.' }], issues: [{ key: 'repair', title: 'Repair value', description: 'Return ready.', acceptance: ['The value is ready.'], dependsOn: [] }, { key: 'confirm', title: 'Confirm readiness', description: 'Confirm the integrated value.', acceptance: ['The integrated value is ready.'], dependsOn: ['repair'] }] });

test('a conversation plan is stored atomically with dependencies and only queues independent plan review', async () => {
  const store = new IssueStore(':memory:');
  const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
  const server = createApp(store, { instanceId: 'submission-test', version: 'test' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/plan-submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan(repo.id)) });
    assert.equal(response.status, 201, 'The whole conversation plan must have a submission endpoint.');
    const receipt = await response.json();
    assert.equal(receipt.requirement.status, 'queued');
    assert.equal(receipt.issues.length, 2);
    const repair = receipt.issues.find((item: { key: string }) => item.key === 'repair');
    const confirm = receipt.issues.find((item: { key: string }) => item.key === 'confirm');
    assert.deepEqual(confirm.issue.work.dependsOn, [repair.issue.id]);
    assert.equal(receipt.jobs.length, 1);
    assert.equal(receipt.jobs[0].kind, 'plan_review');
    assert.equal(receipt.requirement.submission.id, 'conversation-ready-1');
    assert.equal(store.list().length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    store.close();
  }
});

test('submission retries across connections preserve IDs and conflicting or invalid plans create no partial records', async () => {
  const root = evidenceDirectory('submission-atomic');
  const path = join(root, 'state.sqlite');
  const store = new IssueStore(path);
  const other = new IssueStore(path);
  const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
  const app = createApp(store, { instanceId: 'atomic', version: 'test' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/plan-submissions`;
  const post = (input: unknown) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  try {
    const input = plan(repo.id);
    const first = store.work.submitPlan(input);
    assert.equal(first.replayed, false);
    assert.deepEqual(other.work.submitPlan(input).submission.issueIds, first.submission.issueIds);
    const responses = await Promise.all([post(input), post(input)]);
    assert.ok(responses.every(response => response.status === 200));
    assert.equal((await post({ ...input, requirement: { ...input.requirement, goal: 'A changed goal.' } })).status, 409);
    assert.equal((await post({ ...input, submissionId: 'cycle', issues: input.issues.map(issue => ({ ...issue, dependsOn: issue.key === 'repair' ? ['confirm'] : ['repair'] })) })).status, 400);
    assert.equal((await post({ ...input, submissionId: 'missing', issues: [{ ...input.issues[0], dependsOn: ['absent'] }] })).status, 400);
    assert.equal((await post({ ...input, submissionId: 'unknown', approved: true })).status, 400);
    assert.equal((await post({ ...input, submissionId: 'wrong-repo', repoId: 999 })).status, 400);
    assert.equal((await post({ ...input, submissionId: 'wrong-target' })).status, 201);
    const refused = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-issue-tracker-target': 'wrong-instance' }, body: JSON.stringify({ ...input, submissionId: 'refused' }) });
    assert.equal(refused.status, 409);
    assert.equal(store.work.requirements().length, 2);
    assert.equal(store.list().length, 4);
    assert.equal(store.work.jobs().length, 2);
    const fetched = await (await fetch(base + '/' + input.submissionId)).json();
    assert.equal(fetched.submission.planHash, first.submission.planHash);
    assert.deepEqual(fetched.submission.plan.source, input.source);
    assert.equal((await fetch(base + '/absent')).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    other.close(); store.close();
  }
});

test('a database failure halfway through plan insertion rolls back requirements, issues, submission, and jobs', () => {
  const root = evidenceDirectory('submission-rollback');
  const path = join(root, 'state.sqlite');
  const store = new IssueStore(path);
  const database = new DatabaseSync(path);
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
    database.exec("CREATE TRIGGER fail_second BEFORE INSERT ON issues WHEN NEW.title='Confirm readiness' BEGIN SELECT RAISE(ABORT, 'Forced issue insertion failure'); END;");
    assert.throws(() => store.work.submitPlan(plan(repo.id)), /Forced issue insertion failure/);
    assert.equal(store.work.requirements().length, 0);
    assert.equal(store.list().length, 0);
    assert.equal(store.work.jobs().length, 0);
    assert.equal(store.work.submission('conversation-ready-1'), undefined);
    database.exec('DROP TRIGGER fail_second;');
    assert.equal(store.work.submitPlan(plan(repo.id)).issues.length, 2);
  } finally { database.close(); store.close(); }
});

test('submitted plans require coverage approval, remain immutable, and execute through the existing dependency and whole-goal queue', { timeout: 60000 }, async () => {
  const root = evidenceDirectory('submitted-plan-queue');
  const repository = fixtureRepository(join(root, 'repo'));
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: repository, targetBranch: 'main' });
    const receipt = store.work.submitPlan(plan(repo.id));
    assert.throws(() => store.work.startIssue(receipt.issues[0].issue.id), /independent plan approval/);
    assert.throws(() => store.update(receipt.issues[0].issue.id, { title: 'Unreviewed replacement' }), /immutable/);
    assert.throws(() => store.delete(receipt.issues[1].issue.id), /immutable/);
    let approve = false;
    let implementationCalls = 0;
    const delegate = fixtureAgent();
    const queue = new SerialQueue(store, { agent: { run: async input => { implementationCalls += 1; return delegate.run(input); } }, planner: {
      decompose: async () => { throw new Error('Submitted plans must not be decomposed again.'); },
      review: async input => {
        assert.equal(input.requirement.goal, receipt.requirement.goal);
        if (input.directory.endsWith('independent-review') && !input.evidence.includes('deliveries')) {
          assert.match(input.evidence, /repair/);
          assert.match(input.evidence, /confirm/);
        }
        return { approved: approve, summary: approve ? 'The submitted goal is covered.' : 'The integrated confirmation needs stronger acceptance.', findings: approve ? [] : ['Missing observable confirmation.'] };
      },
    } });
    const baseline = git(repository, ['rev-parse', 'HEAD']).trim();
    assert.equal(await queue.processNext(), true);
    assert.equal(store.work.requirement(receipt.requirement.id)?.status, 'blocked');
    assert.equal(implementationCalls, 0);
    assert.equal(git(repository, ['rev-parse', 'HEAD']).trim(), baseline);
    assert.equal(store.work.jobs().length, 1);
    assert.throws(() => store.work.startIssue(receipt.issues[0].issue.id), /independent plan approval/);
    const blocked = store.work.runs()[0];
    assert.equal(JSON.parse(readFileSync(join(blocked.evidencePath, 'delivery.json'), 'utf8')).status, 'blocked');
    assert.equal(store.work.submitPlan(plan(repo.id)).replayed, true);
    assert.equal(store.work.jobs().length, 1, 'An HTTP replay must not retry rejected work.');
    approve = true;
    store.work.startRequirement(receipt.requirement.id);
    assert.equal(await queue.processNext(), true);
    assert.equal(store.list().length, 2);
    assert.equal(store.work.jobs().filter(job => job.kind === 'issue').length, 2);
    const reviewRun = store.work.runs().find(run => run.status === 'passed')!;
    const recorded = JSON.parse(readFileSync(join(reviewRun.evidencePath, 'submission.json'), 'utf8'));
    assert.equal(recorded.planHash, receipt.submission.planHash);
    assert.deepEqual(recorded.plan.source, receipt.submission.plan.source);
    assert.equal(await queue.processNext(), true);
    assert.equal(store.work.runs().filter(run => run.status === 'merged').length, 1);
    assert.equal(await queue.processNext(), true);
    assert.equal(await queue.processNext(), true);
    assert.equal(store.work.requirement(receipt.requirement.id)?.status, 'done');
    assert.ok(store.list().every(issue => issue.status === 'done'));
    assert.equal(await queue.processNext(), false);
  } finally { store.close(); }
});

test('the submission CLI recovers a lost response using the same plan and refuses a different API database', { timeout: 30000 }, async () => {
  const root = evidenceDirectory('submission-cli');
  const store = new IssueStore(join(root, 'state.sqlite'));
  const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
  const app = createApp(store, { instanceId: 'cli-test', version: 'test' });
  let drop = true;
  const server = createServer((request, response) => {
    if (drop && request.method === 'POST' && request.url === '/api/plan-submissions') {
      drop = false;
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { store.work.submitPlan(JSON.parse(body)); response.destroy(); });
    } else app(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const input = { ...plan(repo.id), submissionId: randomUUID() };
  const file = join(root, 'plan.json');
  const receiptPath = join(root, 'receipt.json');
  writeFileSync(file, JSON.stringify(input));
  const base = ['--import', 'tsx', resolve('scripts/submit-plan.ts')];
  const target = ['--url', `http://127.0.0.1:${address.port}`, '--database', store.path];
  const execute = (args: string[], name: string) => runProcess({ command: process.execPath, args: [...base, ...args], cwd: process.cwd(), env: process.env, timeoutMs: 10000, logPath: join(root, name + '.log') });
  try {
    assert.equal((await execute([file, '--validate'], 'validate')).status, 'passed');
    assert.equal((await execute(['--list', ...target], 'list')).status, 'passed');
    assert.equal((await execute([file, ...target, '--receipt', receiptPath], 'lost')).status, 'failed');
    assert.match(readFileSync(join(root, 'lost.log'), 'utf8'), /Reuse the same plan file/);
    assert.equal(store.work.requirements().length, 1);
    assert.equal((await execute([file, ...target, '--receipt', receiptPath], 'retry')).status, 'passed');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.replayed, true);
    assert.equal(store.list().length, 2);
    assert.equal(store.work.jobs().length, 1);
    assert.equal((await execute(['--status', input.submissionId, ...target, '--receipt', receiptPath], 'status')).status, 'passed');
    assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).requirement.status, 'queued');
    assert.equal((await execute([file, '--url', `http://127.0.0.1:${address.port}`, '--database', join(root, 'other.sqlite')], 'wrong-database')).status, 'failed');
    assert.match(readFileSync(join(root, 'wrong-database.log'), 'utf8'), /identity does not match/);
    assert.equal(store.work.requirements().length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    store.close();
  }
});

test('interrupted plan review is blocked and requires a new review instead of releasing its issues', () => {
  const root = evidenceDirectory('submission-interruption');
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
    const receipt = store.work.submitPlan(plan(repo.id));
    store.work.claim(join(root, 'evidence'));
    new SerialQueue(store).recover();
    assert.equal(store.work.requirement(receipt.requirement.id)?.status, 'blocked');
    assert.throws(() => store.work.startIssue(receipt.issues[0].issue.id), /independent plan approval/);
    const [retry] = store.work.startRequirement(receipt.requirement.id);
    assert.equal(retry.kind, 'plan_review');
    assert.equal(store.list().length, 2);
    assert.equal(store.work.jobs().filter(job => job.kind === 'issue').length, 0);
  } finally { store.close(); }
});

test('version-three backlog migration preserves ownership, dependencies, labels, and execution history', () => {
  const root = evidenceDirectory('submission-upgrade');
  const path = join(root, 'state.sqlite');
  const original = new IssueStore(path);
  const repo = original.work.addRepo({ name: 'Existing', path: '/existing', targetBranch: 'main' });
  const requirement = original.work.addRequirement({ repoId: repo.id, title: 'Existing goal', goal: 'Preserve the original backlog.' });
  const first = original.create({ title: 'Existing issue', description: 'Keep the recorded behavior.', status: 'open', priority: 'high', labels: ['existing'], work: { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['Keep history.'] } });
  original.create({ title: 'Existing dependent', description: 'Depend on the existing issue.', status: 'open', priority: 'medium', labels: [], work: { ...first.work!, dependsOn: [first.id] } });
  original.work.startRequirement(requirement.id);
  const run = original.work.claim(join(root, 'evidence'))!;
  original.work.finish(run.run.id, 'blocked', 'Existing failure record.');
  const expected = { issues: original.list(), repos: original.work.repos(), requirements: original.work.requirements(), jobs: original.work.jobs(), runs: original.work.runs() };
  original.close();
  const versionThree = new DatabaseSync(path);
  versionThree.exec('DROP TABLE plan_submissions; PRAGMA user_version = 3;');
  versionThree.close();
  const migrated = new IssueStore(path);
  try {
    assert.deepEqual({ issues: migrated.list(), repos: migrated.work.repos(), requirements: migrated.work.requirements(), jobs: migrated.work.jobs(), runs: migrated.work.runs() }, expected);
    assert.equal(migrated.work.submitPlan(plan(repo.id)).issues.length, 2);
    assert.equal(migrated.get(first.id)?.labels[0], 'existing');
  } finally { migrated.close(); }
});
