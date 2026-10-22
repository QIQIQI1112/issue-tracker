import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { test } from './workspace.ts';
import { repositoryButton, subview, observeRepositoryReads } from './repository-fixture.ts';
import { harnessRepository } from '../tests/repository-harness-fixture.ts';
import { IssueStore } from '../src/storage.ts';
import { parseCreateIssue } from '../src/domain.ts';
import type { Issue, NewIssue } from '../src/domain.ts';
import type { Repo } from '../src/workflow.ts';

function paginationFixture(info: TestInfo) {
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const database = new DatabaseSync(store.path);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const marker = `Pages-${randomUUID().slice(0, 8)}`;
  const source = harnessRepository(info.outputPath('pagination-repository'), marker);
  const first = store.work.addRepo({ name: `${marker} Alpha`, path: source.path, targetBranch: 'main' });
  const second = store.work.addRepo({ name: `${marker} Beta`, path: info.outputPath('other-repository'), targetBranch: 'main' });
  const owned: Issue[] = [];
  function create(values: Partial<NewIssue> & { title: string }, repo: Repo | null = first): Issue {
    const issue = store.create(parseCreateIssue({ description: 'Full diagnostic description.', status: 'open', priority: 'medium', labels: ['shared'], ...values, ...(repo ? { work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Inspect all matching issues.'] } } : {}) }));
    const createdAt = new Date(Date.UTC(2026, 0, 1) + owned.length * 86400000).toISOString();
    database.prepare('UPDATE issues SET created_at=?, updated_at=? WHERE id=?').run(createdAt, createdAt, issue.id);
    const saved = store.get(issue.id)!;
    owned.push(saved);
    return saved;
  }
  function seed(count: number, repo: Repo = first) {
    return Array.from({ length: count }, (_, index) => create({ title: `Record ${String((index * 7) % count + 1).padStart(2, '0')}`, priority: (['low', 'high', 'medium'] as const)[index % 3] }, repo));
  }
  return { store, first, second, create, seed, close: () => {
    for (const issue of owned) store.delete(issue.id);
    database.prepare('DELETE FROM repos WHERE id IN (?, ?)').run(first.id, second.id);
    database.close(); store.close();
  } };
}

const rows = (page: Page) => page.getByRole('region', { name: 'Issue list', exact: true }).locator('.issue-row');
const previous = (page: Page) => page.getByRole('button', { name: 'Previous page', exact: true });
const next = (page: Page) => page.getByRole('button', { name: 'Next page', exact: true });
function range(page: Page, start: number, end: number, total: number) {
  const span = start === end ? `${start}(?:\\s*[–−-]\\s*${end})?` : `${start}\\s*[–−-]\\s*${end}`;
  return page.getByText(new RegExp(`^(?:Showing\\s+)?${span}\\s+of\\s+${total}\\s+issues?\\.?$`, 'i'));
}
async function click(control: Locator, explanation = 'The planned browsing control must exist before activation.') {
  await expect(control, explanation).toBeVisible();
  await expect(control, explanation).toBeEnabled();
  await control.click();
}
async function fill(page: Page, value: string) {
  const control = page.getByLabel('Search issues', { exact: true });
  await expect(control, 'Issue search must remain available.').toBeVisible();
  await expect(control, 'Issue search must remain editable.').toBeEditable();
  await control.fill(value);
}
async function select(page: Page, label: string, value: string) {
  const control = page.getByLabel(label, { exact: true });
  await expect(control, `${label} must remain available before selecting ${value}.`).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control.locator(`option[value="${value}"]`), `${label} must offer ${value} from the complete collection before selection.`).toHaveCount(1);
  await control.selectOption(value);
}
async function chooseRepo(page: Page, repo: Repo | null) {
  await click(repositoryButton(page, repo));
  await expect(repositoryButton(page, repo)).toHaveAttribute('aria-pressed', 'true');
}
async function openRepository(page: Page, repo: Repo) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'false');
  await chooseRepo(page, repo);
}
async function expectPage(page: Page, collection: Issue[], number: number) {
  const expected = collection.slice((number - 1) * 10, number * 10);
  await expect(rows(page), 'Only the current ten-row slice may be rendered.').toHaveCount(expected.length);
  await expect.poll(() => rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))), { message: 'The rendered page must contain the exact sorted issue identities, with no omissions, duplicates or excluded issues.' }).toEqual(expected.map(issue => `issue-${issue.id}`));
  const start = collection.length ? (number - 1) * 10 + 1 : 0;
  await expect(range(page, start, Math.min(number * 10, collection.length), collection.length), 'A visible result range must describe the matching collection and current page.').toBeVisible();
  await expect(previous(page), 'Pagination must expose an accessible Previous page button.').toBeVisible();
  await expect(next(page), 'Pagination must expose an accessible Next page button.').toBeVisible();
  if (number === 1) await expect(previous(page), 'Previous must be disabled on the first or empty page.').toBeDisabled();
  else await expect(previous(page)).toBeEnabled();
  if (number * 10 >= collection.length) await expect(next(page), 'Next must be disabled on the last or empty page.').toBeDisabled();
  else await expect(next(page)).toBeEnabled();
}
async function traverse(page: Page, collection: Issue[]) {
  for (let number = 1; number <= Math.max(1, Math.ceil(collection.length / 10)); number++) {
    await expectPage(page, collection, number);
    if (number * 10 < collection.length) await click(next(page));
  }
}
async function reachByTab(page: Page, control: Locator, key: 'Tab' | 'Shift+Tab') {
  await expect(control, 'The keyboard destination must exist before normal traversal.').toBeVisible();
  await expect(control).toBeEnabled();
  for (let step = 0; step < 100; step++) {
    await page.keyboard.press(key);
    if (await control.evaluate(element => document.activeElement === element)) {
      await expect(control, `Normal ${key} traversal must reach the actual control.`).toBeFocused();
      return;
    }
  }
  await expect(control, `The control must be reachable within 100 normal ${key} presses without programmatic focus.`).toBeFocused();
}
async function compactRow(page: Page, issue: Issue, maximumHeight: number) {
  const row = page.getByTestId(`issue-${issue.id}`);
  await expect(row).toBeVisible();
  await expect(row, 'Summary rows must omit the full description.').not.toContainText(issue.description.slice(0, 64));
  const title = row.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true });
  await expect(title, 'The complete issue title must remain the accessible opener name.').toBeVisible();
  const titleGeometry = await title.evaluate(element => {
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), lineHeight: parseFloat(style.lineHeight) };
  });
  expect(titleGeometry.height, 'Even a maximum-length title must occupy at most two text lines.').toBeLessThanOrEqual(titleGeometry.lineHeight * 2 + 2);
  expect((await row.boundingBox())!.height, 'Long content must not expand compact rows indefinitely.').toBeLessThanOrEqual(maximumHeight);
  await expect(row.getByRole('button', { name: `View issue ${issue.title}`, exact: true })).toHaveText(`LOC-${String(issue.id).padStart(3, '0')}`);
  await expect(row.getByText('Open', { exact: true })).toBeVisible();
  await expect(row.getByText('Medium', { exact: true })).toBeVisible();
  await expect(row.locator(`time[datetime="${issue.createdAt}"]`).filter({ hasText: /\S/ }), 'The creation date must remain visible in the summary at this width.').toBeVisible();
  if (issue.labels.length > 2) {
    for (const label of issue.labels.slice(0, 2)) await expect(row.getByText(label, { exact: true })).toBeVisible();
    for (const label of issue.labels.slice(2)) await expect(row.getByText(label, { exact: true }), 'Only two full label chips belong in a compact summary.').toBeHidden();
    await expect(row, 'The compact summary must disclose the eight additional labels.').toContainText(/(?:\+\s*8|8\s+(?:more|additional))/i);
  }
}
function longValues() {
  return { title: 'Unbroken'.padEnd(120, 'X'), description: 'Complete diagnostic text '.padEnd(2000, 'd'), labels: Array.from({ length: 10 }, (_, index) => `label-${index}-`.padEnd(20, 'x')) };
}

