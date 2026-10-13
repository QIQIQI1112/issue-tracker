import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Owned browser coordination did not complete: ${path}`);
}

test('browser writes reject replacement APIs with colliding numeric IDs', { timeout: 100000 }, async t => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    await t.test(method, async () => {
      const directory = evidenceDirectory(`browser-replacement-${method.toLowerCase()}`);
      const uiPort = await availablePort();
      const original = await ownedAPI(directory, 'owned-browser-original', join(directory, 'original.sqlite'), '', 'Owned browser sentinel', uiPort);
      const configPath = join(directory, 'replacement.config.ts');
      const ready = join(directory, 'mutation-ready.json');
      const replaced = join(directory, 'replacement-ready');
      const observed = join(directory, 'mutation-response.json');
      const restored = join(directory, 'original-restored');
      writeFileSync(configPath, `import original from ${JSON.stringify(resolve('playwright.config.ts'))};\nexport default { ...original, testDir: ${JSON.stringify(resolve('tests/fixtures'))}, testMatch: 'browser-target.spec.ts', webServer: [{ ...original.webServer[1], cwd: ${JSON.stringify(process.cwd())}, url: 'http://127.0.0.1:${uiPort}', env: { API_PORT: '${original.port}', UI_PORT: '${uiPort}' } }], projects: original.projects.map(project => ({ ...project, metadata: { instanceId: 'owned-browser-original', databasePath: ${JSON.stringify(original.databasePath)} }, use: { ...original.use, ...project.use, baseURL: 'http://127.0.0.1:${uiPort}' } })) };\n`);
      const env: NodeJS.ProcessEnv = { ...process.env, RUN_DIR: directory, OWNED_MUTATION: method, OWNED_SWAP_READY: ready, OWNED_SWAP_DONE: replaced, OWNED_SWAP_OBSERVED: observed, OWNED_SWAP_RESTORED: restored };
      delete env.UI_TEST_URL;
      const execution = run('npm', ['run', 'test:e2e', '--', '--config', configPath], env, join(directory, 'playwright.log'));
      let replacement: Awaited<ReturnType<typeof ownedAPI>> | undefined;
      let restarted: Awaited<ReturnType<typeof ownedAPI>> | undefined;
      try {
        await waitForFile(ready);
        await original.stop();
        replacement = await ownedAPI(directory, 'owned-browser-replacement', join(directory, 'replacement.sqlite'), original.port, 'Unrelated colliding sentinel', uiPort);
        assert.equal(replacement.issue.id, original.issue.id, 'Replacement must exercise a numeric ID collision.');
        const before = snapshot(replacement.databasePath);
        writeFileSync(replaced, 'ready');
        await waitForFile(observed);
        const after = snapshot(replacement.databasePath);
        writeFileSync(join(directory, 'database-snapshots.json'), JSON.stringify({ before, after }, null, 2));
        await replacement.stop();
        restarted = await ownedAPI(directory, 'owned-browser-original', original.databasePath, original.port, 'Owned browser sentinel', uiPort);
        writeFileSync(restored, 'ready');
        const result = await execution;
        assert.deepEqual(after, before, `${method} changed the replacement database (${directory})`);
        const mutation = JSON.parse(readFileSync(observed, 'utf8'));
        assert.equal(mutation.status, 409, `Browser mutation accepted a replacement (${directory})`);
        assert.equal(result.code, 0, `Browser guard check failed (${directory}): ${result.output}`);
      } finally {
        writeFileSync(replaced, 'release'); writeFileSync(restored, 'release');
        await execution;
        if (replacement) await replacement.stop();
        if (restarted) await restarted.stop();
        await original.stop();
      }
    });
  }
});

test('UI fixture cleanup refuses a real replacement API without touching its database', { timeout: 100000 }, async () => {
  const directory = evidenceDirectory('ui-cleanup-mismatch');
  const original = await ownedAPI(directory, 'owned-original', join(directory, 'original.sqlite'));
  const configPath = join(directory, 'cleanup.config.ts');
  const ready = join(directory, 'fixture-ready.json');
  const done = join(directory, 'replacement-ready');
  writeFileSync(configPath, `import original from ${JSON.stringify(resolve('playwright.config.ts'))};\nexport default { ...original, testDir: ${JSON.stringify(resolve('tests/fixtures'))}, testMatch: 'cleanup-target.spec.ts', webServer: [], projects: original.projects.map(project => ({ ...project, metadata: { instanceId: 'owned-original', databasePath: ${JSON.stringify(original.databasePath)} }, use: { ...original.use, ...project.use, baseURL: ${JSON.stringify(original.url)} } })) };\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, RUN_DIR: directory, OWNED_SWAP_READY: ready, OWNED_SWAP_DONE: done };
  delete env.UI_TEST_URL;
  const execution = run('npm', ['run', 'test:e2e', '--', '--config', configPath], env, join(directory, 'playwright.log'));
  let replacement: Awaited<ReturnType<typeof ownedAPI>> | undefined;
  try {
    for (let attempt = 0; attempt < 200 && !existsSync(ready); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(existsSync(ready), true, `Fixture did not start (${directory})`);
    const { prefix } = JSON.parse(readFileSync(ready, 'utf8')) as { prefix: string };
    await original.stop();
    replacement = await ownedAPI(directory, 'owned-replacement', join(directory, 'replacement.sqlite'), original.port, `${prefix} Replacement sentinel`);
    const before = snapshot(replacement.databasePath);
    writeFileSync(done, 'ready');
    const result = await execution;
    const after = snapshot(replacement.databasePath);
    writeFileSync(join(directory, 'database-snapshots.json'), JSON.stringify({ before, after }, null, 2));
    assert.notEqual(result.code, 0, `Cleanup accepted a replacement target (${directory}): ${result.output}`);
    assert.match(result.output, /Owned UI target identity mismatch/);
    assert.deepEqual(after, before, `Cleanup changed the replacement database (${directory})`);
  } finally {
    writeFileSync(done, 'release');
    await execution;
    if (replacement) await replacement.stop();
    await original.stop();
  }
});

