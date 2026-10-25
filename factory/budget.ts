import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { acquireExecutionLease } from './lease.ts';
import { digest, taskIdentity } from './checkpoint.ts';
import { readJson, writeJson } from './evidence.ts';
import type { Task } from './contracts.ts';

export type OwnerBudgetGrant = { requestId: string; fromRunId: string; additionalAttempts: number; additionalTimeMs: number; reason: string };
type Ledger = { schemaVersion: 1; taskHash: string; usedMs: number; implementationAttempts: number; acceptanceAttempts: number; infrastructureRetries?: number; ownerGrants?: OwnerBudgetGrant[]; active?: { runId: string; reservedMs: number; startedAt: number } };
export function validateOwnerBudgetRequest(grant: OwnerBudgetGrant): void {
  if (!grant || typeof grant.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(grant.requestId) || typeof grant.fromRunId !== 'string' || !grant.fromRunId.trim() || typeof grant.reason !== 'string' || !grant.reason.trim() || grant.reason.length > 2000 || !Number.isSafeInteger(grant.additionalAttempts) || grant.additionalAttempts < 0 || grant.additionalAttempts > 5 || !Number.isSafeInteger(grant.additionalTimeMs) || grant.additionalTimeMs < 0 || grant.additionalTimeMs > 3600000) throw new Error('Owner budget grant requires an explicit bounded allowance, identity and reason.');
}

export function validateOwnerGrant(grant: OwnerBudgetGrant): void {
  validateOwnerBudgetRequest(grant);
  if (!(grant.additionalAttempts || grant.additionalTimeMs)) throw new Error('Owner budget grant requires an explicit bounded allowance, identity and reason.');
}

function limits(ledger: Ledger, task: Task) {
  if (ledger.schemaVersion !== 1 || ledger.taskHash !== taskIdentity(task) || ![ledger.usedMs, ledger.implementationAttempts, ledger.acceptanceAttempts].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Budget identity changed or ledger is invalid. Owner intervention is required.');
  if (ledger.ownerGrants !== undefined && !Array.isArray(ledger.ownerGrants)) throw new Error('Owner grant ledger is invalid.');
  const ids = new Set<string>();
  let maxAttempts = task.budget.maxAttempts;
  let totalTimeoutMs = task.budget.totalTimeoutMs;
  for (const grant of ledger.ownerGrants ?? []) {
    validateOwnerGrant(grant);
    if (ids.has(grant.requestId)) throw new Error('Duplicate owner grant.');
    ids.add(grant.requestId); maxAttempts += grant.additionalAttempts; totalTimeoutMs += grant.additionalTimeMs;
  }
  if (![maxAttempts, totalTimeoutMs].every(Number.isSafeInteger)) throw new Error('Owner grant limits overflow.');
  return { maxAttempts, totalTimeoutMs };
}

function reservedUsage(ledger: Ledger, totalTimeoutMs: number): number {
  if (!ledger.active) return ledger.usedMs;
  if (!Number.isSafeInteger(ledger.active.reservedMs) || ledger.active.reservedMs < 0 || ledger.active.reservedMs > totalTimeoutMs) throw new Error('Invalid crashed-phase budget reservation.');
  return ledger.usedMs + ledger.active.reservedMs;
}

export function assertRemainingExecutionBudget(root: string, key: string, task: Task, acceptedChecks: boolean, request: OwnerBudgetGrant): void {
  validateOwnerBudgetRequest(request);
  const ledger = readJson(join(root, 'budgets', `${digest(key)}.json`)) as Ledger;
  const usedMs = reservedUsage(ledger, limits(ledger, task).totalTimeoutMs);
  if (request.additionalAttempts || request.additionalTimeMs) {
    const previous = ledger.ownerGrants?.find(grant => grant.requestId === request.requestId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(request)) throw new Error('Owner grant request identity changed.');
    if (!previous) ledger.ownerGrants = [...ledger.ownerGrants ?? [], request];
  }
  const effective = limits(ledger, task);
  if (usedMs >= effective.totalTimeoutMs) throw new Error('Cumulative time budget exhausted.');
  if (ledger.implementationAttempts >= effective.maxAttempts) throw new Error('Cumulative implementation attempt budget exhausted.');
  if (!acceptedChecks && ledger.acceptanceAttempts >= effective.maxAttempts) throw new Error('Cumulative acceptance attempt budget exhausted.');
}

export function validateRevisionBudget(ledger: Ledger, task: Task, grant: OwnerBudgetGrant): void {
  validateOwnerGrant(grant);
  const effective = limits(ledger, task);
  const previous = ledger.ownerGrants?.find(item => item.requestId === grant.requestId);
  if (previous && JSON.stringify(previous) !== JSON.stringify(grant)) throw new Error('Owner grant request identity changed.');
  const attempts = effective.maxAttempts + (previous ? 0 : grant.additionalAttempts);
  const time = effective.totalTimeoutMs + (previous ? 0 : grant.additionalTimeMs);
  if (![attempts, time].every(Number.isSafeInteger) || ledger.active && (!Number.isSafeInteger(ledger.active.reservedMs) || ledger.active.reservedMs < 0 || ledger.active.reservedMs > effective.totalTimeoutMs)) throw new Error('Revision continuation budget reservation is invalid.');
  if (ledger.acceptanceAttempts >= attempts || ledger.implementationAttempts >= attempts || ledger.usedMs + (ledger.active?.reservedMs ?? 0) >= time) throw new Error('Revision continuation cumulative acceptance or implementation budget exhausted.');
}

export function grantExecutionBudget(root: string, key: string, task: Task, input: OwnerBudgetGrant): OwnerBudgetGrant {
  validateOwnerGrant(input);
  const grant = { requestId: input.requestId, fromRunId: input.fromRunId, additionalAttempts: input.additionalAttempts, additionalTimeMs: input.additionalTimeMs, reason: input.reason };
  const path = join(root, 'budgets', `${digest(key)}.json`);
  const release = acquireExecutionLease(path, grant.requestId);
  try {
    const ledger = readJson(path) as Ledger;
    limits(ledger, task);
    const previous = ledger.ownerGrants?.find(item => item.requestId === grant.requestId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(grant)) throw new Error('Owner grant request identity changed.');
      return previous;
    }
    if (ledger.active) throw new Error('Settle the previous owner reservation before granting budget.');
    (ledger.ownerGrants ??= []).push(grant);
    limits(ledger, task);
    writeJson(path, ledger);
    return grant;
  } finally { release(); }
}

