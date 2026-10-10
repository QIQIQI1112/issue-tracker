import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function acquireDatabaseLock(databasePath: string, instanceId: string): () => void {
  if (databasePath === ':memory:') return () => {};
  const lockPath = `${resolve(databasePath)}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  let descriptor: number;
  try { descriptor = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Database is locked: ${lockPath}. Stop its owner before continuing. If it crashed, inspect this lock's PID before removing it.`);
    }
    throw error;
  }
  const record = JSON.stringify({ pid: process.pid, instanceId, databasePath: resolve(databasePath), startedAt: new Date().toISOString() });
  try { writeFileSync(descriptor, record); } finally { closeSync(descriptor); }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (readFileSync(lockPath, 'utf8') === record) unlinkSync(lockPath);
  };
}
