import { expect, test as baseTest } from '@playwright/test';
import { test, appUrl } from './workspace.ts';
import { availablePort, launch, stop } from './owned-server.ts';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';

test('labels can be created, edited, filtered, and cleared through the UI', async ({ page, request, workspace }, info) => {
  test.setTimeout(15000);
  const title = `${workspace.prefix} Labelled issue`;
  const other = await workspace.create({ title: 'Other label', labels: ['backend'], status: 'open' });
  await page.goto(appUrl(info));
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create issue' });
  await create.getByLabel('Title', { exact: true }).fill(title);
  await create.getByLabel('Labels', { exact: true }).fill(' Bug, FRONTEND, bug ');
  const response = page.waitForResponse(response => response.url().endsWith('/api/issues') && response.request().method() === 'POST');
  await create.getByRole('button', { name: 'Create issue', exact: true }).click();
  const { issue } = await (await response).json();
  const row = page.getByTestId(`issue-${issue.id}`);
  await expect(row.getByText('bug', { exact: true })).toBeVisible();
  await expect(row.getByText('frontend', { exact: true })).toBeVisible();
  await page.getByLabel('Filter by label', { exact: true }).selectOption('frontend');
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`issue-${other.id}`)).not.toBeVisible();
  await page.getByLabel('Filter by label', { exact: true }).selectOption('');
  await row.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit issue' });
  await expect(edit.getByLabel('Labels', { exact: true })).toHaveValue('bug, frontend');
  await edit.getByLabel('Labels', { exact: true }).fill('UI, bug');
  await edit.getByLabel('Status', { exact: true }).selectOption('done');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await page.getByLabel('Filter by label', { exact: true }).selectOption('ui');
  await page.getByLabel('Search issues', { exact: true }).fill(workspace.prefix);
  await page.getByLabel('Filter by status', { exact: true }).selectOption('done');
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`issue-${other.id}`)).not.toBeVisible();
  await page.getByLabel('Filter by status', { exact: true }).selectOption('open');
  await expect(page.getByRole('heading', { name: 'No matching issues' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByLabel('Filter by label', { exact: true })).toHaveValue('');
  await row.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await edit.getByLabel('Labels', { exact: true }).fill('');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const issues = await (await request.get(`${appUrl(info)}/api/issues`)).json();
  expect(issues.issues.find((item: { id: number }) => item.id === issue.id).labels).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid label drafts are rejected accessibly without a write', async ({ page, workspace }, info) => {
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/issues')) writes += 1; });
  await page.goto(appUrl(info));
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create issue' });
  await dialog.getByLabel('Title', { exact: true }).fill(`${workspace.prefix} Invalid label`);
  for (const labels of ['bug,,ui', 'x'.repeat(21), Array.from({ length: 11 }, (_, index) => `tag${index}`).join(',')]) {
    await dialog.getByLabel('Labels', { exact: true }).fill(labels);
    await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(/Label/);
    await expect(dialog.getByLabel('Labels', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Labels', { exact: true })).toBeFocused();
  }
  expect(writes).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

baseTest('UI-assigned labels survive a full server restart', async ({ page, request }, info) => {
  baseTest.setTimeout(45000);
  const directory = info.outputPath('owned-label-instance');
  mkdirSync(directory, { recursive: true });
  const databasePath = resolve(directory, 'labels.sqlite');
  const port = await availablePort();
  let running = await launch(port, databasePath, 'labels-before-restart');
  try {
    await page.context().setExtraHTTPHeaders({ [targetHeader]: targetIdentity('labels-before-restart', databasePath) });
    await page.goto(running.url);
    await page.getByRole('button', { name: 'New issue', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create issue' });
    await dialog.getByLabel('Title', { exact: true }).fill('Restart labels');
    await dialog.getByLabel('Labels', { exact: true }).fill(' Bug, durable ');
    await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await stop(running.child);
    expect(existsSync(databasePath + '.lock')).toBe(false);
    running = await launch(port, databasePath, 'labels-after-restart');
    await page.context().setExtraHTTPHeaders({ [targetHeader]: targetIdentity('labels-after-restart', databasePath) });
    await page.reload();
    const row = page.getByTestId('issue-1');
    await expect(row.getByText('bug', { exact: true })).toBeVisible();
    await expect(row.getByText('durable', { exact: true })).toBeVisible();
    expect((await (await request.get(`${running.url}/api/issues`)).json()).issues[0].labels).toEqual(['bug', 'durable']);
    await page.screenshot({ path: info.outputPath('labels-after-restart.png'), fullPage: true });
  } finally { await stop(running.child); }
});
