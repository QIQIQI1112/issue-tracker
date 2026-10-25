import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan, parseTask, parseReview, parseWorkerReport, parseRegressionReport, scoped, ReviewResponseFormatError } from './contracts.ts';
import type { Task, Plan, Review } from './contracts.ts';
import { parseVerificationContract, readJson, snapshot, writeJson } from './evidence.ts';
import { runProcess } from './process.ts';
import { allocatePorts, git, prepareWorkspace, processEnvironment, protectedPath } from './workspace.ts';
import { controllerDelivery } from './delivery.ts';
import { digest, environmentIdentity, loadCheckpoint, restoreCheckpoint, saveCheckpoint, assertTestInventory } from './checkpoint.ts';
import { assertRunQuiescent, processIdentity } from './ownership.ts';
import { executionBudget } from './budget.ts';
import type { Delivery } from '../src/workflow.ts';
import { enforceRegressionDraft, proveRegression } from './regression.ts';
import type { PendingRegression, AcceptedRegression, RedCheck, ReviewReceipt } from './regression.ts';
import { classifyVerificationFailure, writeRoleContext } from './optimization.ts';
import { verifyWithRecovery } from './verification-retry.ts';
import { captureIntegratedVerification, verificationInputIdentity } from './verification-reuse.ts';
import { integrate } from './integration.ts';

export type Phase = 'plan' | 'tests' | 'regression-tests' | 'acceptance-review' | 'implement' | 'repair' | 'review';
export type AgentInput = { phase: Phase; task: Task; plan?: Plan; cwd: string; attempt: number; feedback: string; directory: string; timeoutMs: number; signal: AbortSignal; env: NodeJS.ProcessEnv; context?: { indexPath: string; path: string; bytes: number; sha256: string } };
export type Agent = { run: (input: AgentInput) => Promise<unknown> };
export type Verification = { diagnostics?: { phase: string; code?: string; origin: 'spawn' | 'node-report' | 'report-validation'; kind?: 'product' | 'test-contract'; settled: true }; profile?: 'code-only'; status: string; snapshot: { hash: string }; runDirectory: string; checks: { name: string; status: string; durationMs?: number }[]; node?: { passed: number }; browser?: { passed: number }; error?: string };
class IntegrationRejected extends Error {}
class FocusedFailureHold extends Error {}

export type PendingFailureTriage = { sourceHash: string; check: RedCheck; reportHash: string; logHash: string; receipt?: ReviewReceipt };

export type ControllerState = { execution?: Delivery['execution']; efficiency?: Delivery['efficiency']; schemaVersion: 1; taskId: string; runId: string; phases?: Delivery['phases']; reviewReceipts?: Delivery['reviewReceipts']; failedPhase?: string; failureKind?: 'integrity' | 'timeout' | 'cancelled' | 'budget' | 'ownership' | 'infrastructure' | 'verification' | 'review' | 'worker'; cleanupSafe?: boolean; budget?: { usedMs: number; implementationAttempts: number; acceptanceAttempts: number; infrastructureRetries?: number; maxAttempts: number; totalTimeoutMs: number }; resume?: { fromRunId?: string; reused: boolean; reason: string }; runDirectory: string; workspace: string; status: 'running' | 'ready' | 'merged' | 'blocked'; phase: string; startedAt: string; completedAt?: string; reason?: string; sourceHash?: string; baseCommit?: string; baselineTree?: string; plan?: Plan; regressions?: AcceptedRegression[]; pendingRegression?: PendingRegression; pendingFailureTriage?: PendingFailureTriage; browserRedChecks?: RedCheck[]; redChecks: { file: string; title: string; status: string; logPath: string; reportPath?: string }[]; attempts: { id: string; number: number; verification?: Verification; focused?: RedCheck[]; review?: Review }[]; verification?: Verification; review?: Review; ports?: [string, string]; changes?: { path: string; status: string }[]; integration?: { branch: string; before: string; commit?: string; verification?: Verification; review?: Review } };

