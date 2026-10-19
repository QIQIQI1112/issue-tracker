import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../factory/process.ts';
import { assertRunQuiescent } from '../factory/ownership.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('recovery refuses a live owned group and proceeds only after owned cancellation settles', async () => {
  const root = evidenceDirectory('owned-resume');
  const logPath = join(root, 'worker.log');
  const cancellation = new AbortController();
  let observed = false;
  const result = await runProcess({ command: process.execPath, args: ['-e', "console.log('owned-ready');setInterval(()=>{},1000)"], cwd: root, logPath, timeoutMs: 10000, signal: cancellation.signal, onOutput: text => {
    if (!text.includes('owned-ready')) return;
    const owner = JSON.parse(readFileSync(`${logPath}.owner.json`, 'utf8'));
    assert.ok(owner.pid > 0 && owner.identity);
    assert.throws(() => assertRunQuiescent(root), /still present/);
    observed = true; cancellation.abort();
  } });
  assert.equal(observed, true);
  assert.equal(result.status, 'cancelled');
  assertRunQuiescent(root);
  assert.equal(JSON.parse(readFileSync(`${logPath}.owner.json`, 'utf8')).settled, true);
});

test('a detached recorded descendant blocks recovery after the original group exits', async () => {
  const { spawnSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const root = evidenceDirectory('detached-receipt');
  const group = Number(spawnSync('ps', ['-p', String(process.pid), '-o', 'pgid='], { encoding: 'utf8' }).stdout.trim());
  assert.ok(Number.isSafeInteger(group) && group > 0);
  writeFileSync(join(root, 'worker.log.owner.json'), JSON.stringify({ pid: 2147483647, identity: 'Exited original leader', settled: false, groups: [2147483647, group] }));
  assert.throws(() => assertRunQuiescent(root), /still present/);
});

test('a blocked intermediate retry cannot hide an unresolved older owned group', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const root = evidenceDirectory('ownership-lineage');
  const group = Number(spawnSync('ps', ['-p', String(process.pid), '-o', 'pgid='], { encoding: 'utf8' }).stdout.trim());
  const first = join(root, 'first'); const second = join(root, 'second'); const third = join(root, 'third');
  for (const directory of [first, second, third]) mkdirSync(directory);
  writeFileSync(join(first, 'worker.log.owner.json'), JSON.stringify({ pid: group, settled: false, groups: [group] }));
  writeFileSync(join(second, 'resume-parent.json'), JSON.stringify({ directory: first }));
  writeFileSync(join(third, 'resume-parent.json'), JSON.stringify({ directory: second }));
  assert.throws(() => assertRunQuiescent(third), /still present/);
});
