import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { request } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { IssueStore } from '../src/storage.ts';
import { createApp } from '../src/api.ts';
import { parseCreateIssue, parsePatchIssue } from '../src/domain.ts';
import type { Issue } from '../src/domain.ts';
import { ConflictError } from '../src/workflow.ts';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

type Closure = { reason: string; closedAt: string; supersededBy?: number };
type ClosedIssue = Issue & { closure?: Closure };

function closeIssue(store: IssueStore, id: number, input: unknown): ClosedIssue | undefined {
  const action = (store as unknown as { closeIssue?: (id: number, input: unknown) => ClosedIssue | undefined }).closeIssue;
  assert.equal(typeof action, 'function', 'IssueStore must expose the guarded closeIssue lifecycle operation.');
  return action!.call(store, id, input);
}

function repository(store: IssueStore, path = '/lifecycle-fixture') {
  return store.work.addRepo({ name: 'Lifecycle fixture', path, targetBranch: 'main' });
}

function issue(store: IssueStore, repoId: number, title: string, dependsOn: number[] = [], requirementId: number | null = null) {
  return store.create({ ...parseCreateIssue({ title, description: `Original ${title}`, labels: ['original'] }), work: { repoId, requirementId, dependsOn, acceptance: [`${title} is verified.`] } });
}

test('failed issue outcomes and transitive dependency cascades persist Blocked while retry and verified completion retain their meanings', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = repository(store);
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Dependent work', goal: 'Deliver all dependent behavior.' });
    const first = issue(store, repo.id, 'First', [], requirement.id);
    const second = issue(store, repo.id, 'Second', [first.id], requirement.id);
    const third = issue(store, repo.id, 'Third', [second.id], requirement.id);
    const unrelated = issue(store, repo.id, 'Unrelated');
    assert.equal(first.status, 'open');
    store.work.startRequirement(requirement.id);
    const failed = store.work.claim('/lifecycle-evidence')!;
    assert.equal(store.get(first.id)?.status, 'in_progress');
    store.work.finish(failed.run.id, 'blocked', 'Deterministic acceptance failed.');
    assert.deepEqual([first, second, third].map(item => store.get(item.id)?.status), ['blocked', 'blocked', 'blocked'], 'Both executed failure and every blocked dependency must leave Open backlog.');
    assert.equal(store.get(unrelated.id)?.status, 'open');
    assert.ok(store.work.jobs().every(job => job.status === 'blocked'));
    assert.equal(store.work.requirement(requirement.id)?.status, 'blocked');
    store.work.startRequirement(requirement.id);
    const retry = store.work.claim('/lifecycle-evidence')!;
    assert.equal(retry.job.issueId, first.id);
    assert.equal(store.get(first.id)?.status, 'in_progress');
    assert.equal(store.get(second.id)?.status, 'blocked');
    store.work.finish(retry.run.id, 'merged');
    assert.equal(store.get(first.id)?.status, 'done');
    assert.equal(store.work.run(failed.run.id)?.reason, 'Deterministic acceptance failed.');
    const next = store.work.claim('/lifecycle-evidence')!;
    assert.equal(next.job.issueId, second.id);
    store.work.finish(next.run.id, 'merged');
    store.work.finish(store.work.claim('/lifecycle-evidence')!.run.id, 'merged');
    const whole = store.work.claim('/lifecycle-evidence')!;
    assert.equal(whole.job.kind, 'requirement_verify');
    store.work.finish(whole.run.id, 'passed');
    assert.equal(store.work.requirement(requirement.id)?.status, 'done');
  } finally { store.close(); }
});

