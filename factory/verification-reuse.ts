import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Issue } from '../src/domain.ts';
import type { Requirement, WorkRun } from '../src/workflow.ts';
import type { ControllerState, Verification } from './controller.ts';
import { parsePlan, parseReview, parseTask } from './contracts.ts';
import type { Review } from './contracts.ts';
import { inspectNodeReport, parseVerificationContract, readJson, snapshot, writeJson } from './evidence.ts';
import { commitSnapshot } from './maintenance.ts';
import { git, protectedPath } from './workspace.ts';

type WholeGoal = { requirementId: number; goal: string };
type Proof = { path: string; hash: string };
type Certificate = {
  schemaVersion: 2;
  profile: 'code-only';
  runId: string;
  taskId: string;
  branch: string;
  commit: string;
  sourceHash: string;
  environment: string;
  wholeGoal?: WholeGoal;
  verification: { summaryPath: string; nodePath: string; contractPath: string; runId: string; startedAt: string; completedAt: string };
  reviewReceiptPath: string;
  proofs: Proof[];
  createdAt: string;
};

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const engine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certificateName = 'integrated-verification-certificate.json';

function dependencyIdentity(repository: string): string {
  const entries: { path: string; hash: string }[] = [];
  const walk = (path: string, name: string, ancestors: Set<string>) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      entries.push({ path: name, hash: digest(`symlink:${readlinkSync(path)}`) });
      const target = realpathSync(path);
      if (lstatSync(target).isDirectory()) walk(target, `${name}/target`, ancestors);
      else entries.push({ path: `${name}/target`, hash: digest(readFileSync(target)) });
    } else if (stat.isDirectory()) {
      const actual = realpathSync(path);
      if (ancestors.has(actual)) throw new Error('Dependency installation contains a directory cycle.');
      const next = new Set([...ancestors, actual]);
      for (const entry of readdirSync(path).sort()) {
        if (name === 'node_modules' && ['.vite', '.vite-temp', '.cache'].includes(entry)) continue;
        walk(join(path, entry), name ? `${name}/${entry}` : entry, next);
      }
    } else if (stat.isFile()) entries.push({ path: name, hash: digest(readFileSync(path)) });
    else throw new Error('Dependency installation contains an unsupported entry.');
  };
  walk(realpathSync(join(repository, 'node_modules')), 'node_modules', new Set());
  return digest(JSON.stringify(entries));
}

function environment(source: { files: { path: string; hash: string }[] }, repository: string): string {
  const paths = new Set(source.files.map(file => file.path));
  return digest(JSON.stringify({
    controls: source.files.filter(file => protectedPath(file.path, paths)),
    engine: snapshot(engine).files.filter(file => /^(factory|scripts)\//.test(file.path)),
    runtime: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch, locale: { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, TZ: process.env.TZ } },
    dependencies: dependencyIdentity(repository),
  }));
}

export function verificationInputIdentity(repository: string): string { return environment(snapshot(repository), repository); }

function evidencePath(directory: string, path: string): string {
  const absolute = resolve(directory, path);
  const within = relative(realpathSync(directory), realpathSync(absolute));
  if (!within || within.startsWith('..') || within.startsWith('/')) throw new Error('Reusable verification evidence escaped its owner directory.');
  return absolute;
}

