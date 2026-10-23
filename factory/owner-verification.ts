import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { assertTestInventory, digest } from './checkpoint.ts';
import { inspectBrowserReport, inspectNodeReport, parseVerificationContract, readJson, snapshot, writeJson } from './evidence.ts';
import { acquireExecutionLease } from './lease.ts';
import { assertOwnedGroupsQuiescent } from './ownership.ts';
import { runProcess } from './process.ts';
import { trustedVerifier } from './verifier.ts';
import { allocatePorts, git, processEnvironment } from './workspace.ts';
import { commitSnapshot } from './maintenance.ts';
import type { Verification } from './controller.ts';

type Check = { file: string; title: string };
type Coverage = { approved: boolean; findings: unknown[]; sourceHash: string; snapshot: ReturnType<typeof snapshot>; acceptedChecks: { path: string; hash: string }[]; checks?: Check[]; browserChecks?: Check[] };

function inventory(files: { path: string; hash: string }[]) {
  if (!Array.isArray(files) || files.some(file => !file || typeof file.path !== 'string' || !file.path || isAbsolute(file.path) || file.path.split('/').some(part => part === '..' || part === '.') || !/^[a-f0-9]{64}$/.test(file.hash)) || new Set(files.map(file => file.path)).size !== files.length) throw new Error('Coverage inventory is malformed.');
}

