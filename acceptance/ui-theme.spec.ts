import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './workspace.ts';
import { repositoryButton, repositoryFixture } from './repository-fixture.ts';
import { recordDiagnosticRun } from './diagnostic-fixture.ts';
import { saveDelivery } from '../factory/delivery.ts';
import type { Issue } from '../src/domain.ts';

const view = (page: Page, name: string) => {
  const nav = page.getByRole('navigation', { name: 'Workspace views', exact: true });
  return nav.getByRole('button', { name, exact: true }).or(nav.getByRole('link', { name, exact: true }));
};

async function click(control: Locator) {
  await expect(control, 'The planned inspection control must exist before activation.').toBeVisible({ timeout: 3000 });
  await expect(control, 'The planned control must be enabled before activation.').toBeEnabled();
  await control.click();
}

async function select(control: Locator, value: string) {
  await expect(control, 'The scoped selector must exist before selection.').toBeVisible({ timeout: 3000 });
  await expect(control).toBeEnabled();
  await expect.poll(() => control.locator('option').evaluateAll((options, expected) => options.some(option => (option as HTMLOptionElement).value === expected), value), { message: 'The intended option must be offered before selection.' }).toBe(true);
  await control.selectOption(value);
}

async function reach(page: Page, control: Locator, direction: 'Tab' | 'Shift+Tab') {
  await expect(control, 'The keyboard destination must exist before ordinary traversal.').toBeVisible({ timeout: 3000 });
  await expect(control).toBeEnabled();
  for (let step = 0; step < 100; step++) {
    if (await control.evaluateAll(elements => elements.length === 1 && document.activeElement === elements[0])) break;
    await page.keyboard.press(direction);
    if (!await control.isVisible()) break;
  }
  await expect(control, `Normal ${direction} traversal must reach the inspection control.`).toBeFocused();
  await expect(control).toBeInViewport();
}

function observeTraffic(page: Page) {
  const mutations: string[] = [];
  const preview: string[] = [];
  let inPreview = false;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (!/^\/api(?:\/|$)/.test(path)) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /\/(?:start|retry|execute)(?:\/|$)/.test(path)) mutations.push(`${request.method()} ${path}`);
    if (inPreview) preview.push(`${request.method()} ${path}`);
  });
  return { mutations, preview, enterPreview: () => { inPreview = true; }, leavePreview: () => { inPreview = false; } };
}

async function fits(page: Page, controls: Locator[]) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The light document must fit without horizontal page overflow.').toBe(true);
  for (const control of controls) {
    await expect(control, 'The light control must remain visible.').toBeVisible();
    await control.scrollIntoViewIfNeeded();
    await expect(control, 'Scrolling must make the complete control reachable.').toBeInViewport();
    expect(await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    }), 'Controls must fit their own boxes and viewport without clipped labels.').toBe(true);
  }
}

