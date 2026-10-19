import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { acquireExecutionLease } from './lease.ts';
import { digest, taskIdentity } from './checkpoint.ts';
import { readJson, writeJson } from './evidence.ts';
import type { Task } from './contracts.ts';

type Ledger = { schemaVersion: 1; taskHash: string; usedMs: number; implementationAttempts: number; acceptanceAttempts: number; active?: { runId: string; reservedMs: number; startedAt: number } };
export function executionBudget(root: string, key: string, task: Task, runId: string) {
  const directory = join(root, 'budgets'); mkdirSync(directory, { recursive: true });
  const path = join(directory, `${digest(key)}.json`);
  const release = acquireExecutionLease(path, runId);
  let ledger: Ledger;
  try {
    try { ledger = readJson(path) as Ledger; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ledger = { schemaVersion: 1, taskHash: taskIdentity(task), usedMs: 0, implementationAttempts: 0, acceptanceAttempts: 0 }; }
    if (ledger.schemaVersion !== 1 || ledger.taskHash !== taskIdentity(task) || ![ledger.usedMs, ledger.implementationAttempts, ledger.acceptanceAttempts].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Budget identity changed or ledger is invalid. Owner intervention is required.');
    if (ledger.active) {
      if (!Number.isSafeInteger(ledger.active.reservedMs) || ledger.active.reservedMs < 0 || ledger.active.reservedMs > task.budget.totalTimeoutMs) throw new Error('Invalid crashed-phase budget reservation.');
      ledger.usedMs += ledger.active.reservedMs;
    }
    const baseUsed = ledger.usedMs;
    const started = Date.now();
    const remaining = task.budget.totalTimeoutMs - ledger.usedMs;
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
        if (ledger[field] >= task.budget.maxAttempts) throw new Error(`Cumulative ${kind} attempt budget exhausted.`);
        ledger[field] += 1; persist(); return ledger[field];
      },
      report: () => ({ usedMs: baseUsed + Date.now() - started, implementationAttempts: ledger.implementationAttempts, acceptanceAttempts: ledger.acceptanceAttempts, maxAttempts: task.budget.maxAttempts, totalTimeoutMs: task.budget.totalTimeoutMs }),
      close: () => { if (closed) return; closed = true; clearInterval(heartbeat); ledger.usedMs = baseUsed + Math.max(0, Math.min(remaining, Date.now() - started)); delete ledger.active; try { persist(); } finally { release(); } },
    };
  } catch (error) { release(); throw error; }
}
