import { expect, test as baseTest } from '@playwright/test';
import { test, appUrl } from './workspace.ts';
import { availablePort, launch, stop } from './owned-server.ts';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';

test('created labels and API label updates remain filterable and clearable', async ({ page, request, workspace }, info) => {
  test.setTimeout(15000);
  const other = await workspace.create({ title: 'Other label', labels: ['backend'], status: 'open' });
  const issue = await workspace.create({ title: 'Labelled issue', labels: [' Bug ', 'FRONTEND', 'bug'] });
  await page.goto(appUrl(info));
  const row = page.getByTestId(`issue-${issue.id}`);
  await expect(row.getByText('bug', { exact: true })).toBeVisible();
  await expect(row.getByText('frontend', { exact: true })).toBeVisible();
  await page.getByLabel('Filter by label', { exact: true }).selectOption('frontend');
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`issue-${other.id}`)).not.toBeVisible();
  await page.getByLabel('Filter by label', { exact: true }).selectOption('');
  expect((await request.patch(`${appUrl(info)}/api/issues/${issue.id}`, { data: { labels: ['UI', 'bug'], status: 'done' } })).status()).toBe(200);
  await page.reload();
  await page.getByLabel('Filter by label', { exact: true }).selectOption('ui');
  await page.getByLabel('Search issues', { exact: true }).fill(workspace.prefix);
  await page.getByLabel('Filter by status', { exact: true }).selectOption('done');
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`issue-${other.id}`)).not.toBeVisible();
  await page.getByLabel('Filter by status', { exact: true }).selectOption('open');
  await expect(page.getByRole('heading', { name: 'No matching issues' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByLabel('Filter by label', { exact: true })).toHaveValue('');
  expect((await request.patch(`${appUrl(info)}/api/issues/${issue.id}`, { data: { labels: [] } })).status()).toBe(200);
  await page.reload();
  await expect(row.getByText('ui', { exact: true })).toHaveCount(0);
  const issues = await (await request.get(`${appUrl(info)}/api/issues`)).json();
  expect(issues.issues.find((item: { id: number }) => item.id === issue.id).labels).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('invalid API labels leave the inspected issue unchanged', async ({ page, request, workspace }, info) => {
  const issue = await workspace.create({ title: 'Invalid label sentinel', labels: ['bug'] });
  const api = `${appUrl(info)}/api/issues`;
  const before = await (await request.get(api)).json();
  for (const labels of [['bug', '', 'ui'], ['x'.repeat(21)], Array.from({ length: 11 }, (_, index) => `tag${index}`), ['bug,ui']]) {
    for (const response of [await request.post(api, { data: { title: `${workspace.prefix} Invalid labels`, labels } }), await request.patch(`${api}/${issue.id}`, { data: { labels } })]) {
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/Label/);
    }
  }
  expect(await (await request.get(api)).json()).toEqual(before);
  await page.goto(appUrl(info));
  await expect(page.getByTestId(`issue-${issue.id}`).getByText('bug', { exact: true })).toBeVisible();
});

baseTest('API-assigned labels survive a full server restart', async ({ page, request }, info) => {
  baseTest.setTimeout(45000);
  const directory = info.outputPath('owned-label-instance');
  mkdirSync(directory, { recursive: true });
  const databasePath = resolve(directory, 'labels.sqlite');
  const port = await availablePort();
  let running = await launch(port, databasePath, 'labels-before-restart');
  try {
    await page.context().setExtraHTTPHeaders({ [targetHeader]: targetIdentity('labels-before-restart', databasePath) });
    await page.goto(running.url);
    const created = await request.post(`${running.url}/api/issues`, { headers: { [targetHeader]: targetIdentity('labels-before-restart', databasePath) }, data: { title: 'Restart labels', labels: [' Bug ', 'durable'] } });
    expect(created.status()).toBe(201);
    await page.reload();
    await expect(page.getByTestId('issue-1').getByText('bug', { exact: true })).toBeVisible();
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
