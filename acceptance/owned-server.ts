import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

export async function availablePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Cannot allocate a test port.');
  const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return port;
}

export async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await stopped; } finally { clearTimeout(timer); }
}

export async function launch(port: number, path: string, identity: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, API_PORT: String(port), DB_PATH: path, INSTANCE_ID: identity }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', data => { output += String(data); });
  child.stderr?.on('data', data => { output += String(data); });
  const url = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Owned server exited: ${output}`);
      try {
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
        const health = await response.json();
        if (response.ok && health.instanceId === identity && health.databasePath === path) return { child, url, output: () => output };
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Owned server did not become healthy: ${output}`);
  } catch (error) { await stop(child); throw error; }
}
