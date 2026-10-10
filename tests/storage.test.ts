import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCreateIssue } from '../src/domain.ts';

async function storage() {
  const module = await import('../src/storage.ts').catch(() => null);
  assert.ok(module, 'SQLite issue storage is not implemented yet');
  return module;
}

test('SQLite persists created issues across a close and reopen', async () => {
  const { IssueStore } = await storage();
  const directory = mkdtempSync(join(tmpdir(), 'issue-store-'));
  try {
    const path = join(directory, 'issues.sqlite');
    const first = new IssueStore(path);
    const issue = first.create(parseCreateIssue({ title: 'Persistent issue' }));
    assert.equal(issue.id, 1);
    assert.equal(issue.title, 'Persistent issue');
    first.close();
    const second = new IssueStore(path);
    assert.deepEqual(second.get(issue.id), issue);
    assert.equal(second.list().length, 1);
    second.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('updates preserve omitted fields and deletion is observable', async () => {
  const { IssueStore } = await storage();
  const store = new IssueStore(':memory:');
  try {
    const created = store.create(parseCreateIssue({ title: 'Before', description: 'Keep this', priority: 'high' }));
    const updated = store.update(created.id, { title: 'After', status: 'done' });
    assert.ok(updated);
    assert.equal(updated.title, 'After');
    assert.equal(updated.status, 'done');
    assert.equal(updated.description, 'Keep this');
    assert.equal(updated.priority, 'high');
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(store.delete(created.id), true);
    assert.equal(store.get(created.id), undefined);
    assert.deepEqual(store.list(), []);
    assert.equal(store.delete(created.id), false);
    assert.equal(store.update(created.id, { title: 'Missing' }), undefined);
  } finally { store.close(); }
});

test('titles with SQL and HTML syntax are stored literally', async () => {
  const { IssueStore } = await storage();
  const store = new IssueStore(':memory:');
  try {
    const title = "<script>alert(1)</script> '); DROP TABLE issues;--";
    const issue = store.create(parseCreateIssue({ title }));
    assert.equal(store.get(issue.id)?.title, title);
    assert.equal(store.create(parseCreateIssue({ title: 'Still here' })).id, 2);
  } finally { store.close(); }
});
