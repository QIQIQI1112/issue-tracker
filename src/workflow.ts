import { ValidationError } from './domain.ts';
import type { Issue } from './domain.ts';

export type Repo = { id: number; name: string; path: string; targetBranch: string; createdAt: string };
export type PlanSource = { kind: 'codex'; reference: string; summary: string };
export type Decomposition = { assumptions: { decision: string; reason: string }[]; issues: { key: string; title: string; description: string; acceptance: string[]; dependsOn: string[] }[] };
export type SubmissionPlan = Decomposition & { schemaVersion: 1; submissionId: string; repoId: number; requirement: { title: string; goal: string }; source: PlanSource };
export type PlanSubmission = { id: string; requirementId: number; planHash: string; plan: SubmissionPlan; issueIds: Record<string, number>; createdAt: string };
export type Requirement = { id: number; repoId: number; title: string; goal: string; status: 'draft' | 'queued' | 'running' | 'done' | 'blocked'; createdAt: string; updatedAt: string; submission?: { id: string; planHash: string; source: PlanSource } };
export type SubmissionReceipt = { submission: PlanSubmission; requirement: Requirement; issues: { key: string; issue: Issue }[]; jobs: Job[]; runs: WorkRun[] };
export type Assignment = { repoId: number; requirementId: number | null; dependsOn: number[]; acceptance: string[] };
export type Job = { id: number; repoId: number; requirementId: number | null; issueId: number | null; kind: 'decompose' | 'plan_review' | 'issue' | 'requirement_verify'; status: 'queued' | 'running' | 'completed' | 'blocked'; payload: string; runId: string | null; reason: string | null; createdAt: string; updatedAt: string };
export type WorkRun = { id: string; jobId: number; repoId: number; requirementId: number | null; issueId: number | null; status: 'running' | 'merged' | 'passed' | 'blocked'; evidencePath: string; reason: string | null; startedAt: string; completedAt: string | null };
export type Delivery = { schemaVersion: 1; runId: string; taskId: string; title: string; goal: string; summary?: string; behaviorChecks?: { file: string; title: string }[]; status: string; startedAt: string; completedAt: string; baseline: string | null; sourceHash: string | null; defaults: { decision: string; reason: string }[]; changes: { path: string; category: 'application' | 'tests' | 'harness' | 'documentation'; status: string }[]; checks: { name: string; status: string; durationMs?: number }[]; nodePassed: number; browserPassed: number; attempts: number; review: { approved: boolean; summary: string } | null; integration: { branch: string; before: string; commit: string } | null; limitations: string[]; evidence: { path: string; bytes: number; sha256: string }[] };
export type Workbench = { repos: Repo[]; requirements: Requirement[]; jobs: Job[]; runs: WorkRun[] };

export class ConflictError extends Error {}

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
  return { repoId: positiveId(value.repoId), requirementId: value.requirementId === null ? null : positiveId(value.requirementId), dependsOn, acceptance: criteria(value.acceptance) };
}
