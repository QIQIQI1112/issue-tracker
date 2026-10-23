import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runProcess } from '../factory/process.ts';
import { inspectBrowserReport, inspectNodeReport, parseVerificationContract, snapshot } from '../factory/evidence.ts';
import { git, processEnvironment } from '../factory/workspace.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

function reviewedCoverage(repository: string) {
  const source = snapshot(repository);
  return { schemaVersion: 1, approved: true, summary: 'Independent coverage approval of the retained complete test inventory.', findings: [] as string[], sourceHash: source.hash, snapshot: source, acceptedChecks: source.files.filter(file => /^(tests|acceptance)\//.test(file.path)) };
}

async function verificationApi(root: string, repository: string) {
  const request = { schemaVersion: 1, repository, runDirectory: join(root, 'invalid-cli-run'), coveragePath: join(root, 'missing-coverage.json') };
  const path = join(root, 'invalid-request.json');
  writeFileSync(path, JSON.stringify(request));
  const result = await runProcess({ command: process.execPath, args: ['--import', 'tsx', resolve('factory/cli.ts'), 'verify-maintenance', path], cwd: process.cwd(), env: processEnvironment({}), logPath: join(root, 'invalid-cli.log'), timeoutMs: 15000 });
  assert.notEqual(result.status, 'passed');
  assert.match(result.output, /coverage/i, 'The existing factory CLI must reject missing independent coverage before invoking maintenance verification.');
  return await import('../factory/' + 'owner-verification.ts');
}

async function denied(action: () => Promise<unknown>) {
  try {
    const result = await action() as { status: string };
    assert.ok(['blocked', 'stale', 'rejected'].includes(result.status), 'Unapproved or concurrently owned verification must fail closed.');
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
  }
}

function waitForFile(directory: string, path: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); watcher.close(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('Fixture gate wait cancelled.')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Bounded fixture gate did not signal: ${path}`)); }, 30000);
    const ready = () => { if (!existsSync(path)) return; cleanup(); resolve(); };
    const watcher = watch(directory, ready);
    signal.addEventListener('abort', abort, { once: true });
    ready();
  });
}

test('maintenance verification requires approved source-bound complete test inventory before any gate executes', { timeout: 30000 }, async () => {
  const root = evidenceDirectory('maintenance-coverage');
  const repository = fixtureRepository(join(root, 'repo'));
  const marker = join(root, 'verifier-started');
  const pkg = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  const gate = join(root, 'unexpected-gate.mjs');
  writeFileSync(gate, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'started');\n`);
  pkg.scripts.lint = `node ${JSON.stringify(gate)}`;
  writeFileSync(join(repository, 'package.json'), JSON.stringify(pkg));
  const api = await verificationApi(root, repository);
  const approved = reviewedCoverage(repository);
  const variants = [
    { ...approved, approved: false },
    { ...approved, findings: ['An actionable coverage gap remains.'] },
    { ...approved, sourceHash: '0'.repeat(64) },
    { ...approved, snapshot: undefined },
    { ...approved, acceptedChecks: approved.acceptedChecks.slice(1) },
    { ...approved, acceptedChecks: approved.acceptedChecks.map((file, index) => index ? file : { ...file, hash: '0'.repeat(64) }) },
  ];
  for (const [index, coverage] of variants.entries()) {
    const coveragePath = join(root, `coverage-${index}.json`);
    writeFileSync(coveragePath, JSON.stringify(coverage));
    await denied(() => api.verifyMaintenance({ schemaVersion: 1, repository, runDirectory: join(root, `rejected-${index}`), coveragePath }));
    assert.equal(existsSync(marker), false, 'Rejected coverage must not launch even the first lint gate.');
  }
});

