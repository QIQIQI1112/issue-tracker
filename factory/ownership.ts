import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJson } from './evidence.ts';

export function processIdentity(pid: number): string {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', timeout: 1000 });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function assertRunQuiescent(root: string, visited = new Set<string>()): void {
  root = resolve(root);
  if (visited.has(root) || visited.size > 1000) throw new Error('Invalid recovery lineage.');
  visited.add(root);
  if (!existsSync(root)) return;
  const parent = join(root, 'resume-parent.json');
  if (existsSync(parent)) {
    const value = readJson(parent) as { directory: string };
    if (typeof value.directory !== 'string' || dirname(resolve(value.directory)) !== dirname(root)) throw new Error('Invalid recovery predecessor path.');
    assertRunQuiescent(value.directory, visited);
  }
  assertOwnedGroupsQuiescent(root);
  const ownerPath = join(root, 'controller-owner.json');
  if (existsSync(ownerPath) && existsSync(join(root, 'state.json'))) {
    const state = readJson(join(root, 'state.json')) as { status: string; cleanupSafe?: boolean };
    if (state.cleanupSafe === false) throw new Error('Previous agent did not settle; owner cleanup is required.');
    const owner = readJson(ownerPath) as { pid: number; identity?: string };
    if (state.status === 'running' && processIdentity(owner.pid) && (!owner.identity || processIdentity(owner.pid) === owner.identity)) throw new Error('Previous controller is still running.');
  }
}

export function assertOwnedGroupsQuiescent(root: string): void {
  if (!existsSync(root)) return;
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || ['workspace', 'trusted', 'integration-workspace'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name.endsWith('.owner.json') ? [path] : [];
  });
  for (const path of walk(root)) {
    const record = readJson(path) as { pid: number; settled: boolean; identity: string; groups?: number[] };
    if (record.settled) continue;
    if (!Array.isArray(record.groups) || !record.groups.length || !record.groups.every(pid => Number.isSafeInteger(pid) && pid > 0)) throw new Error(`Unresolved process ownership receipt: ${path}`);
    for (const pid of record.groups) {
      try { process.kill(-pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') continue; throw error; }
      throw new Error(`Previous owned process group ${pid} is still present. Inspect ${path} and stop its verified owner before resuming or cleaning up.`);
    }
  }
}
