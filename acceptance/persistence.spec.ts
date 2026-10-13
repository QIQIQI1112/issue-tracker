import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

async function availablePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Cannot allocate a test port.');
  const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await stopped; } finally { clearTimeout(timer); }
}

async function launch(port: number, path: string, identity: string) {
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

test('a UI rename survives a full server process restart', async ({ page, request }, testInfo) => {
  test.setTimeout(45000);
  const directory = testInfo.outputPath('owned-instance');
  mkdirSync(directory, { recursive: true });
  const databasePath = resolve(directory, 'persistence.sqlite');
  const port = await availablePort();
  let running = await launch(port, databasePath, 'before-restart');
  try {
    const created = await request.post(`${running.url}/api/issues`, { data: { title: 'Before restart', description: 'Restart acceptance fixture' } });
    expect(created.status()).toBe(201);
    await page.goto(running.url);
    await page.getByRole('button', { name: 'Edit Before restart', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit issue' });
    await dialog.getByLabel('Title', { exact: true }).fill('Persisted after restart');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Persisted after restart', { exact: true })).toBeVisible();
    await stop(running.child);
    expect(existsSync(databasePath + '.lock')).toBe(false);
    running = await launch(port, databasePath, 'after-restart');
    await page.reload();
    await expect(page.getByText('Persisted after restart', { exact: true })).toBeVisible();
    const response = await request.get(`${running.url}/api/issues`);
    const { issues } = await response.json();
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Persisted after restart');
    await page.screenshot({ path: testInfo.outputPath('persisted-after-restart.png'), fullPage: true });
    await testInfo.attach('server-log', { body: running.output(), contentType: 'text/plain' });
  } finally { await stop(running.child); }
});