function inspect(directory: string, sourceHash: string, certificate?: Certificate) {
  const state = readJson(join(directory, 'state.json')) as ControllerState;
  const task = parseTask(readJson(join(directory, 'task.json')));
  const plan = parsePlan(readJson(join(directory, 'plan.json')), task);
  const integration = readJson(join(directory, 'integration.json')) as { branch: string; commit: string };
  if (state.status !== 'merged' || !state.integration || state.integration.commit !== integration.commit || state.integration.branch !== integration.branch || state.taskId !== task.id || JSON.stringify(state.plan) !== JSON.stringify(plan)) throw new Error('Reusable verification has no matching completed integration.');
  const verification = state.integration.verification as Verification & { runId?: string; startedAt?: string; completedAt?: string; contractPath?: string; snapshot: { hash: string; files?: { path: string; hash: string }[] } };
  if (!verification?.runDirectory) throw new Error('Reusable verification has no integrated report.');
  const summaryPath = evidencePath(directory, join(verification.runDirectory, 'summary.json'));
  const summary = readJson(summaryPath) as typeof verification;
  if (JSON.stringify(summary) !== JSON.stringify(verification) || summary.status !== 'passed' || summary.snapshot?.hash !== sourceHash || !summary.snapshot.files || digest(JSON.stringify(summary.snapshot.files)) !== sourceHash || !summary.runId || !summary.startedAt || !summary.completedAt || !Number.isFinite(Date.parse(summary.startedAt)) || !Number.isFinite(Date.parse(summary.completedAt)) || Date.parse(summary.completedAt) < Date.parse(summary.startedAt)) throw new Error('Reusable verification source or timestamps do not match the real summary.');
  const inputPath = evidencePath(directory, join(summary.runDirectory, 'verification-input.json'));
  const inputs = readJson(inputPath) as { schemaVersion: number; sourceHash: string; before: string; after: string; verificationRunId: string; summaryHash: string };
  if (inputs.schemaVersion !== 1 || inputs.sourceHash !== sourceHash || !/^[a-f0-9]{64}$/.test(inputs.before) || inputs.before !== inputs.after || inputs.verificationRunId !== summary.runId || inputs.summaryHash !== digest(readFileSync(summaryPath)) || certificate && inputs.before !== certificate.environment) throw new Error('Verification-time input identity stamp is missing or changed.');
  const gates = ['lint', 'typecheck', 'test', 'build'];
  if (summary.profile !== 'code-only' || summary.checks.length !== gates.length || !gates.every(name => summary.checks.filter(check => check.name === name && check.status === 'passed').length === 1)) throw new Error('Reusable verification lacks complete passed gates.');
  const contractPath = evidencePath(directory, summary.contractPath!);
  const contract = parseVerificationContract(readJson(contractPath));
  for (const check of plan.slices.flatMap(slice => slice.checks)) if (!contract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) throw new Error('Reusable verification omitted a planned Node check.');
  const nodePath = evidencePath(directory, join(summary.runDirectory, 'node-results.jsonl'));
  const node = inspectNodeReport(nodePath, contract.requiredNodeTests);
  if (node.passed !== summary.node?.passed) throw new Error('Reusable verification counts do not match actual reports.');
  const receipt = state.reviewReceipts?.filter(item => ['integrated-code', 'integrated-code-and-whole-goal'].includes(item.purpose) && item.approved && item.sourceHash === sourceHash).at(-1);
  if (!receipt) throw new Error('Reusable verification has no independent integrated approval.');
  const reviewReceiptPath = evidencePath(directory, receipt.evidencePath);
  const bound = readJson(reviewReceiptPath) as typeof receipt & { response: unknown; feedback: { wholeGoal?: WholeGoal } };
  for (const field of ['purpose', 'planHash', 'sourceHash', 'criteriaHash', 'contractHash', 'approved', 'summary', 'evidencePath'] as const) if (bound[field] !== receipt[field]) throw new Error('Reusable review receipt does not match controller metadata.');
  const review = parseReview(bound.response, task);
  if (!review.approved || review.findings.length || JSON.stringify(review) !== JSON.stringify(state.integration.review) || receipt.planHash !== digest(JSON.stringify(plan)) || receipt.criteriaHash !== digest(JSON.stringify(task.acceptance)) || receipt.contractHash !== digest(JSON.stringify(contract))) throw new Error('Reusable review is not bound to the exact source, plan, criteria and contract.');
  const paths = [summaryPath, inputPath, nodePath, contractPath, reviewReceiptPath, join(directory, 'task.json'), join(directory, 'plan.json'), join(directory, 'integration.json')];
  const proofs = [...new Set(paths)].map(path => ({ path: relative(directory, path), hash: digest(readFileSync(path)) }));
  if (certificate && (JSON.stringify(proofs) !== JSON.stringify(certificate.proofs) || certificate.runId !== state.runId || certificate.taskId !== task.id || certificate.branch !== integration.branch || certificate.commit !== integration.commit || certificate.reviewReceiptPath !== relative(directory, reviewReceiptPath) || certificate.verification.summaryPath !== relative(directory, summaryPath) || certificate.verification.nodePath !== relative(directory, nodePath) || certificate.verification.contractPath !== relative(directory, contractPath) || certificate.verification.runId !== summary.runId || certificate.verification.startedAt !== summary.startedAt || certificate.verification.completedAt !== summary.completedAt)) throw new Error('Reusable certificate artifacts changed.');
  return { state, task, plan, integration, summary, inputs, contract, receipt, bound, review, proofs, summaryPath, nodePath, contractPath, reviewReceiptPath };
}

