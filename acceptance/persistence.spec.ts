import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { availablePort, launch, stop } from './owned-server.ts';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';

test('an API update remains inspectable after a full server process restart', async ({ page, request }, testInfo) => {
  test.setTimeout(45000);
  const directory = testInfo.outputPath('owned-instance');
  mkdirSync(directory, { recursive: true });
  const databasePath = resolve(directory, 'persistence.sqlite');
  const port = await availablePort();
  let running = await launch(port, databasePath, 'before-restart');
  try {
    const headers = { [targetHeader]: targetIdentity('before-restart', databasePath) };
    await page.context().setExtraHTTPHeaders(headers);
    const created = await request.post(`${running.url}/api/issues`, { headers, data: { title: 'Before restart', description: 'Restart acceptance fixture' } });
    expect(created.status()).toBe(201);
    await page.goto(running.url);
    const updated = await request.patch(`${running.url}/api/issues/1`, { headers, data: { title: 'Persisted after restart' } });
    expect(updated.status()).toBe(200);
    await page.reload();
    await page.getByRole('button', { name: 'View issue Persisted after restart', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Issue #1', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Persisted after restart', exact: true })).toBeVisible();
    await expect(dialog.getByText('Restart acceptance fixture', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await stop(running.child);
    expect(existsSync(databasePath + '.lock')).toBe(false);
    running = await launch(port, databasePath, 'after-restart');
    await page.context().setExtraHTTPHeaders({ [targetHeader]: targetIdentity('after-restart', databasePath) });
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
