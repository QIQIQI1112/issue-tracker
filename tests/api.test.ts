import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { IssueStore } from '../src/storage.ts';

async function instance(databasePath = ':memory:') {
  const module = await import('../src/api.ts').catch(() => null);
  assert.ok(module, 'HTTP API is not implemented yet');
  const store = new IssueStore(databasePath);
  const app = module.createApp(store, { instanceId: 'api-test', version: '0.1.0' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { store, base: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close(); } };
}

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('conditional writes reject mismatched identities before changing records or sequence', async () => {
  const app = await instance(join(evidenceDirectory('api-conditional'), 'issues.sqlite'));
  const database = new DatabaseSync(app.store.path, { readOnly: true });
  const snapshot = () => ({
    issues: database.prepare('SELECT * FROM issues ORDER BY id').all(),
    sequence: database.prepare('SELECT * FROM sqlite_sequence').all(),
  });
  const target = (instanceId: string, path: string) => encodeURIComponent(JSON.stringify([instanceId, path]));
  try {
    const seed = await fetch(`${app.base}/api/issues`, json('POST', { title: 'Manual sentinel' }));
    const { issue } = await seed.json();
    const before = snapshot();
    for (const expected of [target('other-instance', app.store.path), target('api-test', app.store.path + '.other'), '', 'malformed']) {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const url = `${app.base}/api/issues${method === 'POST' ? '' : `/${issue.id}`}`;
        const options = json(method, { title: 'Wrong-target write' });
        const response = await fetch(url, { ...options, headers: { ...options.headers, 'x-issue-tracker-target': expected } });
        assert.deepEqual(snapshot(), before, `${method} changed the mismatched target`);
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /target identity mismatch/i);
      }
    }
    // Matching conditional writes work; unguarded manual CRUD remains covered above.
    const headers = { 'content-type': 'application/json', 'x-issue-tracker-target': target('api-test', app.store.path) };
    const created = await fetch(`${app.base}/api/issues`, { ...json('POST', { title: 'Conditional issue' }), headers });
    assert.equal(created.status, 201);
    const { issue: conditional } = await created.json();
    assert.equal((await fetch(`${app.base}/api/issues/${conditional.id}`, { ...json('PATCH', { title: 'Conditional edit' }), headers })).status, 200);
    assert.equal(app.store.get(conditional.id)?.title, 'Conditional edit');
    assert.equal((await fetch(`${app.base}/api/issues/${conditional.id}`, { method: 'DELETE', headers })).status, 204);
    assert.equal(app.store.get(conditional.id), undefined);
  } finally { database.close(); await app.close(); }
});

test('API creates, lists, updates, and deletes actual SQLite records', async () => {
  const app = await instance();
  try {
    const response = await fetch(`${app.base}/api/issues`, json('POST', { title: 'API issue' }));
    assert.equal(response.status, 201);
    const { issue } = await response.json();
    assert.equal(issue.title, 'API issue');
    assert.equal(issue.status, 'open');
    const listing = await (await fetch(`${app.base}/api/issues`)).json();
    assert.equal(listing.issues[0].id, issue.id);
    const patch = await fetch(`${app.base}/api/issues/${issue.id}`, json('PATCH', { title: 'Renamed', status: 'done' }));
    assert.equal(patch.status, 200);
    assert.equal(app.store.get(issue.id)?.title, 'Renamed');
    assert.equal((await fetch(`${app.base}/api/issues/${issue.id}`, { method: 'DELETE' })).status, 204);
    assert.equal(app.store.list().length, 0);
  } finally { await app.close(); }
});

test('API validates IDs and bodies without writing invalid records', async () => {
  const app = await instance();
  try {
    const invalid = await fetch(`${app.base}/api/issues`, json('POST', { title: ' ' }));
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Title/);
    for (const id of ['NaN', '1.5', '-1', '9007199254740993']) {
      const response = await fetch(`${app.base}/api/issues/${id}`, json('PATCH', { title: 'Valid' }));
      assert.equal(response.status, 400);
    }
    assert.equal((await fetch(`${app.base}/api/issues/999`, { method: 'DELETE' })).status, 404);
    const malformed = await fetch(`${app.base}/api/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid' });
    assert.equal(malformed.status, 400);
    assert.equal(app.store.list().length, 0);
  } finally { await app.close(); }
});

test('oversized JSON returns 413 without writing a SQLite record', async () => {
  const app = await instance();
  try {
    const response = await fetch(`${app.base}/api/issues`, json('POST', { title: 'Too large', description: 'x'.repeat(65 * 1024) }));
    assert.equal(response.status, 413);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.match((await response.json()).error, /too large/i);
    assert.deepEqual(app.store.list(), []);
    assert.deepEqual((await (await fetch(`${app.base}/api/issues`)).json()).issues, []);
  } finally { await app.close(); }
});

test('health identifies the app and cross-origin mutations are refused', async () => {
  const app = await instance();
  try {
    const health = await (await fetch(`${app.base}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.instanceId, 'api-test');
    assert.equal(health.databasePath, ':memory:');
    const options = json('POST', { title: 'Unwanted' });
    const response = await fetch(`${app.base}/api/issues`, { ...options, headers: { ...options.headers, origin: 'https://untrusted.example' } });
    assert.equal(response.status, 403);
    assert.equal(app.store.list().length, 0);
  } finally { await app.close(); }
});