test('compact issue summaries bound long content and keep full descriptions and labels in diagnostics', async ({ page }, info) => {
  const f = paginationFixture(info);
  const values = longValues();
  const long = f.create(values);
  const short = f.create({ title: 'Short summary', description: 'Short description.' });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openRepository(page, f.first);
    await expect(rows(page)).toHaveCount(2);
    await compactRow(page, long, 140);
    await compactRow(page, short, 140);
    const longHeight = (await page.getByTestId(`issue-${long.id}`).boundingBox())!.height;
    const shortHeight = (await page.getByTestId(`issue-${short.id}`).boundingBox())!.height;
    expect(longHeight - shortHeight, 'Maximum valid content may add at most two lines of summary height.').toBeLessThanOrEqual(48);
    for (const name of [`Inspect issue ${long.title}`, `View issue ${long.title}`]) {
      const opener = page.getByRole('button', { name, exact: true });
      await click(opener);
      const dialog = page.getByRole('dialog', { name: `Issue #${long.id}`, exact: true });
      await expect(dialog.getByRole('heading', { name: long.title, exact: true })).toBeVisible();
      await expect(dialog.getByText(long.description, { exact: true }), 'Full descriptions belong in diagnostics even when omitted from rows.').toBeVisible();
      await expect(dialog.getByText(long.labels.join(', '), { exact: true }), 'Diagnostics must retain all ten complete labels.').toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  } finally { f.close(); }
});

