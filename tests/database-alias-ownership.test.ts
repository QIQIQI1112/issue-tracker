import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { acquireDatabaseLock } from '../src/instance.ts';
import { runProcess } from '../factory/process.ts';
import { processEnvironment } from '../factory/workspace.ts';
import { availablePort, evidenceDirectory } from './helpers/subprocess.ts';

function databaseFixture(label: string) {
  const root = evidenceDirectory(label);
  const database = join(root, 'new', 'issues.sqlite');
  const store = new IssueStore(database);
  store.create({ title: 'Preserve the owned data', description: 'Disposable alias fixture.', status: 'open', priority: 'medium', labels: [] });
  const identity = store.path;
  store.close();
  const alias = join(root, 'alias.sqlite');
  symlinkSync(database, alias);
  return { root, database, alias, identity };
}

async function start(args: string[], env: NodeJS.ProcessEnv, logPath: string, event: string) {
  const cancellation = new AbortController();
  let output = '';
  let announce!: () => void;
  const readiness = new Promise<void>(resolve => { announce = resolve; });
  const execution = runProcess({ command: process.execPath, args, cwd: process.cwd(), env: processEnvironment(env), logPath, timeoutMs: 30000, signal: cancellation.signal, onOutput: text => { output += text; if (output.includes(`"event":"${event}"`)) announce(); } });
  const ready = await Promise.race([readiness.then(() => true), execution.then(() => false)]);
  return { ready, execution, stop: async () => { cancellation.abort(); const result = await execution; const owner = JSON.parse(readFileSync(`${logPath}.owner.json`, 'utf8')); assert.equal(owner.settled, true); for (const group of owner.groups) assert.throws(() => process.kill(-group, 0), { code: 'ESRCH' }); return result; } };
}

const aliasError = /alias|symlink|symbolic|unsupported|linked|locked/i;

test('hard-linked database files are rejected before store or lock admission without changing original data', () => {
  const { root, database } = databaseFixture('database-hardlink-alias');
  const alias = join(root, 'hardlink.sqlite');
  linkSync(database, alias);
  let opened: IssueStore | undefined;
  let storeError: unknown;
  let release: (() => void) | undefined;
  let lockError: unknown;
  try {
    try { opened = new IssueStore(alias); } catch (error) { storeError = error; }
    try { release = acquireDatabaseLock(alias, 'hardlink-contender'); } catch (error) { lockError = error; }
  } finally { opened?.close(); release?.(); unlinkSync(alias); }
  const original = new IssueStore(database);
  try { assert.deepEqual(original.list().map(issue => issue.title), ['Preserve the owned data']); }
  finally { original.close(); }
  assert.ok(storeError, 'A hardlink must not open a second storage identity for the same database.');
  assert.match(String(storeError), /hard.?link|linked|unsupported/i);
  assert.ok(lockError, 'A hardlink must not create an independent database owner lock.');
  assert.match(String(lockError), /hard.?link|linked|unsupported/i);
});

test('a database file alias cannot admit a second API owner or reset an owned database', { timeout: 45000 }, async () => {
  const { root, database, alias } = databaseFixture('database-api-alias');
  const port = await availablePort();
  const first = await start(['--import', 'tsx', 'src/server.ts'], { API_PORT: port, DB_PATH: database, FACTORY_REGISTER_SELF: '0' }, join(root, 'first-api.log'), 'ready');
  assert.equal(first.ready, true);
  let second: Awaited<ReturnType<typeof start>> | undefined;
  try {
    let aliasLockAdmitted = false;
    try { const release = acquireDatabaseLock(alias, 'alias-contender'); aliasLockAdmitted = true; release(); }
    catch (error) { assert.match(String(error), aliasError); }
    second = await start(['--import', 'tsx', 'src/server.ts'], { API_PORT: await availablePort(), DB_PATH: alias, FACTORY_REGISTER_SELF: '0' }, join(root, 'second-api.log'), 'ready');
    const contender = await second.stop();
    const reset = await runProcess({ command: process.execPath, args: ['--import', 'tsx', 'scripts/reset.ts', '--confirm'], cwd: process.cwd(), env: processEnvironment({ DB_PATH: alias }), logPath: join(root, 'reset.log'), timeoutMs: 10000 });
    const response = await fetch(`http://127.0.0.1:${port}/api/issues`, { signal: AbortSignal.timeout(5000) });
    assert.equal((await response.json()).issues[0].title, 'Preserve the owned data');
    assert.equal(aliasLockAdmitted, false, 'The same database file must not obtain a second API lock through a symlink.');
    assert.equal(second.ready, false, 'A second API process must refuse the alias before announcing readiness.');
    assert.match(contender.output, aliasError);
    assert.notEqual(reset.status, 'passed', 'Reset must refuse aliases while the real database is owned.');
    assert.match(reset.output, aliasError);
  } finally { await second?.stop(); await first.stop(); }
});

