import { expect } from '@playwright/test';
import { test } from './workspace.ts';
import { chooseRepository, chooseSubview, observeRepositoryReads, repositoryButton, repositoryFixture, repositoryGroup, subview } from './repository-fixture.ts';
import { commitFiles } from '../tests/repository-harness-fixture.ts';

test('repository sidebar selects enrolled repositories and preserves the All repositories overview', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const readOnly = observeRepositoryReads(page);
  try {
    await page.goto('/');
    await expect(repositoryGroup(page), 'The sidebar must list enrolled repositories.').toBeVisible();
    await expect(repositoryButton(page, null)).toHaveAttribute('aria-pressed', 'true');
    await expect(repositoryGroup(page).locator('[aria-pressed="true"]')).toHaveCount(1);
    for (const issue of f.issues) await expect(page.getByTestId(`issue-${issue.id}`)).toBeVisible();
    for (const name of ['All issues', 'Open', 'In progress', 'Done']) await expect(page.getByRole('navigation', { name: 'Workspace views' }).getByRole('button', { name, exact: true })).toHaveCount(0);
    await chooseRepository(page, f.first);
    await expect(subview(page, 'Issues')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await expect(subview(page, 'Repo harness')).toBeVisible();
    await expect(page.getByRole('main')).toContainText(f.first.name);
    await expect(page.getByTestId(`issue-${f.unassigned.id}`)).toHaveCount(0);
    await chooseRepository(page, null);
    await expect(page.getByTestId(`issue-${f.unassigned.id}`)).toBeVisible();
    readOnly();
  } finally { f.close(); }
});

