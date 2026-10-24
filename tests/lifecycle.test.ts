import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { availablePort, evidenceDirectory, run, signalGroup, stopOwned } from './helpers/subprocess.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeout = 10000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  assert.fail('Owned subprocess condition did not complete in time.');
}

test('subprocess runner closes inherited output and bounds resistant owned descendants', { timeout: 10000 }, async t => {
  for (const mode of ['natural', 'timeout']) {
    await t.test(mode, async () => {
      const directory = evidenceDirectory(`runner-${mode}`);
      const recordPath = join(directory, 'leader.json');
      const termAck = join(directory, 'term-ack');
      const logPath = join(directory, 'runner.log');
      const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
      const started = Date.now();
      const execution = run(process.execPath, [resolve('tests/fixtures/subprocess-leader.mjs')], {
        ...process.env, OWNED_LEADER_RECORD: recordPath, OWNED_LEADER_MODE: mode, OWNED_TERM_ACK: termAck,
      }, logPath, process.cwd(), { timeoutMs: 500, graceMs: 200 });
      let record: { leader: number; descendant: number; ready: boolean } | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await waitUntil(() => existsSync(recordPath), 1500);
        record = JSON.parse(readFileSync(recordPath, 'utf8'));
        assert.equal(record!.ready, true);
        const result = await Promise.race([execution, new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('Configured short subprocess timeout did not complete.')), 1500);
        })]);
        await waitUntil(() => !alive(record!.descendant), 500);
        assert.equal(alive(record!.leader), false);
        assert.equal(alive(unrelated.pid!), true, 'Runner cleanup touched an unrelated group.');
        assert.equal(existsSync(termAck), true, 'Resistant descendant never received graceful SIGTERM.');
        assert.match(result.output, /owned descendant survived SIGTERM/);
        assert.equal(readFileSync(logPath, 'utf8'), result.output, 'Output was written before inherited streams closed.');
        assert.equal(result.code, mode === 'natural' ? 17 : 0);
        assert.ok(Date.now() - started < 2500, 'Owned cleanup exceeded its configured bound.');
      } finally {
        if (deadline) clearTimeout(deadline);
        if (!record && existsSync(recordPath)) record = JSON.parse(readFileSync(recordPath, 'utf8'));
        if (record) signalGroup(record.leader, 'SIGKILL');
        await execution;
        await stopOwned(unrelated);
      }
    });
  }
});

test('dev cleans an exited owned leader group including surviving descendants', { timeout: 25000 }, async () => {
  const directory = evidenceDirectory('dev-exited-leader');
  const root = process.cwd();
  const watcher = join(directory, 'node_modules/tsx/dist');
  const vite = join(directory, 'node_modules/vite/bin');
  mkdirSync(watcher, { recursive: true }); mkdirSync(vite, { recursive: true });
  symlinkSync(resolve('tests/fixtures/exited-watcher.mjs'), join(watcher, 'cli.mjs'));
  symlinkSync(resolve('node_modules/vite/bin/vite.js'), join(vite, 'vite.js'));
  symlinkSync(resolve('vite.config.ts'), join(directory, 'vite.config.ts'));
  const apiPort = await availablePort();
  const uiPort = await availablePort();
  const recordPath = join(directory, 'leader.json');
  const databasePath = join(directory, 'issues.sqlite');
  const termAck = join(directory, 'stubborn-term-ack');
  const env = { ...process.env, API_PORT: apiPort, UI_PORT: uiPort, DB_PATH: databasePath, INSTANCE_ID: 'owned-exited-leader', OWNED_REPO_ROOT: root, OWNED_LEADER_RECORD: recordPath, OWNED_TERM_ACK: termAck };
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const supervisor = spawn(process.execPath, [resolve('scripts/dev.mjs')], { cwd: directory, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const supervisorExit = once(supervisor, 'exit');
  let output = '';
  supervisor.stdout.on('data', data => { output += String(data); });
  supervisor.stderr.on('data', data => { output += String(data); });
  let record: { leader: number; api: number; stubborn: number; stubbornReady: boolean } | undefined;
  try {
    await waitUntil(() => existsSync(recordPath));
    record = JSON.parse(readFileSync(recordPath, 'utf8'));
    assert.ok(record);
    assert.equal(record.stubbornReady, true, 'Watcher exited without its descendant readiness acknowledgement.');
    await waitUntil(() => !alive(record!.leader));
    await waitUntil(() => supervisor.exitCode !== null || supervisor.signalCode !== null);
    const [code] = await supervisorExit;
    assert.equal(code, 17);
    await delay(100);
    assert.equal(existsSync(databasePath + '.lock'), false, `Exited watcher left API lock (${directory})`);
    assert.equal(alive(record.api), false, `Owned API survived (${directory})`);
    assert.equal(alive(record.stubborn), false, `SIGTERM-resistant owned descendant survived (${directory})`);
    assert.equal(existsSync(termAck), true, 'Escalation did not exercise the installed SIGTERM handler.');
    assert.equal(alive(unrelated.pid!), true, 'Cleanup touched an unrelated process group.');
    await assert.rejects(fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(500) }));
    await assert.rejects(fetch(`http://127.0.0.1:${uiPort}`, { signal: AbortSignal.timeout(500) }));
  } finally {
    writeFileSync(join(directory, 'supervisor.log'), output);
    if (!record && existsSync(recordPath)) record = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (record) {
      signalGroup(record.leader, 'SIGTERM');
      await delay(200);
      signalGroup(record.leader, 'SIGKILL');
    }
    await stopOwned(supervisor);
    await stopOwned(unrelated);
  }
});
