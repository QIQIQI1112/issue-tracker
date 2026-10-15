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
import { digest, environmentIdentity, loadCheckpoint, restoreCheckpoint, saveCheckpoint } from './checkpoint.ts';
import { assertRunQuiescent, processIdentity } from './ownership.ts';
import { executionBudget } from './budget.ts';
import type { Delivery } from '../src/workflow.ts';
import { integrate } from './integration.ts';

export type Phase = 'plan' | 'tests' | 'acceptance-review' | 'implement' | 'repair' | 'review';
export type AgentInput = { phase: Phase; task: Task; plan?: Plan; cwd: string; attempt: number; feedback: string; directory: string; timeoutMs: number; signal: AbortSignal; env: NodeJS.ProcessEnv };
export type Agent = { run: (input: AgentInput) => Promise<unknown> };
export type Verification = { status: string; snapshot: { hash: string }; runDirectory: string; checks: { name: string; status: string; durationMs?: number }[]; node?: { passed: number }; browser?: { passed: number }; error?: string };
class IntegrationRejected extends Error {}

export type ControllerState = { schemaVersion: 1; taskId: string; runId: string; phases?: Delivery['phases']; reviewReceipts?: Delivery['reviewReceipts']; failedPhase?: string; failureKind?: 'integrity' | 'timeout' | 'cancelled' | 'budget' | 'ownership' | 'verification' | 'review' | 'worker'; cleanupSafe?: boolean; budget?: { usedMs: number; implementationAttempts: number; acceptanceAttempts: number; maxAttempts: number; totalTimeoutMs: number }; resume?: { fromRunId?: string; reused: boolean; reason: string }; runDirectory: string; workspace: string; status: 'running' | 'ready' | 'merged' | 'blocked'; phase: string; startedAt: string; completedAt?: string; reason?: string; sourceHash?: string; baseCommit?: string; baselineTree?: string; plan?: Plan; redChecks: { file: string; title: string; status: string; logPath: string; reportPath?: string }[]; attempts: { id: string; number: number; verification?: Verification; review?: Review }[]; verification?: Verification; review?: Review; ports?: [string, string]; changes?: { path: string; status: string }[]; integration?: { branch: string; before: string; commit?: string; verification?: Verification; review?: Review } };

