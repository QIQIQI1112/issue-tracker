import { expect } from '@playwright/test';
import type { Locator, TestInfo } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appUrl, test } from './workspace.ts';
import { expectStatusSelection, selectRepository, selectStatus } from './navigation.ts';
import { IssueStore } from '../src/storage.ts';
import { saveDelivery } from '../factory/delivery.ts';
import { recordDiagnosticRun } from './diagnostic-fixture.ts';
import type { Issue } from '../src/domain.ts';
import type { Job, WorkRun } from '../src/workflow.ts';

function fixture(info: TestInfo, title: string) {
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const database = new DatabaseSync(store.path);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const root = info.outputPath('dashboard-fixture', randomUUID());
  mkdirSync(root, { recursive: true });
  const repo = store.work.addRepo({ name: `${title} repository`, path: root, targetBranch: 'main' });
  const requirement = store.work.addRequirement({ repoId: repo.id, title, goal: `Original business goal for ${title}.` });
  return {
    store, repo, requirement,
    child: (name: string, dependsOn: number[] = [], status: Issue['status'] = 'open') => store.create({ title: name, description: 'Disposable dashboard behavior.', priority: 'medium', status, labels: [], work: { repoId: repo.id, requirementId: requirement.id, dependsOn, acceptance: ['Observable behavior.'] } }),
    status: (status: string) => database.prepare('UPDATE requirements SET status=? WHERE id=?').run(status, requirement.id),
    record: (kind: Job['kind'], status: Exclude<Job['status'], 'queued'>, issueId: number | null = null, reason: string | null = null, report = false): WorkRun => {
      const run = recordDiagnosticRun(store, database, { root, repoId: repo.id, requirementId: requirement.id, issueId, kind, status, reason });
      if (report) {
        writeFileSync(join(run.evidencePath, 'patch.diff'), `Retained ${run.status} evidence for ${run.id}.`);
        saveDelivery(run.evidencePath, { schemaVersion: 1, runId: run.id, taskId: `dashboard-${run.jobId}`, title, goal: requirement.goal, summary: `Report result ${run.id}`, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt ?? run.startedAt, baseline: null, sourceHash: null, defaults: [], changes: [], checks: [{ name: 'Fixture behavior', status: run.status === 'blocked' ? 'failed' : 'passed' }], nodePassed: 1, browserPassed: 1, attempts: 1, review: null, integration: null, limitations: reason ? [reason] : [] });
      }
      return run;
    },
    close: () => {
      const now = new Date().toISOString();
      database.prepare("UPDATE jobs SET status='blocked', reason='Disposable browser fixture closed.', updated_at=? WHERE repo_id=? AND status IN ('queued', 'running')").run(now, repo.id);
      database.prepare("UPDATE work_runs SET status='blocked', reason='Disposable browser fixture closed.', completed_at=? WHERE repo_id=? AND status='running'").run(now, repo.id);
      database.prepare("UPDATE requirements SET status='blocked', updated_at=? WHERE repo_id=? AND status IN ('queued', 'running')").run(now, repo.id);
      database.close(); store.close();
    },
  };
}

async function reportState(container: Locator, expected: string) {
  const state = container.getByRole('status');
  await expect(state).toHaveText(expected);
  await expect(state).toBeVisible();
  expect(await state.evaluate(element => element.closest('select, option') === null)).toBe(true);
}

