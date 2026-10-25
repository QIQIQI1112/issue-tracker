import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { resolveDatabasePath } from '../src/instance.ts';
import type { Agent } from './controller.ts';
import type { Job } from '../src/workflow.ts';
import { digest, taskIdentity } from './checkpoint.ts';
import { parseTask } from './contracts.ts';
import { executionBudget, grantExecutionBudget, validateOwnerGrant, validateRevisionBudget } from './budget.ts';
import { readJson, writeJson } from './evidence.ts';
import { acquireExecutionLease } from './lease.ts';
import { assertRunQuiescent } from './ownership.ts';
import { issueTask, SerialQueue } from './queue.ts';
import { git } from './workspace.ts';
import { ownerAuthorization } from './profiles.ts';
import { assertRevisionBindings, validateAcceptedRevision } from './owner-revision.ts';
import type { AcceptedRevision } from './owner-revision.ts';

type ResumeRequest = { schemaVersion: 1; requestId: string; databasePath: string; issueId: number; additionalAttempts: number; additionalTimeMs: number; reason: string; ownerAuthorizationPath?: string; acceptedRevisionPath?: string };
type Journal = { request: ResumeRequest; taskHash: string; fromRunId: string; maxJobId: number; jobId?: number; revisionBindings?: AcceptedRevision['bindings']; result?: ResumeResult };
type ResumeResult = { requestId: string; status: string; jobId?: number; runId?: string; runDirectory?: string; reason?: string | null };

function recordedOutcome(store: IssueStore, request: ResumeRequest, jobId: number): ResumeResult {
  const job = store.work.jobs().find(job => job.id === jobId);
  const run = job?.runId ? store.work.run(job.runId) : undefined;
  if (!job || job.issueId !== request.issueId || !['issue', 'maintenance'].includes(job.kind) || JSON.parse(job.payload).ownerResumeRequestId !== request.requestId || !run || run.jobId !== job.id || !['merged', 'blocked'].includes(run.status)) throw new Error('Continuation has no matching settled native outcome.');
  return { requestId: request.requestId, status: run.status, jobId: job.id, runId: run.id, runDirectory: run.evidencePath, reason: run.reason };
}

function replay(request: ResumeRequest, journal: Journal): ResumeResult {
  const store = new IssueStore(request.databasePath);
  try {
    const result = recordedOutcome(store, request, journal.jobId!);
    if (JSON.stringify(result) !== JSON.stringify(journal.result)) throw new Error('Recorded continuation outcome changed.');
    return result;
  } finally { store.close(); }
}

