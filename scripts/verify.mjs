import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { runProcess } from '../factory/process.ts';
import { inspectBrowserReport, inspectNodeReport, parseVerificationContract, snapshot, writeJson } from '../factory/evidence.ts';

if (process.env.UI_TEST_URL !== undefined) {
  throw new Error('UI_TEST_URL is not supported during verification; Playwright must test its owned frontend.');
}

const startedAt = new Date().toISOString();
const runId = `verify-${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const runDirectory = resolve(process.env.VERIFY_RUN_DIR ?? resolve('.runs', runId));
mkdirSync(dirname(runDirectory), { recursive: true });
mkdirSync(runDirectory);
const positive = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
};
const stepTimeout = positive('VERIFY_STEP_TIMEOUT_MS', 180000);
const totalTimeout = positive('VERIFY_TOTAL_TIMEOUT_MS', 600000);
const grace = positive('VERIFY_GRACE_MS', 6000);
const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
const diff = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', timeout: 5000 });
const before = snapshot(process.cwd());
const contractPath = resolve(process.env.VERIFY_CONTRACT_PATH ?? new URL('../factory/verification-contract.json', import.meta.url).pathname);
const contractBytes = readFileSync(contractPath, 'utf8');
const summary = { schemaVersion: 2, runId, taskId: process.env.FACTORY_TASK_ID ?? null, attemptId: process.env.FACTORY_ATTEMPT_ID ?? null, startedAt, runDirectory, commit: head.status === 0 ? head.stdout.trim() : null, dirty: diff.status !== 0 || Boolean(diff.stdout.trim()), snapshot: before, contractPath, status: 'running', checks: [] };
const deadline = Date.now() + totalTimeout;
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
writeJson(resolve(runDirectory, 'summary.json'), summary);
try {
  const contract = parseVerificationContract(JSON.parse(contractBytes));
  for (const script of ['lint', 'typecheck', 'test', 'build', 'test:e2e']) {
    console.log(`\n[verify] ${script}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Total verification timeout exceeded.');
    const result = await runProcess({ command: 'npm', args: ['run', script], cwd: process.cwd(), logPath: resolve(runDirectory, `${script.replace(':', '-')}.log`), timeoutMs: Math.min(stepTimeout, remaining), graceMs: grace, signal: abort.signal, env: { ...process.env, RUN_DIR: runDirectory }, onOutput: text => process.stdout.write(text) });
    summary.checks.push({ name: script, status: result.status, exitCode: result.exitCode ?? 1, signal: result.signal, durationMs: result.durationMs });
    writeJson(resolve(runDirectory, 'summary.json'), summary);
    if (result.status !== 'passed') throw new Error(`${script}: ${result.status}${result.error ? `: ${result.error}` : ''}`);
    if (script === 'test') summary.node = inspectNodeReport(resolve(runDirectory, 'node-results.jsonl'), contract.requiredNodeTests);
    if (script === 'test:e2e') summary.browser = inspectBrowserReport(resolve(runDirectory, 'browser-results.json'), contract);
  }
  if (readFileSync(contractPath, 'utf8') !== contractBytes) throw new Error('Verification contract changed during the run.');
  if (snapshot(process.cwd()).hash !== before.hash) throw new Error('Code snapshot changed during verification.');
  summary.status = 'passed';
} catch (error) {
  summary.status = 'failed';
  summary.error = error.message;
  console.error(error.message);
}
summary.completedAt = new Date().toISOString();
writeJson(resolve(runDirectory, 'summary.json'), summary);
mkdirSync('.runs', { recursive: true });
writeJson(resolve('.runs', 'latest.json'), { runId, summaryPath: resolve(runDirectory, 'summary.json') });
console.log(`\nVerification ${summary.status}: ${runDirectory}/summary.json`);
if (summary.status !== 'passed') process.exitCode = 1;
