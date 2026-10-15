import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { ControllerState } from './controller.ts';
import type { Task, Plan } from './contracts.ts';
import { parsePlan, parseReview } from './contracts.ts';
import { snapshot, readJson, writeJson } from './evidence.ts';
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

type Checkpoint = { schemaVersion: 1; runId: string; taskHash: string; environment: string; baselineTree: string; baseCommit: string; sourceHash: string; patchHash: string; accepted: boolean; plan?: Plan; acceptedChecks: { path: string; hash: string }[]; redChecks: ControllerState['redChecks']; proofs: { path: string; hash: string }[] };

export function saveCheckpoint(state: ControllerState, task: Task, environment: string, accepted: boolean): void {
  if (!state.baselineTree || !state.baseCommit) return;
  const source = snapshot(state.workspace);
  const present = source.files.filter(file => existsSync(join(state.workspace, file.path))).map(file => file.path);
  if (present.length) git(state.workspace, ['add', '-N', '--', ...present]);
  const patch = git(state.workspace, ['diff', '--binary', state.baselineTree, '--']);
  writeFileSync(join(state.runDirectory, 'checkpoint.patch.tmp'), patch);
  const paths = ['acceptance-review.json', ...state.redChecks.flatMap(check => [relative(state.runDirectory, check.logPath), relative(state.runDirectory, check.logPath).replace(/\.log$/, '.jsonl')])];
  const proofs = accepted ? paths.map(path => ({ path, hash: digest(readFileSync(join(state.runDirectory, path))) })) : [];
  const checkpoint: Checkpoint = { schemaVersion: 1, runId: state.runId, taskHash: taskIdentity(task), environment, baselineTree: state.baselineTree, baseCommit: state.baseCommit, sourceHash: source.hash, patchHash: digest(patch), accepted, plan: state.plan, acceptedChecks: source.files.filter(file => /^(tests|acceptance)\//.test(file.path)), redChecks: state.redChecks, proofs };
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
  for (const proof of value.proofs) {
    if (relative(directory, resolve(directory, proof.path)) !== proof.path || proof.path.startsWith('..') || !/^(acceptance-review\.json|red-\d+\.(log|jsonl))$/.test(proof.path)) throw new Error('Invalid checkpoint proof path.');
    if (digest(readFileSync(join(directory, proof.path))) !== proof.hash) throw new Error('Checkpoint proof hash mismatch.');
  }
  const review = parseReview(readJson(join(directory, 'acceptance-review.json')), task);
  if (!review.approved) throw new Error('Checkpoint acceptance review was not approved.');
  return value;
}

export function restoreCheckpoint(checkpoint: Checkpoint, directory: string, workspace: string): void {
  const patch = join(directory, 'checkpoint.patch');
  if (readFileSync(patch).length) git(workspace, ['apply', patch]);
  const source = snapshot(workspace);
  if (source.hash !== checkpoint.sourceHash) throw new Error('Restored checkpoint source hash mismatch.');
  const hashes = new Map(source.files.map(file => [file.path, file.hash]));
  for (const file of checkpoint.acceptedChecks) if (hashes.get(file.path) !== file.hash) throw new Error('Restored accepted checks changed.');
}

export function captureInterruptedDraft(directory: string): void {
  if (!existsSync(join(directory, 'checkpoint.json')) || !existsSync(join(directory, 'workspace', '.git'))) return;
  const value = readJson(join(directory, 'checkpoint.json')) as Checkpoint;
  if (!value.accepted) return;
  const state = readJson(join(directory, 'state.json')) as ControllerState;
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
