import { ValidationError } from './domain.ts';
import type { Issue } from './domain.ts';

export type GitHubEnrollment = { repository: string; remote: string; workflow: string };
export type Publication = GitHubEnrollment & { branch: string; baseBranch: string; state: 'pending' | 'awaiting_ci' | 'blocked' | 'merged'; baseCommit?: string; headCommit?: string; verifiedRunId?: string; deadline?: number; number?: number; url?: string; ciRunId?: number; ciUrl?: string; ciHead?: string; mergeCommit?: string; reason?: string };
export type Repo = { github?: GitHubEnrollment; id: number; name: string; path: string; targetBranch: string; createdAt: string };
export type PlanSource = { kind: 'codex'; reference: string; summary: string };
export type ChangeKind = 'feature' | 'acceptance_contract' | 'harness';
export type Decomposition = { assumptions: { decision: string; reason: string }[]; issues: { key: string; title: string; description: string; acceptance: string[]; dependsOn: string[]; changeKind?: ChangeKind }[] };
export type SubmissionPlan = Decomposition & { schemaVersion: 1 | 2; submissionId: string; repoId: number; requirement: { title: string; goal: string }; source: PlanSource };
export type PlanSubmission = { id: string; requirementId: number; planHash: string; plan: SubmissionPlan; issueIds: Record<string, number>; createdAt: string };
export type Requirement = { publication?: Publication; id: number; repoId: number; title: string; goal: string; status: 'draft' | 'queued' | 'running' | 'done' | 'blocked'; createdAt: string; updatedAt: string; submission?: { id: string; planHash: string; source: PlanSource } };
export type SubmissionReceipt = { submission: PlanSubmission; requirement: Requirement; issues: { key: string; issue: Issue }[]; jobs: Job[]; runs: WorkRun[] };
export type Assignment = { repoId: number; requirementId: number | null; dependsOn: number[]; acceptance: string[]; changeKind?: ChangeKind };
export type Job = { availableAt?: number; id: number; repoId: number; requirementId: number | null; issueId: number | null; kind: 'decompose' | 'plan_review' | 'issue' | 'maintenance' | 'requirement_verify' | 'requirement_publish'; status: 'queued' | 'running' | 'completed' | 'blocked'; payload: string; runId: string | null; reason: string | null; createdAt: string; updatedAt: string };
export type WorkRun = { id: string; jobId: number; repoId: number; requirementId: number | null; issueId: number | null; status: 'running' | 'merged' | 'passed' | 'blocked'; evidencePath: string; reason: string | null; startedAt: string; completedAt: string | null };
export type RunProgress = { schemaVersion: 2; runId: string; profile: 'feature' | 'acceptance_contract' | 'harness'; status: string; stage: string; sourceHash: string; transitions: { stage: string; startedAt: string; completedAt?: string; durationMs: number }[]; failure?: { kind: string; message: string; stage: string } };
export type ExecutionPhase = { name: string; startedAt: string; completedAt?: string; durationMs: number; status: 'running' | 'passed' | 'failed' };
export type ReviewReceipt = { purpose: string; planHash: string; sourceHash: string; criteriaHash: string; contractHash: string; approved: boolean; summary: string; evidencePath: string; reusedFromRunId?: string };
export type ExecutionProfile = { profile: 'adaptive-v2'; coverageMode: 'reuse' | 'extend'; route: 'light' | 'standard'; reason: string };
export type Efficiency = { agentInvocations: number; testAuthoringInvocations: number; verificationExecutions: number; verificationRetries: number; verificationReuses: number; elapsedMs: number; durations: { planningMs: number; testAuthoringMs: number; acceptanceReviewMs: number; implementationMs: number; verificationMs: number; codeReviewMs: number } };
export type Delivery = { lifecycle?: { profile: 'feature' | 'acceptance_contract' | 'harness'; queuedAt: string; claimedAt: string; completedAt: string; queueWaitMs: number; wallMs: number }; execution?: ExecutionProfile; efficiency?: Efficiency; publication?: Publication; schemaVersion: 1; phases?: ExecutionPhase[]; reviewReceipts?: ReviewReceipt[]; resume?: { fromRunId?: string; reused: boolean; reason: string }; failedPhase?: string; failureKind?: string; budget?: { usedMs: number; implementationAttempts: number; acceptanceAttempts: number; infrastructureRetries?: number; maxAttempts: number; totalTimeoutMs: number }; runId: string; taskId: string; title: string; goal: string; summary?: string; workerObservations?: { attempt: number; summary: string }[]; behaviorChecks?: { file: string; title: string }[]; status: string; startedAt: string; completedAt: string; baseline: string | null; sourceHash: string | null; defaults: { decision: string; reason: string }[]; changes: { path: string; category: 'application' | 'tests' | 'harness' | 'documentation'; status: string }[]; checks: { name: string; status: string; durationMs?: number }[]; nodePassed: number; browserPassed: number; attempts: number; review: { approved: boolean; summary: string } | null; integration: { branch: string; before: string; commit: string } | null; limitations: string[]; evidence: { path: string; bytes: number; sha256: string }[] };
export type Workbench = { repos: Repo[]; requirements: Requirement[]; jobs: Job[]; runs: WorkRun[] };

export class ConflictError extends Error {}

export function changeKind(input: unknown): ChangeKind {
  if (input !== 'feature' && input !== 'acceptance_contract' && input !== 'harness') throw new ValidationError('Change kind must be feature, acceptance_contract, or harness.');
  return input;
}

export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Expected an object.');
  return input as Record<string, unknown>;
}

export function positiveId(input: unknown): number {
  if (!Number.isSafeInteger(input) || Number(input) < 1) throw new ValidationError('Expected a positive safe integer ID.');
  return Number(input);
}

export function boundedText(input: unknown, name: string, maximum = 10000): string {
  if (typeof input !== 'string' || !input.trim() || input.length > maximum) throw new ValidationError(`${name} must contain 1–${maximum} characters.`);
  return input.trim();
}

export function criteria(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.length > 30) throw new ValidationError('Provide 1–30 acceptance conditions.');
  return input.map(value => boundedText(value, 'Acceptance condition', 1000));
}

export function assignment(input: unknown): Assignment {
  const value = record(input);
  if (!Array.isArray(value.dependsOn) || value.dependsOn.length > 30) throw new ValidationError('Dependencies must be an array of at most 30 issue IDs.');
  const dependsOn = value.dependsOn.map(positiveId);
  if (new Set(dependsOn).size !== dependsOn.length) throw new ValidationError('Duplicate dependencies are not allowed.');
  return { repoId: positiveId(value.repoId), requirementId: value.requirementId === null ? null : positiveId(value.requirementId), dependsOn, acceptance: criteria(value.acceptance), ...('changeKind' in value ? { changeKind: changeKind(value.changeKind) } : {}) };
}

export function githubEnrollment(input: unknown): GitHubEnrollment {
  const value = record(input);
  if (typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository) || value.repository.length > 200) throw new ValidationError('GitHub repository must be owner/name.');
  const remote = value.remote ?? 'origin';
  const workflow = value.workflow ?? 'verify.yml';
  if (typeof remote !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(remote)) throw new ValidationError('Invalid Git remote name.');
  if (typeof workflow !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.ya?ml$/.test(workflow)) throw new ValidationError('GitHub workflow must be a YAML filename.');
  return { repository: value.repository, remote, workflow };
}
