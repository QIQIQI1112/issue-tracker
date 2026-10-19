import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evidenceDirectory } from './helpers/subprocess.ts';

for (const mode of ['transient-EPERM', 'persistent-EPERM', 'persistent-EIO']) {
  test(`${mode} group probes return a structured result and a consistent ownership receipt`, () => {
    const directory = evidenceDirectory('process-probe');
    const logPath = join(directory, 'child.log');
    const fixture = join(directory, 'probe.mjs');
    writeFileSync(fixture, `
import { readFileSync, existsSync } from 'node:fs';
import { runProcess } from ${JSON.stringify(resolve('factory/process.ts'))};
import { assertOwnedGroupsQuiescent } from ${JSON.stringify(resolve('factory/ownership.ts'))};
const logPath = ${JSON.stringify(logPath)};
const original = process.kill;
let probes = 0;
process.kill = function(pid, signal) {
  const owned = existsSync(logPath + '.owner.json') ? JSON.parse(readFileSync(logPath + '.owner.json', 'utf8')).pid : null;
  if (pid === -owned && signal === 0) {
    probes += 1;
    if (${JSON.stringify(mode)} !== 'transient-EPERM' || probes === 1) {
      const error = new Error('Injected owned-group probe failure');
      error.code = ${JSON.stringify(mode.endsWith('EIO') ? 'EIO' : 'EPERM')};
      throw error;
    }
  }
  return original.call(process, pid, signal);
};
const result = await runProcess({ command: process.execPath, args: ['-e', ''], cwd: ${JSON.stringify(directory)}, logPath, timeoutMs: 5000, graceMs: 100 });
const owner = JSON.parse(readFileSync(logPath + '.owner.json', 'utf8'));
let recoveryBlocked = false;
try { assertOwnedGroupsQuiescent(${JSON.stringify(directory)}); } catch { recoveryBlocked = true; }
process.kill = original;
console.log(JSON.stringify({ result, owner, probes, recoveryBlocked }));
`);
    const child = spawnSync(process.execPath, ['--import', 'tsx', fixture], { encoding: 'utf8', timeout: 10000 });
    writeFileSync(join(directory, 'fixture.log'), child.stdout + child.stderr);
    assert.equal(child.status, 0, `The process runner must finalize without an uncaught probe exception: ${child.stderr}`);
    const { result, owner, probes, recoveryBlocked } = JSON.parse(child.stdout.trim());
    assert.ok(probes >= 2);
    if (mode === 'transient-EPERM') {
      assert.equal(result.status, 'passed');
      assert.equal(owner.settled, true);
      assert.equal(recoveryBlocked, false);
    } else {
      assert.equal(result.status, 'failed');
      assert.match(result.error, /probe|inspect/i);
      assert.equal(owner.settled, false);
      assert.equal(recoveryBlocked, true);
    }
    assert.ok(owner.probeErrors.some((error: string) => error.includes(mode.endsWith('EIO') ? 'EIO' : 'EPERM')));
    assert.equal(JSON.parse(readFileSync(`${logPath}.owner.json`, 'utf8')).settled, owner.settled);
  });
}
