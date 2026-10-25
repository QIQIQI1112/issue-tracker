import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { IssueStore } from '../src/storage.ts';
import type { Task } from './contracts.ts';
import type { OwnerAuthorization } from './profiles.ts';
import { safeScope } from './profiles.ts';
import { assertTestInventory, digest, environmentIdentity, loadCheckpoint, taskIdentity } from './checkpoint.ts';
import { completeVerification, parseVerificationContract, readJson, snapshot } from './evidence.ts';
import { commitSnapshot, maintenanceIdentity } from './maintenance.ts';
import { git, protectedPath } from './workspace.ts';
import { assertRunQuiescent } from './ownership.ts';
import type { ControllerState } from './execution-types.ts';
import { parseRunState } from './stages.ts';

type File = { path: string; hash: string };
type Binding = File;
type Replacement = { path: string; originalHash: string; replacementHash: string; content: string };
type Artifact = { schemaVersion: number; taskId: string; original: { issueId: number; requirementId: number | null; runId: string; taskHash: string; taskFile: Binding; task: Task; plan: Binding; checkpoint: Binding; checkpointPatch: Binding; baseCommit: string; baselineTree: string; environment: string; sourceHash: string; ownerAuthorization: Binding; state: Binding; acceptedChecksFile: Binding; acceptanceReceipt: Binding; checkpointProofs: Binding[] }; revision: { patch: Binding; approvedPatch: Binding; sourceHash: string; originalInventory: File[]; proposedInventory: File[]; files: Replacement[] }; independentApproval: Binding & { sourceHash: string }; delivery: { target: string } };
type Redemption = { schemaVersion: number; artifact: Binding; contractRunId: string; transition: { originalAuthorization: Binding; currentAuthorization: Binding; runtime: { node: string; platform: string; arch: string } } };
export type AcceptedRevision = { directory: string; checkpoint: ReturnType<typeof loadCheckpoint>; files: File[]; tree: string; replacements: Replacement[]; bindings: Binding[]; targetCommit: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const testPath = (path: string) => /^(tests|acceptance)\//.test(path);
const scoped = (path: string, scope: string[]) => scope.some(item => item.endsWith('/') ? path.startsWith(item) : item === path);
function requireRevision(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(`Accepted test revision: ${reason}.`); }
function inventory(files: File[]) {
  requireRevision(Array.isArray(files) && files.every(file => file && safeScope(file.path) && !file.path.endsWith('/') && /^[a-f0-9]{64}$/.test(file.hash)) && new Set(files.map(file => file.path)).size === files.length, 'invalid source inventory');
}
export function assertRevisionBindings(bindings: Binding[]): void {
  for (const file of bindings) requireRevision(isAbsolute(file.path) && digest(readFileSync(file.path)) === file.hash, `changed evidence ${file.path}`);
}
function candidateTree(repository: string, directory: string, checkpoint: ReturnType<typeof loadCheckpoint>, approvedPatch?: string): string {
  const temporary = mkdtempSync(join(tmpdir(), 'revision-index-'));
  try {
    const run = (args: string[]) => execFileSync('git', args, { cwd: repository, env: { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
    run(['read-tree', checkpoint.baselineTree]);
    if (readFileSync(join(directory, 'checkpoint.patch')).length) run(['apply', '--cached', join(directory, 'checkpoint.patch')]);
    if (approvedPatch) run(['apply', '--cached', approvedPatch]);
    return run(['write-tree']);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function validateAcceptedRevision(store: IssueStore, path: string, input: { issueId: number; directory: string; task: Task; authority: OwnerAuthorization; target: string }): AcceptedRevision {
  const bindings: Binding[] = [];
  const bind = (binding: Binding, expected?: string): Buffer => {
    requireRevision(binding && typeof binding.path === 'string' && isAbsolute(binding.path) && /^[a-f0-9]{64}$/.test(binding.hash) && (!expected || resolve(binding.path) === resolve(expected)), 'invalid evidence binding');
    const bytes = readFileSync(binding.path);
    requireRevision(digest(bytes) === binding.hash, `changed evidence ${binding.path}`);
    bindings.push(binding); return bytes;
  };
  requireRevision(isAbsolute(path), 'redemption requires an absolute path');
  const request = JSON.parse(bind({ path, hash: digest(readFileSync(path)) }).toString()) as Redemption;
  requireRevision(request.schemaVersion === 1 && same(Object.keys(request).sort(), ['artifact', 'contractRunId', 'schemaVersion', 'transition']), 'unsupported redemption request');
  const artifact = JSON.parse(bind(request.artifact).toString()) as Artifact;
  const issue = store.get(input.issueId)!;
  const repo = store.work.repo(issue.work!.repoId)!;
  requireRevision(input.authority, 'explicit current authority is required');
  const original = artifact.original;
  requireRevision(artifact.schemaVersion === 1 && original.issueId === issue.id && original.requirementId === issue.work!.requirementId && original.runId === input.directory.split('/').at(-1) && original.taskHash === taskIdentity(input.task), 'original task or run mismatch');
  const originalTask = JSON.parse(bind(original.taskFile, join(input.directory, 'task.json')).toString()) as Task;
  requireRevision(same(original.task, originalTask) && taskIdentity(originalTask) === taskIdentity(input.task), 'original task changed');
  const originalAuthority = JSON.parse(bind(original.ownerAuthorization, join(input.directory, 'owner-authorization.json')).toString()) as OwnerAuthorization;
  requireRevision(originalAuthority.baseCommit === original.baseCommit, 'historical authority base mismatch');
  bind(request.transition.originalAuthorization, original.ownerAuthorization.path);
  requireRevision(request.transition.originalAuthorization.hash === original.ownerAuthorization.hash && same(JSON.parse(bind(request.transition.currentAuthorization).toString()), input.authority), 'authority transition mismatch');
  for (const field of ['issueId', 'issueHash', 'profile', 'scope', 'contractHash'] as const) requireRevision(same(originalAuthority[field], input.authority[field]), `original authority ${field} changed`);
  requireRevision(same(request.transition.runtime, { node: process.version, platform: process.platform, arch: process.arch }), 'runtime transition is unsupported');
  const supervisorPath = join(input.directory, 'supervisor.json');
  const supervisor = readJson(supervisorPath) as { directory: string; sourceHash: string; contractHash: string };
  bind({ path: supervisorPath, hash: digest(readFileSync(supervisorPath)) });
  const engine = snapshot(supervisor.directory);
  requireRevision(engine.hash === originalAuthority.engineSourceHash && supervisor.sourceHash === engine.hash && supervisor.contractHash === originalAuthority.contractHash && digest(readFileSync(join(supervisor.directory, 'factory/verification-contract.json'))) === originalAuthority.contractHash, 'historical pinned supervisor changed');
  for (const file of engine.files) bind({ path: join(supervisor.directory, file.path), hash: file.hash });
  const baseline = commitSnapshot(repo.path, original.baselineTree);
  const paths = new Set(baseline.files.map(file => file.path));
  const baselineEnvironment = digest(JSON.stringify({ controls: baseline.files.filter(file => protectedPath(file.path, paths)), runtime: { ...request.transition.runtime, engine: engine.files.filter(file => /^(factory|scripts)\//.test(file.path)) } }));
  const environment = [baselineEnvironment, environmentIdentity(repo.path, supervisor.directory)].find(identity => identity === original.environment);
  requireRevision(environment, 'historical environment mismatch');
  bind(original.checkpoint, join(input.directory, 'checkpoint.json'));
  bind(original.checkpointPatch, join(input.directory, 'checkpoint.patch'));
  const checkpoint = loadCheckpoint(input.directory, dirname(input.directory), originalTask, environment);
  requireRevision(checkpoint.runId === original.runId && checkpoint.baseCommit === original.baseCommit && checkpoint.baselineTree === original.baselineTree && checkpoint.sourceHash === original.sourceHash && !checkpoint.pendingRegression && !checkpoint.pendingFailureTriage && !checkpoint.regressions?.length && !checkpoint.missingPaths?.length, 'unsupported checkpoint hold or identity');
  bind(original.plan, join(input.directory, 'plan.json'));
  requireRevision(same(readJson(original.plan.path), checkpoint.plan), 'original plan changed');
  const originalState = JSON.parse(bind(original.state, join(input.directory, 'state.json')).toString()) as ControllerState;
  const originalProgressPath = join(input.directory, 'run-state.json');
  const originalProgress = parseRunState(JSON.parse(bind({ path: originalProgressPath, hash: digest(readFileSync(originalProgressPath)) }).toString()));
  requireRevision(originalState.status === 'blocked' && originalState.runId === original.runId && originalState.taskId === originalTask.id && originalProgress.status === 'blocked' && originalProgress.runId === original.runId && originalProgress.engine.sourceHash === originalAuthority.engineSourceHash && originalProgress.engine.contractHash === originalAuthority.contractHash, 'historical native execution identity mismatch');
  bind(original.acceptedChecksFile, join(input.directory, 'accepted-checks.json'));
  bind(original.acceptanceReceipt, join(input.directory, checkpoint.acceptanceReceipt!.evidencePath));
  requireRevision(same(original.checkpointProofs, checkpoint.proofs.map(proof => ({ path: join(input.directory, proof.path), hash: proof.hash }))), 'original proof inventory changed');
  for (const proof of original.checkpointProofs) bind(proof);
  const contractRun = store.work.run(request.contractRunId);
  requireRevision(contractRun?.status === 'merged' && contractRun.issueId !== null, 'contract maintenance is not natively merged');
  const contractIssue = store.get(contractRun.issueId)!;
  const contractRepo = store.work.repo(contractRun.repoId)!;
  const branch = contractIssue.work?.requirementId ? store.work.requirement(contractIssue.work.requirementId)?.publication?.branch ?? contractRepo.targetBranch : contractRepo.targetBranch;
  const common = (repository: string) => realpathSync(git(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  requireRevision(contractIssue.work?.changeKind === 'acceptance_contract' && artifact.taskId === `issue-${contractIssue.id}` && common(repo.path) === common(contractRepo.path) && branch === input.target && artifact.delivery.target === input.target, 'contract repository, branch or profile mismatch');
  assertRunQuiescent(contractRun.evidencePath);
  const native = <T>(name: string): T => JSON.parse(bind({ path: join(contractRun.evidencePath, name), hash: digest(readFileSync(join(contractRun.evidencePath, name))) }).toString()) as T;
  const state = native<ControllerState>('state.json');
  const authority = native<OwnerAuthorization>('owner-authorization.json');
  const delivery = native<{ status: string; integration?: ControllerState['integration'] }>('delivery.json');
  const job = store.work.jobs().find(job => job.id === contractRun.jobId);
  requireRevision(job?.kind === 'maintenance' && job.status === 'completed' && job.runId === contractRun.id && authority.issueId === contractIssue.id && authority.issueHash === maintenanceIdentity(contractIssue) && authority.profile === 'acceptance_contract' && state.status === 'merged' && state.runId === contractRun.id && delivery.status === 'merged' && delivery.integration?.commit === state.integration?.commit && delivery.integration?.branch === state.integration?.branch, 'invalid native contract delivery');
  const integration = state.integration;
  requireRevision(integration?.commit && integration.branch === input.target && integration.verification?.status === 'passed' && integration.review?.approved && !integration.review.findings.length, 'missing integrated verification or review');
  git(repo.path, ['merge-base', '--is-ancestor', integration.commit, `refs/heads/${input.target}`]);
  const merged = commitSnapshot(repo.path, integration.commit);
  const integrated = native<{ branch: string; commit: string; tree: string }>('integration.json');
  const progress = parseRunState(native('run-state.json'));
  requireRevision(integrated.commit === integration.commit && integrated.branch === input.target && git(repo.path, ['rev-parse', `${integration.commit}^{tree}`]).trim() === integrated.tree && progress.status === 'merged' && progress.profile === 'acceptance_contract' && progress.runId === contractRun.id && progress.taskId === artifact.taskId && progress.sourceHash === merged.hash && progress.engine.sourceHash === authority.engineSourceHash && progress.engine.contractHash === authority.contractHash, 'native integration identity mismatch');
  for (const key of ['verification', 'review'] as const) {
    const proof = progress.proofs[key];
    requireRevision(proof && proof.sourceHash === merged.hash, 'native source proof is missing');
    bind({ path: join(contractRun.evidencePath, proof.path), hash: proof.sha256 });
  }
  const artifactPath = safeScope(relative(repo.path, request.artifact.path)) ? relative(repo.path, request.artifact.path) : relative(contractRepo.path, request.artifact.path);
  requireRevision(safeScope(artifactPath) && scoped(artifactPath, authority.scope) && merged.files.some(file => file.path === artifactPath && file.hash === request.artifact.hash), 'artifact lacks merged source provenance');
  const verification = integration.verification;
  const verificationPath = join(verification.runDirectory, 'summary.json');
  requireRevision(same(JSON.parse(bind({ path: verificationPath, hash: digest(readFileSync(verificationPath)) }).toString()), verification), 'integrated verification changed');
  const contractPath = join(contractRun.evidencePath, 'trusted/factory/verification-contract.json');
  bind({ path: contractPath, hash: digest(readFileSync(contractPath)) });
  const contract = parseVerificationContract(readJson(contractPath));
  completeVerification(verification, { sourceHash: merged.hash, contract, nodePath: join(verification.runDirectory, 'node-results.jsonl'), message: 'Contract revision requires complete verified merged source.' });
  bind({ path: join(verification.runDirectory, 'node-results.jsonl'), hash: digest(readFileSync(join(verification.runDirectory, 'node-results.jsonl'))) });
  const receipt = state.reviewReceipts?.find(receipt => ['integrated-code', 'integrated-code-and-whole-goal'].includes(receipt.purpose) && receipt.approved && receipt.sourceHash === merged.hash);
  requireRevision(receipt, 'missing independent integrated source receipt');
  const review = native<{ sourceHash: string; approved: boolean; response: unknown }>(receipt.evidencePath);
  requireRevision(review.sourceHash === merged.hash && review.approved && same(review.response, integration.review), 'integrated source approval changed');
  const revision = artifact.revision;
  const approval = JSON.parse(bind(artifact.independentApproval).toString()) as { approved: boolean; findings: unknown[]; sourceHash: string; snapshot: ReturnType<typeof snapshot>; acceptedChecks: File[]; checks: unknown; browserChecks: unknown[]; original: { issueId: number; runId: string; sourceHash: string; taskHash: string; criteriaHash: string; planHash: string } };
  inventory(approval.snapshot.files); inventory(approval.acceptedChecks); inventory(revision.originalInventory); inventory(revision.proposedInventory);
  requireRevision(approval.approved === true && Array.isArray(approval.findings) && !approval.findings.length && approval.sourceHash === revision.sourceHash && artifact.independentApproval.sourceHash === revision.sourceHash && approval.snapshot.hash === revision.sourceHash && digest(JSON.stringify(approval.snapshot.files)) === revision.sourceHash, 'equivalence is unapproved or stale');
  requireRevision(approval.original.issueId === issue.id && approval.original.runId === original.runId && approval.original.sourceHash === original.sourceHash && approval.original.taskHash === original.taskHash && approval.original.criteriaHash === digest(JSON.stringify(originalTask.acceptance)) && approval.original.planHash === digest(JSON.stringify(checkpoint.plan)) && same(approval.checks, checkpoint.plan!.slices.flatMap(slice => slice.checks)) && same(approval.browserChecks, []), 'equivalence does not cover the original goal and named inventory');
  requireRevision(Array.isArray(revision.files) && revision.files.length > 0 && new Set(revision.files.map(file => file.path)).size === revision.files.length, 'invalid replacements');
  const originalHashes = new Map(checkpoint.acceptedChecks.map(file => [file.path, file.hash]));
  const replacements = new Map(revision.files.map(file => {
    requireRevision(safeScope(file.path) && testPath(file.path) && originalHashes.get(file.path) === file.originalHash && typeof file.content === 'string' && digest(file.content) === file.replacementHash && approval.snapshot.files.some(item => item.path === file.path && item.hash === file.replacementHash), 'replacement is not an approved existing accepted test');
    return [file.path, file];
  }));
  const files = approval.snapshot.files.map(file => ({ ...file, hash: replacements.get(file.path)?.originalHash ?? file.hash }));
  requireRevision(digest(JSON.stringify(files)) === original.sourceHash, 'replacement changes unapproved source');
  assertTestInventory(files, checkpoint.acceptedChecks); assertTestInventory(files, revision.originalInventory);
  assertTestInventory(approval.snapshot.files, approval.acceptedChecks); assertTestInventory(approval.snapshot.files, revision.proposedInventory);
  const patch = bind(revision.approvedPatch);
  requireRevision(revision.patch.hash === digest(patch) && safeScope(revision.patch.path) && merged.files.some(file => file.path === revision.patch.path && file.hash === revision.patch.hash), 'staged patch is not merged');
  const tree = candidateTree(repo.path, input.directory, checkpoint);
  requireRevision(commitSnapshot(repo.path, tree).hash === original.sourceHash, 'retained patch does not reconstruct original source');
  requireRevision(commitSnapshot(repo.path, candidateTree(repo.path, input.directory, checkpoint, revision.approvedPatch.path)).hash === revision.sourceHash, 'staged patch differs from approved replacements');
  const targetCommit = git(repo.path, ['rev-parse', `refs/heads/${input.target}`]).trim();
  const targetFiles = commitSnapshot(repo.path, targetCommit).files;
  const targetHashes = new Map(targetFiles.map(file => [file.path, file.hash]));
  const baselineHashes = new Map(baseline.files.map(file => [file.path, file.hash]));
  for (const file of files) {
    if (testPath(file.path)) requireRevision(!targetHashes.has(file.path) || targetHashes.get(file.path) === baselineHashes.get(file.path) || targetHashes.get(file.path) === file.hash || targetHashes.get(file.path) === replacements.get(file.path)?.replacementHash, `unexplained shared-test change ${file.path}`);
    else if (baselineHashes.get(file.path) !== file.hash) requireRevision(scoped(file.path, input.task.scope) && scoped(file.path, input.authority.scope), `retained draft exceeds authority ${file.path}`);
  }
  for (const file of baseline.files) if (!files.some(item => item.path === file.path)) requireRevision(!testPath(file.path) && scoped(file.path, input.task.scope) && scoped(file.path, input.authority.scope), 'unsupported retained deletion');
  return { directory: input.directory, checkpoint, files, tree, replacements: revision.files, bindings, targetCommit };
}

export function prepareAcceptedRevision(revision: AcceptedRevision, workspace: string): string[] {
  assertRevisionBindings(revision.bindings);
  requireRevision(git(workspace, ['rev-parse', 'HEAD']).trim() === revision.targetCommit, 'target moved after admission');
  const baseline = commitSnapshot(workspace, revision.checkpoint.baselineTree);
  const old = new Map(baseline.files.map(file => [file.path, file.hash]));
  const current = new Map(snapshot(workspace).files.map(file => [file.path, file.hash]));
  const replacements = new Map(revision.replacements.map(file => [file.path, file]));
  const overlaps: string[] = [];
  for (const file of revision.files) {
    if (!testPath(file.path) && old.get(file.path) === file.hash) continue;
    if (!testPath(file.path) && current.get(file.path) !== old.get(file.path)) overlaps.push(file.path);
    const path = join(workspace, file.path); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, replacements.get(file.path)?.content ?? execFileSync('git', ['show', `${revision.tree}:${file.path}`], { cwd: workspace, maxBuffer: 16 * 1024 * 1024 }));
  }
  const retained = new Set(revision.files.map(file => file.path));
  for (const file of baseline.files) if (!retained.has(file.path)) rmSync(join(workspace, file.path), { force: true });
  return overlaps;
}