test('issue pagination exposes exact ranges and every match across first last and empty pages', async ({ page }, info) => {
  const f = paginationFixture(info);
  const collection = f.seed(23).reverse();
  const readOnly = observeRepositoryReads(page);
  let issueReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/issues') issueReads++; });
  try {
    await openRepository(page, f.first);
    const initialReads = issueReads;
    await traverse(page, collection);
    await click(previous(page)); await expectPage(page, collection, 2);
    await click(previous(page)); await expectPage(page, collection, 1);
    expect(issueReads, 'Default-page traversal must remain entirely client-side.').toBe(initialReads);
    for (const count of [1, 10, 11, 20, 23]) {
      const label = `boundary-${count}`;
      for (const issue of collection.slice(0, count)) f.store.update(issue.id, { labels: [...f.store.get(issue.id)!.labels, label] });
    }
    await page.reload();
    await chooseRepo(page, f.first);
    const refreshedReads = issueReads;
    for (const count of [1, 10, 11, 20, 23]) {
      await select(page, 'Filter by label', `boundary-${count}`);
      await traverse(page, collection.slice(0, count));
    }
    await fill(page, 'Definitely absent pagination match');
    await expectPage(page, [], 1);
    await expect(page.getByRole('heading', { name: 'No matching issues', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
    expect(initialReads, 'The initial list is loaded before client-side paging.').toBeGreaterThan(0);
    expect(issueReads, 'Paging and filtering must not fetch additional issue collections.').toBe(refreshedReads);
    readOnly();
  } finally { f.close(); }
});

test('repository search status and label filters precede sorting and pagination across the complete collection', async ({ page }, info) => {
  const f = paginationFixture(info);
  const primary = Array.from({ length: 23 }, (_, index) => f.create({ title: `Record ${String((index * 7) % 23 + 1).padStart(2, '0')}`, description: 'DescriptionOnlyNeedle', status: 'open', labels: index === 0 ? ['target', 'late-only'] : ['target'], priority: (['low', 'high', 'medium'] as const)[index % 3] }));
  const excluded = [
    f.create({ title: 'Foreign match', description: 'DescriptionOnlyNeedle', labels: ['target', 'foreign-only'] }, f.second),
    f.create({ title: 'Unassigned match', description: 'DescriptionOnlyNeedle', labels: ['target'] }, null),
    f.create({ title: 'Wrong status', description: 'DescriptionOnlyNeedle', status: 'done', labels: ['target'] }),
    f.create({ title: 'Wrong label', description: 'DescriptionOnlyNeedle', labels: ['other'] }),
    f.create({ title: 'Wrong search', description: 'Unrelated description', labels: ['target'] }),
  ];
  for (let index = 0; index < 10; index++) f.create({ title: `Newest excluded ${index}`, description: 'DescriptionOnlyNeedle', status: 'done', labels: ['target'] });
  try {
    await openRepository(page, f.first);
    await expect(page.getByTestId(`issue-${primary[0].id}`), 'The description-only sentinel starts beyond the default page.').toHaveCount(0);
    const options = page.getByLabel('Filter by label', { exact: true }).locator('option');
    await expect(options.filter({ hasText: /^late-only$/ }), 'Label options must include labels found only beyond the current page.').toHaveCount(1);
    await expect(options.filter({ hasText: /^foreign-only$/ }), 'Out-of-repository labels must be excluded.').toHaveCount(0);
    await fill(page, 'DescriptionOnlyNeedle');
    await select(page, 'Filter by status', 'open');
    await select(page, 'Filter by label', 'target');
    const orders = [
      { value: 'newest', expected: [...primary].reverse() },
      { value: 'title', expected: [...primary].sort((a, b) => a.title.localeCompare(b.title)) },
      { value: 'priority', expected: (['high', 'medium', 'low'] as const).flatMap(priority => primary.filter(issue => issue.priority === priority).reverse()) },
    ];
    for (const order of orders) {
      await select(page, 'Sort issues', order.value);
      await traverse(page, order.expected);
      for (const issue of excluded) await expect(page.getByTestId(`issue-${issue.id}`)).toHaveCount(0);
    }
    await select(page, 'Filter by label', 'late-only');
    await expectPage(page, [primary[0]], 1);
    await select(page, 'Filter by label', 'target');
    await click(next(page));
    await expect(page.getByTestId(`issue-${primary[0].id}`), 'The title-only sentinel must be outside the current page before searching.').toHaveCount(0);
    await fill(page, primary[0].title);
    await expectPage(page, [primary[0]], 1);
    await fill(page, 'Unmatched title and description');
    await expectPage(page, [], 1);
  } finally { f.close(); }
});

test('changing query status label sort or repository resets the page while same-repository subviews retain it', async ({ page }, info) => {
  const f = paginationFixture(info);
  const first = f.seed(23).reverse();
  const second = f.seed(23, f.second).reverse();
  try {
    for (const change of ['query', 'status', 'label', 'sort', 'repository']) {
      await openRepository(page, f.first);
      await click(next(page)); await expectPage(page, first, 2);
      if (change === 'query') await fill(page, 'Record');
      if (change === 'status') await select(page, 'Filter by status', 'open');
      if (change === 'label') await select(page, 'Filter by label', 'shared');
      if (change === 'sort') await select(page, 'Sort issues', 'priority');
      if (change === 'repository') await chooseRepo(page, f.second);
      const expected = change === 'repository' ? second : change === 'sort' ? (['high', 'medium', 'low'] as const).flatMap(priority => first.filter(issue => issue.priority === priority)) : first;
      await expectPage(page, expected, 1);
    }
    await chooseRepo(page, f.first);
    await fill(page, 'Record');
    await select(page, 'Filter by status', 'open');
    await select(page, 'Filter by label', 'shared');
    await select(page, 'Sort issues', 'title');
    const sorted = [...first].sort((a, b) => a.title.localeCompare(b.title));
    await click(next(page)); await expectPage(page, sorted, 2);
    await chooseRepo(page, f.first);
    await expectPage(page, sorted, 2);
    await click(subview(page, 'Repo harness'));
    await expect(page.getByRole('heading', { name: 'Repo harness', exact: true, level: 1 })).toBeVisible();
    await click(subview(page, 'Issues'));
    await expectPage(page, sorted, 2);
    for (const [label, value] of [['Search issues', 'Record'], ['Filter by status', 'open'], ['Filter by label', 'shared'], ['Sort issues', 'title']]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    await fill(page, 'No matching reset sentinel');
    await expectPage(page, [], 1);
    await click(page.getByRole('button', { name: 'Reset filters', exact: true }));
    await expect(repositoryButton(page, null)).toHaveAttribute('aria-pressed', 'true');
    await expectPage(page, f.store.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id), 1);
  } finally { f.close(); }
});

test('background refresh preserves valid issue pages and clamps shrinking or empty results without stale rows', async ({ page }, info) => {
  test.setTimeout(60000);
  const f = paginationFixture(info);
  let collection = f.seed(23).reverse();
  let revision = 0;
  let registryReads = 0;
  type Pending = { held: boolean; release: () => void; gate: Promise<void>; fail: boolean };
  const refreshState: { pending: Pending | null } = { pending: null };
  await page.route('**/api/workbench', async route => {
    const response = await route.fetch();
    const data = await response.json();
    registryReads++;
    await route.fulfill({ response, json: { ...data, jobs: [{ id: -1000 - revision, status: 'queued' }] } });
  });
  await page.route('**/api/issues', async route => {
    const active = refreshState.pending;
    if (!active || active.held) return route.continue();
    const response = await route.fetch();
    active.held = true;
    await active.gate;
    await route.fulfill(active.fail ? { status: 503, json: { error: 'Owned pagination refresh failure' } } : { response });
  });
  async function holdRefresh(fail = false, retry = false) {
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const active: Pending = { held: false, release, gate, fail };
    refreshState.pending = active;
    if (retry) await click(page.getByRole('button', { name: 'Retry', exact: true }));
    else revision++;
    await expect.poll(() => active.held, { message: 'The owned background issue refresh must be held before asserting page state.', timeout: 10000 }).toBe(true);
    await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'true');
    return async () => {
      refreshState.pending = null; active.release();
      await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'false');
    };
  }
  try {
    await openRepository(page, f.first);
    await expect.poll(() => registryReads).toBeGreaterThan(0);
    await click(next(page)); await expectPage(page, collection, 2);
    const added = f.create({ title: 'New refresh record' });
    let finish = await holdRefresh();
    await expectPage(page, collection, 2);
    await finish();
    collection = [added, ...collection];
    await expectPage(page, collection, 2);
    finish = await holdRefresh(true);
    await expectPage(page, collection, 2);
    await finish();
    await expect(page.getByRole('alert').filter({ hasText: 'Owned pagination refresh failure' })).toBeVisible();
    await expectPage(page, collection, 2);
    finish = await holdRefresh(false, true); await finish();
    await expectPage(page, collection, 2);
    await click(next(page)); await expectPage(page, collection, 3);
    for (const issue of collection.slice(11)) f.store.delete(issue.id);
    collection = collection.slice(0, 11);
    finish = await holdRefresh(); await finish();
    await expectPage(page, collection, 2);
    for (const issue of collection) f.store.delete(issue.id);
    finish = await holdRefresh(); await finish();
    await expectPage(page, [], 1);
    await expect(page.getByRole('heading', { name: 'No matching issues', exact: true })).toBeVisible();
    collection = f.seed(12).reverse();
    finish = await holdRefresh(); await finish();
    await expectPage(page, collection, 1);
    await click(next(page)); await expectPage(page, collection, 2);
    const survivor = f.create({ title: 'Current control survivor', description: 'DelayedUniqueNeedle' });
    finish = await holdRefresh();
    await fill(page, 'DelayedUniqueNeedle');
    await select(page, 'Filter by status', 'open');
    await select(page, 'Filter by label', 'shared');
    await select(page, 'Sort issues', 'priority');
    await expectPage(page, [], 1);
    await finish();
    await expectPage(page, [survivor], 1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    refreshState.pending?.release();
    await page.unrouteAll({ behavior: 'wait' });
    f.close();
  }
});

function scrollState(row: Locator) {
  return row.evaluate(element => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        const rect = parent.getBoundingClientRect();
        return { top: parent.scrollTop, height: parent.clientHeight, contentHeight: parent.scrollHeight, x: rect.x, y: rect.y, width: rect.width, bottom: rect.bottom };
      }
    }
    return null;
  });
}

