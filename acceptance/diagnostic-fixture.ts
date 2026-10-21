import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { IssueStore } from '../src/storage.ts';
import type { Job, WorkRun } from '../src/workflow.ts';

export function recordDiagnosticRun(store: IssueStore, database: DatabaseSync, input: {
  root: string;
  repoId: number;
  requirementId: number | null;
  issueId: number | null;
  status: Exclude<Job['status'], 'queued'>;
  kind?: Job['kind'];
  reason?: string | null;
}): WorkRun {
  const { root, repoId, requirementId, issueId, status, kind = 'issue', reason = null } = input;
  const id = randomUUID();
  const now = new Date().toISOString();
  const jobId = Number(database.prepare('INSERT INTO jobs (repo_id, requirement_id, issue_id, kind, status, payload, run_id, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(repoId, requirementId, issueId, kind, status, '{}', id, reason, now, now).lastInsertRowid);
  const runStatus = status === 'completed' ? kind === 'issue' ? 'merged' : 'passed' : status;
  const evidencePath = join(root, id);
  mkdirSync(evidencePath, { recursive: true });
  database.prepare('INSERT INTO work_runs (id, job_id, repo_id, requirement_id, issue_id, status, evidence_path, reason, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, jobId, repoId, requirementId, issueId, runStatus, evidencePath, reason, now, status === 'running' ? null : now);
  return store.work.run(id)!;
}
