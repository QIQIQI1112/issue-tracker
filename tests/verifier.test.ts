import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evidenceDirectory, run } from './helpers/subprocess.ts';

const root = process.cwd();
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function fixture(mode: 'skipped' | 'missing' | 'omitted' | 'timeout' | 'changed' | 'valid') {
  const directory = evidenceDirectory(`verifier-${mode}`);
  mkdirSync(join(directory, 'specs'));
  writeFileSync(join(directory, '.gitignore'), '.runs/\n');
  writeFileSync(join(directory, 'source.txt'), 'original\n');
  writeFileSync(join(directory, 'gate.mjs'), `import { writeFileSync } from 'node:fs';\nconst phase = process.argv[2];\nif (phase === 'test') writeFileSync(process.env.RUN_DIR + '/node-results.jsonl', JSON.stringify({ type: 'test:summary', data: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } }) + '\\n');\nif (${JSON.stringify(mode)} === 'changed' && phase === 'build') writeFileSync('source.txt', 'changed\\n');\nif (${JSON.stringify(mode)} === 'timeout' && phase === 'lint') { process.on('SIGTERM', () => {}); writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000); }\n`);
  const gate = (phase: string) => `node gate.mjs ${phase}`;
  const playwright = `node ${quote(resolve('node_modules/@playwright/test/cli.js'))} test --config playwright.config.mjs`;
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { lint: gate('lint'), typecheck: gate('typecheck'), test: gate('test'), build: gate('build'), 'test:e2e': mode === 'missing' ? gate('browser') : playwright } }));
  writeFileSync(join(directory, 'playwright.config.mjs'), `import { defineConfig } from ${JSON.stringify(resolve('node_modules/@playwright/test/index.mjs'))};\nexport default defineConfig({ testDir: './specs', workers: 1, reporter: [['json', { outputFile: process.env.RUN_DIR + '/browser-results.json' }]] });\n`);
  writeFileSync(join(directory, 'specs', 'probe.spec.mjs'), `import { test } from ${JSON.stringify(resolve('node_modules/@playwright/test/index.mjs'))};\ntest${mode === 'skipped' ? '.skip' : ''}('required behavior', () => {});\n`);
  const contractPath = join(directory, 'contract.json');
  writeFileSync(contractPath, JSON.stringify({ schemaVersion: 1, requiredBrowserTests: [{ file: 'probe.spec.mjs', title: 'required behavior' }, ...(mode === 'omitted' ? [{ file: 'probe.spec.mjs', title: 'missing required behavior' }] : [])] }));
  const env = { ...process.env, VERIFY_RUN_DIR: join(directory, '.runs', 'verification'), VERIFY_CONTRACT_PATH: contractPath, VERIFY_STEP_TIMEOUT_MS: mode === 'timeout' ? '350' : '15000', VERIFY_TOTAL_TIMEOUT_MS: '30000', VERIFY_GRACE_MS: '100' };
  delete (env as NodeJS.ProcessEnv).UI_TEST_URL;
  const result = await run(process.execPath, [resolve(root, 'scripts/verify.mjs')], env, join(directory, 'execution.log'), directory, { timeoutMs: mode === 'timeout' ? 2500 : 35000, graceMs: 150 });
  let summaryPath: string;
  try { summaryPath = JSON.parse(readFileSync(join(directory, '.runs/latest.json'), 'utf8')).summaryPath; }
  catch { summaryPath = join(directory, '.runs', readFileSync(join(directory, 'execution.log'), 'utf8').match(/verify-[\w.-]+/)?.[0] ?? 'missing', 'summary.json'); }
  let summary: { status: string; checks: { status?: string }[]; error?: string } | undefined;
  try { summary = JSON.parse(readFileSync(summaryPath, 'utf8')); } catch { summary = undefined; }
  return { directory, result, summary };
}

for (const mode of ['skipped', 'missing', 'omitted'] as const) {
  test(`verification refuses ${mode} acceptance evidence`, async () => {
    const { directory, result, summary } = await fixture(mode);
    assert.equal(result.code, 1, `Incomplete acceptance was accepted (${directory}): ${result.output}`);
    assert.equal(summary?.status, 'failed');
    assert.match(summary?.error ?? '', mode === 'skipped' ? /skip/i : mode === 'missing' ? /report|ENOENT/i : /missing|required/i);
  });
}

test('verification times out and stops its resistant owned child', async () => {
  const { directory, result, summary } = await fixture('timeout');
  assert.equal(result.code, 1, `Verifier did not terminate itself (${directory})`);
  assert.equal(summary?.status, 'failed');
  assert.equal(summary?.checks[0].status, 'timeout');
  const pid = Number(readFileSync(join(directory, 'child.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('verification rejects code changed while checks run', async () => {
  const { directory, result, summary } = await fixture('changed');
  assert.equal(result.code, 1, `Changed source was accepted (${directory})`);
  assert.match(summary?.error ?? '', /snapshot|changed/i);
});

test('verification accepts complete evidence for unchanged code', async () => {
  const { directory, result, summary } = await fixture('valid');
  assert.equal(result.code, 0, `Valid evidence was refused (${directory}): ${result.output}`);
  assert.equal(summary?.status, 'passed');
});
