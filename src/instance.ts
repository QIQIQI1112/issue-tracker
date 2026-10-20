import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function resolveDatabasePath(input: string): string {
  const path = resolve(input);
  try {
    const file = lstatSync(path);
    if (file.isSymbolicLink()) throw new Error('Database file symlinks are unsupported. Use the original database path.');
    if (file.nlink > 1) throw new Error('Hard-linked database files are unsupported. Use a database file with a single link.');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return path;
}

export function acquireDatabaseLock(databasePath: string, instanceId: string): () => void {
  if (databasePath === ':memory:') return () => {};
  const path = resolveDatabasePath(databasePath);
  const lockPath = `${path}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  let descriptor: number;
  try { descriptor = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Database is locked: ${lockPath}. Stop its owner before continuing. If it crashed, inspect this lock's PID before removing it.`, { cause: error });
    }
    throw error;
  }
  const record = JSON.stringify({ pid: process.pid, instanceId, databasePath: path, startedAt: new Date().toISOString() });
  try { writeFileSync(descriptor, record); } finally { closeSync(descriptor); }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (readFileSync(lockPath, 'utf8') === record) unlinkSync(lockPath);
  };
}
