import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';
import { availablePort, evidenceDirectory, run, stopOwned } from './helpers/subprocess.ts';

async function ownedAPI(directory: string, instanceId = 'owned-wrong-target', databasePath = join(directory, 'wrong-target.sqlite'), port = '', title = 'Owned wrong-target sentinel', uiPort = process.env.UI_PORT ?? '5173') {
  port ||= await availablePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, API_PORT: port, UI_PORT: uiPort, DB_PATH: databasePath, INSTANCE_ID: instanceId },
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += String(data); });
  child.stderr.on('data', data => { output += String(data); });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned wrong-target API exited: ${output}`);
      try {
        const health = await (await fetch(`${url}/api/health`)).json();
        if (health.instanceId === instanceId && health.databasePath === databasePath) {
          const response = await fetch(`${url}/api/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
          assert.equal(response.status, 201);
          const { issue } = await response.json() as { issue: { id: number } };
          return { child, url, port, databasePath, issue, stop: async () => { await stopOwned(child); writeFileSync(join(directory, `${instanceId}-api.log`), output); } };
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Owned wrong-target API did not start: ${output}`);
  } catch (error) { await stopOwned(child); throw error; }
}

function snapshot(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return { issues: database.prepare('SELECT * FROM issues ORDER BY id').all(), sequence: database.prepare('SELECT * FROM sqlite_sequence').all() };
  } finally { database.close(); }
}

test('pinned HTTP mutations reject replacement APIs with colliding numeric IDs', { timeout: 30000 }, async t => {
  for (const method of ['POST', 'PATCH', 'DELETE']) await t.test(method, async () => {
    const directory = evidenceDirectory(`http-replacement-${method.toLowerCase()}`);
    const original = await ownedAPI(directory, 'owned-original', join(directory, 'original.sqlite'));
    const pinned = targetIdentity('owned-original', original.databasePath);
    await original.stop();
    const replacement = await ownedAPI(directory, 'owned-replacement', join(directory, 'replacement.sqlite'), original.port, 'Unrelated colliding sentinel');
    try {
      assert.equal(replacement.issue.id, original.issue.id);
      const before = snapshot(replacement.databasePath);
      const response = await fetch(`${replacement.url}/api/issues${method === 'POST' ? '' : `/${original.issue.id}`}`, { method, headers: { 'content-type': 'application/json', [targetHeader]: pinned }, ...(method === 'DELETE' ? {} : { body: JSON.stringify({ title: 'Must never be written' }) }) });
      assert.equal(response.status, 409);
      assert.deepEqual(snapshot(replacement.databasePath), before);
    } finally { await replacement.stop(); }
  });
});

test('HTTP cleanup rejects mismatched instance or database identity without touching a real target', { timeout: 15000 }, async t => {
  const directory = evidenceDirectory('http-cleanup-mismatch');
  const api = await ownedAPI(directory);
  try {
    for (const mismatch of ['instance', 'database']) await t.test(mismatch, async () => {
      const before = snapshot(api.databasePath);
      const pinned = targetIdentity(mismatch === 'instance' ? 'unrelated-instance' : 'owned-wrong-target', mismatch === 'database' ? join(directory, 'unrelated.sqlite') : api.databasePath);
      const response = await fetch(`${api.url}/api/issues/${api.issue.id}`, { method: 'DELETE', headers: { [targetHeader]: pinned } });
      assert.equal(response.status, 409);
      assert.deepEqual(snapshot(api.databasePath), before);
    });
  } finally { await api.stop(); }
});

test('verification rejects inherited UI_TEST_URL before gates without touching an owned wrong-target database', { timeout: 15000 }, async () => {
  const directory = evidenceDirectory('verify-override');
  const wrong = await ownedAPI(directory);
  const before = snapshot(wrong.databasePath);
  try {
    const result = await run(process.execPath, [resolve('scripts/verify.mjs')], { ...process.env, UI_TEST_URL: wrong.url, PATH: '', RUN_DIR: directory }, join(directory, 'verify.log'), directory);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /UI_TEST_URL.*not supported/i);
    assert.doesNotMatch(result.output, /\[verify\] lint/);
    assert.deepEqual(snapshot(wrong.databasePath), before);
  } finally { await wrong.stop(); }
});