test('issue navigation and identifier details support keyboard focus and status filters', async ({ page, workspace }, info) => {
  const issue = await workspace.create({ title: 'Keyboard inspection', status: 'done' });
  await page.goto(appUrl(info));
  const nav = page.getByRole('navigation', { name: 'Workspace views' });
  await selectStatus(page, 'done');
  await expectStatusSelection(page, 'done');
  await expect(nav.locator('[aria-pressed="true"]')).toHaveCount(1);
  const opener = page.getByRole('button', { name: `View issue ${issue.title}`, exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(dialog.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await selectStatus(page, 'all');
  await expect(nav.locator('[aria-pressed="true"]')).toHaveCount(1);
});

test('an unstarted issue exposes ownership acceptance and an honest empty execution history', async ({ page }, info) => {
  const f = fixture(info, 'Unstarted inspection');
  try {
    const issue = f.child('Unstarted child');
    await page.goto(appUrl(info));
    await page.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    await expect(dialog.getByText(f.repo.name, { exact: true })).toBeVisible();
    await expect(dialog.getByText(f.requirement.title, { exact: true })).toBeVisible();
    await expect(dialog.getByText('Observable behavior.', { exact: true })).toBeVisible();
    await expect(dialog.getByText('No executions yet.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('article', { name: 'Delivery report', exact: true })).toHaveCount(0);
  } finally { f.close(); }
});

test('requirement API creation validates ownership and duplicate starts while details stay inspectable', async ({ page, request }, info) => {
  const f = fixture(info, 'API administration');
  try {
    const api = appUrl(info);
    expect((await request.post(`${api}/api/requirements`, { data: { repoId: 2147483647, title: 'Invalid', goal: 'Reject unknown ownership.' } })).status()).toBe(400);
    const response = await request.post(`${api}/api/requirements`, { data: { repoId: f.repo.id, title: 'API-created requirement', goal: 'Preserve explicit ownership and independent admission.' } });
    expect(response.status()).toBe(201);
    const { requirement } = await response.json();
    expect(requirement.repoId).toBe(f.repo.id);
    expect((await request.post(`${api}/api/requirements/${requirement.id}/start`, { data: {} })).status()).toBe(202);
    expect((await request.post(`${api}/api/requirements/${requirement.id}/start`, { data: {} })).status()).toBe(409);
    const work = await (await request.get(`${api}/api/workbench`)).json();
    expect(work.jobs.filter((job: Job) => job.requirementId === requirement.id)).toHaveLength(1);
    const issue = f.child('Owned inspection child');
    await page.goto(api);
    await page.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
    await expect(page.getByRole('dialog').getByText(f.repo.name, { exact: true })).toBeVisible();
  } finally { f.close(); }
});

test('issue history opens associated real runs and historical failed evidence', async ({ page, request }, info) => {
  const f = fixture(info, 'Inspectable delivery');
  try {
    const issue = f.child('Retried delivery child');
    const failed = f.record('issue', 'blocked', issue.id, 'Historical failed review.', true);
    const merged = f.record('issue', 'completed', issue.id, null, true);
    await page.goto(appUrl(info));
    await page.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    const selector = dialog.getByLabel('Select execution run', { exact: true });
    for (const run of [failed, merged]) {
      await selector.selectOption(run.id);
      const report = dialog.getByRole('article', { name: 'Delivery report', exact: true });
      await expect(report).toContainText(`Report result ${run.id}`);
      if (run.id === failed.id) await expect(report).toContainText('Historical failed review.');
      await report.locator('summary').filter({ hasText: /^Evidence / }).click();
      const evidence = report.getByRole('link', { name: 'patch.diff', exact: true });
      await expect(evidence).toHaveAttribute('href', `/api/runs/${run.id}/evidence?file=patch.diff`);
      const response = await request.get(`${appUrl(info)}${await evidence.getAttribute('href')}`);
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe(readFileSync(join(run.evidencePath, 'patch.diff'), 'utf8'));
      const download = page.waitForEvent('download');
      await evidence.click();
      expect((await download).suggestedFilename()).toBe('patch.diff');
    }
  } finally { f.close(); }
});

test('issue report content distinguishes loading running terminal absence and request failures', async ({ page }, info) => {
  const f = fixture(info, 'Report state fixture');
  try {
    const issue = f.child('Unavailable terminal child');
    const historical = f.record('issue', 'blocked', issue.id, 'Historical failure.', true);
    const unavailable = f.record('issue', 'blocked', issue.id, 'Terminal failure without report.');
    const running = f.record('issue', 'running', issue.id);
    await page.goto(appUrl(info));
    await page.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
    const scope = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    const selector = scope.getByLabel('Select execution run', { exact: true });
    await selector.selectOption(historical.id);
    await expect(scope.getByRole('article', { name: 'Delivery report' })).toContainText(`Report result ${historical.id}`);
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/runs/${running.id}`, async route => { await held; await route.continue(); });
    try {
      await selector.selectOption(running.id);
      const selected = scope.getByLabel('Selected report', { exact: true });
      await expect(scope.getByRole('article', { name: 'Delivery report' })).toHaveCount(0);
      await reportState(selected, 'Loading delivery report…');
      release();
      await reportState(selected, 'Execution is in progress. The delivery report will appear here.');
      await page.unroute(`**/api/runs/${running.id}`);
      await selector.selectOption(unavailable.id);
      await reportState(selected, 'Delivery report unavailable for this execution.');
      await expect(selected).not.toContainText(/in progress|running/i);
      await page.route(`**/api/runs/${historical.id}`, route => route.fulfill({ status: 503, json: { error: 'Report request failed for this fixture.' } }));
      await selector.selectOption(historical.id);
      await expect(selected.getByRole('alert')).toHaveText('Report request failed for this fixture.');
      await page.unroute(`**/api/runs/${historical.id}`);
      await selector.selectOption(unavailable.id);
      await reportState(selected, 'Delivery report unavailable for this execution.');
    } finally { release(); await page.unroute(`**/api/runs/${running.id}`); }
  } finally { f.close(); }
});

test('issue history and long report evidence fit a 390px viewport', async ({ page }, info) => {
  const f = fixture(info, 'Phone layout');
  try {
    const long = 'long-unbroken-reference'.repeat(18);
    const issue = f.child('Phone delivery child');
    const run = f.record('issue', 'blocked', issue.id, long, true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl(info));
    await page.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    await dialog.getByLabel('Select execution run', { exact: true }).selectOption(run.id);
    const report = dialog.getByRole('article', { name: 'Delivery report' });
    await expect(report).toContainText(long);
    await report.locator('summary').filter({ hasText: /^Evidence / }).click();
    expect(await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))).toEqual({ scroll: 390, width: 390 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(report.getByRole('link', { name: 'patch.diff', exact: true })).toBeVisible();
    expect(await page.locator('html, body, main').evaluateAll(elements => elements.map(element => getComputedStyle(element).overflowX))).not.toContain('hidden');
    await page.screenshot({ path: info.outputPath('inspection-history-phone.png'), fullPage: true });
  } finally { f.close(); }
});

import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { Delivery } from '../src/workflow.ts';

async function openDiagnostics(page: Page, info: TestInfo, issue: Issue) {
  if (page.url().replace(/\/$/, '') !== appUrl(info).replace(/\/$/, '')) await page.goto(appUrl(info));
  await page.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(dialog.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
  return dialog;
}

function enrichDiagnosticRun(run: WorkRun, files: Record<string, string | Buffer> = {}, fields: Partial<Delivery> = {}) {
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(run.evidencePath, name), bytes);
  const stored = JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8')) as Delivery;
  return saveDelivery(run.evidencePath, { ...stored, ...fields });
}

async function evidenceControls(dialog: Locator) {
  const report = dialog.getByRole('article', { name: 'Delivery report', exact: true });
  await expect(report).toBeVisible();
  const disclosure = report.locator('details').filter({ hasText: /^Evidence \(/ });
  if (await disclosure.count() && await disclosure.getAttribute('open') === null) await disclosure.locator('summary').click();
  const selector = report.getByLabel('Select evidence artifact', { exact: true });
  await expect(selector, 'Evidence must have a keyboard accessible manifest selector.').toBeVisible();
  return { report, selector, preview: report.getByRole('region', { name: 'Evidence preview', exact: true }) };
}

test('title and identifier open read-only diagnostics without writes and restore opener focus', async ({ page, request, workspace }, info) => {
  const issue = await workspace.create({ title: 'Read-only entry points', description: 'Persisted diagnostic description.', status: 'in_progress', priority: 'high', labels: ['inspection'] });
  const before = await (await request.get(`${appUrl(info)}/api/issues/${issue.id}`)).json();
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'PATCH') writes.push(request.url()); });
  await page.goto(appUrl(info));
  for (const name of [`Inspect issue ${issue.title}`, `View issue ${issue.title}`]) {
    const opener = page.getByRole('button', { name, exact: true });
    await expect(opener, 'Both title and identifier must inspect the issue.').toBeVisible();
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    for (const text of [issue.title, issue.description, 'In progress', 'High', 'inspection']) await expect(dialog).toContainText(text);
    await expect(dialog.locator('input, textarea, [contenteditable="true"]'), 'Inspection has no editable issue fields.').toHaveCount(0);
    await expect(dialog.locator('select, [role="combobox"], [role="listbox"]'), 'Standalone unexecuted diagnostics have no editable status, priority or other issue-field selectors.').toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^(Edit|Save changes)/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  expect(writes, 'Opening, reading and closing diagnostics must not PATCH an issue.').toEqual([]);
  expect((await (await request.get(`${appUrl(info)}/api/issues/${issue.id}`)).json()).issue).toEqual(before.issue);
});

test('issue workspace removes Workbench administration and retains combined repository controls', async ({ page }, info) => {
  const f = fixture(info, 'Repository filtering');
  const other = fixture(info, 'Other repository filtering');
  try {
    const selected = f.child('Needle selected child');
    const excluded = other.child('Needle unrelated child');
    f.store.update(selected.id, { labels: ['diagnostic'], priority: 'high' });
    await page.goto(appUrl(info));
    await expect(page.getByRole('button', { name: 'Workbench', exact: true }), 'Workbench navigation is removed.').toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Workbench|Register repository|Create requirement/i })).toHaveCount(0);
    await expect(page.locator('form').filter({ hasText: /Register repository|Create requirement/ })).toHaveCount(0);
    await selectRepository(page, f.repo.id);
    await page.getByLabel('Filter by status', { exact: true }).selectOption('open');
    await page.getByLabel('Filter by label', { exact: true }).selectOption('diagnostic');
    await page.getByRole('searchbox', { name: 'Search issues' }).fill('Needle');
    await page.getByLabel('Sort issues', { exact: true }).selectOption('priority');
    await expect(page.getByTestId(`issue-${selected.id}`)).toBeVisible();
    await expect(page.getByTestId(`issue-${excluded.id}`)).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search issues' }).fill('absent-query');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(page.getByTestId(`issue-${excluded.id}`)).toBeVisible();
    await expect(page.getByLabel('Search issues', { exact: true })).toBeEnabled();
  } finally { other.close(); f.close(); }
});

test('diagnostics show persisted issue metadata dependencies acceptance and standalone context', async ({ page, workspace }, info) => {
  const f = fixture(info, 'Persisted metadata');
  try {
    const dependency = f.child('Metadata prerequisite');
    const original = f.child('Metadata subject', [dependency.id], 'in_progress');
    const issue = f.store.update(original.id, { priority: 'high', labels: ['audit', 'diagnostics'] })!;
    const dialog = await openDiagnostics(page, info, issue);
    for (const value of [issue.title, issue.description, 'In progress', 'High', 'audit', 'diagnostics', f.repo.name, f.requirement.title, `#${dependency.id}`, 'Observable behavior.']) await expect(dialog).toContainText(value);
    await expect(dialog.locator(`time[datetime="${issue.createdAt}"]`), 'Creation time uses persisted metadata.').not.toHaveCount(0);
    await expect(dialog.locator(`time[datetime="${issue.updatedAt}"]`), 'Update time uses persisted metadata.').not.toHaveCount(0);
    await expect(dialog).toContainText(/Created/i);
    await expect(dialog).toContainText(/Updated/i);
    await expect(dialog).toContainText(/provenance.*(unavailable|not recorded)|no.*submission/i);
    await page.keyboard.press('Escape');
    const standalone = await workspace.create({ title: 'Standalone metadata', description: 'No requirement ownership.' });
    await page.reload();
    const standaloneDialog = await openDiagnostics(page, info, standalone);
    await expect(standaloneDialog).toContainText('Standalone issue');
    await expect(standaloneDialog).toContainText('No executions yet.');
    await expect(standaloneDialog).not.toContainText(f.requirement.goal);
    await expect(standaloneDialog).not.toContainText(/Edit this issue/i);
  } finally { f.close(); }
});

test('diagnostics expose submission provenance and owned requirement run audits', async ({ page }, info) => {
  const f = fixture(info, 'Requirement provenance');
  const unrelated = fixture(info, 'Unrelated audit');
  try {
    const issue = f.child('Provenance subject');
    const submissionId = `diagnostic-${randomUUID()}`;
    const reference = `conversation/${'long-source-reference-'.repeat(12)}`;
    const plan = { schemaVersion: 1, submissionId, repoId: f.repo.id, requirement: { title: f.requirement.title, goal: f.requirement.goal }, source: { kind: 'codex', reference, summary: 'User authorized inspection and retained audits.' }, assumptions: [], issues: [{ key: 'subject', title: issue.title, description: issue.description, acceptance: issue.work!.acceptance, dependsOn: [] }] };
    const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    const database = new DatabaseSync(f.store.path);
    try { database.prepare('INSERT INTO plan_submissions (id, requirement_id, plan_hash, plan, issue_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(submissionId, f.requirement.id, planHash, JSON.stringify(plan), JSON.stringify({ subject: issue.id }), issue.createdAt); } finally { database.close(); }
    const decomposition = f.record('decompose', 'completed', null, null, true);
    const planning = f.record('plan_review', 'completed', null, null, true);
    const merged = f.record('issue', 'completed', issue.id, null, true);
    const earlier = f.record('requirement_verify', 'completed', null, null, true);
    const latest = f.record('requirement_verify', 'blocked', null, 'Latest whole-goal acceptance rejected.', true);
    const foreign = unrelated.record('requirement_verify', 'completed', null, null, true);
    const sibling = f.child('Sibling audit must stay separate');
    const siblingRun = f.record('issue', 'blocked', sibling.id, 'Sibling-only failure.', true);
    const dialog = await openDiagnostics(page, info, issue);
    for (const value of [f.requirement.goal, submissionId, planHash, reference, plan.source.summary, 'codex', 'Whole-goal verification blocked']) await expect(dialog).toContainText(value);
    const selector = dialog.getByLabel('Select execution run', { exact: true });
    const options = selector.locator('option');
    for (const run of [decomposition, planning, merged, earlier, latest]) await expect(options.filter({ hasText: run.id }), 'Owned issue and requirement-stage runs remain inspectable.').toHaveCount(1);
    for (const run of [foreign, siblingRun]) await expect(options.filter({ hasText: run.id })).toHaveCount(0);
    for (const [run, label] of [[decomposition, /decompos/i], [planning, /plan.*review/i], [latest, /whole.goal|requirement.*verif/i]] as const) {
      const labelled = await options.filter({ hasText: run.id }).evaluate(element => `${element.parentElement?.getAttribute('label') ?? ''} ${element.textContent}`);
      expect(labelled, 'Requirement audit stages must be clearly identified.').toMatch(label);
    }
    await expect(selector).toHaveValue(merged.id);
    for (const run of [decomposition, planning, earlier, latest]) {
      await selector.selectOption(run.id);
      await expect(dialog.getByRole('article', { name: 'Delivery report' })).toContainText(`Report result ${run.id}`);
      await expect(dialog.getByRole('article', { name: 'Delivery report' })).not.toContainText(`Report result ${foreign.id}`);
    }
    await expect(dialog).toContainText('Whole-goal verification blocked');
    await expect(dialog).not.toContainText('Whole goal verified');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'Long provenance must wrap at phone width.').toBe(390);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  } finally { unrelated.close(); f.close(); }
});

test('diagnostics surface current failures without reports and distinguish recovered history', async ({ page }, info) => {
  const f = fixture(info, 'Current failures');
  try {
    const blocked = f.child('Blocked without delivery', [], 'done');
    const failed = f.record('issue', 'blocked', blocked.id, 'Current controller admission failure.');
    const recovered = f.child('Recovered subject');
    const historical = f.record('issue', 'blocked', recovered.id, 'Historical rejected source.', true);
    const successful = f.record('issue', 'completed', recovered.id, null, true);
    enrichDiagnosticRun(successful, {}, { limitations: ['Delivery retained an external validation limitation.'] });
    let dialog = await openDiagnostics(page, info, blocked);
    await expect(dialog.locator('.execution-warning:not(.selected-report .execution-warning)'), 'Current run reasons do not require delivery.json.').toContainText('Current controller admission failure.');
    await expect(dialog.getByLabel('Selected report')).toContainText('Delivery report unavailable');
    await expect(dialog).not.toContainText(/independent.*approved|whole goal verified/i);
    await expect(dialog.getByLabel('Select execution run').locator('option')).toContainText(failed.id);
    await page.keyboard.press('Escape');
    dialog = await openDiagnostics(page, info, recovered);
    const current = dialog.locator('.execution-warning:not(.selected-report .execution-warning)');
    await expect(current).not.toContainText('Historical rejected source.');
    await expect(current, 'Current delivery limitations remain prominent.').toContainText('Delivery retained an external validation limitation.');
    const selector = dialog.getByLabel('Select execution run', { exact: true });
    await expect(selector).toHaveValue(successful.id);
    await selector.selectOption(historical.id);
    await expect(dialog.getByRole('article', { name: 'Delivery report' })).toContainText('Historical rejected source.');
    await expect(current).not.toContainText('Historical rejected source.');
    await expect(current).toContainText('Delivery retained an external validation limitation.');
    await expect(selector.locator('option').filter({ hasText: successful.id })).toContainText(successful.startedAt);
    await expect(dialog.getByLabel('Selected report')).toContainText(historical.completedAt!);
  } finally { f.close(); }
});

test('diagnostic request retry and issue changes clear stale content and errors', async ({ page }, info) => {
  const f = fixture(info, 'Diagnostic retries');
  try {
    const first = f.child('Retry first issue');
    const second = f.child('Retry second issue');
    const run = f.record('issue', 'completed', first.id, null, true);
    const other = f.record('issue', 'completed', second.id, null, true);
    await page.route(`**/api/issues/${first.id}`, route => route.fulfill({ status: 503, json: { error: 'Issue diagnostic request temporarily failed.' } }));
    await page.goto(appUrl(info));
    await page.getByRole('button', { name: `View issue ${first.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Issue #${first.id}`, exact: true });
    await expect(dialog.getByRole('alert')).toContainText('Issue diagnostic request temporarily failed.');
    await page.unroute(`**/api/issues/${first.id}`);
    await dialog.getByRole('button', { name: 'Retry details', exact: true }).click();
    await expect(dialog).toContainText(first.description);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ status: 503, json: { error: 'Selected report failed once.' } }));
    await expect(dialog.getByRole('alert')).toContainText('Selected report failed once.');
    await page.unroute(`**/api/runs/${run.id}`);
    await dialog.getByRole('button', { name: 'Retry report', exact: true }).click();
    await expect(dialog.getByRole('article', { name: 'Delivery report' })).toContainText(`Report result ${run.id}`);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ status: 503, json: { error: 'Old issue report error must disappear.' } }));
    await expect(dialog.getByRole('alert')).toContainText('Old issue report error must disappear.');
    await page.keyboard.press('Escape');
    const next = await openDiagnostics(page, info, second);
    await expect(next.getByRole('article', { name: 'Delivery report' })).toContainText(`Report result ${other.id}`);
    await expect(next).not.toContainText(`Report result ${run.id}`);
    await expect(next.getByRole('alert')).toHaveCount(0);
    await expect(next).not.toContainText('Old issue report error must disappear.');
  } finally { f.close(); }
});