test('desktop issue scrolling is bounded while heading filters and pagination remain reachable', async ({ page }, info) => {
  const f = paginationFixture(info);
  const collection = Array.from({ length: 23 }, (_, index) => f.create({ ...longValues(), title: `Desktop ${index} `.padEnd(120, 'X') })).reverse();
  try {
    await page.setViewportSize({ width: 1440, height: 800 });
    await openRepository(page, f.first);
    await expectPage(page, collection, 1);
    const firstRow = rows(page).first();
    const state = await scrollState(firstRow);
    expect(state, 'The issue rows must have a genuinely scrollable bounded ancestor rather than extending the document.').not.toBeNull();
    expect(state!.contentHeight).toBeGreaterThan(state!.height);
    expect(state!.height, 'The row scroll area must fit within the desktop viewport.').toBeLessThan(800);
    const rowHandle = await firstRow.elementHandle();
    expect(rowHandle).not.toBeNull();
    const controls = [page.getByRole('heading', { name: 'Issues', exact: true, level: 1 }), ...['Search issues', 'Filter by status', 'Filter by label', 'Sort issues'].map(label => page.getByLabel(label, { exact: true })), range(page, 1, 10, 23), previous(page), next(page)];
    for (const control of controls) {
      await expect(control, 'Headings, filters and pagination must remain reachable outside the issue-row scroll area.').toBeInViewport();
      expect(await control.evaluate((element, row) => {
        for (let parent = row.parentElement; parent && parent !== document.body; parent = parent.parentElement) if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) return !parent.contains(element);
        return false;
      }, rowHandle!), 'Browsing controls must not scroll away inside the row viewport.').toBe(true);
    }
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(state!.x + state!.width / 2, state!.y + state!.height / 2);
    await page.mouse.wheel(0, 10000);
    await expect.poll(async () => (await scrollState(firstRow))?.top ?? 0, { message: 'Actual wheel scrolling must move the bounded issue area.' }).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY), 'Scrolling the backlog must not move the document and its browsing controls.').toBe(before);
    for (const control of controls) await expect(control).toBeInViewport();
    await expect(rows(page).last()).toBeInViewport();
    await click(next(page)); await expectPage(page, collection, 2);
    await expect(next(page)).toBeInViewport();
  } finally { f.close(); }
});