export async function ownerResume(input: unknown, options: { agent?: Agent; validateOnly?: boolean; signal?: AbortSignal } = {}): Promise<ResumeResult> {
  const value = input as ResumeRequest;
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['schemaVersion', 'requestId', 'databasePath', 'issueId', 'additionalAttempts', 'additionalTimeMs', 'reason', 'ownerAuthorizationPath', 'acceptedRevisionPath'].includes(key)) || value.schemaVersion !== 1 || typeof value.databasePath !== 'string' || !isAbsolute(value.databasePath) || !existsSync(value.databasePath) || value.ownerAuthorizationPath !== undefined && (typeof value.ownerAuthorizationPath !== 'string' || !isAbsolute(value.ownerAuthorizationPath)) || !Number.isSafeInteger(value.issueId) || value.issueId < 1) throw new Error('Invalid owner resume request.');
  if (value.acceptedRevisionPath !== undefined && (typeof value.acceptedRevisionPath !== 'string' || !isAbsolute(value.acceptedRevisionPath))) throw new Error('Invalid accepted revision path.');
  validateOwnerGrant({ ...value, fromRunId: 'validation' });
  const request: ResumeRequest = { schemaVersion: 1, requestId: value.requestId, databasePath: resolveDatabasePath(value.databasePath), issueId: value.issueId, additionalAttempts: value.additionalAttempts, additionalTimeMs: value.additionalTimeMs, reason: value.reason, ...(value.ownerAuthorizationPath ? { ownerAuthorizationPath: value.ownerAuthorizationPath } : {}), ...(value.acceptedRevisionPath ? { acceptedRevisionPath: value.acceptedRevisionPath } : {}) };
  const evidenceRoot = join(dirname(request.databasePath), 'evidence');
  const directory = join(evidenceRoot, 'owner-resumes', request.requestId);
  const journalPath = join(directory, 'state.json');
  let journal = existsSync(journalPath) ? readJson(journalPath) as Journal : undefined;
  if (journal && JSON.stringify(journal.request) !== JSON.stringify(request)) throw new Error('Owner resume request identity changed.');
  if (journal?.revisionBindings) assertRevisionBindings(journal.revisionBindings);
  if (journal?.result) return replay(request, journal);
  const release = options.validateOnly ? () => {} : acquireExecutionLease(`${request.databasePath}.queue`, request.requestId);
  let store: IssueStore | undefined;
  try {
    journal = existsSync(journalPath) ? readJson(journalPath) as Journal : undefined;
    if (journal && JSON.stringify(journal.request) !== JSON.stringify(request)) throw new Error('Owner resume request identity changed.');
    if (journal?.revisionBindings) assertRevisionBindings(journal.revisionBindings);
    if (journal?.result) return replay(request, journal);
    store = new IssueStore(request.databasePath);
    if (journal?.revisionBindings && journal.jobId !== undefined) {
      const selected = store.work.jobs().find(item => item.id === journal!.jobId);
      const outcome = selected?.runId ? store.work.run(selected.runId) : undefined;
      if (outcome && ['merged', 'blocked'].includes(outcome.status)) {
        assertRunQuiescent(outcome.evidencePath);
        const result = recordedOutcome(store, request, journal.jobId);
        if (!options.validateOnly) { journal.result = result; writeJson(journalPath, journal); }
        return result;
      }
    }
    const issue = store.get(request.issueId);
    if (!issue?.work) throw new Error('Owner resume requires an enrolled issue.');
    const authority = request.ownerAuthorizationPath ? ownerAuthorization(store, request.ownerAuthorizationPath) : undefined;
    if (issue.work.changeKind && issue.work.changeKind !== 'feature' && (!authority || authority.issueId !== issue.id)) throw new Error('Maintenance continuation requires its original owner authorization.');
    if (authority && authority.issueId !== issue.id) throw new Error('Owner authorization issue does not match continuation.');
    const repo = store.work.repo(issue.work.repoId)!;
    const runs = store.work.runs().filter(run => run.issueId === issue.id).sort((a, b) => b.jobId - a.jobId);
    const predecessor = journal ? runs.find(run => run.id === journal!.fromRunId) : runs.find(run => run.status === 'blocked');
    if (!predecessor || predecessor.repoId !== repo.id || predecessor.requirementId !== issue.work.requirementId) throw new Error('No matching blocked predecessor.');
    const task = issueTask(store, issue, '', authority);
    const original = parseTask(readJson(join(predecessor.evidencePath, 'task.json')), authority?.scope);
    if (!request.acceptedRevisionPath && authority && JSON.stringify(readJson(join(predecessor.evidencePath, 'owner-authorization.json'))) !== JSON.stringify(authority)) throw new Error('Maintenance continuation cannot change its pinned authorization.');
    const oldJob = store.work.jobs().find(job => job.id === predecessor.jobId)!;
    const oldIssue = JSON.parse(oldJob.payload) as typeof issue;
    if (taskIdentity(task) !== taskIdentity(original) || !original.notes.startsWith(task.notes) || JSON.stringify(oldIssue.work) !== JSON.stringify(issue.work)) throw new Error('Original goal, criteria, enrollment or task identity changed.');
    if (journal && journal.taskHash !== taskIdentity(task)) throw new Error('Owner journal task identity changed.');
    for (const run of runs) assertRunQuiescent(run.evidencePath);
    let job: Job | undefined;
    if (journal) {
      const matches = store.work.jobs().filter(job => job.issueId === issue.id && job.id > journal!.maxJobId);
      if (matches.some(job => JSON.parse(job.payload).ownerResumeRequestId !== request.requestId)) throw new Error('Another decision changed the owner recovery job history.');
      if (matches.length > 1 || journal.jobId !== undefined && !matches.some(job => job.id === journal!.jobId)) throw new Error('Ambiguous owner recovery job history.');
      job = matches[0];
    }
    if (store.work.jobs().some(item => item.status === 'running' && item.id !== job?.id)) throw new Error('Another queue execution is running.');
    if (!job && (issue.status !== 'blocked' || store.work.jobs().some(item => item.issueId === issue.id && ['queued', 'running'].includes(item.status)))) throw new Error('Only a blocked quiescent issue can continue.');
    const target = issue.work.requirementId ? store.work.requirement(issue.work.requirementId)?.publication?.branch ?? repo.targetBranch : repo.targetBranch;
    git(repo.path, ['rev-parse', '--verify', `refs/heads/${target}^{commit}`]);
    if (git(repo.path, ['status', '--porcelain']).trim()) throw new Error('Owner continuation requires a clean enrolled repository.');
    if (request.acceptedRevisionPath && !authority) throw new Error('Revision adoption requires explicit current authority.');
    const revision = request.acceptedRevisionPath ? validateAcceptedRevision(store, request.acceptedRevisionPath, { issueId: issue.id, directory: predecessor.evidencePath, task: original, authority: authority!, target }) : undefined;
    if (revision && job?.status !== 'running') {
      const ledger = readJson(join(evidenceRoot, 'budgets', `${digest(`repo-${repo.id}:issue-${issue.id}`)}.json`)) as Parameters<typeof validateRevisionBudget>[0];
      validateRevisionBudget(ledger, task, { requestId: request.requestId, fromRunId: predecessor.id, additionalAttempts: request.additionalAttempts, additionalTimeMs: request.additionalTimeMs, reason: request.reason });
    }
    if (options.validateOnly) return { requestId: request.requestId, status: 'valid', jobId: job?.id, runId: job?.runId ?? undefined };
    if (options.signal?.aborted) throw new Error('Owner continuation cancelled before admission.');
    if (!journal) {
      journal = { request, taskHash: taskIdentity(task), fromRunId: predecessor.id, ...(revision ? { revisionBindings: revision.bindings } : {}), maxJobId: Math.max(0, ...store.work.jobs().map(job => job.id)) };
      mkdirSync(directory, { recursive: true });
      writeJson(join(directory, 'request.json'), request);
      writeJson(journalPath, journal);
    }
    const queue = new SerialQueue(store, { evidenceRoot, agent: options.agent, signal: options.signal, ownerAuthorizationPath: request.ownerAuthorizationPath, acceptedRevision: revision });
    if (!job) {
      const key = `repo-${repo.id}:issue-${issue.id}`;
      const ledger = readJson(join(evidenceRoot, 'budgets', `${digest(key)}.json`)) as { active?: unknown };
      if (ledger.active) executionBudget(evidenceRoot, key, task, `settle-${request.requestId}`).close();
      grantExecutionBudget(evidenceRoot, key, task, { requestId: request.requestId, fromRunId: predecessor.id, additionalAttempts: request.additionalAttempts, additionalTimeMs: request.additionalTimeMs, reason: request.reason });
      job = store.work.startIssue(issue.id, request.requestId);
      journal.jobId = job.id;
      writeJson(journalPath, journal);
    }
    if (job.status === 'running') queue.recover();
    else if (job.status === 'queued' && !await queue.processNext(job.id)) throw new Error('Selected continuation is not ready; retained for explicit recovery.');
    journal.jobId = job.id;
    journal.result = recordedOutcome(store, request, job.id);
    writeJson(journalPath, journal);
    return journal.result;
  } finally { store?.close(); release(); }
}