test('diagnostic inspection reflects API admission and duplicate starts remain rejected', async ({ page, request }, info) => {
  const f = fixture(info, 'Contextual execution');
  try {
    const idle = f.child('Inactive contextual subject');
    const retry = f.child('Blocked contextual retry');
    f.record('issue', 'blocked', retry.id, 'Retryable controller failure.');
    const prerequisite = f.child('Manual Done dependency', [], 'done');
    const waiting = f.child('Waiting contextual subject', [prerequisite.id]);
    f.store.work.startIssue(waiting.id);
    const running = f.child('Running contextual subject');
    f.record('issue', 'running', running.id);
    const merged = f.child('Merged contextual subject', [], 'done');
    f.record('issue', 'completed', merged.id, null, true);
    for (const issue of [retry, idle]) expect((await request.post(`${appUrl(info)}/api/issues/${issue.id}/start`, { data: {} })).status()).toBe(202);
    let dialog = await openDiagnostics(page, info, idle);
    await expect(dialog.getByText('No executions yet.', { exact: true })).toBeVisible();
    const work = await (await request.get(`${appUrl(info)}/api/workbench`)).json();
    expect(work.jobs.filter((job: Job) => job.issueId === idle.id && ['queued', 'running'].includes(job.status))).toHaveLength(1);
    for (const issue of [idle, retry, waiting, running, merged]) {
      await page.keyboard.press('Escape');
      dialog = await openDiagnostics(page, info, issue);
      await expect(dialog.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
      expect((await request.post(`${appUrl(info)}/api/issues/${issue.id}/start`, { data: {} })).status()).toBe(409);
      if (issue.id === waiting.id) await expect(dialog).toContainText(new RegExp(`(waiting|dependenc).*#${prerequisite.id}`, 'i'));
      if (issue.id === running.id) await expect(dialog).toContainText('Execution is in progress.');
    }
  } finally { f.close(); }
});

test('diagnostics render stored review outcomes verification changes and delivery commits', async ({ page }, info) => {
  const f = fixture(info, 'Stored audit fields');
  try {
    const issue = f.child('Audit subject', [], 'done');
    const rejected = f.record('issue', 'blocked', issue.id, 'Independent source review rejected.', true);
    const approved = f.record('issue', 'completed', issue.id, null, true);
    const absent = f.record('issue', 'blocked', issue.id, 'Report has no recorded review.', true);
    const source = 'e'.repeat(64);
    const commit = 'f'.repeat(40);
    enrichDiagnosticRun(approved, {}, { review: { approved: true, summary: 'Recorded neutral assessment.' }, nodePassed: 17, browserPassed: 9, attempts: 2, sourceHash: source, changes: [{ path: 'src/ui/IssueDetails.tsx', category: 'application', status: 'modified' }], checks: [{ name: 'Diagnostic behavior verification', status: 'passed' }], integration: { branch: 'main', before: 'a'.repeat(40), commit }, phases: [{ name: 'verification', startedAt: approved.startedAt, completedAt: approved.completedAt!, durationMs: 2500, status: 'passed' }], resume: { reused: true, fromRunId: rejected.id, reason: 'Recovered after recorded rejection.' }, budget: { usedMs: 4000, implementationAttempts: 2, acceptanceAttempts: 1, maxAttempts: 3, totalTimeoutMs: 600000 } });
    enrichDiagnosticRun(rejected, {}, { review: { approved: false, summary: 'Recorded neutral assessment.' }, failedPhase: 'review', failureKind: 'rejected_source' });
    const dialog = await openDiagnostics(page, info, issue);
    const selector = dialog.getByLabel('Select execution run', { exact: true });
    await selector.selectOption(approved.id);
    const report = dialog.getByRole('article', { name: 'Delivery report' });
    for (const value of ['approved', 'Recorded neutral assessment.', '17 Node cases', '9 browser cases', 'Diagnostic behavior verification', 'src/ui/IssueDetails.tsx', 'verification', '2.5', rejected.id, 'Recovered after recorded rejection.', '2/3', commit]) await expect(report).toContainText(value);
    await report.locator('summary').filter({ hasText: /^Evidence / }).click();
    await expect(report).toContainText(source);
    await selector.selectOption(rejected.id);
    for (const value of ['rejected', 'Recorded neutral assessment.', 'Failed phase:', 'review', 'rejected_source']) await expect(report).toContainText(value);
    await expect(report).not.toContainText(commit);
    await selector.selectOption(absent.id);
    await expect(report).toContainText('No completed review.');
    await expect(report).toContainText('No target branch was advanced.');
    await expect(report).not.toContainText(source);
    await expect(report).not.toContainText(commit);
  } finally { f.close(); }
});

test('manifest text evidence previews real escaped content and downloads unchanged bytes', async ({ page, request }, info) => {
  const f = fixture(info, 'Text evidence');
  try {
    const issue = f.child('Text evidence subject');
    const run = f.record('issue', 'completed', issue.id, null, true);
    const unsafe = '<script>window.diagnosticInjected=true</script><img src=x onerror="window.diagnosticInjected=true"> & literal text';
    const files = { 'worker.log': `Actual worker output\n${unsafe}\n`, 'result.json': JSON.stringify({ unsafe, outcome: 'recorded' }), 'review.md': `# Actual review\n${unsafe}`, 'patch.diff': `--- before\n+++ after\n+${unsafe}\n`, 'notes.txt': '真实 evidence text — retained bytes\n' };
    enrichDiagnosticRun(run, files);
    const dialog = await openDiagnostics(page, info, issue);
    const { selector, preview, report } = await evidenceControls(dialog);
    for (const [name, content] of Object.entries(files)) {
      await selector.selectOption(name);
      await expect(preview.locator('pre'), 'Preview renders the actual manifest-listed bytes as plain text.').toHaveText(content, { useInnerText: false });
      await expect(preview.locator('script, img, iframe')).toHaveCount(0);
      const link = report.getByRole('link', { name, exact: true });
      const href = `/api/runs/${run.id}/evidence?file=${encodeURIComponent(name)}`;
      await expect(link).toHaveAttribute('href', href);
      const response = await request.get(`${appUrl(info)}${href}`);
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(Buffer.from(content));
      const downloadEvent = page.waitForEvent('download');
      await link.click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe(name);
      expect(readFileSync((await download.path())!)).toEqual(Buffer.from(content));
    }
    expect(await page.evaluate(() => 'diagnosticInjected' in window), 'Unsafe evidence must never execute.').toBe(false);
  } finally { f.close(); }
});

test('text evidence preview explains loading errors and retry', async ({ page }, info) => {
  const f = fixture(info, 'Preview recovery');
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    const issue = f.child('Preview retry subject');
    const run = f.record('issue', 'completed', issue.id, null, true);
    enrichDiagnosticRun(run, { 'recovery.log': 'Recovered actual log bytes.', 'integrity.log': 'Original verified bytes.' });
    const url = `**/api/runs/${run.id}/evidence?file=recovery.log`;
    await page.route(url, async route => { await held; await route.fulfill({ status: 503, json: { error: 'Evidence unavailable for this attempt.' } }); });
    const dialog = await openDiagnostics(page, info, issue);
    const { selector, preview } = await evidenceControls(dialog);
    await selector.selectOption('recovery.log');
    await expect(preview.getByRole('status')).toContainText(/Loading/i);
    await expect(preview.locator('pre')).toHaveCount(0);
    release();
    await expect(preview.getByRole('alert')).toContainText('Evidence unavailable for this attempt.');
    await page.unroute(url);
    await preview.getByRole('button', { name: /Retry/i }).click();
    await expect(preview.locator('pre')).toHaveText('Recovered actual log bytes.');
    await expect(preview.getByRole('alert')).toHaveCount(0);
    writeFileSync(join(run.evidencePath, 'integrity.log'), 'Tampered unverified bytes.');
    await selector.selectOption('integrity.log');
    await expect(preview.getByRole('alert'), 'The verified endpoint must reject tampered evidence.').toBeVisible();
    await expect(preview).not.toContainText('Tampered unverified bytes.');
    writeFileSync(join(run.evidencePath, 'integrity.log'), 'Original verified bytes.');
    await preview.getByRole('button', { name: /Retry/i }).click();
    await expect(preview.locator('pre')).toHaveText('Original verified bytes.');
    await expect(preview.getByRole('alert')).toHaveCount(0);
  } finally { release(); f.close(); }
});