test('interrupted recovery persists Blocked across reopen without rewriting failed execution history', () => {
  const path = join(evidenceDirectory('lifecycle-recovery'), 'state.sqlite');
  const first = new IssueStore(path);
  const repo = repository(first);
  const parent = issue(first, repo.id, 'Interrupted');
  const dependent = issue(first, repo.id, 'Waiting', [parent.id]);
  first.work.startIssue(parent.id); first.work.startIssue(dependent.id);
  const running = first.work.claim('/lifecycle-evidence')!;
  first.close();
  const recovered = new IssueStore(path);
  try {
    recovered.work.recoverInterrupted();
    assert.equal(recovered.get(parent.id)?.status, 'blocked', 'An interrupted issue must remain visibly Blocked after persisted recovery.');
    assert.equal(recovered.get(dependent.id)?.status, 'blocked');
    const history = recovered.work.runs();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, running.run.id);
    assert.match(history[0].reason!, /interrupted/i);
    recovered.work.recoverInterrupted();
    assert.deepEqual(recovered.work.runs(), history);
    recovered.work.startIssue(parent.id);
    assert.equal(recovered.work.claim('/lifecycle-evidence')?.job.issueId, parent.id);
    assert.equal(recovered.get(parent.id)?.status, 'in_progress');
  } finally { recovered.close(); }
});

test('closure is persisted, trimmed, idempotent and distinct from successful delivery with optional replacement context', () => {
  const path = join(evidenceDirectory('lifecycle-closure'), 'state.sqlite');
  const store = new IssueStore(path);
  let closed: ClosedIssue;
  let withoutReplacement: ClosedIssue;
  try {
    const repo = repository(store);
    const original = issue(store, repo.id, 'Superseded work');
    const replacement = issue(store, repo.id, 'Replacement work');
    const started = Date.now();
    closed = closeIssue(store, original.id, { reason: '  Replaced by the verified follow-up.  ', supersededBy: replacement.id })!;
    assert.equal(closed.status, 'closed');
    assert.deepEqual({ ...closed, status: original.status, updatedAt: original.updatedAt, closure: undefined }, { ...original, closure: undefined });
    assert.equal(closed.closure?.reason, 'Replaced by the verified follow-up.');
    assert.equal(closed.closure?.supersededBy, replacement.id);
    assert.ok(Number.isFinite(Date.parse(closed.closure!.closedAt)));
    assert.ok(Date.parse(closed.closure!.closedAt) >= started && Date.parse(closed.closure!.closedAt) <= Date.now());
    assert.deepEqual(closeIssue(store, original.id, { reason: 'Replaced by the verified follow-up.', supersededBy: replacement.id }), closed);
    assert.throws(() => closeIssue(store, original.id, { reason: 'A conflicting reason.', supersededBy: replacement.id }), ConflictError);
    assert.throws(() => closeIssue(store, original.id, { reason: closed.closure!.reason }), ConflictError);
    assert.deepEqual(store.get(original.id), closed);
    assert.deepEqual(store.work.runs(), []);
    withoutReplacement = closeIssue(store, replacement.id, { reason: `  ${'r'.repeat(2000)}  ` })!;
    assert.equal(withoutReplacement.closure?.reason.length, 2000);
    assert.equal(withoutReplacement.closure?.supersededBy, undefined);
  } finally { store.close(); }
  const reopened = new IssueStore(path);
  try {
    assert.deepEqual(reopened.get(closed!.id), closed!);
    assert.deepEqual(reopened.get(withoutReplacement!.id), withoutReplacement!);
    assert.deepEqual(closeIssue(reopened, closed!.id, closed!.closure && { reason: closed!.closure.reason, supersededBy: closed!.closure.supersededBy }), closed!);
  } finally { reopened.close(); }
});

test('closure validation rejects invalid reasons, fields and replacement identities atomically', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = repository(store);
    const other = repository(store, '/other-lifecycle-fixture');
    const original = issue(store, repo.id, 'Retain original');
    const foreign = issue(store, other.id, 'Foreign work');
    assert.equal(typeof (store as unknown as { closeIssue?: unknown }).closeIssue, 'function', 'IssueStore must expose guarded closure validation before invalid requests can be checked.');
    const before = { issues: store.list(), jobs: store.work.jobs(), runs: store.work.runs() };
    for (const input of [null, [], 'closed', {}, { reason: '' }, { reason: ' \n ' }, { reason: 1 }, { reason: 'r'.repeat(2001) }, { reason: 'Valid', extra: true }, { reason: 'Valid', closedAt: '2000-01-01' }, ...[0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1, original.id, 999, foreign.id].map(supersededBy => ({ reason: 'Valid', supersededBy }))]) {
      assert.throws(() => closeIssue(store, original.id, input), /reason|field|object|replacement|supersed|positive|repository|issue|integer/i, JSON.stringify(input));
      assert.deepEqual({ issues: store.list(), jobs: store.work.jobs(), runs: store.work.runs() }, before, 'Rejected closure must not write partial state.');
    }
  } finally { store.close(); }
});