export function captureIntegratedVerification(input: { repository: string; runDirectory: string; branch: string; commit: string; wholeGoal?: WholeGoal }): Certificate {
  const source = commitSnapshot(input.repository, input.commit);
  if (git(input.repository, ['rev-parse', `refs/heads/${input.branch}`]).trim() !== input.commit) throw new Error('Reusable integration target moved before capture.');
  const value = inspect(input.runDirectory, source.hash);
  if (value.integration.commit !== input.commit || value.integration.branch !== input.branch) throw new Error('Reusable certificate target differs from integration.');
  const currentEnvironment = environment(source, input.repository);
  if (value.inputs.before !== currentEnvironment) throw new Error('Integrated verification input identity changed before certificate capture.');
  const certificate: Certificate = { schemaVersion: 2, profile: 'code-only', runId: value.state.runId, taskId: value.task.id, branch: input.branch, commit: input.commit, sourceHash: source.hash, environment: currentEnvironment, ...(input.wholeGoal ? { wholeGoal: input.wholeGoal } : {}), verification: { summaryPath: relative(input.runDirectory, value.summaryPath), nodePath: relative(input.runDirectory, value.nodePath), contractPath: relative(input.runDirectory, value.contractPath), runId: value.summary.runId!, startedAt: value.summary.startedAt!, completedAt: value.summary.completedAt! }, reviewReceiptPath: relative(input.runDirectory, value.reviewReceiptPath), proofs: value.proofs, createdAt: new Date().toISOString() };
  writeJson(join(input.runDirectory, certificateName), certificate);
  return certificate;
}

export function reusableRequirementVerification(input: { repository: string; cwd: string; branch: string; requirement: Requirement; children: Issue[]; runs: WorkRun[]; onRejected?: (reason: string) => void }): { verification: Verification; review?: Review; provenance: { runId: string; certificatePath: string; verificationRunId: string; startedAt: string; completedAt: string; reviewReused: boolean } } | undefined {
  try {
    if (!input.children.length || input.children.some(child => child.work?.requirementId !== input.requirement.id || child.work.repoId !== input.requirement.repoId)) throw new Error('Requirement child membership or repository does not match.');
    const latest = input.children.map(child => input.runs.filter(run => run.repoId === input.requirement.repoId && run.requirementId === input.requirement.id && run.issueId === child.id).sort((a, b) => b.jobId - a.jobId)[0]);
    if (latest.some(run => !run || run.status !== 'merged')) throw new Error('Every current child needs its latest merged run.');
    const head = git(input.repository, ['rev-parse', `refs/heads/${input.branch}`]).trim();
    const source = snapshot(input.cwd);
    let candidate: { run: WorkRun; path: string; certificate: Certificate } | undefined;
    for (const run of latest) {
      const path = join(run.evidencePath, certificateName);
      if (!existsSync(path)) continue;
      const certificate = readJson(path) as Certificate;
      if (certificate.branch === input.branch && certificate.commit === head && certificate.sourceHash === source.hash) {
        candidate = { run, path, certificate };
        break;
      }
    }
    if (!candidate) throw new Error('No current merged child has an integrated verification certificate for the exact target source.');
    const { run, path, certificate } = candidate;
    if (certificate.schemaVersion !== 2 || certificate.profile !== 'code-only' || certificate.runId !== run.id || certificate.taskId !== `issue-${run.issueId}` || certificate.branch !== input.branch || certificate.commit !== head || certificate.sourceHash !== source.hash || certificate.environment !== environment(source, input.cwd)) throw new Error('Certificate run, exact target, source, runtime, dependencies or engine identity changed.');
    const value = inspect(run.evidencePath, source.hash, certificate);
    const base = parseVerificationContract(readJson(join(input.cwd, 'factory/verification-contract.json')));
    if (base.requiredNodeTests.some(check => !value.contract.requiredNodeTests.some(item => item.file === check.file && item.title === check.title)) || base.requiredBrowserTests.some(check => !value.contract.requiredBrowserTests.some(item => item.file === check.file && item.title === check.title))) throw new Error('Current required verification identities are missing from the integrated proof.');
    const child = input.children.find(child => child.id === run.issueId)!;
    if (value.task.title !== child.title || value.task.goal !== (child.description || child.title) || JSON.stringify(value.task.acceptance.map(item => item.description)) !== JSON.stringify(child.work!.acceptance)) throw new Error('Current child goal or acceptance differs from the source-bound task.');
    const wholeGoal = { requirementId: input.requirement.id, goal: input.requirement.goal };
    const taskWholeGoal = (value.task as typeof value.task & { wholeGoal?: WholeGoal }).wholeGoal;
    const reviewReused = input.children.length === 1 && value.receipt.purpose === 'integrated-code-and-whole-goal' && JSON.stringify(certificate.wholeGoal) === JSON.stringify(wholeGoal) && JSON.stringify(taskWholeGoal) === JSON.stringify(wholeGoal) && JSON.stringify(value.bound.feedback.wholeGoal) === JSON.stringify(wholeGoal);
    return { verification: value.summary, ...(reviewReused ? { review: value.review } : {}), provenance: { runId: run.id, certificatePath: path, verificationRunId: certificate.verification.runId, startedAt: certificate.verification.startedAt, completedAt: certificate.verification.completedAt, reviewReused } };
  } catch (error) { input.onRejected?.(error instanceof Error ? error.message : String(error)); return undefined; }
}