test('text evidence previews enforce the one MiB boundary and retain binary download fallbacks', async ({ page }, info) => {
  const f = fixture(info, 'Preview bounds');
  try {
    const issue = f.child('Bounded evidence subject');
    const run = f.record('issue', 'completed', issue.id, null, true);
    const exact = 'é'.repeat(524288);
    enrichDiagnosticRun(run, { 'empty.log': '', 'exact.log': exact, 'oversized.log': 'x'.repeat(1048577), 'received.log': 'Small manifest-listed response.', 'binary.png': Buffer.from([137, 80, 78, 71, 0, 255]), 'unknown.asset': 'Unsupported artifact bytes.' });
    const dialog = await openDiagnostics(page, info, issue);
    const { selector, preview, report } = await evidenceControls(dialog);
    await selector.selectOption('exact.log');
    await expect(preview.locator('pre')).toHaveText(exact, { useInnerText: false });
    expect(await preview.locator('pre').evaluate(element => new TextEncoder().encode(element.textContent ?? '').length)).toBe(1048576);
    await selector.selectOption('empty.log');
    await expect(preview).toContainText(/empty|0 bytes/i);
    await expect(preview.getByRole('alert')).toHaveCount(0);
    for (const name of ['oversized.log', 'binary.png', 'unknown.asset']) {
      await selector.selectOption(name);
      await expect(preview).toContainText(/download/i);
      await expect(preview).toContainText(name === 'oversized.log' ? /1 MiB|1 MB|1,048,576|1048576|too large/i : /binary|unsupported|cannot.*preview/i);
      await expect(preview.locator('pre')).toHaveCount(0);
      await expect(report.getByRole('link', { name, exact: true })).toHaveAttribute('href', `/api/runs/${run.id}/evidence?file=${encodeURIComponent(name)}`);
    }
    const url = `**/api/runs/${run.id}/evidence?file=received.log`;
    await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/plain', body: `${'é'.repeat(524288)}FORBIDDEN_OVERSIZED_TAIL` }));
    await selector.selectOption('received.log');
    await expect(preview, 'Enforce the bound against received bytes, even for a small manifest entry.').toContainText(/1 MiB|1 MB|1,048,576|1048576|too large/i);
    await expect(preview).not.toContainText('FORBIDDEN_OVERSIZED_TAIL');
    expect(await preview.evaluate(element => new TextEncoder().encode(element.textContent ?? '').length)).toBeLessThanOrEqual(1048576);
    await expect(report.getByRole('link', { name: 'received.log', exact: true })).toBeVisible();
  } finally { f.close(); }
});