test('a database file alias cannot admit a second queue daemon or bypass its reset lock', { timeout: 45000 }, async () => {
  const { root, database, alias } = databaseFixture('database-queue-alias');
  const first = await start(['--import', 'tsx', 'factory/daemon.ts'], { DB_PATH: database }, join(root, 'first-queue.log'), 'queue-ready');
  assert.equal(first.ready, true);
  let second: Awaited<ReturnType<typeof start>> | undefined;
  try {
    second = await start(['--import', 'tsx', 'factory/daemon.ts'], { DB_PATH: alias }, join(root, 'second-queue.log'), 'queue-ready');
    const contender = await second.stop();
    const reset = await runProcess({ command: process.execPath, args: ['--import', 'tsx', 'scripts/reset.ts', '--confirm'], cwd: process.cwd(), env: processEnvironment({ DB_PATH: alias }), logPath: join(root, 'reset.log'), timeoutMs: 10000 });
    const store = new IssueStore(database);
    try { assert.equal(store.list()[0].title, 'Preserve the owned data'); } finally { store.close(); }
    assert.equal(second.ready, false, 'The database alias must not create an independent queue lease.');
    assert.match(contender.output, aliasError);
    assert.notEqual(reset.status, 'passed', 'Reset must respect the actual queue owner through a database alias.');
    assert.match(reset.output, aliasError);
  } finally { await second?.stop(); await first.stop(); }
});

test('store, server, doctor and intake share database identity or clearly reject unsupported file aliases', { timeout: 45000 }, async () => {
  const { root, database, alias, identity } = databaseFixture('database-alias-identity');
  let opened: IssueStore | undefined;
  let rejected: unknown;
  try { opened = new IssueStore(alias); }
  catch (error) { rejected = error; }
  const aliasIdentity = opened?.path;
  try { if (opened) assert.equal(opened.list()[0].title, 'Preserve the owned data'); } finally { opened?.close(); }
  const port = await availablePort();
  const api = await start(['--import', 'tsx', 'src/server.ts'], { API_PORT: port, DB_PATH: database, FACTORY_REGISTER_SELF: '0' }, join(root, 'api.log'), 'ready');
  assert.equal(api.ready, true);
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) })).json();
    assert.equal(health.databasePath, identity);
    for (const path of [database, alias]) {
      for (const tool of ['doctor', 'intake'] as const) {
        const args = tool === 'doctor' ? ['scripts/doctor.mjs'] : ['--import', 'tsx', 'scripts/submit-plan.ts', '--list', '--url', `http://127.0.0.1:${port}`, '--database', path];
        const result = await runProcess({ command: process.execPath, args, cwd: process.cwd(), env: processEnvironment({ DB_PATH: path, API_PORT: port }), logPath: join(root, `${tool}-${path === alias ? 'alias' : 'normal'}.log`), timeoutMs: 10000 });
        if (path === alias && result.status !== 'passed') assert.match(result.output, /alias|symlink|symbolic|unsupported|linked/i, 'Alias rejection must be explicit rather than a misleading running-instance mismatch.');
        else { assert.equal(result.status, 'passed', result.output); assert.equal(JSON.parse(result.output).databasePath, identity); }
      }
    }
    if (rejected) assert.match(String(rejected), /alias|symlink|symbolic|unsupported|linked/i);
    else assert.equal(aliasIdentity, identity, 'An admitted store alias must expose the same database identity as the normal store and server.');
  } finally { await api.stop(); }
});
