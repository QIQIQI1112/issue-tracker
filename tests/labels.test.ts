import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { join } from 'node:path';
import { parseCreateIssue, parsePatchIssue } from '../src/domain.ts';
import { DATABASE_SCHEMA_VERSION, IssueStore } from '../src/storage.ts';
import { createApp } from '../src/api.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('labels normalize and deduplicate without changing other issue defaults', () => {
  const issue = parseCreateIssue({ title: '  Labelled issue  ', labels: [' Bug ', 'BUG', 'Front-end'] });
  assert.deepEqual(issue, { title: 'Labelled issue', description: '', status: 'open', priority: 'medium', labels: ['bug', 'front-end'] });
  assert.deepEqual(parseCreateIssue({ title: 'Without labels' }).labels, []);
  assert.deepEqual(parsePatchIssue({ labels: [] }), { labels: [] });
});

test('labels enforce type, empty, length, and count boundaries', () => {
  assert.deepEqual(parseCreateIssue({ title: 'Boundary', labels: ['x'.repeat(20)] }).labels, ['x'.repeat(20)]);
  assert.equal(parseCreateIssue({ title: 'Unicode boundary', labels: ['😀'.repeat(20)] }).labels[0], '😀'.repeat(20));
  for (const labels of [null, 'bug', [1], [''], ['   '], ['x'.repeat(21)], ['😀'.repeat(21)], Array.from({ length: 11 }, (_, index) => `label-${index}`)]) {
    assert.throws(() => parseCreateIssue({ title: 'Invalid labels', labels }), /Labels|Label/);
    assert.throws(() => parsePatchIssue({ labels }), /Labels|Label/);
  }
});

test('labels reject values that cannot round-trip through the form', () => {
  for (const label of ['bug,ui', 'bug\nui', 'bug\u0000ui']) assert.throws(() => parseCreateIssue({ title: 'Round trip', labels: [label] }), /comma|control/i);
});

test('stored labels survive reopen, omitted patches, and explicit clearing', () => {
  const path = join(evidenceDirectory('labels-storage'), 'issues.sqlite');
  const first = new IssueStore(path);
  const issue = first.create(parseCreateIssue({ title: 'Persistent labels', labels: ['bug', 'ui'] }));
  first.close();
  const second = new IssueStore(path);
  try {
    assert.deepEqual(second.get(issue.id)?.labels, ['bug', 'ui']);
    assert.deepEqual(second.update(issue.id, parsePatchIssue({ title: 'Renamed' }))?.labels, ['bug', 'ui']);
    assert.deepEqual(second.update(issue.id, parsePatchIssue({ labels: [] }))?.labels, []);
    assert.equal(second.get(issue.id)?.title, 'Renamed');
  } finally { second.close(); }
});

test('version-one databases upgrade without losing existing records', () => {
  const path = join(evidenceDirectory('labels-migration'), 'issues.sqlite');
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); PRAGMA user_version = 1;");
  database.prepare('INSERT INTO issues VALUES (?, ?, ?, ?, ?, ?, ?)').run(7, 'Existing issue', 'Keep this', 'open', 'high', '2026-01-01', '2026-01-01');
  database.close();
  const store = new IssueStore(path);
  try {
    assert.deepEqual(store.get(7), { id: 7, title: 'Existing issue', description: 'Keep this', status: 'open', priority: 'high', createdAt: '2026-01-01', updatedAt: '2026-01-01', labels: [] });
    assert.deepEqual(store.update(7, { labels: ['migrated'] })?.labels, ['migrated']);
  } finally { store.close(); }
  const reopened = new DatabaseSync(path);
  assert.equal((reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, DATABASE_SCHEMA_VERSION);
  reopened.close();
});

test('newer database versions are rejected without resetting their version', () => {
  const path = join(evidenceDirectory('labels-forward-version'), 'issues.sqlite');
  const database = new DatabaseSync(path);
  database.exec('PRAGMA user_version = 99');
  database.close();
  assert.throws(() => new IssueStore(path), /newer|version/i);
  const reopened = new DatabaseSync(path);
  assert.equal((reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 99);
  reopened.close();
});

test('label API writes and invalid requests preserve real database state', async () => {
  const store = new IssueStore(':memory:');
  const app = createApp(store, { instanceId: 'labels-api', version: 'test' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const api = `http://127.0.0.1:${address.port}/api/issues`;
  const send = (url: string, method: string, data: unknown) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  try {
    for (const labels of [[''], ['x'.repeat(21)], [5], Array.from({ length: 11 }, (_, index) => String(index))]) {
      assert.equal((await send(api, 'POST', { title: 'Rejected', labels })).status, 400);
      assert.deepEqual(store.list(), []);
    }
    const created = await send(api, 'POST', { title: 'Label API', labels: [' Bug '] });
    assert.equal(created.status, 201);
    const { issue } = await created.json();
    assert.deepEqual(issue.labels, ['bug']);
    assert.equal((await send(`${api}/${issue.id}`, 'PATCH', { labels: ['x'.repeat(21)] })).status, 400);
    assert.deepEqual(store.get(issue.id)?.labels, ['bug']);
    const updated = await send(`${api}/${issue.id}`, 'PATCH', { labels: ['backend'] });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).issue.labels, ['backend']);
    assert.deepEqual((await (await fetch(api)).json()).issues[0].labels, ['backend']);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); }
});