test('maintenance verification freezes source, rejects concurrent checkout runs, and cannot authorize later edits', { timeout: 90000 }, async () => {
  const root = evidenceDirectory('maintenance-frozen');
  const repository = fixtureRepository(join(root, 'repo'));
  const signaled = join(root, 'gate-started.json');
  const release = join(root, 'gate-release');
  const gate = join(root, 'paused-gate.mjs');
  writeFileSync(gate, `import {existsSync,readFileSync,watch,writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(signaled)},JSON.stringify({cwd:process.cwd(),source:readFileSync('src/value.ts','utf8'),api:process.env.API_PORT,ui:process.env.UI_PORT,database:process.env.DB_PATH}));\nif(!existsSync(${JSON.stringify(release)}))await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{watcher.close();reject(new Error('Paused fixture deadline exceeded.'));},30000);const ready=()=>{if(existsSync(${JSON.stringify(release)})){clearTimeout(timer);watcher.close();resolve();}};const watcher=watch(${JSON.stringify(root)},ready);ready();});\n`);
  const pkg = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  pkg.scripts.lint = `node ${JSON.stringify(gate)}`;
  writeFileSync(join(repository, 'package.json'), JSON.stringify(pkg));
  git(repository, ['add', 'package.json']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Install deterministic fixture gate']);
  const coverage = reviewedCoverage(repository);
  const coveragePath = join(root, 'approved-coverage.json');
  writeFileSync(coveragePath, JSON.stringify(coverage));
  writeFileSync(join(repository, 'src/value.ts'), "export const value = 'ready';\n");
  const candidate = snapshot(repository);
  const api = await verificationApi(root, repository);
  const runDirectory = join(root, 'verification-run');
  const waiting = new AbortController();
  const gateReady = waitForFile(root, signaled, waiting.signal);
  const verification = api.verifyMaintenance({ schemaVersion: 1, repository, runDirectory, coveragePath });
  let gateObserved = false;
  try {
    await Promise.race([gateReady, verification.then(() => { if (!gateObserved) throw new Error('Verification returned before executing the frozen fixture gate.'); })]);
    gateObserved = true;
    const observed = JSON.parse(readFileSync(signaled, 'utf8'));
    assert.notEqual(observed.cwd, repository);
    assert.equal(observed.source, "export const value = 'ready';\n");
    assert.ok(Number(observed.api) > 0 && Number(observed.ui) > 0);
    assert.notEqual(observed.api, observed.ui);
    assert.ok(observed.database && observed.database.startsWith(runDirectory));
    await denied(() => api.verifyMaintenance({ schemaVersion: 1, repository, runDirectory: join(root, 'concurrent-run'), coveragePath }));
    writeFileSync(join(repository, 'src/value.ts'), "export const value = 'edited after the freeze';\n");
  } finally { writeFileSync(release, 'continue'); waiting.abort(); }
  const result = await verification;
  assert.equal(result.status, 'stale', 'Passing frozen evidence cannot authorize a changed source checkout.');
  const summary = JSON.parse(readFileSync(join(runDirectory, 'verification', 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'passed');
  assert.equal(summary.snapshot.hash, candidate.hash);
  assert.equal(summary.checks.length, 5);
  assert.ok(summary.checks.every((check: { status: string }) => check.status === 'passed'));
  assert.equal(inspectNodeReport(join(summary.runDirectory, 'node-results.jsonl')).passed, 1);
  assert.equal(inspectBrowserReport(join(summary.runDirectory, 'browser-results.json'), parseVerificationContract(JSON.parse(readFileSync(join(repository, 'factory/verification-contract.json'), 'utf8')))).required, 1);
  assert.equal(readFileSync(join(repository, 'src/value.ts'), 'utf8'), "export const value = 'edited after the freeze';\n");
  assert.ok(existsSync(join(runDirectory, 'owner-verification.json')));
  assert.ok(existsSync(join(runDirectory, 'readiness.json')));
  const owner = JSON.parse(readFileSync(join(runDirectory, 'owner-verification.json'), 'utf8'));
  assert.equal(owner.status, 'stale');
});
