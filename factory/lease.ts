import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { acquireDatabaseLock } from '../src/instance.ts';

export function acquireExecutionLease(path: string, runId: string): () => void {
  const admit = acquireDatabaseLock(`${path}.admission`, runId);
  try {
  if (existsSync(`${path}.lock`)) {
    const owner = JSON.parse(readFileSync(`${path}.lock`, 'utf8')) as { pid: number };
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid execution owner record.');
    try { process.kill(owner.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; unlinkSync(`${path}.lock`); }
  }
  return acquireDatabaseLock(path, runId);
  } finally { admit(); }
}