test('queued, running and actually merged issues reject closure without changing ownership or completion evidence', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = repository(store);
    const original = issue(store, repo.id, 'Owned execution');
    assert.equal(typeof (store as unknown as { closeIssue?: unknown }).closeIssue, 'function', 'IssueStore must expose guarded closure before execution ownership can be checked.');
    store.work.startIssue(original.id);
    const assertRejected = () => {
      const before = { issue: store.get(original.id), jobs: store.work.jobs(), runs: store.work.runs() };
      assert.throws(() => closeIssue(store, original.id, { reason: 'Must not cancel execution.' }), ConflictError);
      assert.deepEqual({ issue: store.get(original.id), jobs: store.work.jobs(), runs: store.work.runs() }, before);
    };
    assertRejected();
    const running = store.work.claim('/lifecycle-evidence')!;
    assertRejected();
    store.work.finish(running.run.id, 'merged');
    assert.equal(store.get(original.id)?.status, 'done');
    assertRejected();
  } finally { store.close(); }
});

test('closed standalone issues cannot restart, edit, reassign, delete or be forged by ordinary mutation input', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = repository(store);
    const original = issue(store, repo.id, 'Abandoned work');
    const closed = closeIssue(store, original.id, { reason: 'No longer required.' });
    assert.throws(() => store.work.startIssue(original.id), ConflictError);
    for (const patch of [{ title: 'Rewritten' }, { status: 'open' as const }, { description: 'Rewritten' }, { work: original.work! }]) assert.throws(() => store.update(original.id, patch), ConflictError);
    assert.throws(() => store.work.assign(original.id, original.work!), ConflictError);
    assert.throws(() => store.delete(original.id), ConflictError);
    assert.throws(() => store.create(parseCreateIssue({ title: 'Forged closure', status: 'closed' })), /clos|lifecycle|status/i);
    const open = issue(store, repo.id, 'Still open');
    assert.throws(() => store.update(open.id, parsePatchIssue({ status: 'closed' })), /clos|lifecycle|status/i);
    assert.deepEqual(store.get(original.id), closed);
    assert.equal(store.get(open.id)?.status, 'open');
    assert.deepEqual(store.work.jobs(), []);
  } finally { store.close(); }
});