export function executionBudget(root: string, key: string, task: Task, runId: string) {
  const directory = join(root, 'budgets'); mkdirSync(directory, { recursive: true });
  const path = join(directory, `${digest(key)}.json`);
  const release = acquireExecutionLease(path, runId);
  let ledger: Ledger;
  try {
    try { ledger = readJson(path) as Ledger; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ledger = { schemaVersion: 1, taskHash: taskIdentity(task), usedMs: 0, implementationAttempts: 0, acceptanceAttempts: 0 }; }
    const effective = limits(ledger, task);
    ledger.usedMs = reservedUsage(ledger, effective.totalTimeoutMs);
    if (ledger.infrastructureRetries !== undefined && (!Number.isSafeInteger(ledger.infrastructureRetries) || ledger.infrastructureRetries < 0 || ledger.infrastructureRetries > 1)) throw new Error('Infrastructure retry ledger is invalid.');
    const baseUsed = ledger.usedMs;
    const started = Date.now();
    const remaining = effective.totalTimeoutMs - ledger.usedMs;
    ledger.active = { runId, reservedMs: Math.max(0, remaining), startedAt: started };
    let reservedUntil = started;
    const persist = () => { writeJson(`${path}.tmp`, ledger); renameSync(`${path}.tmp`, path); };
    const update = () => { ledger.usedMs = baseUsed + Date.now() - started; if (ledger.active) ledger.active.reservedMs = Math.max(0, reservedUntil - Date.now()); persist(); };
    update();
    const heartbeat = setInterval(update, 1000); heartbeat.unref();
    let closed = false;
    return {
      phase: (timeoutMs: number) => { reservedUntil = Date.now() + Math.min(timeoutMs, Math.max(0, remaining - (Date.now() - started))); update(); },
      remaining: () => Math.max(0, remaining - (Date.now() - started)),
      consume: (kind: 'implementation' | 'acceptance') => {
        const field = kind === 'implementation' ? 'implementationAttempts' : 'acceptanceAttempts';
        if (ledger[field] >= effective.maxAttempts) throw new Error(`Cumulative ${kind} attempt budget exhausted.`);
        ledger[field] += 1; persist(); return ledger[field];
      },
      consumeInfrastructureRetry: () => { if ((ledger.infrastructureRetries ?? 0) >= 1) throw new Error('Cumulative infrastructure retry budget exhausted.'); ledger.infrastructureRetries = (ledger.infrastructureRetries ?? 0) + 1; persist(); return ledger.infrastructureRetries; },
      report: () => ({ usedMs: baseUsed + Date.now() - started, implementationAttempts: ledger.implementationAttempts, acceptanceAttempts: ledger.acceptanceAttempts, infrastructureRetries: ledger.infrastructureRetries ?? 0, ...effective }),
      close: () => { if (closed) return; closed = true; clearInterval(heartbeat); ledger.usedMs = baseUsed + Math.max(0, Math.min(remaining, Date.now() - started)); delete ledger.active; try { persist(); } finally { release(); } },
    };
  } catch (error) { release(); throw error; }
}