function fixture(info: TestInfo) {
  const f = repositoryFixture(info);
  const database = new DatabaseSync(f.store.path);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const requirements = Array.from({ length: 12 }, (_, index) => f.store.work.addRequirement({ repoId: f.first.id, title: `Theme requirement ${String(index).padStart(2, '0')}`, goal: `Retain the original themed inspection goal ${index}.` }));
  const matches: Issue[] = [];
  for (let index = 0; index < 23; index++) {
    const issue = f.store.create({ title: `Theme record ${String((index * 7) % 23).padStart(2, '0')}`, description: 'Theme diagnostics retain all business fields.', status: 'open', priority: 'medium', labels: ['theme-owned'], work: { repoId: f.first.id, requirementId: requirements[0].id, dependsOn: [], acceptance: ['Retain browsing state while changing theme.'] } });
    matches.push(issue); f.issues.push(issue);
  }
  for (const [title, repo, status, label] of [
    ['Theme record wrong repository', f.second, 'open', 'theme-owned'],
    ['Theme record wrong status', f.first, 'done', 'theme-owned'],
    ['Theme record wrong label', f.first, 'open', 'excluded'],
    ['Excluded search result', f.first, 'open', 'theme-owned'],
  ] as const) f.issues.push(f.store.create({ title, description: '', status, priority: 'low', labels: [label], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Exclude confounding records.'] } }));
  matches.sort((a, b) => a.title.localeCompare(b.title));
  const issue = matches[10];
  const run = recordDiagnosticRun(f.store, database, { root: info.outputPath('theme-evidence'), repoId: f.first.id, requirementId: requirements[0].id, issueId: issue.id, status: 'completed' });
  const evidence = 'Theme evidence retains independently readable artifact bytes.\n';
  writeFileSync(join(run.evidencePath, 'theme.log'), evidence);
  saveDelivery(run.evidencePath, { schemaVersion: 1, runId: run.id, taskId: 'theme-fixture', title: 'Theme audit', goal: 'Read retained delivery content.', summary: 'The stored theme audit remains readable.', status: 'merged', startedAt: run.startedAt, completedAt: run.completedAt!, baseline: null, sourceHash: null, defaults: [], changes: [], checks: [{ name: 'Retained audit', status: 'passed' }], nodePassed: 1, browserPassed: 1, attempts: 1, review: null, integration: null, limitations: ['Retained theme warning.'] });
  return { ...f, matches, requirements, issue, run, evidence, close: () => {
    database.prepare('DELETE FROM work_runs WHERE repo_id=?').run(f.first.id);
    database.prepare('DELETE FROM jobs WHERE repo_id=?').run(f.first.id);
    for (const item of f.issues) f.store.delete(item.id);
    database.prepare('DELETE FROM requirements WHERE repo_id=?').run(f.first.id);
    database.close(); f.close();
  } };
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('theme-test-seeded')) return;
    localStorage.setItem('loop.theme', 'light');
    sessionStorage.setItem('theme-test-seeded', 'true');
  });
}

test('app and preview apply the light palette before mounting with supported baseline storage states', async ({ context }) => {
  test.setTimeout(90000);
  for (const path of ['/', '/__ui/components']) {
    for (const saved of [null, 'light', 'DARK', 'system', 'unavailable']) {
      const page = await context.newPage();
      try {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.addInitScript(value => {
          if (value === null) localStorage.removeItem('loop.theme');
          else if (value !== 'unavailable') localStorage.setItem('loop.theme', value);
          if (value === 'unavailable') Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('Storage denied', 'SecurityError'); } });
          const observation = { first: null as null | { scheme: string; frame: string; titleInk: string | null } };
          Object.assign(window, { themeMountObservation: observation });
          const observer = new MutationObserver(() => {
            const root = document.getElementById('root');
            if (!root?.firstElementChild || observation.first) return;
            const style = getComputedStyle(document.documentElement);
            const title = root.querySelector('h1');
            observation.first = { scheme: style.colorScheme, frame: style.backgroundColor, titleInk: title ? getComputedStyle(title).color : null };
            observer.disconnect();
          });
          observer.observe(document, { childList: true, subtree: true });
        }, saved);
        await page.goto(path);
        await expect(page.getByRole('heading', { name: path === '/' ? 'Issues' : 'Component preview', exact: true, level: 1 }), 'Storage handling must leave the actual entry usable.').toBeVisible({ timeout: 5000 });
        await expect.poll(() => page.evaluate(() => (window as unknown as { themeMountObservation: { first: unknown } }).themeMountObservation.first), { message: `${path}: saved ${String(saved)} must apply the light scheme and rendered frame/title palette at the first populated mount, including rejected invalid values.` }).toEqual({ scheme: 'light', frame: 'rgb(252, 252, 251)', titleInk: 'rgb(11, 11, 11)' });
      } finally { await page.close(); }
    }
  }
});

