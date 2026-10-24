import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory, run } from './helpers/subprocess.ts';

async function fixture(mode: 'timeout' | 'changed') {
  const directory = fixtureRepository(evidenceDirectory(`verifier-${mode}`));
  writeFileSync(join(directory, 'src/value.ts'), "export const value = 'ready';\n");
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  writeFileSync(join(directory, 'gate.mjs'), `import {writeFileSync} from 'node:fs';\nif (${JSON.stringify(mode)} === 'changed') writeFileSync('src/value.ts', 'export const value = "changed";\\n');\nelse {process.on('SIGTERM',()=>{});writeFileSync('child.pid',String(process.pid));setInterval(()=>{},1000);}\n`);
  pkg.scripts[mode === 'timeout' ? 'lint' : 'build'] = 'node gate.mjs';
  writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg));
  const result = await run(process.execPath, [resolve('scripts/verify.mjs')], { ...process.env, VERIFY_RUN_DIR: join(directory, '.runs/verification'), VERIFY_CONTRACT_PATH: join(directory, 'factory/verification-contract.json'), VERIFY_STEP_TIMEOUT_MS: mode === 'timeout' ? '350' : '15000', VERIFY_TOTAL_TIMEOUT_MS: '30000', VERIFY_GRACE_MS: '100' }, join(directory, '.runs/execution.log'), directory, { timeoutMs: mode === 'timeout' ? 2500 : 35000, graceMs: 150 });
  const summary = JSON.parse(readFileSync(join(directory, '.runs/verification/summary.json'), 'utf8'));
  return { directory, result, summary };
}

test('verification times out and stops its resistant owned child', async () => {
  const { directory, result, summary } = await fixture('timeout');
  assert.equal(result.code, 1);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.checks[0].status, 'timeout');
  const pid = Number(readFileSync(join(directory, 'child.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('verification rejects code changed while checks run', async () => {
  const { result, summary } = await fixture('changed');
  assert.equal(result.code, 1);
  assert.match(summary.error, /snapshot|changed/i);
});