export async function runController(options: { repository: string; task: unknown; agent: Agent; baseRef?: string; evidenceRoot?: string; runId?: string; mergeTarget?: string; signal?: AbortSignal; resumeFrom?: string; budgetKey?: string }): Promise<ControllerState> {
  const task = parseTask(options.task);
  const repository = resolve(options.repository);
  const runId = options.runId ?? `${task.id}-${randomUUID()}`;
  if (!/^[a-z0-9-]+$/.test(runId)) throw new Error('Invalid run ID.');
  const runDirectory = join(options.evidenceRoot ?? join(repository, '.data', 'evidence'), runId);
  mkdirSync(runDirectory, { recursive: true });
  const state: ControllerState = { schemaVersion: 1, taskId: task.id, runId, runDirectory, workspace: join(runDirectory, 'workspace'), status: 'running', phase: 'prepare', startedAt: new Date().toISOString(), redChecks: [], attempts: [], phases: [], reviewReceipts: [] };
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let budget: ReturnType<typeof executionBudget> | undefined;
  let checkpoint: (() => void) | undefined;
  let settled = true;
  const cancelled = new AbortController();
  const cancel = () => cancelled.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const save = () => {
    const now = new Date().toISOString();
    const last = state.phases!.at(-1);
    if (last && (last.name !== state.phase || state.completedAt)) {
      last.completedAt ??= now;
      last.durationMs = Date.parse(last.completedAt) - Date.parse(last.startedAt);
      if (last.status === 'running') last.status = state.status === 'blocked' ? 'failed' : 'passed';
    }
    if (!state.completedAt && (!last || last.name !== state.phase)) state.phases!.push({ name: state.phase, startedAt: now, durationMs: 0, status: 'running' });
    writeJson(join(runDirectory, 'state.json'), state);
  };
  save(); writeJson(join(runDirectory, 'task.json'), task);
  let counter = 0;
  let env: NodeJS.ProcessEnv = {};
  const remaining = () => {
    if (cancelled.signal.aborted) throw new Error('Controller cancelled.');
    const value = budget?.remaining() ?? 0;
    if (value <= 0) throw new Error('Total task timeout exceeded.');
    return value;
  };
  const invoke = async (phase: Phase, attempt: number, feedback = '', cwd = state.workspace) => {
    state.phase = phase; save();
    const directory = join(runDirectory, `phase-${++counter}-${phase}`);
    mkdirSync(directory);
    const timeoutMs = Math.min(task.budget.workerTimeoutMs, remaining());
    budget!.phase(timeoutMs);
    const abort = new AbortController();
    const onCancel = () => abort.abort();
    cancelled.signal.addEventListener('abort', onCancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const work = options.agent.run({ phase, task, plan: state.plan, cwd, attempt, feedback, directory, timeoutMs, signal: abort.signal, env: { ...env, RUN_DIR: join(cwd, '.runs', 'worker-checks', `phase-${counter}`) } }).finally(() => { finished = true; });
    work.catch(() => {});
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error(`Agent ${phase} timed out.`)); }, timeoutMs); abort.signal.addEventListener('abort', () => reject(new Error(`Agent ${phase} cancelled or timed out.`)), { once: true }); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      cancelled.signal.removeEventListener('abort', onCancel);
      if (!finished) {
        abort.abort();
        await Promise.race([work.catch(() => {}), new Promise(done => setTimeout(done, 2500))]);
        if (!finished) { settled = false; state.cleanupSafe = false; }
      }
      budget!.phase(0);
    }
  };
  try {
    budget = executionBudget(options.evidenceRoot ?? join(repository, '.data', 'evidence'), options.budgetKey ?? `${repository}:${task.id}`, task, runId);
    remaining();
    writeJson(join(runDirectory, 'controller-owner.json'), { pid: process.pid, identity: processIdentity(process.pid), runId });
    const environment = environmentIdentity(repository, engineRoot);
    let restored: ReturnType<typeof loadCheckpoint> | undefined;
    if (options.resumeFrom) {
      if (dirname(resolve(options.resumeFrom)) !== dirname(resolve(runDirectory)) || resolve(options.resumeFrom) === resolve(runDirectory)) throw new Error('Resume predecessor must be an earlier sibling run in the owned evidence root.');
      writeJson(join(runDirectory, 'resume-parent.json'), { directory: resolve(options.resumeFrom) });
      state.resume = { fromRunId: resolve(options.resumeFrom).split('/').at(-1), reused: false, reason: 'Checking predecessor ownership and checkpoint identity.' }; save();
      assertRunQuiescent(options.resumeFrom);
      try {
        const previous = readJson(join(options.resumeFrom, 'state.json')) as ControllerState;
        if (previous.cleanupSafe === false) throw new Error('Previous worker did not settle; owner cleanup is required.');
        restored = loadCheckpoint(options.resumeFrom, options.evidenceRoot ?? join(repository, '.data', 'evidence'), task, environment);
        state.resume = { fromRunId: restored.runId, reused: true, reason: 'Reused accepted checks and source draft; full verification and code review will run again.' };
      } catch (error) { state.resume = { ...state.resume, reused: false, reason: error instanceof Error ? error.message : String(error) }; }
    }
    if (options.mergeTarget && git(repository, ['status', '--porcelain']).trim()) throw new Error('Automatic execution requires a clean repository. Commit or preserve local changes first.');
    const workspace = prepareWorkspace(repository, runDirectory, restored?.baseCommit ?? options.baseRef ?? options.mergeTarget, restored ? false : !options.mergeTarget);
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
    let proofsComplete = false;
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
    checkpoint = () => { if (settled) { enforce(!checksFrozen); saveCheckpoint(state, task, environment, checksFrozen && proofsComplete); } };
    if (restored) {
      restoreCheckpoint(restored, options.resumeFrom!, state.workspace);
      state.plan = restored.plan!;
      if (restored.acceptanceReceipt) state.reviewReceipts!.push({ ...restored.acceptanceReceipt, reusedFromRunId: restored.runId });
      state.redChecks = restored.redChecks.map(check => ({ ...check, logPath: join(runDirectory, check.logPath.split('/').at(-1)!), reportPath: join(runDirectory, check.logPath.split('/').at(-1)!.replace(/\.log$/, '.jsonl')) }));
      for (const proof of restored.proofs) copyFileSync(join(options.resumeFrom!, proof.path), join(runDirectory, proof.path));
      for (const file of restored.acceptedChecks) protectedFiles.set(file.path, file.hash);
      checksFrozen = true; proofsComplete = true; enforce();
      writeJson(join(runDirectory, 'accepted-checks.json'), [...protectedFiles].map(([path, hash]) => ({ path, hash })));
    } else state.plan = parsePlan(await readonly('plan', 0), task);
    writeJson(join(runDirectory, 'plan.json'), state.plan);
    const trustedRoot = join(runDirectory, 'trusted');
    for (const path of ['scripts/verify.mjs', 'factory/process.ts', 'factory/ownership.ts', 'factory/evidence.ts', 'factory/node-reporter.mjs']) {
      const to = join(trustedRoot, path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(engineRoot, path), to);
    }
    writeJson(join(trustedRoot, 'package.json'), { type: 'module' });
    const contract = parseVerificationContract(readJson(join(options.mergeTarget ? state.workspace : repository, 'factory/verification-contract.json')));
    for (const check of state.plan.browserChecks) if (!contract.requiredBrowserTests.some(item => item.file === check.file && item.title === check.title)) contract.requiredBrowserTests.push(check);
    for (const check of state.plan.slices.flatMap(slice => slice.checks)) if (!contract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) contract.requiredNodeTests.push(check);
    const contractPath = join(trustedRoot, 'factory/verification-contract.json');
    writeJson(contractPath, contract);
    const reviewCandidate = async (phase: 'acceptance-review' | 'review', purpose: string, attempt: number, feedback: Record<string, unknown>, cwd = state.workspace, effectiveContract = contract) => {
      const sourceHash = snapshot(cwd).hash;
      const response = parseReview(await invoke(phase, attempt, JSON.stringify({ ...feedback, purpose, sourceHash }), cwd), task);
      if (snapshot(cwd).hash !== sourceHash) throw new Error(`Read-only ${purpose} changed the code snapshot.`);
      const receipt = { purpose, planHash: digest(JSON.stringify(state.plan)), sourceHash, criteriaHash: digest(JSON.stringify(task.acceptance)), contractHash: digest(JSON.stringify(effectiveContract)), approved: response.approved, summary: response.summary, evidencePath: `review-receipt-${runId}-${state.reviewReceipts!.length + 1}.json` };
      writeJson(join(runDirectory, receipt.evidencePath), { ...receipt, response, feedback });
      state.reviewReceipts!.push(receipt);
      if (!response.approved) state.phases!.at(-1)!.status = 'failed';
      save();
      return response;
    };
    if (!restored) {
      let acceptanceFeedback = '';
      for (let number = 1; number <= task.budget.maxAttempts; number += 1) {
        budget.consume('acceptance');
        const testReport = parseWorkerReport(await invoke('tests', number - 1, acceptanceFeedback), task);
        writeJson(join(runDirectory, 'test-report.json'), testReport);
        writeJson(join(runDirectory, `test-report-${number}.json`), testReport);
        if (testReport.blockers.length) throw new Error(testReport.blockers.join('\n'));
        enforce(true);
        state.redChecks = [];
        state.phase = 'red-checks'; save();
        for (const check of state.plan.slices.flatMap(slice => slice.checks)) {
          const prefix = `red-${number}-${state.redChecks.length}`;
          const logPath = join(runDirectory, `${prefix}.log`);
          const reportPath = join(runDirectory, `${prefix}.jsonl`);
          const escaped = check.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          budget.phase(Math.min(30000, remaining()));
          const result = await runProcess({ command: process.execPath, args: ['--import', 'tsx', '--test', `--test-name-pattern=^${escaped}$`, `--test-reporter=${join(trustedRoot, 'factory/node-reporter.mjs')}`, `--test-reporter-destination=${reportPath}`, check.file], cwd: state.workspace, env, logPath, timeoutMs: Math.min(30000, remaining()), signal: cancelled.signal });
          enforce(true);
          const records = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
          const isAssertion = (error: Record<string, unknown> | undefined): boolean => Boolean(error && (error.name === 'AssertionError' || error.code === 'ERR_ASSERTION' || isAssertion(error.cause as Record<string, unknown> | undefined)));
          const failed = records.some(event => event.type === 'test:fail' && event.data.name === check.title && isAssertion(event.data.details?.error));
          const passed = records.some(event => event.type === 'test:pass' && event.data.name === check.title && !event.data.skip && !event.data.todo);
          if (result.status === 'passed' && passed) state.redChecks.push({ ...check, status: 'already_passed', logPath, reportPath });
          else if (result.status === 'failed' && failed) state.redChecks.push({ ...check, status: 'expected_failure', logPath, reportPath });
          else throw new Error(`Red check did not establish a named behavior assertion: ${check.file}#${check.title}`);
          save();
        }
        const acceptanceReview = await reviewCandidate('acceptance-review', 'acceptance-coverage', number - 1, { baselineTree: state.baselineTree, redChecks: state.redChecks, evidenceDirectory: runDirectory, acceptance: task.acceptance });
        writeJson(join(runDirectory, 'acceptance-review.json'), acceptanceReview);
        writeJson(join(runDirectory, `acceptance-review-${number}.json`), acceptanceReview);
        if (acceptanceReview.approved) break;
        acceptanceFeedback = `Independent acceptance review rejected the new checks: ${acceptanceReview.findings.join('\n')}\nRepair only the unapproved scoped checks. Preserve every original test byte, the plan, acceptance criteria, and implementation. All revised checks require fresh owner red proofs and another independent acceptance review.`;
        if (number === task.budget.maxAttempts) throw new Error(`Acceptance review attempt budget exhausted. ${acceptanceFeedback}`);
      }
      const accepted = snapshot(state.workspace);
      for (const file of accepted.files.filter(file => /^(tests|acceptance)\//.test(file.path))) protectedFiles.set(file.path, file.hash);
      checksFrozen = true;
      writeJson(join(runDirectory, 'accepted-checks.json'), [...protectedFiles].map(([path, hash]) => ({ path, hash })));
    }
    proofsComplete = true;
    checkpoint();
    let feedback = options.resumeFrom ? `Repair the restored draft using the retained evidence from ${options.resumeFrom}. Preserve accepted checks.` : '';
    const alreadySatisfied = state.redChecks.every(check => check.status === 'already_passed');
    for (let number = 1; number <= task.budget.maxAttempts; number += 1) {
      budget.consume('implementation');
      const attempt = { id: `${runId}-${number}`, number } as ControllerState['attempts'][number];
      state.attempts.push(attempt); save();
      if (restored || !alreadySatisfied || number > 1) {
        const report = parseWorkerReport(await invoke(number === 1 && !restored ? 'implement' : 'repair', number, feedback), task);
        writeJson(join(runDirectory, `worker-${number}.json`), report);
        if (report.blockers.length) throw new Error(report.blockers.join('\n'));
      }
      enforce(); checkpoint();
      state.phase = 'verify'; save();
      budget.phase(Math.min(600000, remaining()));
      const verificationDirectory = join(runDirectory, `verification-${number}`);
      const execution = await runProcess({ command: process.execPath, args: [join(trustedRoot, 'scripts/verify.mjs')], cwd: state.workspace, env: { ...env, FACTORY_ATTEMPT_ID: attempt.id, VERIFY_RUN_DIR: verificationDirectory, VERIFY_CONTRACT_PATH: contractPath, VERIFY_TOTAL_TIMEOUT_MS: String(Math.min(600000, remaining())), VERIFY_STEP_TIMEOUT_MS: String(Math.min(180000, remaining())), VERIFY_GRACE_MS: '1000' }, logPath: join(runDirectory, `verification-${number}.log`), timeoutMs: Math.min(600000, remaining()) + 3000, signal: cancelled.signal });
      enforce();
      attempt.verification = readJson(join(verificationDirectory, 'summary.json')) as Verification;
      state.verification = attempt.verification; save();
      if (execution.status !== 'passed' || attempt.verification.status !== 'passed') { state.phases!.at(-1)!.status = 'failed'; feedback = `Independent verification failed. ${attempt.verification.error ?? execution.status}\n${execution.output}`; continue; }
      if (attempt.verification.snapshot.hash !== snapshot(state.workspace).hash) throw new Error('Code changed after independent verification.');
      if (!options.mergeTarget) {
        attempt.review = await reviewCandidate('review', 'delivery-code', number, { baselineTree: state.baselineTree, verification: attempt.verification, evidenceDirectory: verificationDirectory });
        state.review = attempt.review; save();
        if (!attempt.review.approved) { feedback = `Independent review rejected the candidate: ${attempt.review.findings.join('\n')}`; continue; }
        if (attempt.verification.snapshot.hash !== snapshot(state.workspace).hash) throw new Error('Code changed after review.');
      }
      const presentFiles = snapshot(state.workspace).files.filter(file => {
        try { lstatSync(join(state.workspace, file.path)); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
      }).map(file => file.path);
      if (presentFiles.length) git(state.workspace, ['add', '-N', '--', ...presentFiles]);
      writeFileSync(join(runDirectory, 'patch.diff'), git(state.workspace, ['diff', '--binary', workspace.baselineTree, '--']));
      state.changes = git(state.workspace, ['diff', '--name-status', workspace.baselineTree, '--']).trim().split('\n').filter(Boolean).map(line => { const [status, ...paths] = line.split('\t'); return { status, path: paths.at(-1)! }; });
      state.status = 'ready'; state.phase = 'ready';
      if (options.mergeTarget) {
      try {
      state.phase = 'integrate'; save();
      const receipt = await integrate({ repository, branch: options.mergeTarget, patchPath: join(runDirectory, 'patch.diff'), runDirectory, runId, validate: async (cwd, before, attempt) => {
        state.phase = 'integration-verify';
        state.integration = { branch: options.mergeTarget!, before }; save();
        const latestContract = parseVerificationContract(readJson(join(cwd, 'factory/verification-contract.json')));
        for (const check of contract.requiredBrowserTests) if (!latestContract.requiredBrowserTests.some(item => item.file === check.file && item.title === check.title)) latestContract.requiredBrowserTests.push(check);
        for (const check of contract.requiredNodeTests) if (!latestContract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) latestContract.requiredNodeTests.push(check);
        const integrationContract = join(trustedRoot, `integration-contract-${attempt}.json`); writeJson(integrationContract, latestContract);
        const directory = join(runDirectory, `integration-verification-${number}-${attempt}`);
        budget!.phase(Math.min(600000, remaining()));
        const execution = await runProcess({ command: process.execPath, args: [join(trustedRoot, 'scripts/verify.mjs')], cwd, env: { ...env, VERIFY_RUN_DIR: directory, VERIFY_CONTRACT_PATH: integrationContract, VERIFY_TOTAL_TIMEOUT_MS: String(Math.min(600000, remaining())), VERIFY_STEP_TIMEOUT_MS: String(Math.min(180000, remaining())), VERIFY_GRACE_MS: '1000' }, logPath: join(runDirectory, `integration-verification-${number}-${attempt}.log`), timeoutMs: Math.min(600000, remaining()) + 3000, signal: cancelled.signal });
        state.integration.verification = readJson(join(directory, 'summary.json')) as Verification; save();
        if (snapshot(cwd).hash !== state.integration.verification.snapshot.hash) throw new Error('Integrated source changed during verification.');
        if (execution.status !== 'passed' || state.integration.verification.status !== 'passed') throw new IntegrationRejected(`Integrated candidate failed independent verification. See ${directory}. ${execution.output}`);
        const hash = snapshot(cwd).hash;
        state.integration.review = await reviewCandidate('review', 'integrated-code', state.attempts.length, { baselineTree: git(cwd, ['rev-parse', `${before}^{tree}`]).trim(), verification: state.integration.verification, evidenceDirectory: directory, integratedCandidate: true }, cwd, latestContract); save();
        if (snapshot(cwd).hash !== hash) throw new Error('Integrated candidate changed during independent review.');
        if (!state.integration.review.approved) throw new IntegrationRejected(`Integrated candidate rejected: ${state.integration.review.findings.join('; ')}`);
      } });
      state.integration = { ...state.integration!, ...receipt }; state.status = 'merged'; state.phase = 'merged';
      } catch (error) {
        if (!(error instanceof IntegrationRejected)) throw error;
        feedback = error.message; state.phases!.at(-1)!.status = 'failed'; state.status = 'running'; state.phase = 'repair-pending'; save(); checkpoint(); continue;
      }
      }
      break;
    }
    if (state.status !== 'ready' && state.status !== 'merged') throw new Error(`Attempt budget exhausted. ${feedback}`);
  } catch (error) {
    state.failedPhase = state.phase;
    try { checkpoint?.(); } catch (checkpointError) { writeJson(join(runDirectory, 'checkpoint-error.json'), { reason: String(checkpointError) }); }
    state.status = 'blocked'; state.reason = error instanceof Error ? error.message : String(error);
    state.failureKind = /protected|scope|changed during|changed after|read.only/i.test(state.reason) ? 'integrity' : /cancelled/i.test(state.reason) ? 'cancelled' : /timeout|timed out/i.test(state.reason) ? 'timeout' : /budget.*exhausted/i.test(state.reason) ? 'budget' : /owner|process group|locked/i.test(state.reason) ? 'ownership' : /verification/i.test(state.reason) ? 'verification' : /review/i.test(state.reason) ? 'review' : 'worker';
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    options.signal?.removeEventListener('abort', cancel);
    if (budget) { state.budget = budget.report(); budget.close(); }
    state.completedAt = new Date().toISOString(); save();
    controllerDelivery(state, task);
  }
  return state;
}
