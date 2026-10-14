import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/api.ts';
import { IssueStore } from '../src/storage.ts';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { saveDelivery } from '../factory/delivery.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('requirements retain repo ownership and duplicate starts do not duplicate queued work', async () => {
  const store = new IssueStore(':memory:');
  const server = createApp(store, { instanceId: 'workbench-test', version: 'test' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const response = await post('/repos', { name: 'Issue tracker', path: process.cwd(), targetBranch: 'main' });
    assert.equal(response.status, 201, 'Repository enrollment must be available.');
    const { repo } = await response.json();
    const created = await post('/requirements', { repoId: repo.id, title: 'Useful reports', goal: 'Show what changed and the real verification results.' });
    assert.equal(created.status, 201);
    const { requirement } = await created.json();
    assert.equal(requirement.repoId, repo.id);
    assert.equal((await post(`/requirements/${requirement.id}/start`, {})).status, 202);
    assert.equal((await post(`/requirements/${requirement.id}/start`, {})).status, 409);
    const workbench = await (await fetch(base + '/workbench')).json();
    assert.equal(workbench.jobs.length, 1);
    assert.equal(workbench.jobs[0].kind, 'decompose');
    assert.equal(workbench.jobs[0].status, 'queued');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    store.close();
  }
});

test('manifest evidence downloads from hidden storage and rejects tampering and path escape', async () => {
  const root = evidenceDirectory('evidence-api');
  const store = new IssueStore(join(root, 'state.sqlite'));
  const repo = store.work.addRepo({ name: 'Fixture', path: '/fixture', targetBranch: 'main' });
  const issue = store.create({ title: 'Evidence', description: 'Evidence behavior.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Evidence is readable.'] } });
  store.work.startIssue(issue.id);
  const claimed = store.work.claim(join(root, '.data/evidence'))!;
  mkdirSync(claimed.run.evidencePath, { recursive: true });
  const file = join(claimed.run.evidencePath, 'patch.diff');
  writeFileSync(file, 'Reviewable patch.');
  saveDelivery(claimed.run.evidencePath, { schemaVersion: 1, runId: claimed.run.id, taskId: 'evidence', title: 'Evidence', goal: 'Readable evidence.', status: 'blocked', startedAt: claimed.run.startedAt, completedAt: new Date().toISOString(), baseline: null, sourceHash: null, defaults: [], changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 0, review: null, integration: null, limitations: ['Fixture evidence.'] });
  store.work.finish(claimed.run.id, 'blocked');
  const server = createApp(store, { instanceId: 'evidence', version: 'test' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/runs/${claimed.run.id}/evidence?file=`;
  try {
    const response = await fetch(url + 'patch.diff');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition')!, /patch\.diff/);
    assert.equal(await response.text(), 'Reviewable patch.');
    assert.equal((await fetch(url + encodeURIComponent('../state.sqlite'))).status, 400);
    writeFileSync(file, 'Changed evidence.');
    assert.equal((await fetch(url + 'patch.diff')).status, 409);
    const outside = join(root, 'outside.diff'); writeFileSync(outside, 'Reviewable patch.');
    unlinkSync(file); symlinkSync(outside, file);
    assert.equal((await fetch(url + 'patch.diff')).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); }
});
