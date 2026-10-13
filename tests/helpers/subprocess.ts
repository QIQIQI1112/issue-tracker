import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function evidenceDirectory(label: string): string {
  return mkdtempSync(join(tmpdir(), `issue-${label}-`));
}

export async function availablePort(): Promise<string> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot allocate an owned test port.');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return String(address.port);
}

export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

export async function stopOwned(child: ChildProcess, graceMs = 5000): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;
  const exited = child.exitCode !== null || child.signalCode !== null;
  const streamsClosed = [child.stdout, child.stderr].every(stream => !stream || stream.closed);
  const closed = exited && streamsClosed ? Promise.resolve() : once(child, 'close');
  const deadline = Date.now() + graceMs;
  signalGroup(pid, 'SIGTERM');
  const timer = setTimeout(() => signalGroup(pid, 'SIGKILL'), graceMs);
  try {
    await closed;
    while (groupAlive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    const killDeadline = Math.max(Date.now(), deadline) + 1000;
    while (groupAlive(pid) && Date.now() < killDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (groupAlive(pid)) throw new Error(`Owned process group ${pid} survived SIGKILL.`);
  } finally { clearTimeout(timer); }
}

export async function run(command: string, args: string[], env: NodeJS.ProcessEnv, logPath: string, cwd = process.cwd(), options: { timeoutMs?: number; graceMs?: number } = {}) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let output = '';
  child.stdout.on('data', data => { output += String(data); });
  child.stderr.on('data', data => { output += String(data); });
  const timeoutMs = options.timeoutMs ?? 90000;
  const graceMs = options.graceMs ?? 5000;
  let stopping: Promise<void> | undefined;
  const cleanup = () => stopping ??= stopOwned(child, graceMs);
  const startCleanup = () => { void cleanup().catch(() => {}); };
  child.once('exit', startCleanup);
  const timer = setTimeout(startCleanup, timeoutMs);
  try {
    const [code, signal] = await closed;
    await cleanup();
    return { code, signal, output };
  } finally {
    clearTimeout(timer);
    writeFileSync(logPath, output);
  }
}
