import { expect, test as ownedTest } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Issue } from '../src/domain.ts';
import { appUrl, test } from './workspace.ts';
import { availablePort, launch, stop } from './owned-server.ts';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';

test('workspace exposes labelled controls and the real local persistence hint', async ({ page }, info) => {
  await page.goto(appUrl(info));
  await expect(page).toHaveTitle('Loop — Local issue tracker');
  await expect(page.getByRole('heading', { name: 'Issues', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace views' })).toBeVisible();
  await expect(page.getByLabel('Search issues', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Filter by status', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Sort issues', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New issue', exact: true })).toBeVisible();
  await expect(page.getByText('SQLite persistence', { exact: true })).toBeVisible();
  const opener = page.getByRole('button', { name: 'New issue', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Create issue', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Description', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Status', { exact: true })).toHaveValue('open');
  await expect(dialog.getByLabel('Priority', { exact: true })).toHaveValue('medium');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Create issue', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('create, reload, inspect API updates and confirmed deletion persist', async ({ page, request, workspace }, info) => {
  const title = `${workspace.prefix} Repair keyboard focus`;
  const editedTitle = `${workspace.prefix} Preserve keyboard focus`;
  const api = `${appUrl(info)}/api/issues`;
  await page.goto(appUrl(info));
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create issue', exact: true });
  await create.getByLabel('Title', { exact: true }).fill(`  ${title}  `);
  await create.getByLabel('Description', { exact: true }).fill('Restore focus after closing the dialog.');
  await create.getByLabel('Status', { exact: true }).selectOption('in_progress');
  await create.getByLabel('Priority', { exact: true }).selectOption('high');
  const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/issues') && response.request().method() === 'POST');
  await create.getByRole('button', { name: 'Create issue', exact: true }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const { issue } = await response.json() as { issue: Issue };
  await expect(create).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'New issue', exact: true })).toBeFocused();
  await page.getByLabel('Search issues', { exact: true }).fill(workspace.prefix);
  await expect(page.getByRole('button', { name: `View issue ${title}`, exact: true })).toBeVisible();
  const row = page.getByTestId(`issue-${issue.id}`);
  await expect(row.getByText(`LOC-${String(issue.id).padStart(3, '0')}`, { exact: true })).toBeVisible();
  await expect(row.getByText('In progress', { exact: true })).toBeVisible();
  await expect(row.getByText('High', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Search issues', { exact: true }).fill(workspace.prefix);
  const detailOpener = page.getByRole('button', { name: `View issue ${title}`, exact: true });
  await expect(detailOpener).toBeVisible();
  await detailOpener.click();
  const detail = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(detail.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(detail.getByText('Restore focus after closing the dialog.', { exact: true })).toBeVisible();
  await expect(detail.getByLabel('Title', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(detail).not.toBeVisible();
  await expect(detailOpener).toBeFocused();
  const updated = await request.patch(`${api}/${issue.id}`, { data: { title: editedTitle, description: 'Keyboard support verified.', status: 'done', priority: 'low' } });
  expect(updated.status()).toBe(200);
  const persisted = await request.get(api);
  expect(persisted.status()).toBe(200);
  const { issues } = await persisted.json() as { issues: Issue[] };
  expect(issues.find((item) => item.id === issue.id)).toMatchObject({ title: editedTitle, description: 'Keyboard support verified.', status: 'done', priority: 'low' });
  await page.reload();
  await page.getByLabel('Search issues', { exact: true }).fill(workspace.prefix);
  await expect(row.getByText('Done', { exact: true })).toBeVisible();
  await expect(row.getByText('Low', { exact: true })).toBeVisible();
  const deleteOpener = row.getByRole('button', { name: `Delete ${editedTitle}`, exact: true });
  await deleteOpener.click();
  const confirmation = page.getByRole('dialog', { name: 'Delete issue', exact: true });
  await expect(confirmation.getByText(editedTitle, { exact: true })).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(deleteOpener).toBeFocused();
  await expect(row).toBeVisible();
  await deleteOpener.click();
  const deletedResponse = page.waitForResponse((result) => result.url().endsWith(`/api/issues/${issue.id}`) && result.request().method() === 'DELETE');
  await confirmation.getByRole('button', { name: 'Delete issue', exact: true }).click();
  expect((await deletedResponse).status()).toBe(204);
  await expect(confirmation).not.toBeVisible();
  await expect(row).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'New issue', exact: true })).toBeFocused();
  const remaining = await request.get(api);
  expect(remaining.status()).toBe(200);
  expect((await remaining.json() as { issues: Issue[] }).issues.some((item) => item.id === issue.id)).toBe(false);
});

test('whitespace-only titles are rejected accessibly without a mutation', async ({ page }, info) => {
  let posts = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/api/issues')) posts += 1; });
  await page.goto(appUrl(info));
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create issue', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Enter a title.');
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByLabel('Title', { exact: true })).toBeFocused();
  expect(posts).toBe(0);
});

test('title and description search, both status controls, and all sort orders operate on real issues', async ({ page, workspace }, info) => {
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
  const views = page.getByRole('navigation', { name: 'Workspace views' });
  await expect(views.getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await views.getByRole('button', { name: 'In progress', exact: true }).click();
  await expect(filter).toHaveValue('in_progress');
  await expect(titles).toHaveText([`${workspace.prefix} Beta layout`]);
  await views.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(filter).toHaveValue('open');
  await expect(titles).toHaveText([`${workspace.prefix} Zulu routing`]);
  await views.getByRole('button', { name: 'All issues', exact: true }).click();
  await expect(filter).toHaveValue('all');
  await expect(titles).toHaveCount(3);
  await search.fill(`${workspace.prefix} no-such-issue`);
  await expect(page.getByRole('heading', { name: 'No matching issues', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(filter).toHaveValue('all');
  await expect(titles).toHaveCount(3);
});

ownedTest('an empty isolated workspace offers a working first-issue action', async ({ page, request }, info) => {
  const directory = info.outputPath('owned-empty-instance');
  mkdirSync(directory, { recursive: true });
  const databasePath = resolve(directory, 'empty.sqlite');
  const running = await launch(await availablePort(), databasePath, 'empty-workspace');
  try {
    await page.context().setExtraHTTPHeaders({ [targetHeader]: targetIdentity('empty-workspace', databasePath) });
    const health = await (await request.get(`${running.url}/api/health`)).json();
    expect(health).toMatchObject({ instanceId: 'empty-workspace', databasePath });
    const response = await request.get(`${running.url}/api/issues`);
    expect(response.status()).toBe(200);
    expect((await response.json() as { issues: Issue[] }).issues).toEqual([]);
    await page.goto(running.url);
    await expect(page.getByRole('heading', { name: 'No issues yet', exact: true })).toBeVisible();
    const opener = page.getByRole('button', { name: 'Create your first issue', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Create issue', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
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
    await expect(page.getByRole('button', { name: 'New issue', exact: true })).toBeDisabled();
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

test('a real server validation error preserves draft values and allows retry', async ({ page, workspace }, info) => {
  let invalidateNextPost = true;
  await page.route('**/api/issues', async (route) => {
    if (invalidateNextPost && route.request().method() === 'POST') {
      invalidateNextPost = false;
      await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), title: '' }) });
    } else await route.continue();
  });
  const title = `${workspace.prefix} Retry an unsaved draft`;
  await page.goto(appUrl(info));
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create issue', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Description', { exact: true }).fill('Keep these details after the error.');
  const failedResponse = page.waitForResponse((response) => response.url().endsWith('/api/issues') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
  expect((await failedResponse).status()).toBe(400);
  await expect(dialog.getByRole('alert')).toHaveText('Title must contain 1–120 characters.');
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(title);
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('Keep these details after the error.');
  await expect(dialog.getByRole('button', { name: 'Create issue', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: `View issue ${title}`, exact: true })).toBeVisible();
});

test('pending creation blocks duplicate submission and dialog dismissal', async ({ page, request, workspace }, info) => {
  let posts = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/issues', async (route) => {
    if (route.request().method() === 'POST') { posts += 1; await gate; }
    await route.continue();
  });
  try {
    const title = `${workspace.prefix} Submit exactly once`;
    await page.goto(appUrl(info));
    await page.getByRole('button', { name: 'New issue', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create issue', exact: true });
    await dialog.getByLabel('Title', { exact: true }).fill(title);
    await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
    await expect.poll(() => posts).toBe(1);
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('button', { name: 'Create issue', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Title', { exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).not.toBeVisible();
    const response = await request.get(`${appUrl(info)}/api/issues`);
    expect(response.status()).toBe(200);
    const { issues } = await response.json() as { issues: Issue[] };
    expect(issues.filter((issue) => issue.title === title)).toHaveLength(1);
    expect(posts).toBe(1);
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
  await expect(row.getByRole('button', { name: `Delete ${issue.title}`, exact: true })).toBeInViewport();
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
  await page.getByRole('navigation', { name: 'Workspace views' }).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(row.getByText('Done', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('phone-workspace.png'), fullPage: true });
  await row.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete issue', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Delete issue', exact: true })).toBeInViewport();
  await confirmation.getByRole('button', { name: 'Delete issue', exact: true }).click();
  await expect(row).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(externalRequests).toEqual([]);
});