test('390px issue pagination stays readable keyboard accessible and restores detail opener focus', async ({ page }, info) => {
  const f = paginationFixture(info);
  const collection = Array.from({ length: 23 }, (_, index) => f.create({ ...longValues(), title: `Mobile ${index} `.padEnd(120, 'X') })).reverse();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRepository(page, f.first);
    await expectPage(page, collection, 1);
    for (const label of ['Search issues', 'Filter by status', 'Filter by label', 'Sort issues']) {
      const control = page.getByLabel(label, { exact: true });
      await reachByTab(page, control, 'Tab');
      await expect(control).toBeInViewport();
    }
    await reachByTab(page, next(page), 'Tab');
    await expect(next(page)).toBeInViewport();
    await page.keyboard.press('Enter');
    await expectPage(page, collection, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Maximum valid issue data and pagination must fit 390px without horizontal overflow.').toBe(true);
    const issue = collection[10];
    await compactRow(page, issue, 200);
    const row = page.getByTestId(`issue-${issue.id}`);
    for (const control of [row.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true }), row.getByRole('button', { name: `View issue ${issue.title}`, exact: true }), row.locator('time[datetime]')]) {
      const box = await control.boundingBox();
      expect(box, 'Title, ID and date must remain displayed on mobile.').not.toBeNull();
      expect(box!.x >= 0 && box!.x + box!.width <= 391, 'Summary metadata must remain within the phone width.').toBe(true);
    }
    for (const kind of ['Inspect', 'View']) {
      const opener = row.getByRole('button', { name: `${kind} issue ${issue.title}`, exact: true });
      await reachByTab(page, opener, 'Shift+Tab');
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(issue.description, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (kind === 'Inspect') await page.keyboard.press('Escape');
      else {
        await reachByTab(page, dialog.getByRole('button', { name: 'Close dialog', exact: true }), 'Tab');
        await page.keyboard.press('Enter');
      }
      await expect(dialog).toHaveCount(0);
      await expect(opener, 'Dismissing later-page diagnostics must restore the exact opener.').toBeFocused();
      await expectPage(page, collection, 2);
    }
    await reachByTab(page, previous(page), 'Shift+Tab');
    await page.keyboard.press('Enter'); await expectPage(page, collection, 1);
    await reachByTab(page, next(page), 'Tab');
    await page.keyboard.press('Enter'); await expectPage(page, collection, 2);
    await reachByTab(page, next(page), 'Tab');
    await page.keyboard.press('Enter'); await expectPage(page, collection, 3);
    await expect(range(page, 21, 23, 23)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { f.close(); }
});