export async function verifyMaintenance(input: unknown, options: { signal?: AbortSignal } = {}) {
  const request = input as { schemaVersion: number; repository: string; runDirectory: string; coveragePath: string };
  if (!request || typeof request !== 'object' || request.schemaVersion !== 1 || Object.keys(request).some(key => !['schemaVersion', 'repository', 'runDirectory', 'coveragePath'].includes(key)) || ![request.repository, request.runDirectory, request.coveragePath].every(path => typeof path === 'string' && isAbsolute(path))) throw new Error('Invalid maintenance verification request.');
  const repository = realpathSync(request.repository);
  const directory = resolve(request.runDirectory);
  const coverageBytes = readFileSync(request.coveragePath);
  const coverage = JSON.parse(coverageBytes.toString()) as Coverage;
  if (coverage.approved !== true || !Array.isArray(coverage.findings) || coverage.findings.length || !coverage.snapshot || coverage.sourceHash !== coverage.snapshot.hash || coverage.sourceHash !== digest(JSON.stringify(coverage.snapshot.files))) throw new Error('Independent coverage approval is missing or not source-bound.');
  inventory(coverage.snapshot.files); inventory(coverage.acceptedChecks);
  if (coverage.acceptedChecks.some(file => !/^(tests|acceptance)\//.test(file.path))) throw new Error('Accepted coverage includes a non-test file.');
  assertTestInventory(coverage.snapshot.files, coverage.acceptedChecks);
  const candidate = snapshot(repository);
  assertTestInventory(candidate.files, coverage.acceptedChecks);
  const contract = parseVerificationContract(readJson(join(repository, 'factory/verification-contract.json')));
  for (const [checks, target, prefix] of [[coverage.checks ?? [], contract.requiredNodeTests, ''], [coverage.browserChecks ?? [], contract.requiredBrowserTests, 'acceptance/']] as const) {
    if (!Array.isArray(checks)) throw new Error('Coverage named checks are invalid.');
    for (const check of checks) {
      if (!check || !coverage.acceptedChecks.some(file => file.path === `${prefix}${check.file}`)) throw new Error('Named coverage must refer to an approved test file.');
      if (!target.some(item => item.file === check.file && item.title === check.title)) target.push(check);
    }
  }
  const effectiveContract = parseVerificationContract(contract);
  const release = acquireExecutionLease(join(repository, '.runs', 'owner-verification'), directory);
  const workspace = join(directory, 'workspace');
  const previousPath = join(repository, '.runs', 'owner-verification-state.json');
  let created = false;
  let ownedDirectory = false;
  try {
    if (existsSync(previousPath)) {
      const previous = readJson(previousPath) as { runDirectory: string };
      if (typeof previous.runDirectory !== 'string' || !isAbsolute(previous.runDirectory)) throw new Error('Invalid previous verification ownership.');
      assertOwnedGroupsQuiescent(previous.runDirectory);
    }
    mkdirSync(directory, { recursive: false }); ownedDirectory = true;
    writeJson(previousPath, { runDirectory: directory });
    const index = join(directory, 'source.index');
    const capture = (args: string[]) => execFileSync('git', args, { cwd: repository, env: { ...process.env, GIT_INDEX_FILE: index }, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 }).trim();
    capture(['read-tree', 'HEAD']); capture(['add', '-A', '--', '.']);
    const tree = capture(['write-tree']);
    if (snapshot(repository).hash !== candidate.hash || commitSnapshot(repository, tree).hash !== candidate.hash) throw new Error('Source changed while freezing maintenance verification.');
    copyFileSync(request.coveragePath, join(directory, 'coverage.json'));
    if (digest(readFileSync(join(directory, 'coverage.json'))) !== digest(coverageBytes)) throw new Error('Coverage changed while freezing verification.');
    git(repository, ['worktree', 'add', '--detach', workspace, 'HEAD']); created = true;
    git(workspace, ['read-tree', '--reset', '-u', tree]);
    symlinkSync(join(repository, 'node_modules'), join(workspace, 'node_modules'), 'dir');
    if (snapshot(workspace).hash !== candidate.hash) throw new Error('Frozen maintenance source does not match the candidate.');
    writeJson(join(directory, 'readiness.json'), { schemaVersion: 1, repository, sourceHash: candidate.hash, tree, coverageHash: digest(coverageBytes), acceptedChecks: coverage.acceptedChecks, readyAt: new Date().toISOString() });
    const verifier = trustedVerifier(join(directory, 'trusted'), effectiveContract);
    const [apiPort, uiPort] = await allocatePorts();
    const verificationDirectory = join(directory, 'verification');
    const result = await runProcess({ command: process.execPath, args: [verifier.command], cwd: workspace, env: processEnvironment({ API_PORT: apiPort, UI_PORT: uiPort, TEST_API_PORT: apiPort, TEST_UI_PORT: uiPort, DB_PATH: join(directory, 'verification.sqlite'), INSTANCE_ID: `owner-${Date.now()}`, VERIFY_RUN_DIR: verificationDirectory, VERIFY_CONTRACT_PATH: verifier.contractPath }), logPath: join(directory, 'verification.log'), timeoutMs: 610000, signal: options.signal });
    writeJson(join(directory, 'process.json'), result);
    const summary = readJson(join(verificationDirectory, 'summary.json')) as Verification;
    if (result.status !== 'passed' || result.settled !== true || summary.status !== 'passed') throw new Error(`Maintenance verification failed: ${summary.error ?? result.error ?? result.status}`);
    const node = inspectNodeReport(join(verificationDirectory, 'node-results.jsonl'), effectiveContract.requiredNodeTests);
    const browser = inspectBrowserReport(join(verificationDirectory, 'browser-results.json'), effectiveContract);
    if (result.status !== 'passed' || result.settled !== true || summary.status !== 'passed' || summary.snapshot.hash !== candidate.hash || summary.checks.length !== 5 || !['lint', 'typecheck', 'test', 'build', 'test:e2e'].every(name => summary.checks.some(check => check.name === name && check.status === 'passed')) || node.passed !== summary.node?.passed || browser.passed !== summary.browser?.passed || snapshot(workspace).hash !== candidate.hash) throw new Error('Maintenance requires complete passing machine evidence on frozen source.');
    const status = snapshot(repository).hash === candidate.hash && digest(readFileSync(request.coveragePath)) === digest(coverageBytes) ? 'passed' : 'stale';
    const outcome = { schemaVersion: 1, status, sourceHash: candidate.hash, runDirectory: directory, summaryPath: join(verificationDirectory, 'summary.json'), coverageHash: digest(coverageBytes) };
    writeJson(join(directory, 'owner-verification.json'), outcome);
    if (status === 'passed') copyFileSync(join(workspace, '.runs', 'latest.json'), join(repository, '.runs', 'latest.json'));
    return outcome;
  } catch (error) {
    if (ownedDirectory) writeJson(join(directory, 'owner-verification.json'), { status: 'blocked', reason: String(error) });
    throw error;
  } finally {
    try {
      if (created) {
        try { assertOwnedGroupsQuiescent(directory); git(repository, ['worktree', 'remove', '--force', workspace]); }
        catch (error) { writeJson(join(directory, 'cleanup-error.json'), { workspace, reason: String(error) }); }
      }
    } finally { release(); }
  }
}