test('immutable submitted failures can close without changing original plans, failed reports or retry budgets and cannot retry the requirement', () => {
  const root = evidenceDirectory('lifecycle-submitted');
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = repository(store);
    const plan = { schemaVersion: 1, submissionId: 'lifecycle-submission', repoId: repo.id, requirement: { title: 'Original goal', goal: 'Keep the original goal and failed evidence.' }, source: { kind: 'codex', reference: 'original-conversation', summary: 'The original immutable request.' }, assumptions: [], issues: [{ key: 'repair', title: 'Original repair', description: 'Original description.', acceptance: ['The original acceptance condition.'], dependsOn: [] }] };
    const receipt = store.work.submitPlan(plan);
    const review = store.work.claim(root)!;
    store.work.finish(review.run.id, 'passed');
    const failed = store.work.claim(root)!;
    mkdirSync(failed.run.evidencePath, { recursive: true });
    const report = { status: 'blocked', summary: 'The acceptance budget was exhausted.', budget: { implementationAttempts: 3, acceptanceAttempts: 3, usedMs: 2700 }, evidence: [{ path: 'failure.log', sha256: 'retained-proof' }] };
    const reportPath = join(failed.run.evidencePath, 'delivery.json');
    writeFileSync(reportPath, JSON.stringify(report));
    writeFileSync(join(failed.run.evidencePath, 'failure.log'), 'Original failure details.');
    store.work.finish(failed.run.id, 'blocked', report.summary);
    const original = store.get(receipt.issues[0].issue.id)!;
    const before = { submission: store.work.submission(plan.submissionId), jobs: store.work.jobs(), runs: store.work.runs(), report: readFileSync(reportPath, 'utf8') };
    const closed = closeIssue(store, original.id, { reason: 'Replaced by a separately accepted plan.' })!;
    assert.equal(closed.status, 'closed');
    assert.equal(closed.title, original.title);
    assert.equal(closed.description, original.description);
    assert.deepEqual(closed.work, original.work);
    assert.throws(() => store.work.startIssue(original.id), ConflictError);
    assert.throws(() => store.work.startRequirement(receipt.requirement.id), ConflictError);
    assert.equal(store.work.submitPlan(plan).replayed, true);
    assert.notEqual(store.work.requirement(receipt.requirement.id)?.status, 'done');
    assert.deepEqual({ submission: store.work.submission(plan.submissionId), jobs: store.work.jobs(), runs: store.work.runs(), report: readFileSync(reportPath, 'utf8') }, before);
    assert.equal(readFileSync(join(failed.run.evidencePath, 'failure.log'), 'utf8'), 'Original failure details.');
  } finally { store.close(); }
});

test('a closed prerequisite never satisfies dependencies through its successfully merged replacement', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = repository(store);
    const original = issue(store, repo.id, 'Original prerequisite');
    const replacement = issue(store, repo.id, 'Verified replacement');
    store.work.startIssue(replacement.id);
    store.work.finish(store.work.claim('/lifecycle-evidence')!.run.id, 'merged');
    const dependent = issue(store, repo.id, 'Dependent original contract', [original.id]);
    store.work.startIssue(dependent.id);
    closeIssue(store, original.id, { reason: 'Superseded; dependencies retain their original contracts.', supersededBy: replacement.id });
    assert.equal(store.work.claim('/lifecycle-evidence'), undefined, 'Closure and replacement merge evidence must not redirect or satisfy an immutable dependency.');
    assert.deepEqual(store.get(dependent.id)?.work?.dependsOn, [original.id]);
    assert.equal(store.work.runs().filter(run => run.issueId === original.id).length, 0);
    assert.notEqual(store.get(dependent.id)?.status, 'done');
  } finally { store.close(); }
});

test('supersession cannot create a replacement cycle or change an already recorded closure', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = repository(store);
    const first = issue(store, repo.id, 'Original work');
    const second = issue(store, repo.id, 'Follow-up work');
    const closed = closeIssue(store, first.id, { reason: 'Replaced by follow-up work.', supersededBy: second.id });
    assert.throws(() => closeIssue(store, second.id, { reason: 'Invalid circular replacement.', supersededBy: first.id }), /cycl|closed|replacement|supersed/i);
    assert.deepEqual(store.get(first.id), closed);
    assert.equal(store.get(second.id)?.status, 'open');
    assert.equal((store.get(second.id) as ClosedIssue).closure, undefined);
  } finally { store.close(); }
});

async function api() {
  const path = join(evidenceDirectory('lifecycle-api'), 'state.sqlite');
  const store = new IssueStore(path);
  const repo = repository(store);
  const original = issue(store, repo.id, 'HTTP closure');
  const server = createApp(store, { instanceId: 'lifecycle-api', version: 'test' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { 'content-type': 'application/json', [targetHeader]: targetIdentity('lifecycle-api', path) };
  const post = (input: unknown, id: string | number = original.id, extra: Record<string, string> = {}) => fetch(`${base}/api/issues/${id}/close`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(input) });
  return { store, original, base, headers, post, close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); } };
}