test('light workspace preserves repository browsing state real polling focus and inspection interactions', async ({ page }, info) => {
  test.setTimeout(90000);
  const f = fixture(info);
  const traffic = observeTraffic(page);
  let generation = 0;
  let reads = 0;
  let issueReads = 0;
  await page.route('**/api/issues', async route => {
    const response = await route.fetch();
    issueReads++;
    await route.fulfill({ response });
  });
  await page.route('**/api/workbench', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.jobs.push({ id: -999, status: generation % 2 ? 'completed' : 'queued' });
    reads++;
    await route.fulfill({ response, json: data });
  });
  try {
    await seed(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    await click(repositoryButton(page, f.first));
    const search = page.getByLabel('Search issues', { exact: true });
    await expect(search, 'Search must exist before establishing retained filters.').toBeVisible();
    await search.fill('Theme record');
    for (const [label, value] of [['Filter by status', 'open'], ['Filter by label', 'theme-owned'], ['Sort issues', 'title']]) await select(page.getByLabel(label, { exact: true }), value);
    const pages = page.getByRole('navigation', { name: 'Issue pages', exact: true });
    await click(pages.getByRole('button', { name: 'Next page', exact: true }));
    const rows = page.getByRole('list', { name: 'Issues on this page', exact: true }).getByTestId(/^issue-\d+$/);
    const retained = async () => {
      await expect(repositoryButton(page, f.first)).toHaveAttribute('aria-pressed', 'true');
      await expect(view(page, 'Issues')).toHaveAttribute('aria-current', /^(?:page|true)$/);
      for (const [label, value] of [['Search issues', 'Theme record'], ['Filter by status', 'open'], ['Filter by label', 'theme-owned'], ['Sort issues', 'title']]) await expect(page.getByLabel(label, { exact: true }), `Polling must preserve ${label}.`).toHaveValue(value);
      await expect(pages.getByRole('status'), 'Polling must retain the exact filtered page range.').toHaveText(/^11\s*[–−—-]\s*20\s+of\s+23\s+issues\.?$/i);
      await expect.poll(() => rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))), { message: 'The title-sorted page must retain exactly owned matches and exclude wrong repository, status, label and search records.' }).toEqual(f.matches.slice(10, 20).map(issue => `issue-${issue.id}`));
    };
    await retained();
    const handle = await search.elementHandle();
    const resting = await search.evaluate(element => {
      const style = getComputedStyle(element);
      return { shadow: style.boxShadow, border: style.border, background: style.backgroundColor };
    });
    await reach(page, search, 'Tab');
    const before = reads;
    const beforeIssues = issueReads;
    generation++;
    await expect.poll(() => reads, { message: 'A real registry polling interval must occur in the light workspace.' }).toBeGreaterThan(before);
    await expect.poll(() => issueReads, { message: 'The changed registry must complete an actual issue refresh.' }).toBeGreaterThan(beforeIssues);
    await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'false');
    expect(await handle!.evaluate(element => element.isConnected && document.activeElement === element), 'Polling must preserve the same intentional keyboard focus owner.').toBe(true);
    expect(await search.evaluate((element, before) => {
      const style = getComputedStyle(element);
      const outlined = !['none', 'hidden'].includes(style.outlineStyle) && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(style.outlineColor);
      return outlined || style.boxShadow !== before.shadow || style.border !== before.border || style.backgroundColor !== before.background;
    }, resting), 'Intentional keyboard focus must retain a rendered indicator after a background refresh.').toBe(true);
    await retained();
    const opener = page.getByRole('button', { name: `View issue ${f.issue.title}`, exact: true });
    await click(opener);
    const dialog = page.getByRole('dialog', { name: `Issue #${f.issue.id}`, exact: true });
    await expect(dialog, 'Diagnostics must keep neutral named-container focus in the light workspace.').toBeFocused();
    await expect(dialog).toHaveCSS('outline-style', 'none');
    await reach(page, dialog.getByRole('button', { name: 'Close dialog', exact: true }), 'Tab');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener, 'Escape must return to the exact issue opener in the light workspace.').toBeFocused();
    await click(opener);
    await expect(dialog).toBeVisible();
    await click(dialog.getByRole('button', { name: 'Close dialog', exact: true }));
    await expect(opener, 'Close must restore the issue opener in the light workspace.').toBeFocused();
    await click(view(page, 'Requirements'));
    const requirementPages = page.getByRole('navigation', { name: 'Requirement pages', exact: true });
    await click(requirementPages.getByRole('button', { name: /Next(?: page)?$/i }));
    const requirementRows = page.getByRole('region', { name: 'Requirement list', exact: true }).getByTestId(/^requirement-\d+$/);
    await expect(requirementRows).toHaveCount(2);
    const expectedRequirements = [...f.requirements].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).slice(10, 12);
    const selectedRequirement = expectedRequirements[0];
    const selected = page.getByTestId(`requirement-${selectedRequirement.id}`).getByRole('button', { name: `Inspect requirement ${selectedRequirement.title}`, exact: true });
    await click(selected);
    const identity = page.getByRole('region', { name: 'Requirement inspection', exact: true }).getByTestId('requirement-identity');
    await expect(identity).toBeVisible();
    await expect(view(page, 'Requirements')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(identity, 'The selected requirement identity field must show the fixture-selected second-page requirement.').toHaveText(`Requirement #${selectedRequirement.id}`);
    await expect(requirementPages.getByRole('status')).toHaveText(/^11\s*[–−—-]\s*12\s+of\s+12\s+requirements\.?$/i);
    expect(await requirementRows.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(expectedRequirements.map(requirement => `requirement-${requirement.id}`));
    await click(view(page, 'Repo harness'));
    const source = page.locator('details.harness-source').filter({ has: page.locator('summary .harness-source-path', { hasText: /^package\.json$/ }) });
    await click(source.locator('summary').filter({ has: page.locator('.harness-source-path', { hasText: /^package\.json$/ }) }));
    const raw = source.locator('details').filter({ has: page.locator('summary', { hasText: /^Committed source text/ }) });
    await click(raw.locator('summary'));
    await expect(view(page, 'Repo harness')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await expect(source).toHaveJSProperty('open', true);
    await expect(raw).toHaveJSProperty('open', true);
    await expect(raw.getByLabel('package.json committed source', { exact: true })).toBeVisible();
    expect(traffic.mutations, 'Workspace browsing and inspection must remain read-only.').toEqual([]);
  } finally { await page.goto('about:blank'); f.close(); }
});