test('selected repository scopes rows counts labels and combined issue filters', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const readOnly = observeRepositoryReads(page);
  try {
    await page.goto('/');
    await expect(repositoryButton(page, f.first), 'The sidebar must offer the enrolled repository before scoping issue rows, counts and labels.').toBeVisible();
    await chooseRepository(page, f.first);
    const rows = page.getByRole('region', { name: 'Issue list', exact: true }).locator('.issue-row');
    await expect(rows).toHaveCount(3);
    await expect(page.getByLabel('3 total issues', { exact: true }), 'Repository totals must exclude other repositories and unassigned records.').toBeVisible();
    await expect(page.getByLabel('Filter by label').locator('option')).toHaveText(['All labels', 'alpha-only', 'completed-only', 'shared']);
    await page.getByLabel('Search issues').fill('description-search');
    await page.getByLabel('Filter by status').selectOption('open');
    await page.getByLabel('Filter by label').selectOption('alpha-only');
    await page.getByLabel('Sort issues').selectOption('title');
    await expect(rows).toHaveCount(2); await expect(rows.first()).toHaveAttribute('data-testid', `issue-${f.alpha.id}`);
    await page.getByLabel('Sort issues').selectOption('priority');
    await expect(rows.first()).toHaveAttribute('data-testid', `issue-${f.zulu.id}`);
    await expect(page.getByLabel('3 total issues', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Filter by label').locator('option')).toHaveText(['All labels', 'alpha-only', 'completed-only', 'shared']);
    await page.getByLabel('Search issues').fill('no-matching-repository-record');
    await expect(page.getByRole('heading', { name: 'No matching issues' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(repositoryButton(page, null)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Search issues')).toHaveValue('');
    await expect(page.getByLabel('Filter by status')).toHaveValue('all');
    await expect(page.getByLabel('Filter by label')).toHaveValue('');
    await expect(page.getByTestId(`issue-${f.unassigned.id}`)).toBeVisible();
    readOnly();
  } finally { f.close(); }
});

test('subview switches retain issue filters and repository changes clear obsolete details and filters', async ({ page }, info) => {
  const f = repositoryFixture(info);
  try {
    await page.goto('/');
    await expect(repositoryButton(page, f.first), 'The sidebar must offer the enrolled repository before testing subview filter retention.').toBeVisible();
    await chooseRepository(page, f.first);
    await page.getByLabel('Search issues').fill('Alpha open');
    await page.getByLabel('Filter by status').selectOption('open');
    await page.getByLabel('Filter by label').selectOption('alpha-only');
    await page.getByLabel('Sort issues').selectOption('priority');
    await chooseSubview(page, 'Repo harness'); await expect(page.getByRole('main')).toContainText(`${f.a.marker}-lint`);
    await chooseSubview(page, 'Issues');
    await expect(page.getByLabel('Search issues')).toHaveValue('Alpha open');
    await expect(page.getByLabel('Filter by status')).toHaveValue('open');
    await expect(page.getByLabel('Filter by label')).toHaveValue('alpha-only');
    await expect(page.getByLabel('Sort issues')).toHaveValue('priority');
    await expect(page.locator('.issue-row')).toHaveCount(1);
    await page.getByRole('button', { name: `Inspect issue ${f.alpha.title}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await chooseRepository(page, f.second);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const [name, value] of [['Search issues', ''], ['Filter by status', 'all'], ['Filter by label', ''], ['Sort issues', 'newest']]) await expect(page.getByLabel(name, { exact: true })).toHaveValue(value);
    await expect(page.getByTestId(`issue-${f.beta.id}`)).toBeVisible();
    await chooseRepository(page, f.first);
    await expect(page.getByRole('dialog'), 'Returning to a repository must not reopen obsolete issue details.').toHaveCount(0);
    await chooseRepository(page, f.second);
    await chooseSubview(page, 'Repo harness');
    await expect(page.getByRole('main')).toContainText(`${f.b.marker}-lint`);
    await expect(page.getByRole('main')).not.toContainText(`${f.a.marker}-lint`);
    await chooseRepository(page, null);
    await expect(page.getByRole('heading', { name: 'Issues', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(`${f.b.marker}-lint`);
  } finally { f.close(); }
  await checkRetainedRepositorySubview(page, info);
  await checkPendingRepositoryDetails(page, info);
});

test('delayed harness successes and failures cannot replace the current repository view', async ({ page }, info) => {
  const f = repositoryFixture(info);
  try {
    for (const failure of [false, true]) for (const returnToAlpha of [false, true]) {
      let held = false;
      let release = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      let finished = () => {};
      const settled = new Promise<void>(resolve => { finished = resolve; });
      await page.route(`**/api/repos/${f.first.id}/harness`, async route => {
        if (held) return route.continue();
        const response = await route.fetch(); held = true;
        await gate;
        try { await route.fulfill(failure ? { status: 503, json: { error: 'OBSOLETE_ALPHA_FAILURE' } } : { response }); }
        finally { finished(); }
      });
      try {
        await page.goto('/');
        await expect(repositoryButton(page, f.first), 'The sidebar must offer the enrolled repository before testing delayed harness responses.').toBeVisible();
        await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
        await expect.poll(() => held).toBe(true);
        const fresh = `${f.prefix}-FRESH-${failure}-${returnToAlpha}`;
        commitFiles(f.a.path, { 'package.json': JSON.stringify({ scripts: { verify: fresh } }) });
        await chooseRepository(page, f.second); await chooseSubview(page, 'Repo harness');
        await expect(page.getByRole('main')).toContainText(`${f.b.marker}-lint`);
        if (returnToAlpha) { await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness'); await expect(page.getByRole('main')).toContainText(fresh); }
        release(); await settled;
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(page.getByRole('main')).toContainText(returnToAlpha ? fresh : `${f.b.marker}-lint`);
        await expect(page.getByRole('main')).not.toContainText('OBSOLETE_ALPHA_FAILURE');
        await expect(page.getByRole('main')).not.toContainText(`${f.a.marker}-lint`);
      } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
    }
  } finally { f.close(); }
});

test('repository registry loading empty failure and recovery leave Issues inspectable', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const readOnly = observeRepositoryReads(page);
  let mode = 'pending';
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.route(/\/api\/(?:workbench|repos)$/, async route => {
      if (mode === 'pending') await gate;
      if (mode === 'failure') return route.fulfill({ status: 503, json: { error: 'Repository registry unavailable' } });
      const response = await route.fetch(); const data = await response.json();
      await route.fulfill({ response, json: mode === 'empty' ? { ...data, repos: [] } : data });
    });
    await page.goto('/');
    await expect(repositoryGroup(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId(`issue-${f.unassigned.id}`)).toBeVisible();
    mode = 'empty'; release();
    await expect(repositoryGroup(page)).toContainText(/no (?:enrolled |registered )?repositories/i);
    await expect(repositoryButton(page, null)).toHaveAttribute('aria-pressed', 'true');
    mode = 'failure'; await page.reload();
    await expect(page.getByRole('alert').filter({ hasText: /repository|registry/i })).toBeVisible();
    await expect(page.getByTestId(`issue-${f.alpha.id}`)).toBeVisible();
    mode = 'ready';
    await page.getByRole('button', { name: /retry.*repositor|retry.*metadata/i }).click();
    await expect(repositoryButton(page, f.first)).toBeVisible();
    await chooseRepository(page, f.first); await expect(page.locator('.issue-row')).toHaveCount(3);
    readOnly();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); f.close(); }
});

test('repository submenus and both subviews preserve keyboard focus and fit long content at 390px', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const longCommand = `verify-${'long-command-segment'.repeat(25)}`;
  const longTitle = `Named ${'long acceptance title '.repeat(20)}`.trim();
  commitFiles(f.a.path, { 'package.json': JSON.stringify({ scripts: { verify: longCommand } }), 'factory/verification-contract.json': JSON.stringify({ ...f.a.full, requiredBrowserTests: [{ file: 'long.spec.ts', title: longTitle }] }) });
  try {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
    await expect(repositoryButton(page, f.first), 'The repository sidebar must be visible for keyboard navigation at 390px.').toBeVisible();
    await repositoryButton(page, f.first).focus(); await page.keyboard.press('Enter');
    await expect(repositoryButton(page, f.first)).toBeFocused();
    await subview(page, 'Repo harness').focus(); await page.keyboard.press('Enter');
    await expect(subview(page, 'Repo harness')).toBeFocused();
    await expect(page.getByRole('main')).toContainText(longCommand);
    await expect(page.getByRole('main')).toContainText(longTitle.trim());
    await page.waitForResponse(response => /\/api\/(?:workbench|repos)$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET');
    await expect(subview(page, 'Repo harness'), 'Background registry refresh must preserve submenu keyboard focus.').toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Harness source text and long repository names must fit 390px.').toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard focus must remain on an interactive control.').toBe(true);
    await subview(page, 'Issues').focus(); await page.keyboard.press('Enter');
    await expect(subview(page, 'Issues')).toBeFocused();
    await expect(page.getByTestId(`issue-${f.alpha.id}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Issues must fit 390px after subview navigation.').toBe(true);
    await page.getByRole('button', { name: `Inspect issue ${f.alpha.title}`, exact: true }).focus();
    await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: `Inspect issue ${f.alpha.title}`, exact: true })).toBeFocused();
  } finally { f.close(); }
  await checkNormalRepositoryKeyboardTraversal(page, info);
});

async function checkRetainedRepositorySubview(page: Parameters<typeof repositoryGroup>[0], info: Parameters<typeof repositoryFixture>[0]) {
  const f = repositoryFixture(info);
  const other = f.store.create({ title: `${f.prefix} Alpha open outside repository`, description: 'Matches the retained issue filters.', status: 'open', priority: 'high', labels: ['alpha-only'], work: { repoId: f.second.id, requirementId: null, dependsOn: [], acceptance: ['Remain excluded from the selected repository.'] } });
  try {
    await page.goto('/');
    await expect(repositoryButton(page, f.first), 'Repository selection is required before testing subview ownership.').toBeVisible();
    await chooseRepository(page, f.first);
    await page.getByLabel('Search issues').fill('Alpha open');
    await page.getByLabel('Filter by status').selectOption('open');
    await page.getByLabel('Filter by label').selectOption('alpha-only');
    await page.getByLabel('Sort issues').selectOption('priority');
    for (const name of ['Repo harness', 'Issues'] as const) {
      await chooseSubview(page, name);
      await expect(repositoryButton(page, f.first), `Switching to ${name} must retain the selected repository.`).toHaveAttribute('aria-pressed', 'true');
      await expect(repositoryButton(page, null)).not.toHaveAttribute('aria-pressed', 'true');
      await expect(repositoryGroup(page).locator('[aria-pressed="true"]')).toHaveCount(1);
      await expect(page.getByRole('main')).toContainText(f.first.name);
    }
    for (const [name, value] of [['Search issues', 'Alpha open'], ['Filter by status', 'open'], ['Filter by label', 'alpha-only'], ['Sort issues', 'priority']]) await expect(page.getByLabel(name, { exact: true })).toHaveValue(value);
    await expect(page.getByTestId(`issue-${f.alpha.id}`)).toBeVisible();
    await expect(page.getByTestId(`issue-${other.id}`), 'A matching out-of-repository issue must remain excluded after both subview transitions.').toHaveCount(0);
    await expect(page.locator('.issue-row')).toHaveCount(1);
    await chooseRepository(page, null);
    await page.getByLabel('Search issues').fill('Alpha open');
    await page.getByLabel('Filter by status').selectOption('open');
    await page.getByLabel('Filter by label').selectOption('alpha-only');
    await expect(page.getByTestId(`issue-${other.id}`), 'The excluded control issue really matches the same filters in All repositories.').toBeVisible();
    await expect(page.locator('.issue-row')).toHaveCount(2);
  } finally { f.store.delete(other.id); f.close(); }
}

async function checkPendingRepositoryDetails(page: Parameters<typeof repositoryGroup>[0], info: Parameters<typeof repositoryFixture>[0]) {
  const f = repositoryFixture(info);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  let finished = () => {};
  const settled = new Promise<void>(resolve => { finished = resolve; });
  const sentinel = 'OBSOLETE_ALPHA_DETAIL_RESPONSE';
  try {
    await page.route(`**/api/issues/${f.alpha.id}`, async route => {
      const response = await route.fetch();
      const data = await response.json();
      held = true;
      await gate;
      try { await route.fulfill({ response, json: { ...data, issue: { ...data.issue, title: sentinel } } }); }
      finally { finished(); }
    });
    await page.goto('/');
    await expect(repositoryButton(page, f.first), 'Repository selection is required before testing pending details.').toBeVisible();
    await chooseRepository(page, f.first);
    await page.getByRole('button', { name: `Inspect issue ${f.alpha.title}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => held, 'The detail read must be pending during the repository transition.').toBe(true);
    await repositoryButton(page, f.second).dispatchEvent('click');
    await expect(repositoryButton(page, f.second), 'The repository transition must occur while details are still active, without Escape or close.').toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('dialog'), 'Changing repositories must close the active pending detail dialog.').toHaveCount(0);
    await expect(page.getByTestId(`issue-${f.beta.id}`)).toBeVisible();
    release(); await settled;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('dialog'), 'A delayed detail response must not reopen the obsolete dialog.').toHaveCount(0);
    await expect(page.getByText(sentinel, { exact: true }), 'Delayed details must not survive in a visible or hidden stale view.').toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(sentinel);
    await expect(repositoryButton(page, f.second)).toHaveAttribute('aria-pressed', 'true');
    await chooseRepository(page, f.first);
    await expect(page.getByRole('dialog'), 'Returning to the original repository must not restore obsolete pending details.').toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(sentinel);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); f.close(); }
}

async function reachRepositoryControlByTab(page: Parameters<typeof repositoryGroup>[0], target: ReturnType<typeof repositoryGroup>, key: 'Tab' | 'Shift+Tab') {
  await expect(target, 'The repository or submenu target must be visible before keyboard traversal.').toBeVisible();
  for (let step = 0; step < 60; step++) {
    await page.keyboard.press(key);
    if (await target.evaluate(element => document.activeElement === element)) return;
  }
  await expect(target, `The actual repository or submenu control must be reachable within 60 ${key} presses without programmatic focus.`).toBeFocused();
}

async function checkNormalRepositoryKeyboardTraversal(page: Parameters<typeof repositoryGroup>[0], info: Parameters<typeof repositoryFixture>[0]) {
  const f = repositoryFixture(info);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(repositoryButton(page, f.first), 'Repository controls must exist for normal keyboard traversal.').toBeVisible();
    await reachRepositoryControlByTab(page, repositoryButton(page, f.first), 'Tab');
    await expect(repositoryButton(page, f.first)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(repositoryButton(page, f.first)).toHaveAttribute('aria-pressed', 'true');
    await expect(repositoryButton(page, f.first)).toBeFocused();
    await reachRepositoryControlByTab(page, subview(page, 'Repo harness'), 'Tab');
    await expect(subview(page, 'Repo harness')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(subview(page, 'Repo harness')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await expect(page.getByRole('main')).toContainText(`${f.a.marker}-lint`);
    await expect(subview(page, 'Repo harness')).toBeFocused();
    await reachRepositoryControlByTab(page, subview(page, 'Issues'), 'Shift+Tab');
    await expect(subview(page, 'Issues')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(subview(page, 'Issues')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await expect(page.getByTestId(`issue-${f.alpha.id}`)).toBeVisible();
    await expect(repositoryButton(page, f.first)).toHaveAttribute('aria-pressed', 'true');
    await expect(subview(page, 'Issues')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The keyboard-operated Issues subview must fit 390px.').toBe(true);
  } finally { f.close(); }
}
