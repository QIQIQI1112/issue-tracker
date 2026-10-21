import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { ControllerState } from './controller.ts';
import type { Task, Plan } from './contracts.ts';
import { parsePlan, parseReview, parseRegressionReport } from './contracts.ts';
import { snapshot, readJson, writeJson } from './evidence.ts';
import type { PendingRegression, AcceptedRegression } from './regression.ts';
import { git, protectedPath } from './workspace.ts';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const taskIdentity = (task: Task) => digest(JSON.stringify({ ...task, notes: '' }));
export function environmentIdentity(repository: string, engine: string): string {
  const source = snapshot(repository);
  const paths = new Set(source.files.map(file => file.path));
  const controls = source.files.filter(file => protectedPath(file.path, paths));
  const runtime = { node: process.version, platform: process.platform, arch: process.arch, engine: snapshot(engine).files.filter(file => /^(factory|scripts)\//.test(file.path)) };
  return digest(JSON.stringify({ controls, runtime }));
}

type Checkpoint = { schemaVersion: 1; runId: string; taskHash: string; environment: string; baselineTree: string; baseCommit: string; sourceHash: string; patchHash: string; accepted: boolean; regressions?: AcceptedRegression[]; pendingRegression?: PendingRegression; plan?: Plan; acceptanceReceipt?: NonNullable<ControllerState['reviewReceipts']>[number]; acceptedChecks: { path: string; hash: string }[]; redChecks: ControllerState['redChecks']; browserRedChecks?: ControllerState['browserRedChecks']; proofs: { path: string; hash: string }[] };

export function assertTestInventory(files: { path: string; hash: string }[], approved: { path: string; hash: string }[]): void {
  const current = new Map(files.filter(file => /^(tests|acceptance)\//.test(file.path)).map(file => [file.path, file.hash]));
  const expected = new Map(approved.filter(file => /^(tests|acceptance)\//.test(file.path)).map(file => [file.path, file.hash]));
  for (const path of current.keys()) if (!expected.has(path)) throw new Error(`Protected test inventory contains an unapproved file: ${path}`);
  for (const [path, hash] of expected) if (current.get(path) !== hash) throw new Error(`Protected test inventory changed: ${path}`);
}

export function saveCheckpoint(state: ControllerState, task: Task, environment: string, accepted: boolean): void {
  if (!state.baselineTree || !state.baseCommit) return;
  const source = snapshot(state.workspace);
  const acceptedChecks = accepted ? (readJson(join(state.runDirectory, 'accepted-checks.json')) as { path: string; hash: string }[]).filter(file => /^(tests|acceptance)\//.test(file.path)) : source.files.filter(file => /^(tests|acceptance)\//.test(file.path));
  if (accepted) assertTestInventory(source.files, acceptedChecks);
  const present = source.files.filter(file => existsSync(join(state.workspace, file.path))).map(file => file.path);
  if (present.length) git(state.workspace, ['add', '-N', '--', ...present]);
  const patch = git(state.workspace, ['diff', '--binary', state.baselineTree, '--']);
  writeFileSync(join(state.runDirectory, 'checkpoint.patch.tmp'), patch);
  const acceptanceReceipt = state.reviewReceipts?.filter(receipt => ['acceptance-coverage', 'baseline-coverage-reuse'].includes(receipt.purpose) && receipt.approved).at(-1);
  const reuse = state.plan?.coverage?.mode === 'reuse';
  const paths = ['accepted-checks.json', ...(reuse ? ['baseline.json'] : ['acceptance-review.json']), ...state.redChecks.flatMap(check => [relative(state.runDirectory, check.logPath), relative(state.runDirectory, check.logPath).replace(/\.log$/, '.jsonl')])];
  for (const check of state.browserRedChecks ?? []) paths.push(relative(state.runDirectory, check.logPath), relative(state.runDirectory, check.reportPath!));
  if (acceptanceReceipt) paths.push(acceptanceReceipt.evidencePath);
  for (const regression of state.regressions ?? []) paths.push(regression.receipt.evidencePath, ...regression.redChecks.flatMap(check => [relative(state.runDirectory, check.logPath), relative(state.runDirectory, check.reportPath!)]));
  if (state.pendingRegression) paths.push(state.pendingRegression.receipt.evidencePath);
  const proofs = accepted ? paths.map(path => ({ path, hash: digest(readFileSync(join(state.runDirectory, path))) })) : [];
  const checkpoint: Checkpoint = { schemaVersion: 1, runId: state.runId, taskHash: taskIdentity(task), environment, baselineTree: state.baselineTree, baseCommit: state.baseCommit, sourceHash: source.hash, patchHash: digest(patch), accepted, regressions: state.regressions, pendingRegression: state.pendingRegression, plan: state.plan, acceptanceReceipt, acceptedChecks, redChecks: state.redChecks, browserRedChecks: state.browserRedChecks ?? [], proofs };
  renameSync(join(state.runDirectory, 'checkpoint.patch.tmp'), join(state.runDirectory, 'checkpoint.patch'));
  writeJson(join(state.runDirectory, 'checkpoint.json'), checkpoint);
}

export function loadCheckpoint(directory: string, root: string, task: Task, environment: string): Checkpoint {
  const path = relative(resolve(root), resolve(directory));
  if (!path || path.startsWith('..') || path.startsWith('/')) throw new Error('Checkpoint must be from a previous run inside the owned evidence root.');
  const value = readJson(join(directory, 'checkpoint.json')) as Checkpoint;
  if (value.schemaVersion !== 1 || value.taskHash !== taskIdentity(task) || value.environment !== environment) throw new Error('Checkpoint task, criteria, or environment identity changed.');
  if (!value.accepted) throw new Error('Checkpoint has no accepted checks; restart from planning.');
  if (!/^[a-f0-9]{40,64}$/.test(value.baseCommit) || !/^[a-f0-9]{40,64}$/.test(value.baselineTree)) throw new Error('Invalid checkpoint Git identity.');
  if (digest(readFileSync(join(directory, 'checkpoint.patch'))) !== value.patchHash) throw new Error('Checkpoint patch hash mismatch.');
  value.plan = parsePlan(value.plan, task);
  if (!value.proofs.length || value.redChecks.length !== value.plan.slices.flatMap(slice => slice.checks).length) throw new Error('Checkpoint behavior proofs are incomplete.');
  if (!Array.isArray(value.browserRedChecks)) throw new Error('Checkpoint browser proof metadata is missing.');
  for (const proof of value.proofs) {
    if (relative(directory, resolve(directory, proof.path)) !== proof.path || proof.path.startsWith('..') || !/^(baseline\.json|accepted-checks\.json|acceptance-review\.json|baseline-coverage-reuse\.json|(?:red-\d+(?:-\d+)?|regression-red-\d+-\d+|browser-red-\d+-\d+)\.(log|jsonl|json)|review-receipt-[a-z0-9-]+\.json)$/.test(proof.path)) throw new Error('Invalid checkpoint proof path.');
    if (digest(readFileSync(join(directory, proof.path))) !== proof.hash) throw new Error('Checkpoint proof hash mismatch.');
  }
  if (!value.proofs.some(proof => proof.path === 'accepted-checks.json')) throw new Error('Checkpoint has no approved test inventory proof.');
  assertTestInventory(value.acceptedChecks, readJson(join(directory, 'accepted-checks.json')) as { path: string; hash: string }[]);
  const regressionReceipts = new Set((value.regressions ?? []).map(regression => regression.receipt.evidencePath));
  const regressionProofs = new Set((value.regressions ?? []).flatMap(regression => regression.redChecks.flatMap(check => [check.logPath.split('/').at(-1)!, check.reportPath?.split('/').at(-1)])));
  const browserProofs = new Set(value.browserRedChecks.flatMap(check => [check.logPath.split('/').at(-1), check.reportPath?.split('/').at(-1)]));
  for (const proof of value.proofs) {
    if (proof.path.startsWith('browser-red-') && !browserProofs.has(proof.path)) throw new Error('Orphan browser red proof in checkpoint.');
    if (proof.path.startsWith('regression-red-') && !regressionProofs.has(proof.path)) throw new Error('Orphan regression red proof in checkpoint.');
    if (!proof.path.startsWith('review-receipt-')) continue;
    const bound = readJson(join(directory, proof.path)) as { purpose: string; response: unknown };
    const response = parseReview(bound.response, task);
    if (bound.purpose === 'regression-coverage' && !regressionReceipts.has(proof.path)) throw new Error('Orphan regression coverage receipt in checkpoint.');
    if (['integrated-code', 'integrated-code-and-whole-goal', 'delivery-code'].includes(bound.purpose) && response.needsRegression && value.pendingRegression?.receipt.evidencePath !== proof.path) throw new Error('Orphan regression request receipt in checkpoint.');
  }
  const reuse = value.plan.coverage?.mode === 'reuse';
  const review = reuse ? undefined : parseReview(readJson(join(directory, 'acceptance-review.json')), task);
  if (!value.acceptanceReceipt?.approved || value.acceptanceReceipt.criteriaHash !== digest(JSON.stringify(task.acceptance)) || !value.proofs.some(proof => proof.path === value.acceptanceReceipt?.evidencePath)) throw new Error('Checkpoint has no source-bound acceptance receipt.');
  const receipt = value.acceptanceReceipt;
  if (receipt.planHash !== digest(JSON.stringify(value.plan))) throw new Error('Checkpoint plan identity does not match its acceptance approval.');
  const bound = readJson(join(directory, receipt.evidencePath)) as typeof receipt & { response: unknown; owner?: { environment: string; baselineTree: string }; feedback: { redChecks: ControllerState['redChecks']; browserRedChecks: ControllerState['redChecks']; acceptedChecks: { path: string; hash: string }[] } };
  const fields = ['purpose', 'planHash', 'sourceHash', 'criteriaHash', 'contractHash', 'approved', 'summary', 'evidencePath'] as const;
  if (fields.some(field => receipt[field] !== bound[field])) throw new Error('Checkpoint acceptance receipt metadata does not match its hashed proof.');
  const normalizeProofs = (checks: ControllerState['redChecks']) => checks.map(check => ({ ...check, logPath: check.logPath.split('/').at(-1), reportPath: check.reportPath?.split('/').at(-1) }));
  if (reuse) {
    if (task.schemaVersion !== 2 || receipt.purpose !== 'baseline-coverage-reuse' || receipt.evidencePath !== 'baseline-coverage-reuse.json' || bound.owner?.environment !== environment || bound.owner.baselineTree !== value.baselineTree) throw new Error('Checkpoint baseline coverage owner receipt is invalid.');
    if (JSON.stringify(normalizeProofs(bound.feedback.redChecks)) !== JSON.stringify(normalizeProofs(value.redChecks))) throw new Error('Checkpoint baseline named proofs differ from the owner receipt.');
    const baseline = readJson(join(directory, 'baseline.json')) as ReturnType<typeof snapshot>;
    if (baseline.hash !== receipt.sourceHash || digest(JSON.stringify(baseline.files)) !== baseline.hash) throw new Error('Checkpoint baseline coverage source identity changed.');
    assertTestInventory(baseline.files, bound.feedback.acceptedChecks);
    const initialTests = bound.feedback.acceptedChecks;
    const approvedExtra = new Set((value.regressions ?? []).flatMap(item => [...item.checks.map(check => check.file), ...item.browserChecks.map(check => `acceptance/${check.file}`)]));
    assertTestInventory(value.acceptedChecks.filter(file => !approvedExtra.has(file.path)), initialTests);
    if (value.browserRedChecks.length !== value.plan.browserChecks.length) throw new Error('Checkpoint baseline browser proofs are incomplete.');
    for (const check of value.redChecks) {
      if (!value.plan.slices.flatMap(slice => slice.checks).some(planned => planned.file === check.file && planned.title === check.title) || !['already_passed', 'expected_failure'].includes(check.status) || !check.reportPath) throw new Error('Checkpoint baseline named proof is invalid.');
      for (const path of [check.logPath, check.reportPath]) if (!value.proofs.some(proof => proof.path === path.split('/').at(-1))) throw new Error('Checkpoint baseline named proof is missing.');
    }
  } else if (receipt.purpose !== 'acceptance-coverage' || JSON.stringify(parseReview(bound.response, task)) !== JSON.stringify(review) || !review?.approved) throw new Error('Checkpoint acceptance review was not approved.');
  const browserFeedback = (bound as typeof bound & { feedback: { browserRedChecks?: ControllerState['redChecks']; acceptedChecks?: { path: string; hash: string }[] } }).feedback;
  const normalizeBrowser = (checks: ControllerState['redChecks']) => checks.map(check => ({ ...check, logPath: check.logPath.split('/').at(-1), reportPath: check.reportPath?.split('/').at(-1) }));
  if (!Array.isArray(browserFeedback?.browserRedChecks) || JSON.stringify(normalizeBrowser(browserFeedback.browserRedChecks)) !== JSON.stringify(normalizeBrowser(value.browserRedChecks))) throw new Error('Checkpoint browser proof metadata does not match approval.');
  const approvedBrowserFiles = new Map(browserFeedback.acceptedChecks?.map(file => [file.path, file.hash]));
  for (const check of value.browserRedChecks) {
    if (!value.plan.browserChecks.some(planned => planned.file === check.file && planned.title === check.title) || !['expected_failure', 'already_passed'].includes(check.status) || !check.reportPath) throw new Error('Checkpoint browser proof is invalid.');
    for (const path of [check.logPath, check.reportPath]) if (!value.proofs.some(proof => proof.path === path.split('/').at(-1))) throw new Error('Checkpoint browser proof is incomplete.');
    const path = `acceptance/${check.file}`;
    if (!approvedBrowserFiles.has(path) || approvedBrowserFiles.get(path) !== value.acceptedChecks.find(file => file.path === path)?.hash) throw new Error('Checkpoint browser test hash does not match approval.');
  }
  const requireProof = (path: string) => { if (!value.proofs.some(proof => proof.path === path)) throw new Error('Checkpoint regression proof is incomplete.'); };
  for (const regression of value.regressions ?? []) {
    const report = parseRegressionReport({ schemaVersion: 1, taskId: task.id, summary: 'Checkpoint regression checks.', blockers: [], checks: regression.checks, browserChecks: regression.browserChecks }, task);
    const receipt = regression.receipt;
    requireProof(receipt.evidencePath);
    const bound = readJson(join(directory, receipt.evidencePath)) as typeof receipt & { response: unknown; feedback: { checks: unknown; browserChecks: unknown; redChecks: unknown[] } };
    if (receipt.purpose !== 'regression-coverage' || !receipt.approved || !parseReview(bound.response, task).approved || fields.some(field => receipt[field] !== bound[field]) || receipt.planHash !== digest(JSON.stringify(value.plan)) || receipt.criteriaHash !== digest(JSON.stringify(task.acceptance))) throw new Error('Checkpoint regression approval is invalid.');
    if (JSON.stringify(bound.feedback.checks) !== JSON.stringify(report.checks) || JSON.stringify(bound.feedback.browserChecks) !== JSON.stringify(report.browserChecks) || regression.redChecks.length !== report.checks.length + report.browserChecks.length) throw new Error('Checkpoint regression checks do not match their approval.');
    for (const check of regression.redChecks) {
      if (check.status !== 'expected_failure' || !check.reportPath) throw new Error('Checkpoint regression red proof is invalid.');
      requireProof(check.logPath.split('/').at(-1)!); requireProof(check.reportPath.split('/').at(-1)!);
    }
    const normalize = (checks: ControllerState['redChecks']) => checks.map(check => ({ ...check, logPath: check.logPath.split('/').at(-1), reportPath: check.reportPath?.split('/').at(-1) }));
    if (JSON.stringify(normalize(bound.feedback.redChecks as ControllerState['redChecks'])) !== JSON.stringify(normalize(regression.redChecks))) throw new Error('Checkpoint regression red proofs do not match approval.');
    const approvedHashes = new Map((bound.feedback as typeof bound.feedback & { acceptedChecks?: { path: string; hash: string }[] }).acceptedChecks?.map(file => [file.path, file.hash]));
    for (const check of [...report.checks.map(check => check.file), ...report.browserChecks.map(check => `acceptance/${check.file}`)]) if (approvedHashes.get(check) !== value.acceptedChecks.find(file => file.path === check)?.hash || !approvedHashes.has(check)) throw new Error('Checkpoint regression test hash does not match approval.');
  }
  if (value.pendingRegression) {
    const { receipt, review } = value.pendingRegression;
    requireProof(receipt.evidencePath);
    const bound = readJson(join(directory, receipt.evidencePath)) as typeof receipt & { response: unknown };
    if (!['integrated-code', 'integrated-code-and-whole-goal', 'delivery-code'].includes(receipt.purpose) || receipt.approved || fields.some(field => receipt[field] !== bound[field]) || JSON.stringify(parseReview(bound.response, task)) !== JSON.stringify(parseReview(review, task)) || receipt.planHash !== digest(JSON.stringify(value.plan)) || receipt.criteriaHash !== digest(JSON.stringify(task.acceptance)) || !review.needsRegression || value.sourceHash !== receipt.sourceHash) throw new Error('Checkpoint pending regression review is invalid.');
  }
  return value;
}

export function restoreCheckpoint(checkpoint: Checkpoint, directory: string, workspace: string): void {
  const patch = join(directory, 'checkpoint.patch');
  if (readFileSync(patch).length) git(workspace, ['apply', patch]);
  const source = snapshot(workspace);
  if (source.hash !== checkpoint.sourceHash) throw new Error('Restored checkpoint source hash mismatch.');
  assertTestInventory(source.files, checkpoint.acceptedChecks);
}

export function captureInterruptedDraft(directory: string): void {
  if (!existsSync(join(directory, 'checkpoint.json')) || !existsSync(join(directory, 'workspace', '.git'))) return;
  const value = readJson(join(directory, 'checkpoint.json')) as Checkpoint;
  if (!value.accepted) return;
  const state = readJson(join(directory, 'state.json')) as ControllerState;
  if (state.pendingRegression) return;
  const task = readJson(join(directory, 'task.json')) as Task;
  const original = readJson(join(directory, 'baseline.json')) as ReturnType<typeof snapshot>;
  const current = snapshot(state.workspace);
  const hashes = new Map(current.files.map(file => [file.path, file.hash]));
  const baselinePaths = new Set(original.files.map(file => file.path));
  const accepted = new Map((readJson(join(directory, 'accepted-checks.json')) as { path: string; hash: string }[]).map(file => [file.path, file.hash]));
  for (const [path, hash] of accepted) if (hashes.get(path) !== hash) throw new Error(`Interrupted draft changed frozen controls or checks: ${path}`);
  const baseline = new Map(original.files.map(file => [file.path, file.hash]));
  for (const path of new Set([...baseline.keys(), ...hashes.keys()])) {
    if (baseline.get(path) === hashes.get(path) || accepted.has(path) && accepted.get(path) === hashes.get(path)) continue;
    if (!task.scope.some(scope => scope.endsWith('/') ? path.startsWith(scope) : path === scope) || protectedPath(path, baselinePaths)) throw new Error(`Interrupted draft changed scope: ${path}`);
  }
  saveCheckpoint(state, task, value.environment, true);
  writeJson(join(directory, 'recovered-draft.json'), { sourceHash: current.hash, recoveredAt: new Date().toISOString() });
}