test('the close endpoint returns durable closure metadata and keeps issue inspection and execution history available', async () => {
  const app = await api();
  let result: ClosedIssue;
  try {
    app.store.work.startIssue(app.original.id);
    const failed = app.store.work.claim('/lifecycle-evidence')!;
    app.store.work.finish(failed.run.id, 'blocked', 'The original execution failed.');
    const history = app.store.work.runs();
    const response = await app.post({ reason: '  Abandoned after failed verification.  ' });
    assert.equal(response.status, 200, 'POST /api/issues/:id/close must provide an explicit guarded lifecycle operation.');
    result = (await response.json()).issue;
    assert.equal(result.status, 'closed');
    assert.equal(result.closure?.reason, 'Abandoned after failed verification.');
    assert.ok(Number.isFinite(Date.parse(result.closure!.closedAt)));
    assert.deepEqual(await (await app.post({ reason: result.closure!.reason })).json(), { issue: result });
    assert.equal((await app.post({ reason: 'Conflicting closure.' })).status, 409);
    const inspected = await (await fetch(`${app.base}/api/issues/${app.original.id}`)).json();
    assert.deepEqual(inspected.issue, result);
    assert.deepEqual(inspected.runs, history);
    assert.deepEqual((await (await fetch(`${app.base}/api/issues`)).json()).issues, [result]);
    assert.equal((await fetch(`${app.base}/api/issues/${app.original.id}/start`, { method: 'POST', headers: app.headers })).status, 409);
    assert.equal((await fetch(`${app.base}/api/issues/${app.original.id}`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ title: 'Must remain original' }) })).status, 409);
    assert.equal((await fetch(`${app.base}/api/issues/${app.original.id}`, { method: 'DELETE', headers: app.headers })).status, 409);
  } finally { await app.close(); }
  const reopened = new IssueStore(app.store.path);
  try { assert.deepEqual(reopened.get(result!.id), result!); }
  finally { reopened.close(); }
});

test('the close endpoint strictly validates payloads and retains target identity, loopback and origin protection without partial writes', async () => {
  const app = await api();
  try {
    const before = app.store.list();
    for (const target of ['', 'malformed', targetIdentity('other-instance', app.store.path), targetIdentity('lifecycle-api', `${app.store.path}.other`)]) assert.equal((await app.post({ reason: 'Wrong target.' }, app.original.id, { [targetHeader]: target })).status, 409);
    assert.equal((await app.post({ reason: 'Cross origin.' }, app.original.id, { origin: 'https://untrusted.example' })).status, 403);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const sent = request(`${app.base}/api/issues/${app.original.id}/close`, { method: 'POST', headers: { ...app.headers, host: 'untrusted.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      sent.on('error', reject);
      sent.end(JSON.stringify({ reason: 'Wrong host.' }));
    });
    assert.equal(wrongHost, 403);
    assert.deepEqual(app.store.list(), before);
    for (const input of [null, [], {}, { reason: '' }, { reason: ' \n ' }, { reason: 3 }, { reason: 'r'.repeat(2001) }, { reason: 'Valid', surprise: true }, { reason: 'Valid', closedAt: '2000-01-01' }, { reason: 'Valid', supersededBy: '1' }, { reason: 'Valid', supersededBy: app.original.id }, { reason: 'Valid', supersededBy: 999 }]) {
      const response = await app.post(input);
      assert.equal(response.status, 400, `Invalid closure must be rejected: ${JSON.stringify(input)}`);
      assert.deepEqual(app.store.list(), before);
    }
    assert.equal((await app.post({ reason: 'Missing issue.' }, 999)).status, 404);
    for (const id of ['0', '-1', '1.5', 'NaN', '9007199254740993']) assert.equal((await app.post({ reason: 'Invalid issue.' }, id)).status, 400);
    assert.equal((await fetch(`${app.base}/api/issues/${app.original.id}/close`, { method: 'POST', headers: app.headers, body: '{broken' })).status, 400);
    assert.equal((await app.post({ reason: 'x'.repeat(65 * 1024) })).status, 413);
    assert.deepEqual(app.store.list(), before);
    app.store.work.startIssue(app.original.id);
    assert.equal((await app.post({ reason: 'Queued issue.' })).status, 409);
  } finally { await app.close(); }
});
