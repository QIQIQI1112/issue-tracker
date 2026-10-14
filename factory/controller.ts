import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan, parseTask, parseReview, parseWorkerReport, scoped } from './contracts.ts';
import type { Task, Plan, Review } from './contracts.ts';
import { parseVerificationContract, readJson, snapshot, writeJson } from './evidence.ts';
import { runProcess } from './process.ts';
import { allocatePorts, git, prepareWorkspace, processEnvironment, protectedPath } from './workspace.ts';
import { controllerDelivery } from './delivery.ts';
import { integrate } from './integration.ts';

export type Phase = 'plan' | 'tests' | 'acceptance-review' | 'implement' | 'repair' | 'review';
export type AgentInput = { phase: Phase; task: Task; plan?: Plan; cwd: string; attempt: number; feedback: string; directory: string; timeoutMs: number; signal: AbortSignal; env: NodeJS.ProcessEnv };
export type Agent = { run: (input: AgentInput) => Promise<unknown> };
export type Verification = { status: string; snapshot: { hash: string }; runDirectory: string; checks: { name: string; status: string; durationMs?: number }[]; node?: { passed: number }; browser?: { passed: number }; error?: string };
export type ControllerState = { schemaVersion: 1; taskId: string; runId: string; runDirectory: string; workspace: string; status: 'running' | 'ready' | 'merged' | 'blocked'; phase: string; startedAt: string; completedAt?: string; reason?: string; sourceHash?: string; baseCommit?: string; baselineTree?: string; plan?: Plan; redChecks: { file: string; title: string; status: string; logPath: string }[]; attempts: { id: string; number: number; verification?: Verification; review?: Review }[]; verification?: Verification; review?: Review; ports?: [string, string]; changes?: { path: string; status: string }[]; integration?: { branch: string; before: string; commit?: string; verification?: Verification; review?: Review } };

