import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../factory/process.ts';
import { inspectBrowserReport, inspectNodeReport, snapshot, writeJson } from '../factory/evidence.ts';
import { parseCiContract } from '../factory/ci-contract.ts';

if (process.env.UI_TEST_URL !== undefined) throw new Error('UI_TEST_URL is not supported; CI must test its owned frontend.');

const startedAt = new Date().toISOString();
const runId = `ci-${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const runDirectory = resolve(process.env.CI_VERIFY_RUN_DIR ?? resolve('.runs', runId));
mkdirSync(dirname(runDirectory), { recursive: true });
mkdirSync(runDirectory);
const summaryPath = resolve(runDirectory, 'ci-summary.json');
const contractPath = fileURLToPath(new URL('../factory/ci-verification-contract.json', import.meta.url));
const contractBytes = readFileSync(contractPath, 'utf8');
const before = snapshot(process.cwd());
const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
const diff = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', timeout: 5000 });
const summary = { schemaVersion: 1, profile: 'ci-critical', runId, startedAt, runDirectory, commit: head.status === 0 ? head.stdout.trim() : null, dirty: diff.status !== 0 || Boolean(diff.stdout.trim()), snapshot: before, contract: { profile: 'ci-critical', path: contractPath, hash: createHash('sha256').update(contractBytes).digest('hex') }, status: 'running', checks: [] };
const positive = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
};
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
writeJson(summaryPath, summary);
try {
  const stepTimeout = positive('VERIFY_STEP_TIMEOUT_MS', 180000);
  const deadline = Date.now() + positive('VERIFY_TOTAL_TIMEOUT_MS', 600000);
  const grace = positive('VERIFY_GRACE_MS', 6000);
  const concurrency = positive('NODE_TEST_CONCURRENCY', 6);
  const contract = parseCiContract(JSON.parse(contractBytes));
  summary.contract.selection = contract;
  for (const file of [...contract.nodeFiles, ...new Set(contract.requiredBrowserTests.map(item => `acceptance/${item.file}`))]) readFileSync(resolve(file));
  const nodeArgs = ['--import', 'tsx', '--test', `--test-concurrency=${concurrency}`, '--test-reporter=spec', `--test-reporter=${resolve('factory/node-reporter.mjs')}`, '--test-reporter-destination=stdout', `--test-reporter-destination=${resolve(runDirectory, 'node-results.jsonl')}`, ...contract.nodeFiles];
  const browserFiles = [...new Set(contract.requiredBrowserTests.map(item => `(?:^|/)${escape(item.file)}$`))];
  const browserTitles = `(?:^| )(?:${contract.requiredBrowserTests.map(item => escape(item.title)).join('|')})$`;
  const gates = [
    { name: 'lint', command: 'npm', args: ['run', 'lint'] },
    { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
    { name: 'test', command: process.execPath, args: nodeArgs },
    { name: 'build', command: 'npm', args: ['run', 'build'] },
    { name: 'test:e2e', command: process.execPath, args: [resolve('node_modules/@playwright/test/cli.js'), 'test', ...browserFiles, '--grep', browserTitles, '--retries=0', '--forbid-only'] },
  ];
  for (const gate of gates) {
    console.log(`\n[verify:ci / ci-critical] ${gate.name}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Total CI verification timeout exceeded.');
    const result = await runProcess({ command: gate.command, args: gate.args, cwd: process.cwd(), logPath: resolve(runDirectory, `${gate.name.replace(':', '-')}.log`), timeoutMs: Math.min(stepTimeout, remaining), graceMs: grace, signal: abort.signal, env: { ...process.env, RUN_DIR: runDirectory }, onOutput: text => process.stdout.write(text) });
    summary.checks.push({ name: gate.name, status: result.status, exitCode: result.exitCode ?? 1, signal: result.signal, durationMs: result.durationMs });
    writeJson(summaryPath, summary);
    if (result.status !== 'passed') throw new Error(`${gate.name}: ${result.status}${result.error ? `: ${result.error}` : ''}`);
    if (gate.name === 'test') summary.node = inspectNodeReport(resolve(runDirectory, 'node-results.jsonl'), contract.requiredNodeTests);
    if (gate.name === 'test:e2e') summary.browser = inspectBrowserReport(resolve(runDirectory, 'browser-results.json'), contract);
  }
  if (readFileSync(contractPath, 'utf8') !== contractBytes) throw new Error('CI verification contract changed during the run.');
  if (snapshot(process.cwd()).hash !== before.hash) throw new Error('Code snapshot changed during CI verification.');
  summary.status = 'passed';
} catch (error) {
  summary.status = 'failed';
  summary.error = error.message;
  console.error(error.message);
}
summary.completedAt = new Date().toISOString();
writeJson(summaryPath, summary);
mkdirSync('.runs', { recursive: true });
writeJson(resolve('.runs', 'ci-latest.json'), { profile: 'ci-critical', runId, summaryPath });
console.log(`\nCritical CI ${summary.status}: ${summaryPath}`);
if (summary.status !== 'passed') process.exitCode = 1;