test('light UTG workspace inspection and preview surfaces remain usable at desktop and 390px', async ({ page }, info) => {
  test.setTimeout(120000);
  const f = fixture(info);
  const traffic = observeTraffic(page);
  try {
    await seed(page);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      traffic.leavePreview();
      await page.goto('/');
      await click(repositoryButton(page, f.first));
      const main = page.getByRole('main');
      const heading = page.getByRole('heading', { name: 'Issues', exact: true, level: 1 });
      await expect(page.locator('html'), 'The frame must use the existing neutral light palette.').toHaveCSS('background-color', 'rgb(252, 252, 251)');
      await expect(main, 'The main panel must be distinct from the frame in the light workspace.').toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(heading, 'The page title must use the existing light ink.').toHaveCSS('color', 'rgb(11, 11, 11)');
      await expect(heading, 'The compact reference title hierarchy must apply at both widths.').toHaveCSS('font-size', '22px');
      await expect(page.locator('body')).toHaveCSS('font-family', /system-ui/);
      await expect(page.locator('body')).toHaveCSS('font-family', /PingFang SC|Noto Sans CJK SC|Microsoft YaHei/);
      await fits(page, [page.getByLabel('Search issues', { exact: true }), page.getByLabel('Filter by status', { exact: true }), page.getByLabel('Filter by label', { exact: true }), page.getByLabel('Sort issues', { exact: true })]);
      await info.attach(`light-${width}-issues`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      const search = page.getByLabel('Search issues', { exact: true });
      await search.fill(f.issue.title);
      await click(page.getByRole('button', { name: `View issue ${f.issue.title}`, exact: true }));
      const dialog = page.getByRole('dialog', { name: `Issue #${f.issue.id}`, exact: true });
      const report = dialog.getByRole('article', { name: 'Delivery report', exact: true });
      await expect(report, 'The light workspace must render the real stored delivery report.').toBeVisible();
      await expect(report.getByText('The stored theme audit remains readable.', { exact: true })).toBeVisible();
      await expect(report.getByText('Retained theme warning.', { exact: true })).toBeVisible();
      const evidenceDisclosure = report.locator('details').filter({ has: page.locator('summary', { hasText: /^Evidence \(/ }) });
      await click(evidenceDisclosure.locator('summary'));
      await select(report.getByLabel('Select evidence artifact', { exact: true }), 'theme.log');
      const evidence = report.getByRole('region', { name: 'Evidence preview', exact: true }).locator('pre');
      await expect(evidence, 'Actual artifact output must be separate from report fixture prose.').toHaveText(f.evidence);
      await fits(page, [dialog, evidence, dialog.getByRole('button', { name: 'Close dialog', exact: true })]);
      await info.attach(`light-${width}-diagnostics-report-evidence`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await click(view(page, 'Requirements'));
      const requirement = f.requirements.at(-1)!;
      await click(page.getByRole('button', { name: `Inspect requirement ${requirement.title}`, exact: true }));
      await expect(page.getByRole('region', { name: 'Original goal', exact: true })).toContainText(requirement.goal);
      await fits(page, [page.getByRole('region', { name: 'Requirement inspection', exact: true }).getByTestId('requirement-identity')]);
      await info.attach(`light-${width}-requirements`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await click(view(page, 'Repo harness'));
      const source = page.locator('details.harness-source').filter({ has: page.locator('summary .harness-source-path', { hasText: /^package\.json$/ }) });
      const sourceControl = source.locator('summary').filter({ has: page.locator('.harness-source-path', { hasText: /^package\.json$/ }) });
      await click(sourceControl);
      const raw = source.locator('details').filter({ has: page.locator('summary', { hasText: /^Committed source text/ }) });
      await expect(source, 'The outer package disclosure must open independently of raw source text.').toHaveJSProperty('open', true);
      await expect(raw, 'Opening the outer disclosure must leave raw committed source independently collapsed.').toHaveJSProperty('open', false);
      await click(raw.locator('summary'));
      await expect(raw).toHaveJSProperty('open', true);
      await expect(raw.getByLabel('package.json committed source', { exact: true })).toBeVisible();
      await fits(page, [sourceControl]);
      await info.attach(`light-${width}-harness`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      traffic.enterPreview();
      await page.goto('/__ui/components');
      await expect(page.getByRole('region', { name: 'Error state', exact: true }).getByRole('alert')).toHaveText('Sample read failed. Try the local action again.');
      await expect(page.getByRole('region', { name: 'Loading state', exact: true }).getByRole('status')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No sample items', exact: true })).toBeVisible();
      await fits(page, [page.getByRole('button', { name: 'Preview action', exact: true }), page.getByLabel('Sample issue status', { exact: true })]);
      await info.attach(`light-${width}-preview-states`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await page.waitForTimeout(2200);
      expect(traffic.preview, 'Standalone preview states must make no app API calls.').toEqual([]);
      await click(page.getByRole('button', { name: 'Open preview dialog', exact: true }));
      await expect(page.getByRole('dialog', { name: 'Preview dialog', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Loading action', exact: true, includeHidden: true })).toHaveAttribute('aria-busy', 'true');
      await page.goto('about:blank');
      await expect(page.getByRole('dialog'), 'Leaving active modal and pending sample state must clean up the preview.').toHaveCount(0);
    }
    expect(traffic.preview, 'Preview dialog interactions and cleanup must make no app API calls.').toEqual([]);
    expect(traffic.mutations, 'Workspace and preview browsing must send no application mutations or execution commands.').toEqual([]);
  } finally { await page.goto('about:blank'); f.close(); }
});