test('UI fixtures refuse mismatched instance or database identity before writing', { timeout: 100000 }, async t => {
  for (const mismatch of ['instance', 'database']) {
    await t.test(mismatch, async () => {
      const directory = evidenceDirectory(`ui-${mismatch}-mismatch`);
      const wrong = await ownedAPI(directory);
      const before = snapshot(wrong.databasePath);
      const expectedInstanceId = mismatch === 'instance' ? 'owned-expected-instance' : 'owned-wrong-target';
      const expectedDatabasePath = mismatch === 'database' ? join(directory, 'expected.sqlite') : wrong.databasePath;
      const configPath = join(directory, 'mismatch.config.ts');
      writeFileSync(configPath, `import original from ${JSON.stringify(resolve('playwright.config.ts'))};\nexport default { ...original, testDir: ${JSON.stringify(resolve('acceptance'))}, webServer: [], projects: original.projects.map(project => ({ ...project, metadata: { instanceId: ${JSON.stringify(expectedInstanceId)}, databasePath: ${JSON.stringify(expectedDatabasePath)} }, use: { ...original.use, ...project.use, baseURL: ${JSON.stringify(wrong.url)} } })) };\n`);
      try {
        const env: NodeJS.ProcessEnv = { ...process.env, RUN_DIR: directory };
        delete env.UI_TEST_URL;
        const result = await run('npm', ['run', 'test:e2e', '--', '--config', configPath, 'ui.spec.ts', '--grep', 'title and description search'], env, join(directory, 'playwright.log'));
        const after = snapshot(wrong.databasePath);
        writeFileSync(join(directory, 'database-snapshots.json'), JSON.stringify({ before, after }, null, 2));
        assert.notEqual(result.code, 0, `Mismatched ${mismatch} was accepted (${directory}): ${result.output}`);
        assert.match(result.output, /Owned UI target identity mismatch/);
        assert.deepEqual(after, before, `Wrong-target database changed (${directory})`);
      } finally { await wrong.stop(); }
    });
  }
});

test('standalone UI tests reject an override without mutating its owned wrong-target database', { timeout: 100000 }, async () => {
  const directory = evidenceDirectory('ui-override');
  const wrong = await ownedAPI(directory);
  const before = snapshot(wrong.databasePath);
  try {
    const env = { ...process.env, RUN_DIR: directory, TEST_API_PORT: await availablePort(), TEST_UI_PORT: await availablePort(), UI_TEST_URL: wrong.url };
    const result = await run('npm', ['run', 'test:e2e', '--', 'acceptance/ui.spec.ts', '--grep', 'title and description search'], env, join(directory, 'playwright.log'));
    assert.notEqual(result.code, 0, `UI override was accepted (${directory}): ${result.output}`);
    assert.match(result.output, /UI_TEST_URL.*not supported/i);
    assert.deepEqual(snapshot(wrong.databasePath), before);
  } finally { await wrong.stop(); }
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
