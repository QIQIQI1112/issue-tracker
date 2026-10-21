import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { processIdentity } from './ownership.ts';
import { writeJson } from './evidence.ts';
import { dirname } from 'node:path';

export type ProcessResult = { status: 'passed' | 'failed' | 'timeout' | 'cancelled' | 'output_limit'; pid: number | null; exitCode: number | null; signal: NodeJS.Signals | null; durationMs: number; output: string; error?: string; spawnErrorCode?: string; settled?: boolean };
export type ProcessOptions = { command: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; logPath: string; timeoutMs: number; graceMs?: number; input?: string; signal?: AbortSignal; onOutput?: (text: string) => void };

export async function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const started = Date.now();
  const grace = options.graceMs ?? 1000;
  const inherited = Number(process.env.ISSUE_TRACKER_PARENT_GRACE_MS ?? grace);
  const ownerGrace = Number.isSafeInteger(inherited) && inherited > 0 ? Math.min(grace, inherited) : grace;
  mkdirSync(dirname(options.logPath), { recursive: true });
  writeFileSync(options.logPath, '');
  const child = spawn(options.command, options.args, { cwd: options.cwd, env: { ...(options.env ?? process.env), ISSUE_TRACKER_PARENT_GRACE_MS: String(Math.max(1, Math.floor(ownerGrace / 2))) }, detached: true, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  const owner = { pid: child.pid ?? null, identity: child.pid ? processIdentity(child.pid) : '', cwd: options.cwd, command: options.command, args: options.args, groups: child.pid ? [child.pid] : [], settled: false, probeErrors: [] as string[] };
  writeJson(`${options.logPath}.owner.json`, owner);
  let status: ProcessResult['status'] | undefined;
  let spawnErrorCode: string | undefined;
  let errorMessage: string | undefined;
  let output = '';
  let bytes = 0;
  let escalating: ReturnType<typeof setTimeout> | undefined;
  let forcing: ReturnType<typeof setTimeout> | undefined;
  const ownedGroups = new Set<number>(child.pid ? [child.pid] : []);
  const discoverGroups = () => {
    if (!child.pid) return;
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 1000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) { status ??= 'failed'; errorMessage = 'Cannot inspect the owned process tree for cleanup.'; return; }
    const rows = result.stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number)).filter(row => row.length === 3 && row.every(value => Number.isSafeInteger(value) && value > 0));
    const descendants = new Set([child.pid]);
    const pending = [child.pid];
    for (let index = 0; index < pending.length; index += 1) for (const [pid, parent] of rows) if (parent === pending[index] && !descendants.has(pid)) { descendants.add(pid); pending.push(pid); }
    for (const [pid, , group] of rows) if (descendants.has(pid) && descendants.has(group)) ownedGroups.add(group);
    owner.groups = [...ownedGroups];
    writeJson(`${options.logPath}.owner.json`, owner);
  };
  const probeGroups = () => {
    let present = false;
    let inspectionError: string | undefined;
    for (const pid of ownedGroups) {
      try { process.kill(-pid, 0); present = true; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') continue;
        present = true;
        inspectionError = `Cannot inspect owned process group ${pid}: ${code ?? 'unknown'}: ${String(error)}`;
        if (!owner.probeErrors.includes(inspectionError) && owner.probeErrors.length < 16) owner.probeErrors.push(inspectionError);
      }
    }
    return { present, inspectionError };
  };
  const signalGroup = (signal: NodeJS.Signals) => {
    for (const pid of ownedGroups) {
      try { process.kill(-pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') errorMessage = String(error); }
    }
  };
  const stop = (budget = grace) => {
    discoverGroups();
    signalGroup('SIGTERM');
    if (budget < grace) { clearTimeout(escalating); clearTimeout(forcing); escalating = undefined; forcing = undefined; }
    escalating ??= setTimeout(() => signalGroup('SIGKILL'), budget);
    forcing ??= setTimeout(() => { signalGroup('SIGKILL'); child.stdout?.destroy(); child.stderr?.destroy(); }, budget + 1000);
  };
  const abort = () => { status ??= 'cancelled'; stop(); };
  const ownerStopped = () => { status ??= 'cancelled'; stop(ownerGrace); };
  process.once('SIGTERM', ownerStopped); process.once('SIGINT', ownerStopped);
  const timer = setTimeout(() => { status ??= 'timeout'; stop(); }, options.timeoutMs);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const capture = (data: Buffer) => {
    const text = String(data);
    bytes += data.byteLength;
    if (bytes > 16 * 1024 * 1024) { status ??= 'output_limit'; stop(); return; }
    output = (output + text).slice(-32000);
    appendFileSync(options.logPath, text);
    options.onOutput?.(text);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.once('error', error => { spawnErrorCode = (error as NodeJS.ErrnoException).code; errorMessage = error.message; status ??= 'failed'; });
  child.once('exit', () => { if (probeGroups().present) stop(); });
  child.stdin?.on('error', () => {});
  if (options.input !== undefined) child.stdin?.end(options.input);
  return await new Promise(resolve => {
    child.once('close', async (exitCode, signal) => {
      const deadline = Date.now() + grace + 1000;
      let remaining = probeGroups();
      while (remaining.present && Date.now() < deadline) {
        await new Promise(done => setTimeout(done, 20));
        remaining = probeGroups();
      }
      if (remaining.present) { status = 'failed'; errorMessage = remaining.inspectionError ?? 'Owned process group survived cleanup.'; }
      clearTimeout(timer);
      if (escalating) clearTimeout(escalating);
      if (forcing) clearTimeout(forcing);
      options.signal?.removeEventListener('abort', abort);
      process.removeListener('SIGTERM', ownerStopped); process.removeListener('SIGINT', ownerStopped);
      owner.settled = !remaining.present;
      writeJson(`${options.logPath}.owner.json`, owner);
      resolve({ status: status ?? (exitCode === 0 ? 'passed' : 'failed'), pid: child.pid ?? null, exitCode, signal, durationMs: Date.now() - started, output, ...(errorMessage ? { error: errorMessage } : {}), settled: !remaining.present, ...(spawnErrorCode ? { spawnErrorCode } : {}) });
    });
  });
}
