import { expect, test as ownedTest } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Issue } from '../src/domain.ts';
import { appUrl, test } from './workspace.ts';
import { availablePort, launch, stop } from './owned-server.ts';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';
import { expectRepositoryControl, expectStatusSelection, selectStatus } from './navigation.ts';

test('workspace exposes labelled controls and the real local persistence hint', async ({ page, workspace }, info) => {
  const issue = await workspace.create({ title: 'Inspect keyboard navigation' });
  await page.goto(appUrl(info));
  await expect(page).toHaveTitle('Loop — Local issue tracker');
  await expect(page.getByRole('heading', { name: 'Issues', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace views' })).toBeVisible();
  for (const label of ['Search issues', 'Filter by status', 'Filter by label', 'Sort issues']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await expectRepositoryControl(page);
  await expect(page.getByText('SQLite persistence', { exact: true })).toBeVisible();
  const opener = page.getByRole('button', { name: `View issue ${issue.title}`, exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(dialog.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('API-created issues, API updates and deletions remain visible across reloads', async ({ page, request, workspace }, info) => {
  const title = `${workspace.prefix} Repair keyboard focus`;
  const editedTitle = `${workspace.prefix} Preserve keyboard focus`;
  const api = `${appUrl(info)}/api/issues`;
  const created = await request.post(api, { data: { title: `  ${title}  `, description: 'Restore focus after closing the dialog.', status: 'in_progress', priority: 'high' } });
  expect(created.status()).toBe(201);
  const { issue } = await created.json() as { issue: Issue };
  expect(issue.title).toBe(title);
  await page.goto(appUrl(info));
  await page.getByLabel('Search issues', { exact: true }).fill(workspace.prefix);
  const row = page.getByTestId(`issue-${issue.id}`);
  await expect(row.getByText(`LOC-${String(issue.id).padStart(3, '0')}`, { exact: true })).toBeVisible();
  await expect(row.getByText('In progress', { exact: true })).toBeVisible();
  await expect(row.getByText('High', { exact: true })).toBeVisible();
  await page.reload();
  const opener = page.getByRole('button', { name: `View issue ${title}`, exact: true });
  await opener.click();
  const detail = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(detail.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(detail.getByText('Restore focus after closing the dialog.', { exact: true })).toBeVisible();
  await expect(detail.getByLabel('Title', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(detail).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect((await request.patch(`${api}/${issue.id}`, { data: { title: editedTitle, description: 'Keyboard support verified.', status: 'done', priority: 'low' } })).status()).toBe(200);
  const persisted = await request.get(api);
  expect(persisted.status()).toBe(200);
  expect((await persisted.json() as { issues: Issue[] }).issues.find(item => item.id === issue.id)).toMatchObject({ title: editedTitle, description: 'Keyboard support verified.', status: 'done', priority: 'low' });
  await page.reload();
  await expect(row.getByText('Done', { exact: true })).toBeVisible();
  await expect(row.getByText('Low', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: `Inspect issue ${editedTitle}`, exact: true }).click();
  await expect(detail.getByText('Keyboard support verified.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await request.delete(`${api}/${issue.id}`)).status()).toBe(204);
  await page.reload();
  await expect(row).not.toBeVisible();
  const remaining = await request.get(api);
  expect(remaining.status()).toBe(200);
  expect((await remaining.json() as { issues: Issue[] }).issues.some(item => item.id === issue.id)).toBe(false);
});

test('invalid API titles are rejected without changing the inspected collection', async ({ page, request, workspace }, info) => {
  const issue = await workspace.create({ title: 'Preserved validation sentinel' });
  const api = `${appUrl(info)}/api/issues`;
  const before = await (await request.get(api)).json();
  for (const title of ['', '   ', 'x'.repeat(121)]) {
    const created = await request.post(api, { data: { title } });
    expect(created.status()).toBe(400);
    expect((await created.json()).error).toBe('Title must contain 1–120 characters.');
    expect((await request.patch(`${api}/${issue.id}`, { data: { title } })).status()).toBe(400);
  }
  expect(await (await request.get(api)).json()).toEqual(before);
  await page.goto(appUrl(info));
  await expect(page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true })).toBeVisible();
});

test('title and description search, status filtering, and all sort orders operate on real issues', async ({ page, workspace }, info) => {
  const zulu = await workspace.create({ title: 'Zulu routing', description: `DescriptionOnly-${workspace.prefix}`, status: 'open', priority: 'high' });
  const alpha = await workspace.create({ title: 'Alpha keyboard', description: 'Polish focus restoration.', status: 'done', priority: 'low' });
  const beta = await workspace.create({ title: 'Beta layout', description: 'Fit the phone viewport.', status: 'in_progress', priority: 'medium' });
  await page.goto(appUrl(info));
  const search = page.getByLabel('Search issues', { exact: true });
  await search.fill(workspace.prefix);
  const titles = page.getByRole('region', { name: 'Issue list', exact: true }).getByRole('button').filter({ hasText: workspace.prefix });
  await expect(titles).toHaveText([`${workspace.prefix} Beta layout`, `${workspace.prefix} Alpha keyboard`, `${workspace.prefix} Zulu routing`]);
  await page.getByLabel('Sort issues', { exact: true }).selectOption('priority');
  await expect(titles).toHaveText([`${workspace.prefix} Zulu routing`, `${workspace.prefix} Beta layout`, `${workspace.prefix} Alpha keyboard`]);
  await page.getByLabel('Sort issues', { exact: true }).selectOption('title');
  await expect(titles).toHaveText([`${workspace.prefix} Alpha keyboard`, `${workspace.prefix} Beta layout`, `${workspace.prefix} Zulu routing`]);
  await page.screenshot({ path: info.outputPath('desktop-workspace.png'), fullPage: true });
  await page.getByLabel('Sort issues', { exact: true }).selectOption('newest');
  await expect(titles).toHaveText([`${workspace.prefix} Beta layout`, `${workspace.prefix} Alpha keyboard`, `${workspace.prefix} Zulu routing`]);
  await search.fill(`${workspace.prefix} ALPHA`);
  await expect(titles).toHaveText([`${workspace.prefix} Alpha keyboard`]);
  await search.fill(`DESCRIPTIONONLY-${workspace.prefix.toUpperCase()}`);
  await expect(titles).toHaveText([`${workspace.prefix} Zulu routing`]);
  await search.fill(workspace.prefix);
  const filter = page.getByLabel('Filter by status', { exact: true });
  await filter.selectOption('done');
  await expect(page.getByTestId(`issue-${alpha.id}`)).toBeVisible();
  await expect(page.getByTestId(`issue-${zulu.id}`)).not.toBeVisible();
  await expect(page.getByTestId(`issue-${beta.id}`)).not.toBeVisible();
  await expectStatusSelection(page, 'done');
  await selectStatus(page, 'in_progress');
  await expect(filter).toHaveValue('in_progress');
  await expect(titles).toHaveText([`${workspace.prefix} Beta layout`]);
  await selectStatus(page, 'open');
  await expect(filter).toHaveValue('open');
  await expect(titles).toHaveText([`${workspace.prefix} Zulu routing`]);
  await selectStatus(page, 'all');
  await expect(filter).toHaveValue('all');
  await expect(titles).toHaveCount(3);
  await search.fill(`${workspace.prefix} no-such-issue`);
  await expect(page.getByRole('heading', { name: 'No matching issues', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(filter).toHaveValue('all');
  await expect(titles).toHaveCount(3);
});

ownedTest('an empty isolated workspace remains inspectable and receives agent-created issues', async ({ page, request }, info) => {
  const directory = info.outputPath('owned-empty-instance');
  mkdirSync(directory, { recursive: true });
  const databasePath = resolve(directory, 'empty.sqlite');
  const running = await launch(await availablePort(), databasePath, 'empty-workspace');
  try {
    const headers = { [targetHeader]: targetIdentity('empty-workspace', databasePath) };
    await page.context().setExtraHTTPHeaders(headers);
    expect(await (await request.get(`${running.url}/api/health`)).json()).toMatchObject({ instanceId: 'empty-workspace', databasePath });
    const response = await request.get(`${running.url}/api/issues`);
    expect(response.status()).toBe(200);
    expect((await response.json() as { issues: Issue[] }).issues).toEqual([]);
    await page.goto(running.url);
    await expect(page.getByRole('heading', { name: 'No issues yet', exact: true })).toBeVisible();
    const created = await request.post(`${running.url}/api/issues`, { headers, data: { title: 'Agent-created first issue' } });
    expect(created.status()).toBe(201);
    const { issue } = await created.json();
    await page.reload();
    await expect(page.getByTestId(`issue-${issue.id}`)).toBeVisible();
    await page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
  } finally { await stop(running.child); }
});

test('loading is exposed while the real issue request is pending', async ({ page, workspace }, info) => {
  const issue = await workspace.create({ title: 'Wait for local data' });
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/issues', async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.continue();
  });
  try {
    await page.goto(appUrl(info));
    await expect(page.getByRole('heading', { name: 'Loading issues…', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByLabel('Search issues', { exact: true })).toBeEnabled();
    release();
    await expect(page.getByTestId(`issue-${issue.id}`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'false');
  } finally { release(); }
});

test('a failed list request announces an error and Retry reaches the real server', async ({ page, workspace }, info) => {
  const issue = await workspace.create({ title: 'Recover after a connection error' });
  let fail = true;
  await page.route('**/api/issues', async (route) => {
    if (fail && route.request().method() === 'GET') await route.abort('connectionrefused');
    else await route.continue();
  });
  await page.goto(appUrl(info));
  await expect(page.getByRole('heading', { name: 'Couldn’t load issues', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Could not reach the local server. Check that it is running and try again.');
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId(`issue-${issue.id}`)).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('a failed detail request allows read retry without losing the issue', async ({ page, workspace }, info) => {
  const issue = await workspace.create({ title: 'Retry inspection', description: 'Preserve the persisted details.' });
  await page.route(`**/api/issues/${issue.id}`, route => route.fulfill({ status: 503, json: { error: 'Details temporarily unavailable.' } }));
  await page.goto(appUrl(info));
  await page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Details temporarily unavailable.');
  await page.unroute(`**/api/issues/${issue.id}`);
  await dialog.getByRole('button', { name: 'Retry details', exact: true }).click();
  await expect(dialog).toContainText(issue.description);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true })).toBeFocused();
});

test('pending details can be dismissed without leaking stale content', async ({ page, workspace }, info) => {
  const first = await workspace.create({ title: 'Pending first details', description: 'Obsolete detail response.' });
  const second = await workspace.create({ title: 'Second details', description: 'Current detail response.' });
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let settled = () => {};
  const finished = new Promise<void>(resolve => { settled = resolve; });
  await page.route(`**/api/issues/${first.id}`, async route => {
    await gate;
    try { await route.continue(); } finally { settled(); }
  });
  try {
    await page.goto(appUrl(info));
    const opener = page.getByRole('button', { name: `Inspect issue ${first.title}`, exact: true });
    await opener.click();
    await expect(page.getByRole('dialog').getByText('Loading issue…', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.getByRole('button', { name: `Inspect issue ${second.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Issue #${second.id}`, exact: true });
    await expect(dialog).toContainText(second.description);
    release();
    await finished;
    await expect(dialog).toContainText(second.description);
    await expect(dialog).not.toContainText(first.description);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
});

test('phone layout keeps issue actions and dialogs in the viewport with no horizontal overflow', async ({ page, request, workspace }, info) => {
  const issue = await workspace.create({ title: 'X'.repeat(72), description: 'd'.repeat(180), status: 'in_progress', priority: 'high' });
  await page.setViewportSize({ width: 390, height: 844 });
  const externalRequests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(appUrl(info)).origin) externalRequests.push(request.url()); });
  await page.goto(appUrl(info));
  await page.getByLabel('Search issues', { exact: true }).fill(workspace.prefix);
  const row = page.getByTestId(`issue-${issue.id}`);
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: `View issue ${issue.title}`, exact: true })).toBeInViewport();
  await expect(row.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await row.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x >= 0 && bounds!.x + bounds!.width <= 390).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  const title = `${workspace.prefix} Mobile layout verified`;
  expect((await request.patch(`${appUrl(info)}/api/issues/${issue.id}`, { data: { title, status: 'done' } })).status()).toBe(200);
  await page.reload();
  await selectStatus(page, 'done');
  await expect(row.getByText('Done', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('phone-workspace.png'), fullPage: true });
  expect((await request.delete(`${appUrl(info)}/api/issues/${issue.id}`)).status()).toBe(204);
  await page.reload();
  await expect(row).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(externalRequests).toEqual([]);
});