export async function runController(options: { repository: string; task: unknown; agent: Agent; baseRef?: string; evidenceRoot?: string; runId?: string; mergeTarget?: string; signal?: AbortSignal }): Promise<ControllerState> {
  const task = parseTask(options.task);
  const repository = resolve(options.repository);
  const runId = options.runId ?? `${task.id}-${randomUUID()}`;
  if (!/^[a-z0-9-]+$/.test(runId)) throw new Error('Invalid run ID.');
  const runDirectory = join(options.evidenceRoot ?? join(repository, '.data', 'evidence'), runId);
  mkdirSync(runDirectory, { recursive: true });
  const state: ControllerState = { schemaVersion: 1, taskId: task.id, runId, runDirectory, workspace: join(runDirectory, 'workspace'), status: 'running', phase: 'prepare', startedAt: new Date().toISOString(), redChecks: [], attempts: [] };
  const deadline = Date.now() + task.budget.totalTimeoutMs;
  const cancelled = new AbortController();
  const cancel = () => cancelled.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const save = () => writeJson(join(runDirectory, 'state.json'), state);
  save(); writeJson(join(runDirectory, 'task.json'), task);
  let counter = 0;
  let env: NodeJS.ProcessEnv = {};
  const remaining = () => {
    if (cancelled.signal.aborted) throw new Error('Controller cancelled.');
    const value = deadline - Date.now();
    if (value <= 0) throw new Error('Total task timeout exceeded.');
    return value;
  };
  const invoke = async (phase: Phase, attempt: number, feedback = '', cwd = state.workspace) => {
    state.phase = phase; save();
    const directory = join(runDirectory, `phase-${++counter}-${phase}`);
    mkdirSync(directory);
    const timeoutMs = Math.min(task.budget.workerTimeoutMs, remaining());
    const abort = new AbortController();
    const onCancel = () => abort.abort();
    cancelled.signal.addEventListener('abort', onCancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        options.agent.run({ phase, task, plan: state.plan, cwd, attempt, feedback, directory, timeoutMs, signal: abort.signal, env: { ...env, RUN_DIR: join(cwd, '.runs', 'worker-checks', `phase-${counter}`) } }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error(`Agent ${phase} timed out.`)); }, timeoutMs); abort.signal.addEventListener('abort', () => reject(new Error(`Agent ${phase} cancelled or timed out.`)), { once: true }); }),
      ]);
    } finally { if (timer) clearTimeout(timer); cancelled.signal.removeEventListener('abort', onCancel); }
  };
  try {
    if (options.mergeTarget && git(repository, ['status', '--porcelain']).trim()) throw new Error('Automatic execution requires a clean repository. Commit or preserve local changes first.');
    const workspace = prepareWorkspace(repository, runDirectory, options.baseRef ?? options.mergeTarget, !options.mergeTarget);
    state.workspace = workspace.path; state.baseCommit = workspace.baseCommit; state.baselineTree = workspace.baselineTree; state.sourceHash = workspace.sourceHash;
    state.ports = await allocatePorts();
    const [apiPort, uiPort] = state.ports;
    env = processEnvironment({ API_PORT: apiPort, UI_PORT: uiPort, TEST_API_PORT: apiPort, TEST_UI_PORT: uiPort, DB_PATH: join(runDirectory, 'worker.sqlite'), INSTANCE_ID: runId, FACTORY_TASK_ID: task.id });
    const baseline = snapshot(state.workspace);
    writeJson(join(runDirectory, 'baseline.json'), baseline);
    const baselinePaths = new Set(baseline.files.map(file => file.path));
    const protectedFiles = new Map(baseline.files.filter(file => protectedPath(file.path, baselinePaths)).map(file => [file.path, file.hash]));
    const originalChecks = new Map(baseline.files.filter(file => /^(tests|acceptance)\//.test(file.path)).map(file => [file.path, readFileSync(join(state.workspace, file.path))]));
    let checksFrozen = false;
    const enforce = (testOnly = false) => {
      const current = snapshot(state.workspace);
      const currentFiles = new Map(current.files.map(file => [file.path, file.hash]));
      const appended = new Set<string>();
      if (testOnly && !checksFrozen) for (const [path, original] of originalChecks) {
        if (currentFiles.get(path) === protectedFiles.get(path) || !currentFiles.has(path) || !scoped(path, task)) continue;
        const content = readFileSync(join(state.workspace, path));
        if (content.length > original.length && content.subarray(0, original.length).equals(original)) appended.add(path);
      }
      for (const [path, hash] of protectedFiles) if (currentFiles.get(path) !== hash && !appended.has(path)) throw new Error(`Protected contract file changed: ${path}`);
      const original = new Map(baseline.files.map(file => [file.path, file.hash]));
      for (const path of new Set([...original.keys(), ...currentFiles.keys()])) {
        if (original.get(path) === currentFiles.get(path)) continue;
        const acceptedExtension = checksFrozen && originalChecks.has(path) && currentFiles.get(path) === protectedFiles.get(path);
        if (!scoped(path, task) || protectedPath(path, baselinePaths) && !appended.has(path) && !acceptedExtension) throw new Error(`Change is outside the approved scope: ${path}`);
        if (testOnly && !/^(tests|acceptance)\//.test(path)) throw new Error(`Tests phase changed implementation: ${path}`);
      }
      return current;
    };
    const readonly = async (phase: 'plan' | 'acceptance-review' | 'review', attempt: number, feedback = '') => {
      const before = snapshot(state.workspace).hash;
      const value = await invoke(phase, attempt, feedback);
      if (snapshot(state.workspace).hash !== before) throw new Error(`Read-only ${phase} changed the code snapshot.`);
      return value;
    };
    state.plan = parsePlan(await readonly('plan', 0), task);
    writeJson(join(runDirectory, 'plan.json'), state.plan);
    const testReport = parseWorkerReport(await invoke('tests', 0), task);
    writeJson(join(runDirectory, 'test-report.json'), testReport);
    if (testReport.blockers.length) throw new Error(testReport.blockers.join('\n'));
    enforce(true);
    const acceptanceReview = parseReview(await readonly('acceptance-review', 0), task);
    writeJson(join(runDirectory, 'acceptance-review.json'), acceptanceReview);
    if (!acceptanceReview.approved) throw new Error(`Acceptance review rejected the checks: ${acceptanceReview.findings.join('\n')}`);
    const accepted = snapshot(state.workspace);
    for (const file of accepted.files.filter(file => /^(tests|acceptance)\//.test(file.path))) protectedFiles.set(file.path, file.hash);
    checksFrozen = true;
    writeJson(join(runDirectory, 'accepted-checks.json'), [...protectedFiles].map(([path, hash]) => ({ path, hash })));
    const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const trustedRoot = join(runDirectory, 'trusted');
    for (const path of ['scripts/verify.mjs', 'factory/process.ts', 'factory/evidence.ts', 'factory/node-reporter.mjs']) {
      const to = join(trustedRoot, path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(engineRoot, path), to);
    }
    writeJson(join(trustedRoot, 'package.json'), { type: 'module' });
    const contract = parseVerificationContract(readJson(join(options.mergeTarget ? state.workspace : repository, 'factory/verification-contract.json')));
    for (const check of state.plan.browserChecks) if (!contract.requiredBrowserTests.some(item => item.file === check.file && item.title === check.title)) contract.requiredBrowserTests.push(check);
    for (const check of state.plan.slices.flatMap(slice => slice.checks)) if (!contract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) contract.requiredNodeTests.push(check);
    const contractPath = join(trustedRoot, 'factory/verification-contract.json');
    writeJson(contractPath, contract);
    state.phase = 'red-checks'; save();
    for (const check of state.plan.slices.flatMap(slice => slice.checks)) {
      const logPath = join(runDirectory, `red-${state.redChecks.length}.log`);
      const reportPath = join(runDirectory, `red-${state.redChecks.length}.jsonl`);
      const escaped = check.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const result = await runProcess({ command: process.execPath, args: ['--import', 'tsx', '--test', `--test-name-pattern=^${escaped}$`, `--test-reporter=${join(trustedRoot, 'factory/node-reporter.mjs')}`, `--test-reporter-destination=${reportPath}`, check.file], cwd: state.workspace, env, logPath, timeoutMs: Math.min(30000, remaining()), signal: cancelled.signal });
      enforce(true);
      const records = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const isAssertion = (error: Record<string, unknown> | undefined): boolean => Boolean(error && (error.name === 'AssertionError' || error.code === 'ERR_ASSERTION' || isAssertion(error.cause as Record<string, unknown> | undefined)));
      const failed = records.some(event => event.type === 'test:fail' && event.data.name === check.title && isAssertion(event.data.details?.error));
      const passed = records.some(event => event.type === 'test:pass' && event.data.name === check.title && !event.data.skip && !event.data.todo);
      if (result.status === 'passed' && passed) state.redChecks.push({ ...check, status: 'already_passed', logPath });
      else if (result.status === 'failed' && failed) state.redChecks.push({ ...check, status: 'expected_failure', logPath });
      else throw new Error(`Red check did not establish a named behavior assertion: ${check.file}#${check.title}`);
      save();
    }
    let feedback = '';
    const alreadySatisfied = state.redChecks.every(check => check.status === 'already_passed');
    for (let number = 1; number <= task.budget.maxAttempts; number += 1) {
      const attempt = { id: `${runId}-${number}`, number } as ControllerState['attempts'][number];
      state.attempts.push(attempt); save();
      if (!alreadySatisfied || number > 1) {
        const report = parseWorkerReport(await invoke(number === 1 ? 'implement' : 'repair', number, feedback), task);
        writeJson(join(runDirectory, `worker-${number}.json`), report);
        if (report.blockers.length) throw new Error(report.blockers.join('\n'));
      }
      enforce();
      state.phase = 'verify'; save();
      const verificationDirectory = join(runDirectory, `verification-${number}`);
      const execution = await runProcess({ command: process.execPath, args: [join(trustedRoot, 'scripts/verify.mjs')], cwd: state.workspace, env: { ...env, FACTORY_ATTEMPT_ID: attempt.id, VERIFY_RUN_DIR: verificationDirectory, VERIFY_CONTRACT_PATH: contractPath, VERIFY_TOTAL_TIMEOUT_MS: String(remaining()), VERIFY_STEP_TIMEOUT_MS: String(Math.min(180000, remaining())), VERIFY_GRACE_MS: '1000' }, logPath: join(runDirectory, `verification-${number}.log`), timeoutMs: remaining() + 3000, signal: cancelled.signal });
      enforce();
      attempt.verification = readJson(join(verificationDirectory, 'summary.json')) as Verification;
      state.verification = attempt.verification; save();
      if (execution.status !== 'passed' || attempt.verification.status !== 'passed') { feedback = `Independent verification failed. ${attempt.verification.error ?? execution.status}\n${execution.output}`; continue; }
      if (attempt.verification.snapshot.hash !== snapshot(state.workspace).hash) throw new Error('Code changed after independent verification.');
      attempt.review = parseReview(await readonly('review', number, JSON.stringify({ baselineTree: state.baselineTree, verification: attempt.verification, evidenceDirectory: verificationDirectory })), task);
      state.review = attempt.review; save();
      if (!attempt.review.approved) { feedback = `Independent review rejected the candidate: ${attempt.review.findings.join('\n')}`; continue; }
      if (attempt.verification.snapshot.hash !== snapshot(state.workspace).hash) throw new Error('Code changed after review.');
      const presentFiles = snapshot(state.workspace).files.filter(file => {
        try { lstatSync(join(state.workspace, file.path)); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      }).map(file => file.path);
      if (presentFiles.length) git(state.workspace, ['add', '-N', '--', ...presentFiles]);
      writeFileSync(join(runDirectory, 'patch.diff'), git(state.workspace, ['diff', '--binary', workspace.baselineTree, '--']));
      state.changes = git(state.workspace, ['diff', '--name-status', workspace.baselineTree, '--']).trim().split('\n').filter(Boolean).map(line => { const [status, ...paths] = line.split('\t'); return { status, path: paths.at(-1)! }; });
      state.status = 'ready'; state.phase = 'ready'; break;
    }
    if (state.status !== 'ready') throw new Error(`Attempt budget exhausted. ${feedback}`);
    if (options.mergeTarget) {
      state.phase = 'integrate'; save();
      const receipt = await integrate({ repository, branch: options.mergeTarget, patchPath: join(runDirectory, 'patch.diff'), runDirectory, runId, validate: async (cwd, before, attempt) => {
        state.integration = { branch: options.mergeTarget!, before }; save();
        const latestContract = parseVerificationContract(readJson(join(cwd, 'factory/verification-contract.json')));
        for (const check of contract.requiredBrowserTests) if (!latestContract.requiredBrowserTests.some(item => item.file === check.file && item.title === check.title)) latestContract.requiredBrowserTests.push(check);
        for (const check of contract.requiredNodeTests) if (!latestContract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) latestContract.requiredNodeTests.push(check);
        const integrationContract = join(trustedRoot, `integration-contract-${attempt}.json`); writeJson(integrationContract, latestContract);
        const directory = join(runDirectory, `integration-verification-${attempt}`);
        const execution = await runProcess({ command: process.execPath, args: [join(trustedRoot, 'scripts/verify.mjs')], cwd, env: { ...env, VERIFY_RUN_DIR: directory, VERIFY_CONTRACT_PATH: integrationContract, VERIFY_TOTAL_TIMEOUT_MS: String(remaining()), VERIFY_STEP_TIMEOUT_MS: String(Math.min(180000, remaining())), VERIFY_GRACE_MS: '1000' }, logPath: join(runDirectory, `integration-verification-${attempt}.log`), timeoutMs: remaining() + 3000, signal: cancelled.signal });
        state.integration.verification = readJson(join(directory, 'summary.json')) as Verification; save();
        if (execution.status !== 'passed' || state.integration.verification.status !== 'passed' || snapshot(cwd).hash !== state.integration.verification.snapshot.hash) throw new Error('Integrated candidate failed independent verification.');
        const hash = snapshot(cwd).hash;
        state.integration.review = parseReview(await invoke('review', state.attempts.length, JSON.stringify({ baselineTree: git(cwd, ['rev-parse', `${before}^{tree}`]).trim(), verification: state.integration.verification, integratedCandidate: true }), cwd), task); save();
        if (!state.integration.review.approved || snapshot(cwd).hash !== hash) throw new Error('Integrated candidate was rejected or changed during independent review.');
      } });
      state.integration = { ...state.integration!, ...receipt }; state.status = 'merged'; state.phase = 'merged';
    }
  } catch (error) {
    state.status = 'blocked'; state.phase = 'blocked'; state.reason = error instanceof Error ? error.message : String(error);
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    options.signal?.removeEventListener('abort', cancel);
    state.completedAt = new Date().toISOString(); save();
    controllerDelivery(state, task);
  }
  return state;
}