test('changing artifacts runs and issues aborts previews and prevents stale evidence', async ({ page }, info) => {
  const f = fixture(info, 'Stale preview isolation');
  const releases: (() => void)[] = [];
  try {
    await page.addInitScript(() => {
      const state = window as unknown as { diagnosticAborts: string[] };
      state.diagnosticAborts = [];
      const original = window.fetch.bind(window);
      window.fetch = (...args: Parameters<typeof fetch>) => {
        const url = String(args[0]);
        args[1]?.signal?.addEventListener('abort', () => { state.diagnosticAborts.push(url); }, { once: true });
        return original(...args);
      };
    });
    const issue = f.child('Obsolete evidence subject');
    const otherIssue = f.child('Fresh evidence subject');
    const old = f.record('issue', 'blocked', issue.id, 'Old attempt.', true);
    const latest = f.record('issue', 'completed', issue.id, null, true);
    const other = f.record('issue', 'completed', otherIssue.id, null, true);
    for (const run of [old, latest, other]) enrichDiagnosticRun(run, { 'slow.log': `STALE_CONTENT_${run.id}`, 'fresh.log': `FRESH_CONTENT_${run.id}` });
    const hold = async (run: WorkRun) => {
      const held = new Promise<void>(resolve => { releases.push(resolve); });
      await page.route(`**/api/runs/${run.id}/evidence?file=slow.log`, async route => { await held; await route.fulfill({ status: 503, json: { error: `STALE_ERROR_${run.id}` } }).catch(() => {}); });
    };
    await hold(latest);
    await hold(old);
    const dialog = await openDiagnostics(page, info, issue);
    let controls = await evidenceControls(dialog);
    await controls.selector.selectOption('slow.log');
    await expect(controls.preview.getByRole('status')).toContainText(/Loading/i);
    await controls.selector.selectOption('fresh.log');
    await expect(controls.preview.locator('pre')).toHaveText(`FRESH_CONTENT_${latest.id}`);
    await expect.poll(() => page.evaluate(() => (window as unknown as { diagnosticAborts: string[] }).diagnosticAborts)).toContain(`/api/runs/${latest.id}/evidence?file=slow.log`);
    await controls.selector.selectOption('slow.log');
    await expect(controls.preview.getByRole('status')).toContainText(/Loading/i);
    await dialog.getByLabel('Select execution run', { exact: true }).selectOption(old.id);
    await expect(dialog.getByRole('article', { name: 'Delivery report' })).toContainText(`Report result ${old.id}`);
    await expect.poll(() => page.evaluate(runId => (window as unknown as { diagnosticAborts: string[] }).diagnosticAborts.filter(url => url === `/api/runs/${runId}/evidence?file=slow.log`).length, latest.id)).toBeGreaterThanOrEqual(2);
    controls = await evidenceControls(dialog);
    await expect(controls.preview).not.toContainText(`FRESH_CONTENT_${latest.id}`);
    await controls.selector.selectOption('slow.log');
    await expect(controls.preview.getByRole('status')).toContainText(/Loading/i);
    await page.keyboard.press('Escape');
    const freshDialog = await openDiagnostics(page, info, otherIssue);
    const fresh = await evidenceControls(freshDialog);
    await fresh.selector.selectOption('fresh.log');
    await expect(fresh.preview.locator('pre')).toHaveText(`FRESH_CONTENT_${other.id}`);
    await expect.poll(() => page.evaluate(() => (window as unknown as { diagnosticAborts: string[] }).diagnosticAborts)).toContain(`/api/runs/${old.id}/evidence?file=slow.log`);
    for (const release of releases) release();
    await expect(fresh.preview.getByRole('alert')).toHaveCount(0);
    await expect(freshDialog).not.toContainText(/STALE_CONTENT_|STALE_ERROR_/);
  } finally { for (const release of releases) release(); f.close(); }
});