export async function runController(options: { repository: string; task: unknown; agent: Agent; baseRef?: string; evidenceRoot?: string; runId?: string; mergeTarget?: string; signal?: AbortSignal; resumeFrom?: string; budgetKey?: string }): Promise<ControllerState> {
  const task = parseTask(options.task);
  const repository = resolve(options.repository);
  const runId = options.runId ?? `${task.id}-${randomUUID()}`;
  if (!/^[a-z0-9-]+$/.test(runId)) throw new Error('Invalid run ID.');
  const runDirectory = join(options.evidenceRoot ?? join(repository, '.data', 'evidence'), runId);
  mkdirSync(runDirectory, { recursive: true });
  const state: ControllerState = { schemaVersion: 1, taskId: task.id, runId, runDirectory, workspace: join(runDirectory, 'workspace'), status: 'running', phase: 'prepare', startedAt: new Date().toISOString(), redChecks: [], browserRedChecks: [], attempts: [], phases: [], reviewReceipts: [] };
  if (task.schemaVersion === 2) state.efficiency = { agentInvocations: 0, testAuthoringInvocations: 0, verificationExecutions: 0, verificationRetries: 0, verificationReuses: 0, elapsedMs: 0, durations: { planningMs: 0, testAuthoringMs: 0, acceptanceReviewMs: 0, implementationMs: 0, verificationMs: 0, codeReviewMs: 0 } };
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
  const invoke = async (phase: Phase, attempt: number, feedback = '', cwd = state.workspace, deadline = Infinity) => {
    state.phase = phase; save();
    if (state.efficiency) { state.efficiency.agentInvocations += 1; if (phase === 'tests' || phase === 'regression-tests') state.efficiency.testAuthoringInvocations += 1; }
    const directory = join(runDirectory, `phase-${++counter}-${phase}`);
    mkdirSync(directory);
    const timeoutMs = Math.min(task.budget.workerTimeoutMs, remaining(), deadline - Date.now());
    if (timeoutMs <= 0) throw new Error(`Agent ${phase} timed out.`);
    budget!.phase(timeoutMs);
    const abort = new AbortController();
    const onCancel = () => abort.abort();
    cancelled.signal.addEventListener('abort', onCancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const verification = state.integration?.verification ?? state.verification;
    const evidenceFiles = [...(options.resumeFrom ? ['state.json', 'delivery.json'].map(file => join(options.resumeFrom!, file)) : []), join(runDirectory, 'task.json'), join(runDirectory, 'plan.json'), ...state.redChecks.flatMap(check => [check.logPath, ...(check.reportPath ? [check.reportPath] : [])]), ...(state.browserRedChecks ?? []).flatMap(check => [check.logPath, ...(check.reportPath ? [check.reportPath] : [])]), ...(state.pendingFailureTriage ? [state.pendingFailureTriage.check.logPath, state.pendingFailureTriage.check.reportPath!] : []), ...(verification ? ['summary.json', 'node-results.jsonl', 'test.log'].map(file => join(verification.runDirectory, file)) : [])].filter(existsSync);
    const context = task.schemaVersion === 2 ? writeRoleContext({ directory, role: phase, goal: task.wholeGoal?.goal ?? task.goal, sourceHash: snapshot(cwd).hash, feedback, relevantPaths: [...new Set([...(state.plan?.slices.flatMap(slice => slice.checks.map(check => check.file)) ?? []), ...snapshot(cwd).files.filter(file => file.path.startsWith('src/') && scoped(file.path, task)).map(file => file.path)])], decisions: state.plan?.assumptions ?? [], evidence: [...new Set(evidenceFiles)].map(path => ({ path, purpose: 'Retained controller task, plan or actual machine proof; inspect the file before making a delivery judgment.' })) }) : undefined;
    const work = options.agent.run({ phase, task, plan: state.plan, cwd, attempt, feedback, context, directory, timeoutMs, signal: abort.signal, env: { ...env, RUN_DIR: join(cwd, '.runs', 'worker-checks', `phase-${counter}`) } }).finally(() => { finished = true; });
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
        state.resume = { fromRunId: restored.runId, reused: false, reason: 'Validated accepted checkpoint metadata; source reconstruction is pending.' };
      } catch (error) { state.resume = { ...state.resume, reused: false, reason: error instanceof Error ? error.message : String(error) }; }
    }
    if (options.mergeTarget && git(repository, ['status', '--porcelain']).trim()) throw new Error('Automatic execution requires a clean repository. Commit or preserve local changes first.');
    const workspace = prepareWorkspace(repository, runDirectory, restored?.baseCommit ?? options.baseRef ?? options.mergeTarget, restored ? false : !options.mergeTarget);
    if (restored) {
      git(workspace.path, ['read-tree', '--reset', '-u', restored.baselineTree]);
      workspace.baselineTree = restored.baselineTree;
    }
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
    let regressionDraft = false;
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
      if (checksFrozen && !regressionDraft) assertTestInventory(current.files, [...protectedFiles].map(([path, hash]) => ({ path, hash })));
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
    checkpoint = () => { if (settled && !regressionDraft) { enforce(!checksFrozen); saveCheckpoint(state, task, environment, checksFrozen && proofsComplete); } };
    if (restored) {
      restoreCheckpoint(restored, options.resumeFrom!, state.workspace);
      state.plan = restored.plan!;
      state.regressions = restored.regressions ?? [];
      state.pendingRegression = restored.pendingRegression;
      if (restored.pendingFailureTriage) {
        const pending = restored.pendingFailureTriage;
        state.pendingFailureTriage = { ...pending, check: { ...pending.check, logPath: join(runDirectory, pending.check.logPath.split('/').at(-1)!), reportPath: join(runDirectory, pending.check.reportPath!.split('/').at(-1)!) } };
        if (pending.receipt) state.reviewReceipts!.push({ ...pending.receipt, reusedFromRunId: restored.runId });
      }
      for (const regression of state.regressions) {
        state.reviewReceipts!.push({ ...regression.receipt, reusedFromRunId: restored.runId });
        regression.redChecks = regression.redChecks.map(check => ({ ...check, logPath: join(runDirectory, check.logPath.split('/').at(-1)!), reportPath: join(runDirectory, check.reportPath!.split('/').at(-1)!) }));
      }
      if (state.pendingRegression) state.reviewReceipts!.push({ ...state.pendingRegression.receipt, reusedFromRunId: restored.runId });
      if (restored.acceptanceReceipt) state.reviewReceipts!.push({ ...restored.acceptanceReceipt, reusedFromRunId: restored.runId });
      state.redChecks = restored.redChecks.map(check => ({ ...check, logPath: join(runDirectory, check.logPath.split('/').at(-1)!), reportPath: join(runDirectory, check.logPath.split('/').at(-1)!.replace(/\.log$/, '.jsonl')) }));
      state.browserRedChecks = restored.browserRedChecks!.map(check => ({ ...check, logPath: join(runDirectory, check.logPath.split('/').at(-1)!), reportPath: join(runDirectory, check.reportPath!.split('/').at(-1)!) }));
      for (const proof of restored.proofs) copyFileSync(join(options.resumeFrom!, proof.path), join(runDirectory, proof.path));
      for (const file of restored.acceptedChecks) protectedFiles.set(file.path, file.hash);
      checksFrozen = true; proofsComplete = true; enforce();
      writeJson(join(runDirectory, 'accepted-checks.json'), [...protectedFiles].map(([path, hash]) => ({ path, hash })));
      state.resume = { fromRunId: restored.runId, reused: true, reason: 'Reconstructed the original baseline and accepted draft; full verification and code review will run again.' }; save();
    } else state.plan = parsePlan(await readonly('plan', 0), task);
    if (task.schemaVersion === 2) state.execution = { profile: 'adaptive-v2', coverageMode: state.plan.coverage!.mode, route: state.plan.coverage!.mode === 'reuse' ? 'light' : 'standard', reason: state.plan.coverage!.reason };
    writeJson(join(runDirectory, 'plan.json'), state.plan);
    const trustedRoot = join(runDirectory, 'trusted');
    for (const path of ['scripts/verify.mjs', 'factory/process.ts', 'factory/ownership.ts', 'factory/evidence.ts', 'factory/node-reporter.mjs']) {
      const to = join(trustedRoot, path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(engineRoot, path), to);
    }
    writeJson(join(trustedRoot, 'package.json'), { type: 'module' });
    const contract = parseVerificationContract(readJson(join(options.mergeTarget ? state.workspace : repository, 'factory/verification-contract.json')));
    for (const check of state.plan.slices.flatMap(slice => slice.checks)) if (!contract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) contract.requiredNodeTests.push(check);
    for (const regression of state.regressions ?? []) {
      contract.requiredNodeTests.push(...regression.checks);
    }
    const contractPath = join(trustedRoot, 'factory/verification-contract.json');
    writeJson(contractPath, contract);
    const reviewCandidate = async (phase: 'acceptance-review' | 'review', purpose: string, attempt: number, feedback: Record<string, unknown>, cwd = state.workspace, effectiveContract = contract) => {
      const sourceHash = snapshot(cwd).hash;
      const deadline = Date.now() + Math.min(task.budget.workerTimeoutMs, remaining());
      let response: Review | undefined;
      let protocolRepair: { validationError: string; previousResponse: unknown; instruction: string } | undefined;
      for (let number = 1; number <= 2; number += 1) {
        let value: unknown;
        let validationError: string | undefined;
        let invocationFailed = false;
        let invocationError: unknown;
        try {
          value = await invoke(phase, attempt, JSON.stringify({ ...feedback, purpose, sourceHash, ...(protocolRepair ? { protocolRepair } : {}) }), cwd, deadline);
        } catch (error) { invocationError = error; invocationFailed = true; }
        if (snapshot(cwd).hash !== sourceHash) throw new Error(`Read-only ${purpose} changed the code snapshot.`);
        if (invocationFailed) {
          if (!(invocationError instanceof ReviewResponseFormatError)) throw invocationError;
          value = invocationError.response; validationError = invocationError.message;
        }
        if (!validationError) {
          try { response = parseReview(value, task); break; }
          catch (error) { validationError = error instanceof Error ? error.message : String(error); }
        }
        writeJson(join(runDirectory, `phase-${counter}-${phase}`, 'contract-error.json'), { purpose, sourceHash, attempt, responseNumber: number, validationError, previousResponse: value });
        if (number === 2) throw new Error(`Review response protocol repair exhausted: ${validationError}`);
        protocolRepair = { validationError, previousResponse: value, instruction: 'Correct only the response format. Keep the same source, task, evidence, role and review judgment. Approved reviews require findings: []; blocking findings require approved: false. Do not edit files.' };
      }
      if (!response) throw new Error('Review response is missing.');
      const receipt = { purpose, planHash: digest(JSON.stringify(state.plan)), sourceHash, criteriaHash: digest(JSON.stringify(task.acceptance)), contractHash: digest(JSON.stringify(parseVerificationContract(effectiveContract))), approved: response.approved, summary: response.summary, evidencePath: `review-receipt-${runId}-${state.reviewReceipts!.length + 1}.json` };
      writeJson(join(runDirectory, receipt.evidencePath), { ...receipt, response, feedback });
      state.reviewReceipts!.push(receipt);
      if (!response.approved) state.phases!.at(-1)!.status = 'failed';
      save();
      return response;
    };
    const triageFocusedFailure = async (check: RedCheck, attempt: number) => {
      const source = enforce();
      if (!check.reportPath || check.status !== 'expected_failure') throw new Error('Focused failure triage requires an actual named assertion report.');
      if (state.pendingFailureTriage && state.pendingFailureTriage.sourceHash !== source.hash) throw new Error('Pending failure triage source identity changed.');
      const report = readFileSync(check.reportPath);
      const log = readFileSync(check.logPath);
      const prefix = join(runDirectory, `failure-proof-${runId}-${attempt}`);
      const held = { ...check, logPath: `${prefix}.log`, reportPath: `${prefix}.${check.file.startsWith('tests/') ? 'jsonl' : 'json'}` };
      writeFileSync(held.logPath, log);
      writeFileSync(held.reportPath, report);
      const pending: PendingFailureTriage = { sourceHash: source.hash, check: held, reportHash: digest(report), logHash: digest(log) };
      state.pendingFailureTriage = pending;
      checkpoint!();
      const path = join(runDirectory, `failure-triage-${attempt}.json`);
      const diagnostic = { schemaVersion: 1, purpose: 'focused-failure-triage', sourceHash: source.hash, check: held, reportHash: pending.reportHash, logHash: pending.logHash };
      writeJson(path, { ...diagnostic, status: 'pending-review' });
      try {
        const review = await reviewCandidate('acceptance-review', 'focused-failure-triage', attempt, { ...diagnostic, baselineTree: state.baselineTree, acceptance: task.acceptance, originalGoal: task.wholeGoal?.goal ?? task.goal, acceptedChecksPath: join(runDirectory, 'accepted-checks.json'), evidenceDirectory: runDirectory });
        enforce();
        if (digest(readFileSync(held.reportPath)) !== pending.reportHash || digest(readFileSync(held.logPath)) !== pending.logHash || digest(readFileSync(check.reportPath)) !== pending.reportHash || digest(readFileSync(check.logPath)) !== pending.logHash) throw new Error('Read-only focused failure triage changed the machine evidence.');
        const receipt = state.reviewReceipts!.at(-1)!;
        if (review.approved) state.pendingFailureTriage = undefined;
        else pending.receipt = receipt;
        writeJson(path, { ...diagnostic, status: review.approved ? 'repair-approved' : 'owner-maintenance-required', receipt, summary: review.summary, findings: review.findings });
        checkpoint!();
        if (!review.approved) throw new FocusedFailureHold(`Focused check requires owner maintenance before product repair: ${review.findings.join('; ') || review.summary}. Preserve frozen checks and read ${path}.`);
        return review;
      } catch (error) {
        if (!(error instanceof FocusedFailureHold)) writeJson(path, { ...diagnostic, status: 'owner-maintenance-required', reason: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };
    const fullVerification = async (cwd: string, directory: string, effectiveContractPath: string, attemptId?: string) => {
      let execution: Awaited<ReturnType<typeof runProcess>> | undefined;
      const execute = async (generation: number) => {
        const target = generation === 1 ? directory : `${directory}-infrastructure-retry-${generation - 1}`;
        const timeoutMs = Math.min(600000, remaining()); budget!.phase(timeoutMs);
        if (state.efficiency) { state.efficiency.verificationExecutions += 1; if (generation > 1) state.efficiency.verificationRetries += 1; }
        const inputIdentity = task.schemaVersion === 2 ? verificationInputIdentity(cwd) : undefined;
        execution = await runProcess({ command: process.execPath, args: [join(trustedRoot, 'scripts/verify.mjs')], cwd, env: { ...env, ...(attemptId ? { FACTORY_ATTEMPT_ID: attemptId } : {}), VERIFY_RUN_DIR: target, VERIFY_CONTRACT_PATH: effectiveContractPath, VERIFY_TOTAL_TIMEOUT_MS: String(timeoutMs), VERIFY_STEP_TIMEOUT_MS: String(Math.min(300000, remaining())), VERIFY_GRACE_MS: '1000' }, logPath: `${target}.log`, timeoutMs: timeoutMs + 3000, signal: cancelled.signal });
        if (task.schemaVersion === 2 && (execution.settled !== true || execution.error && !execution.spawnErrorCode || execution.status === 'cancelled' || execution.status === 'timeout')) throw new Error(`Verifier process ownership or execution failed: ${execution.error ?? execution.status}. Retain source and require owner recovery.`);
        const verification = readJson(join(target, 'summary.json')) as Verification;
        if (execution.status !== 'passed' && verification.status === 'passed') throw new Error('Verifier process failed despite a passing summary; inspect owned process evidence.');
        if (snapshot(cwd).hash !== verification.snapshot.hash) throw new Error('Source changed during verification.');
        if (inputIdentity) {
          const after = verificationInputIdentity(cwd);
          writeJson(join(target, 'verification-input.json'), { schemaVersion: 1, sourceHash: verification.snapshot.hash, before: inputIdentity, after, verificationRunId: (verification as Verification & { runId: string }).runId, summaryHash: digest(readFileSync(join(target, 'summary.json'))) });
          if (inputIdentity !== after) throw new Error('Verification input identity changed during execution.');
        }
        return verification;
      };
      const record = (generation: number, verification: Verification) => writeJson(`${directory}-diagnosis-${generation}.json`, { generation, diagnosis: classifyVerificationFailure(verification), verificationDirectory: verification.runDirectory });
      const result = task.schemaVersion === 2 ? await verifyWithRecovery({ execute, record, budget: budget!, identity: () => digest(JSON.stringify({ source: snapshot(cwd).hash, environment: environmentIdentity(cwd, engineRoot), contract: readFileSync(effectiveContractPath, 'utf8') })) }) : { verification: await execute(1) };
      if (task.schemaVersion === 2 && classifyVerificationFailure(result.verification).kind === 'test-contract') throw new Error('Verification contract evidence was rejected; preserve frozen checks and request owner maintenance before retrying.');
      if (task.schemaVersion === 2 && classifyVerificationFailure(result.verification).retryable) throw new Error('Infrastructure verification retry exhausted; retain accepted source and require owner resource recovery before retrying.');
      return { verification: result.verification, execution: execution! };
    };
    const regressionLoop = async () => {
      const pending = state.pendingRegression!;
      const before = enforce();
      if (before.hash !== pending.receipt.sourceHash) throw new Error('Regression request source differs from the reviewed candidate; owner rebase is required.');
      checkpoint!();
      regressionDraft = true;
      let feedback = JSON.stringify({ review: pending.review, sourceHash: before.hash, evidencePath: pending.receipt.evidencePath });
      for (let number = 1; number <= task.budget.maxAttempts; number += 1) {
        const generation = budget!.consume('acceptance');
        const report = parseRegressionReport(await invoke('regression-tests', generation, feedback), task);
        writeJson(join(runDirectory, `regression-report-${generation}.json`), report);
        if (report.blockers.length) throw new Error(report.blockers.join('\n'));
        enforceRegressionDraft(before, enforce(), report);
        state.phase = 'regression-red-checks'; save();
        const redChecks = [];
        for (const check of report.checks) {
          const timeoutMs = Math.min(30000, remaining());
          budget!.phase(timeoutMs);
          redChecks.push(await proveRegression({ check, browser: false, cwd: state.workspace, prefix: join(runDirectory, `regression-red-${generation}-${redChecks.length}`), env, reporter: join(trustedRoot, 'factory/node-reporter.mjs'), timeoutMs, signal: cancelled.signal }));
          enforceRegressionDraft(before, enforce(), report);
        }
        const response = await reviewCandidate('acceptance-review', 'regression-coverage', generation, { baselineTree: state.baselineTree, review: pending.review, checks: report.checks, browserChecks: report.browserChecks, acceptedChecks: snapshot(state.workspace).files.filter(file => /^(tests|acceptance)\//.test(file.path)), redChecks, evidenceDirectory: runDirectory, acceptance: task.acceptance }, state.workspace, { ...contract, requiredNodeTests: [...contract.requiredNodeTests, ...report.checks], requiredBrowserTests: [...contract.requiredBrowserTests, ...report.browserChecks] });
        if (!response.approved) { feedback = JSON.stringify({ review: pending.review, rejection: response, checks: report, redChecks }); continue; }
        const receipt = state.reviewReceipts!.at(-1)!;
        (state.regressions ??= []).push({ checks: report.checks, browserChecks: report.browserChecks, redChecks, receipt });
        contract.requiredNodeTests.push(...report.checks);
        writeJson(contractPath, contract);
        for (const file of snapshot(state.workspace).files.filter(file => /^(tests|acceptance)\//.test(file.path))) protectedFiles.set(file.path, file.hash);
        writeJson(join(runDirectory, 'accepted-checks.json'), [...protectedFiles].map(([path, hash]) => ({ path, hash })));
        state.pendingRegression = undefined; regressionDraft = false; save(); checkpoint!();
        return;
      }
      throw new Error('Regression acceptance review attempt budget exhausted.');
    };
    const requestRegression = async (review: Review) => {
      if (!review.needsRegression) return;
      state.pendingRegression = { review, receipt: state.reviewReceipts!.at(-1)! }; save();
      await regressionLoop();
    };
    const reuse = state.execution?.coverageMode === 'reuse';
    if (!restored) {
      if (reuse) for (const check of [...state.plan.slices.flatMap(slice => slice.checks).map(check => check.file), ...state.plan.browserChecks.map(check => `acceptance/${check.file}`)]) if (!originalChecks.has(check)) throw new Error(`Baseline reuse requires existing named checks: ${check}`);
      let acceptanceFeedback = '';
      for (let number = 1; number <= task.budget.maxAttempts; number += 1) {
        if (!reuse) {
        budget.consume('acceptance');
        const testReport = parseWorkerReport(await invoke('tests', number - 1, acceptanceFeedback), task);
        writeJson(join(runDirectory, 'test-report.json'), testReport);
        writeJson(join(runDirectory, `test-report-${number}.json`), testReport);
        if (testReport.blockers.length) throw new Error(testReport.blockers.join('\n'));
        enforce(true);
        }
        state.redChecks = [];
        state.browserRedChecks = [];
        state.phase = 'red-checks'; save();
        for (const check of state.plan.slices.flatMap(slice => slice.checks)) {
          const prefix = `red-${number}-${state.redChecks.length}`;
          const logPath = join(runDirectory, `${prefix}.log`);
          const reportPath = join(runDirectory, `${prefix}.jsonl`);
          const escaped = check.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          budget.phase(Math.min(30000, remaining()));
          const result = await runProcess({ command: process.execPath, args: ['--import', 'tsx', '--test', `--test-name-pattern=^${escaped}$`, `--test-reporter=${join(trustedRoot, 'factory/node-reporter.mjs')}`, `--test-reporter-destination=${reportPath}`, check.file], cwd: state.workspace, env, logPath, timeoutMs: Math.min(30000, remaining()), signal: cancelled.signal });
          enforce(true);
          if (result.error || result.settled !== true) throw new Error(`Initial behavior proof ownership is unsafe: ${result.error ?? result.status}`);
          const records = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
          const isAssertion = (error: Record<string, unknown> | undefined): boolean => Boolean(error && (error.name === 'AssertionError' || error.code === 'ERR_ASSERTION' || isAssertion(error.cause as Record<string, unknown> | undefined)));
          const failed = records.some(event => event.type === 'test:fail' && event.data.name === check.title && isAssertion(event.data.details?.error));
          const passed = records.some(event => event.type === 'test:pass' && event.data.name === check.title && !event.data.skip && !event.data.todo);
          if (result.status === 'passed' && passed) state.redChecks.push({ ...check, status: 'already_passed', logPath, reportPath });
          else if (result.status === 'failed' && failed) state.redChecks.push({ ...check, status: 'expected_failure', logPath, reportPath });
          else throw new Error(`Red check did not establish a named behavior assertion: ${check.file}#${check.title}`);
          save();
        }
        if (reuse) {
          const receipt = { purpose: 'baseline-coverage-reuse', planHash: digest(JSON.stringify(state.plan)), sourceHash: baseline.hash, criteriaHash: digest(JSON.stringify(task.acceptance)), contractHash: digest(JSON.stringify(parseVerificationContract(contract))), approved: true, summary: 'Controller proved named baseline coverage and froze the complete existing test inventory. Independent final goal review remains required.', evidencePath: 'baseline-coverage-reuse.json' };
          writeJson(join(runDirectory, receipt.evidencePath), { ...receipt, owner: { environment, baselineTree: state.baselineTree }, feedback: { redChecks: state.redChecks, browserRedChecks: state.browserRedChecks, acceptedChecks: baseline.files.filter(file => /^(tests|acceptance)\//.test(file.path)) } });
          state.reviewReceipts!.push(receipt);
          break;
        }
        const acceptanceReview = await reviewCandidate('acceptance-review', 'acceptance-coverage', number - 1, { baselineTree: state.baselineTree, redChecks: state.redChecks, browserRedChecks: state.browserRedChecks, acceptedChecks: snapshot(state.workspace).files.filter(file => /^(tests|acceptance)\//.test(file.path)), evidenceDirectory: runDirectory, acceptance: task.acceptance });
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
    if (state.pendingRegression) await regressionLoop();
    if (state.pendingFailureTriage) await triageFocusedFailure(state.pendingFailureTriage.check, 0);
    let feedback = options.resumeFrom ? `Repair the restored draft using the retained evidence from ${options.resumeFrom}. Preserve accepted checks.` : '';
    const alreadySatisfied = [...state.redChecks, ...(state.browserRedChecks ?? [])].every(check => check.status === 'already_passed');
    for (let number = 1; number <= task.budget.maxAttempts; number += 1) {
      budget.consume('implementation');
      const attempt = { id: `${runId}-${number}`, number } as ControllerState['attempts'][number];
      state.attempts.push(attempt); save();
      if (task.schemaVersion === 2 || restored || !alreadySatisfied || number > 1) {
        const report = parseWorkerReport(await invoke(number === 1 && !restored ? 'implement' : 'repair', number, feedback), task);
        writeJson(join(runDirectory, `worker-${number}.json`), report);
        if (report.blockers.length) throw new Error(report.blockers.join('\n'));
      }
      enforce(); checkpoint();
      const verificationDirectory = join(runDirectory, `verification-${number}`);
      if (task.schemaVersion === 2 && options.mergeTarget) {
        state.phase = 'focused-checks'; save();
        attempt.focused = [];
        let failedCheck: RedCheck | undefined;
        const checks = [...state.plan.slices.flatMap(slice => slice.checks), ...(state.regressions ?? []).flatMap(item => item.checks)];
        for (const check of checks) {
            const timeoutMs = Math.min(30000, remaining()); budget.phase(timeoutMs);
            const proof = await proveRegression({ check, browser: false, cwd: state.workspace, prefix: join(runDirectory, `focused-${number}-${attempt.focused.length}`), env, reporter: join(trustedRoot, 'factory/node-reporter.mjs'), timeoutMs, signal: cancelled.signal, allowAlreadyPassed: true });
            enforce();
            attempt.focused.push(proof);
            if (proof.status !== 'already_passed') { failedCheck = proof; break; }
        }
        writeJson(join(runDirectory, `focused-${number}.json`), { purpose: 'development-diagnostics', sourceHash: snapshot(state.workspace).hash, checks: attempt.focused });
        if (failedCheck) {
          state.phases!.at(-1)!.status = 'failed';
          const diagnosis = await triageFocusedFailure(failedCheck, number);
          feedback = `Independent focused failure triage confirmed a product defect: ${diagnosis.summary} Focused assertion: ${failedCheck.file}#${failedCheck.title}. Read ${failedCheck.reportPath} and ${join(runDirectory, `failure-triage-${number}.json`)}. Preserve frozen checks.`;
          continue;
        }
      } else {
        state.phase = 'verify'; save();
        const { execution, verification } = await fullVerification(state.workspace, verificationDirectory, contractPath, attempt.id);
        enforce();
        attempt.verification = verification;
        state.verification = attempt.verification; save();
        if (execution.status !== 'passed' || attempt.verification.status !== 'passed') { state.phases!.at(-1)!.status = 'failed'; feedback = `Independent verification failed. ${attempt.verification.error ?? execution.status}\n${execution.output}`; continue; }
        if (attempt.verification.snapshot.hash !== snapshot(state.workspace).hash) throw new Error('Code changed after independent verification.');
      }
      if (!options.mergeTarget) {
        attempt.review = await reviewCandidate('review', 'delivery-code', number, { baselineTree: state.baselineTree, verification: attempt.verification, evidenceDirectory: attempt.verification!.runDirectory });
        state.review = attempt.review; save();
        if (!attempt.review.approved) { await requestRegression(attempt.review); feedback = `Independent review rejected the candidate: ${attempt.review.findings.join('\n')}`; continue; }
        if (attempt.verification!.snapshot.hash !== snapshot(state.workspace).hash) throw new Error('Code changed after review.');
        if (task.schemaVersion === 2 && (readJson(join(attempt.verification!.runDirectory, 'verification-input.json')) as { before: string }).before !== verificationInputIdentity(state.workspace)) throw new Error('Delivery verification input identity changed during review.');
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
      const receipt = await integrate({ repository, branch: options.mergeTarget, patchPath: join(runDirectory, 'patch.diff'), runDirectory, runId, assertCleanupSafe: () => { if (!settled || state.cleanupSafe === false) throw new Error('Agent did not settle after cancellation.'); }, validate: async (cwd, before, attempt) => {
        state.phase = 'integration-verify';
        state.integration = { branch: options.mergeTarget!, before }; save();
        const latestContract = parseVerificationContract(readJson(join(cwd, 'factory/verification-contract.json')));
        for (const check of contract.requiredNodeTests) if (!latestContract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) latestContract.requiredNodeTests.push(check);
        const integrationContract = join(trustedRoot, `integration-contract-${attempt}.json`); writeJson(integrationContract, latestContract);
        const directory = join(runDirectory, `integration-verification-${number}-${attempt}`);
        const { execution, verification } = await fullVerification(cwd, directory, integrationContract);
        state.integration.verification = verification; save();
        if (snapshot(cwd).hash !== state.integration.verification.snapshot.hash) throw new Error('Integrated source changed during verification.');
        if (execution.status !== 'passed' || state.integration.verification.status !== 'passed') throw new IntegrationRejected(`Integrated candidate failed independent verification. See ${directory}. ${execution.output}`);
        const hash = snapshot(cwd).hash;
        state.integration.review = await reviewCandidate('review', task.wholeGoal ? 'integrated-code-and-whole-goal' : 'integrated-code', state.attempts.length, { baselineTree: git(cwd, ['rev-parse', `${before}^{tree}`]).trim(), verification: state.integration.verification, evidenceDirectory: state.integration.verification.runDirectory, integratedCandidate: true, ...(task.wholeGoal ? { wholeGoal: task.wholeGoal } : {}) }, cwd, latestContract); save();
        if (snapshot(cwd).hash !== hash) throw new Error('Integrated candidate changed during independent review.');
        if (task.schemaVersion === 2 && (readJson(join(state.integration.verification.runDirectory, 'verification-input.json')) as { before: string }).before !== verificationInputIdentity(cwd)) throw new Error('Integrated verification input identity changed during review.');
        if (!state.integration.review.approved) {
          if (state.integration.review.needsRegression) { state.pendingRegression = { review: state.integration.review, receipt: state.reviewReceipts!.at(-1)! }; save(); }
          throw new IntegrationRejected(`Integrated candidate rejected: ${state.integration.review.findings.join('; ')}`);
        }
      } });
      state.integration = { ...state.integration!, ...receipt }; state.status = 'merged'; state.phase = 'merged';
      if (task.schemaVersion === 2) {
        writeJson(join(runDirectory, 'state.json'), state);
        try { captureIntegratedVerification({ repository, runDirectory, branch: receipt.branch, commit: receipt.commit, wholeGoal: task.wholeGoal }); }
        catch (error) { writeJson(join(runDirectory, 'verification-reuse-unavailable.json'), { reason: String(error), action: 'Whole-requirement execution must verify freshly.' }); }
      }
      } catch (error) {
        if (!(error instanceof IntegrationRejected)) throw error;
        state.phases!.at(-1)!.status = 'failed'; state.status = 'running';
        if (state.pendingRegression) await regressionLoop();
        feedback = error.message; state.phase = 'repair-pending'; save(); checkpoint(); continue;
      }
      }
      break;
    }
    if (state.status !== 'ready' && state.status !== 'merged') throw new Error(`Attempt budget exhausted. ${feedback}`);
  } catch (error) {
    state.failedPhase = state.phase;
    try { checkpoint?.(); } catch (checkpointError) { writeJson(join(runDirectory, 'checkpoint-error.json'), { reason: String(checkpointError) }); }
    state.status = 'blocked'; state.reason = error instanceof Error ? error.message : String(error);
    state.failureKind = error instanceof FocusedFailureHold ? 'review' : /protected|scope|identity changed|changed during|changed after|read.only/i.test(state.reason) ? 'integrity' : /cancelled/i.test(state.reason) ? 'cancelled' : /timeout|timed out/i.test(state.reason) ? 'timeout' : /budget.*exhausted/i.test(state.reason) ? 'budget' : /owner|process group|locked/i.test(state.reason) ? 'ownership' : /infrastructure.*retry/i.test(state.reason) ? 'infrastructure' : /verification/i.test(state.reason) ? 'verification' : /review/i.test(state.reason) ? 'review' : 'worker';
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    options.signal?.removeEventListener('abort', cancel);
    if (budget) { state.budget = budget.report(); budget.close(); }
    state.completedAt = new Date().toISOString(); save();
    if (state.efficiency) {
      state.efficiency.elapsedMs = Date.parse(state.completedAt) - Date.parse(state.startedAt);
      const sum = (...names: string[]) => state.phases!.filter(phase => names.includes(phase.name)).reduce((total, phase) => total + phase.durationMs, 0);
      state.efficiency.durations = { planningMs: sum('plan'), testAuthoringMs: sum('tests', 'regression-tests'), acceptanceReviewMs: sum('acceptance-review'), implementationMs: sum('implement', 'repair'), verificationMs: sum('verify', 'integration-verify', 'focused-checks'), codeReviewMs: sum('review') };
      save();
    }
    controllerDelivery(state, task);
  }
  return state;
}