test('diagnostics remain readable and keyboard operable on desktop and at 390px', async ({ page }, info) => {
  const f = fixture(info, 'Responsive diagnostics');
  try {
    const issue = f.child('Long unbroken diagnostic title '.concat('x'.repeat(85)));
    const run = f.record('issue', 'blocked', issue.id, 'long-error-reference-'.repeat(80), true);
    const otherRun = f.record('issue', 'completed', issue.id, null, true);
    const logs = new Map([[run.id, 'long-log-line-'.repeat(1500)], [otherRun.id, `OTHER_RUN_${otherRun.id}\n${'other-long-log-line-'.repeat(1500)}`]]);
    for (const item of [run, otherRun]) enrichDiagnosticRun(item, { 'keyboard.log': logs.get(item.id)! });
    await page.goto(appUrl(info));
    const opener = page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true });
    await expect(opener).toBeVisible();
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    await expect(dialog.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
    expect((await dialog.boundingBox())!.width, 'Desktop diagnostics provide reading space.').toBeGreaterThanOrEqual(700);
    const runSelector = dialog.getByLabel('Select execution run', { exact: true });
    await expect(runSelector.locator('option'), 'Keyboard navigation has two distinct owned execution choices.').toHaveCount(2);
    const runIds = await runSelector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    expect(runIds, 'Both recorded runs are selectable.').toEqual(expect.arrayContaining([run.id, otherRun.id]));
    const [firstRunId, nextRunId] = runIds;
    await runSelector.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(runSelector, 'Home selects the first real run.').toHaveValue(firstRunId);
    const { report, selector, preview } = await evidenceControls(dialog);
    await expect(report, 'The first selected report identifies its own run.').toContainText(`Report result ${firstRunId}`);
    await expect(report.getByRole('link', { name: 'keyboard.log', exact: true })).toHaveAttribute('href', `/api/runs/${firstRunId}/evidence?file=keyboard.log`);
    await selector.focus();
    await page.keyboard.press('k');
    await page.keyboard.press('Enter');
    await expect(selector).toHaveValue('keyboard.log');
    await expect(preview.locator('pre'), 'The initial preview contains only the first run log.').toHaveText(logs.get(firstRunId)!);
    await runSelector.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(runSelector, 'End changes keyboard selection to the other real run ID.').toHaveValue(nextRunId);
    const next = await evidenceControls(dialog);
    await expect(next.report, 'Keyboard run selection replaces the report.').toContainText(`Report result ${nextRunId}`);
    await expect(next.report, 'The previous run report is removed.').not.toContainText(`Report result ${firstRunId}`);
    await expect(next.report.getByRole('link', { name: 'keyboard.log', exact: true }), 'Evidence downloads follow the keyboard-selected run.').toHaveAttribute('href', `/api/runs/${nextRunId}/evidence?file=keyboard.log`);
    await next.selector.focus();
    await page.keyboard.press('k');
    await page.keyboard.press('Enter');
    await expect(next.selector).toHaveValue('keyboard.log');
    await expect(next.preview.locator('pre'), 'Keyboard run selection replaces the previous inline log with the selected run bytes.').toHaveText(logs.get(nextRunId)!);
    await expect(next.report.locator(`a[href^="/api/runs/${firstRunId}/evidence"]`), 'Previous run evidence links are removed.').toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const close = dialog.getByRole('button', { name: /Close/i });
    await close.focus();
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab focus remains inside the diagnostic dialog.').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').getByRole('button', { name: /Close/i }).click();
    await expect(opener).toBeFocused();
    await page.screenshot({ path: info.outputPath('diagnostics-phone.png'), fullPage: true });
  } finally { f.close(); }
});
