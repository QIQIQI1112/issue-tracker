import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IssueStore } from '../src/storage.ts';
import type { Issue } from '../src/domain.ts';
import type { Delivery, Job, WorkRun } from '../src/workflow.ts';
import { saveDelivery } from '../factory/delivery.ts';
import { appUrl, test } from './workspace.ts';
import { expectRepositorySelection, expectStatusSelection, selectRepository, selectStatus } from './navigation.ts';

const operationName = /^(?:New issue|Create issue|Create your first issue|Delete\b.*|Edit\b.*|Save changes|Start issue|Retry issue|Queued or running|Automatically merged|Starting…|Deleting…)$/i;

function observeInspection(page: Page) {
  const writes: string[] = [];
  const executionRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method())) writes.push(`${request.method()} ${path}`);
    if (/\/api\/.*\/(?:start|retry|execute)(?:\/|$)/.test(path)) executionRequests.push(`${request.method()} ${path}`);
  });
  return () => {
    expect(writes, 'Inspection interactions must never send browser mutation requests.').toEqual([]);
    expect(executionRequests, 'Inspection must never request execution admission or retry endpoints.').toEqual([]);
  };
}

async function noOperations(root: Locator) {
  await expect(root.getByRole('button', { name: operationName, includeHidden: true }), 'No operation button may remain, even hidden or disabled.').toHaveCount(0, { timeout: 1000 });
  await expect(root.getByRole('link', { name: operationName, includeHidden: true }), 'Operations must not be replaced with mutation links.').toHaveCount(0, { timeout: 1000 });
  await expect(root.locator('form, textarea, [contenteditable="true"], input:not([type="search"])'), 'Inspection must have no mutation forms or editable fields.').toHaveCount(0, { timeout: 1000 });
  await expect(root.getByRole('dialog', { name: /^(?:Create|Delete|Edit) issue$/i, includeHidden: true }), 'Creation, deletion and editing dialogs must be absent from the DOM.').toHaveCount(0, { timeout: 1000 });
}

function fixture(info: TestInfo) {
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const db = new DatabaseSync(store.path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const prefix = `Read-only-${randomUUID()}`;
  const root = info.outputPath('inspection-fixture', prefix);
  mkdirSync(root, { recursive: true });
  const repo = store.work.addRepo({ name: `${prefix} repository`, path: root, targetBranch: 'main' });
  const requirement = store.work.addRequirement({ repoId: repo.id, title: `${prefix} requirement`, goal: 'Inspect agent-owned work and retained execution evidence.' });
  const child = (title: string, dependsOn: number[] = []) => store.create({ title: `${prefix} ${title}`, description: 'Persisted inspection description.', status: 'open', priority: 'high', labels: ['inspection'], work: { repoId: repo.id, requirementId: requirement.id, dependsOn, acceptance: ['Agent-owned delivery remains inspectable.'] } });
  const record = (issueId: number | null, status: Exclude<Job['status'], 'queued'>, reason: string | null = null, kind: Job['kind'] = 'issue', fields: Partial<Delivery> = {}): WorkRun => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const jobId = Number(db.prepare('INSERT INTO jobs (repo_id, requirement_id, issue_id, kind, status, payload, run_id, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(repo.id, requirement.id, issueId, kind, status, '{}', id, reason, now, now).lastInsertRowid);
    const runStatus = status === 'completed' ? kind === 'issue' ? 'merged' : 'passed' : status;
    const evidencePath = join(root, id);
    mkdirSync(evidencePath, { recursive: true });
    db.prepare('INSERT INTO work_runs (id, job_id, repo_id, requirement_id, issue_id, status, evidence_path, reason, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, jobId, repo.id, requirement.id, issueId, runStatus, evidencePath, reason, now, status === 'running' ? null : now);
    writeFileSync(join(evidencePath, 'worker.log'), `Retained log ${id}\n<script>untrusted evidence</script>\n`);
    saveDelivery(evidencePath, { schemaVersion: 1, runId: id, taskId: `inspection-${jobId}`, title: requirement.title, goal: requirement.goal, summary: `Stored report ${id}`, status: runStatus, startedAt: now, completedAt: now, baseline: null, sourceHash: null, defaults: [], changes: [], checks: [{ name: 'Retained verification', status: status === 'blocked' ? 'failed' : 'passed' }], nodePassed: 1, browserPassed: 1, attempts: 1, review: { approved: status === 'completed', summary: 'Stored independent assessment.' }, integration: null, limitations: reason ? [reason] : [], ...fields });
    return store.work.run(id)!;
  };
  return { store, db, repo, requirement, prefix, child, record, close: () => {
    const now = new Date().toISOString();
    db.prepare("UPDATE jobs SET status='blocked', reason='Disposable inspection fixture closed.', updated_at=? WHERE repo_id=? AND status IN ('queued', 'running')").run(now, repo.id);
    db.prepare("UPDATE work_runs SET status='blocked', reason='Disposable inspection fixture closed.', completed_at=? WHERE repo_id=? AND status='running'").run(now, repo.id);
    db.close(); store.close();
  } };
}

async function openDetails(page: Page, issue: Issue) {
  const opener = page.getByRole('button', { name: `View issue ${issue.title}`, exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(dialog.getByRole('heading', { name: issue.title, exact: true }), 'Wait for hydrated details before proving absent operation controls.').toBeVisible();
  return dialog;
}

test('empty workspace directs work through the agent without creation controls', async ({ page }, info) => {
  const assertReadOnly = observeInspection(page);
  await page.route('**/api/issues', async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { issues: [] } });
    else await route.continue();
  });
  await page.goto(appUrl(info));
  await expect(page.getByRole('heading', { name: 'No issues yet', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Issue list', exact: true }), 'The empty workspace must explain that the agent creates and manages issues.').toContainText(/(?:ask|through|use).*agent|agent.*(?:create|manage)/i, { timeout: 1000 });
  await noOperations(page.locator('body'));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Search issues', { exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Empty inspection fits a 390px viewport.').toBe(true);
  assertReadOnly();
});

test('populated and filtered issue lists expose inspection controls only', async ({ page, workspace }, info) => {
  const f = fixture(info);
  const assertReadOnly = observeInspection(page);
  try {
    const work = { repoId: f.repo.id, requirementId: f.requirement.id, dependsOn: [], acceptance: ['Inspect without web operations.'] };
    const alpha = await workspace.create({ title: 'Alpha inspection', status: 'done', priority: 'low', labels: ['read-only'], work });
    const zulu = await workspace.create({ title: 'Zulu inspection', description: `${workspace.prefix} description-only`, priority: 'high', labels: ['other'], work });
    await page.goto(appUrl(info));
    const search = page.getByLabel('Search issues', { exact: true });
    await search.fill(workspace.prefix);
    const rows = page.getByRole('region', { name: 'Issue list', exact: true }).locator('.issue-row');
    await expect(rows).toHaveCount(2);
    await noOperations(page.locator('body'));
    await selectRepository(page, alpha.work!.repoId);
    await search.fill(workspace.prefix);
    await page.getByLabel('Sort issues', { exact: true }).selectOption('title');
    await expect(rows.nth(0)).toHaveAttribute('data-testid', `issue-${alpha.id}`);
    await expect(rows.nth(1)).toHaveAttribute('data-testid', `issue-${zulu.id}`);
    await page.getByLabel('Sort issues', { exact: true }).selectOption('priority');
    await expect(rows.nth(0)).toHaveAttribute('data-testid', `issue-${zulu.id}`);
    await expect(rows.nth(1)).toHaveAttribute('data-testid', `issue-${alpha.id}`);
    await page.getByLabel('Filter by label', { exact: true }).selectOption('read-only');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId(`issue-${alpha.id}`)).toBeVisible();
    await page.getByLabel('Filter by label', { exact: true }).selectOption('');
    await page.getByLabel('Filter by status', { exact: true }).selectOption('done');
    await expectStatusSelection(page, 'done');
    await selectStatus(page, 'all');
    await search.fill(`${workspace.prefix} description-only`);
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId(`issue-${zulu.id}`)).toBeVisible();
    await search.fill(`${workspace.prefix} missing`);
    await expect(page.getByRole('heading', { name: 'No matching issues', exact: true })).toBeVisible();
    await noOperations(page.locator('body'));
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(search).toHaveValue('');
    await expectRepositorySelection(page, '');
    await search.fill(workspace.prefix);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of [`View issue ${alpha.title}`, `Inspect issue ${alpha.title}`]) {
      const opener = page.getByRole('button', { name, exact: true });
      await expect(opener).toBeInViewport();
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: `Issue #${alpha.id}`, exact: true });
      await expect(dialog.getByRole('heading', { name: alpha.title, exact: true })).toBeVisible();
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement)), 'Keyboard focus remains inside inspection.').toBe(true);
      await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeInViewport();
      if (name.startsWith('View')) await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Populated inspection fits a 390px viewport.').toBe(true);
    assertReadOnly();
  } finally { f.close(); }
});

test('issue details omit the Current execution card and operation controls in every execution state', async ({ page }, info) => {
  const f = fixture(info);
  const assertReadOnly = observeInspection(page);
  try {
    const unassigned = f.store.create({ title: `${f.prefix} genuinely unassigned`, description: 'No persisted ownership.', status: 'open', priority: 'medium', labels: [] });
    expect(f.store.get(unassigned.id)?.work, 'The unassigned fixture must genuinely have no work ownership.').toBeUndefined();
    const unstarted = f.child('assigned unstarted');
    const queued = f.child('queued');
    const dependency = f.child('unmerged prerequisite');
    const waiting = f.child('dependency waiting', [dependency.id]);
    const running = f.child('running');
    const blocked = f.child('blocked');
    const merged = f.child('merged');
    f.store.work.startIssue(queued.id);
    f.store.work.startIssue(waiting.id);
    f.record(running.id, 'running');
    const historical = f.record(blocked.id, 'blocked', 'Historical report reason.');
    const current = f.record(blocked.id, 'blocked', 'Current failure remains readable.', 'issue', { limitations: ['Current limitation remains readable.'] });
    f.record(merged.id, 'completed');
    const jobs = f.store.work.jobs();
    expect(jobs.find(job => job.issueId === queued.id)?.status).toBe('queued');
    expect(jobs.find(job => job.issueId === waiting.id)?.status).toBe('queued');
    expect(f.store.get(waiting.id)?.work?.dependsOn).toEqual([dependency.id]);
    expect(f.store.work.runs().some(run => run.issueId === dependency.id && run.status === 'merged')).toBe(false);
    for (const [issue, state] of [[running, 'running'], [blocked, 'blocked'], [merged, 'merged']] as const) expect(f.store.work.runs().find(run => run.issueId === issue.id)?.status).toBe(state);
    await page.goto(appUrl(info));
    await page.getByLabel('Search issues', { exact: true }).fill(f.prefix);
    for (const issue of [unassigned, unstarted, queued, waiting, running, blocked, merged]) {
      const persisted = f.store.get(issue.id)!;
      const dialog = await openDetails(page, persisted);
      if (persisted.work) {
        expect(persisted.work.repoId, 'Assigned fixtures explicitly own the test repository.').toBe(f.repo.id);
        const repository = f.store.work.repos().find(repo => repo.id === persisted.work!.repoId)!;
        await expect(dialog.getByText(repository.name, { exact: true }), 'Repository metadata must match persisted work ownership.').toBeVisible();
      } else await expect(dialog.getByText('Unassigned', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('region', { name: 'Current execution', exact: true, includeHidden: true }), `${issue.title}: remove the entire Current execution region.`).toHaveCount(0, { timeout: 1000 });
      await expect(dialog.getByRole('heading', { name: 'Current execution', exact: true, includeHidden: true }), `${issue.title}: remove the Current execution heading.`).toHaveCount(0, { timeout: 1000 });
      await expect(dialog.locator('.current-execution'), `${issue.title}: remove the obsolete execution card container.`).toHaveCount(0, { timeout: 1000 });
      await noOperations(dialog);
      if ([unassigned.id, unstarted.id].includes(issue.id)) await expect(dialog.getByText('No executions yet.', { exact: true })).toBeVisible();
      if (issue.id === queued.id) await expect(dialog).toContainText('Queued for execution.');
      if (issue.id === waiting.id) await expect(dialog).toContainText(`Waiting for dependencies with recorded merges: #${dependency.id}.`);
      if (issue.id === running.id) await expect(dialog).toContainText('Execution is in progress.');
      if (issue.id === blocked.id) {
        const currentDiagnostics = dialog.locator('.execution-warning:not(.selected-report .execution-warning)');
        await expect(currentDiagnostics).toContainText(['Current failure remains readable.', 'Current limitation remains readable.']);
        await expect(dialog.getByLabel('Select execution run', { exact: true })).toHaveValue(current.id);
        await dialog.getByLabel('Select execution run', { exact: true }).selectOption(historical.id);
        await expect(dialog.getByRole('article', { name: 'Delivery report' })).toContainText('Historical report reason.');
        await expect(currentDiagnostics).toContainText(['Current failure remains readable.', 'Current limitation remains readable.']);
        await expect(currentDiagnostics).not.toContainText(['Historical report reason.']);
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    assertReadOnly();
  } finally { f.close(); }
});

test('inspection navigation reports evidence and read retries send no mutations', async ({ page }, info) => {
  const f = fixture(info);
  const assertReadOnly = observeInspection(page);
  await page.clock.install({ time: new Date('2026-10-20T11:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-10-20T12:00:00.000Z'));
  try {
    const issue = f.child('read recovery');
    const historical = f.record(issue.id, 'blocked', 'Inspectable historical failure.');
    const latest = f.record(issue.id, 'completed', null, 'issue', { limitations: ['Retained delivery limitation.'] });
    const audit = f.record(null, 'completed', null, 'requirement_verify');
    await page.route('**/api/issues', async route => {
      if (route.request().method() === 'GET') await route.fulfill({ status: 503, json: { error: 'List read failed.' } });
      else await route.continue();
    });
    await page.goto(appUrl(info));
    await expect(page.getByRole('heading', { name: 'Couldn’t load issues', exact: true })).toBeVisible();
    await page.unroute('**/api/issues');
    const listRecovery = page.waitForResponse(response => new URL(response.url()).pathname === '/api/issues' && new URL(response.url()).search === '' && response.request().method() === 'GET' && response.status() === 200);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await listRecovery;
    await expect(page.getByTestId(`issue-${issue.id}`)).toBeVisible();
    await expect(page.getByRole('alert'), 'A successful list retry clears the failed read.').toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Couldn’t load issues', exact: true }), 'A successful list retry restores inspection content.').toHaveCount(0, { timeout: 1000 });
    await page.route(`**/api/issues/${issue.id}`, async route => {
      if (route.request().method() === 'GET') await route.fulfill({ status: 503, json: { error: 'Details read failed.' } });
      else await route.continue();
    });
    await page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    await expect(dialog.getByRole('alert')).toContainText('Details read failed.');
    await page.unroute(`**/api/issues/${issue.id}`);
    const detailRecovery = page.waitForResponse(response => new URL(response.url()).pathname === `/api/issues/${issue.id}` && new URL(response.url()).search === '' && response.request().method() === 'GET' && response.status() === 200);
    await dialog.getByRole('button', { name: 'Retry details', exact: true }).click();
    await detailRecovery;
    await expect(dialog.getByRole('heading', { name: issue.title, exact: true })).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog).toContainText(issue.description);
    await expect(dialog).toContainText(f.requirement.goal);
    const selector = dialog.getByLabel('Select execution run', { exact: true });
    const report = dialog.getByRole('article', { name: 'Delivery report', exact: true });
    await expect(report).toContainText(`Stored report ${latest.id}`);
    await page.route(`**/api/runs/${historical.id}`, async route => {
      if (route.request().method() === 'GET') await route.fulfill({ status: 503, json: { error: 'Report read failed.' } });
      else await route.continue();
    });
    await selector.selectOption(historical.id);
    await expect(dialog.getByRole('alert')).toContainText('Report read failed.');
    await page.unroute(`**/api/runs/${historical.id}`);
    const reportRecovery = page.waitForResponse(response => new URL(response.url()).pathname === `/api/runs/${historical.id}` && new URL(response.url()).search === '' && response.request().method() === 'GET' && response.status() === 200);
    await dialog.getByRole('button', { name: 'Retry report', exact: true }).click();
    await reportRecovery;
    await expect(report).toContainText(`Stored report ${historical.id}`);
    await expect(report).toContainText('Inspectable historical failure.');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await selector.selectOption(audit.id);
    await expect(report).toContainText(`Stored report ${audit.id}`);
    await expect(selector.locator('optgroup[label="Requirement audits"] option')).toContainText(audit.id);
    await selector.selectOption(latest.id);
    await expect(report).toContainText(`Stored report ${latest.id}`);
    await expect(report).toContainText('approved');
    await report.locator('summary').filter({ hasText: /^Evidence / }).click();
    const evidenceUrl = `**/api/runs/${latest.id}/evidence?file=worker.log`;
    await page.route(evidenceUrl, async route => {
      if (route.request().method() === 'GET') await route.fulfill({ status: 503, json: { error: 'Evidence read failed.' } });
      else await route.continue();
    });
    await report.getByLabel('Select evidence artifact', { exact: true }).selectOption('worker.log');
    const preview = report.getByRole('region', { name: 'Evidence preview', exact: true });
    await expect(preview.getByRole('alert')).toContainText('Evidence read failed.');
    await page.unroute(evidenceUrl);
    const evidenceRecovery = page.waitForResponse(response => new URL(response.url()).pathname === `/api/runs/${latest.id}/evidence` && new URL(response.url()).searchParams.get('file') === 'worker.log' && [...new URL(response.url()).searchParams.keys()].length === 1 && response.request().method() === 'GET' && response.status() === 200);
    await preview.getByRole('button', { name: 'Retry evidence', exact: true }).click();
    await evidenceRecovery;
    const bytes = readFileSync(join(latest.evidencePath, 'worker.log'));
    await expect(preview.locator('pre')).toHaveText(bytes.toString('utf8'), { useInnerText: false });
    await expect(preview.locator('script')).toHaveCount(0);
    await expect(preview.getByRole('alert')).toHaveCount(0);
    const downloadEvent = page.waitForEvent('download');
    await report.getByRole('link', { name: 'worker.log', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('worker.log');
    const downloadedPath = await download.path();
    expect(downloadedPath, 'Evidence download must complete.').not.toBeNull();
    expect(readFileSync(downloadedPath!), 'Inspection downloads preserve the exact stored evidence bytes.').toEqual(bytes);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), 'Reports and logs remain readable at phone width.').toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true })).toBeFocused();
    const polling = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workbench' && new URL(response.url()).search === '' && response.request().method() === 'GET' && response.status() === 200);
    await page.clock.runFor(2100);
    const polled = await polling;
    expect(await polled.finished(), 'The observed inspection poll must finish before checking browser mutations.').toBeNull();
    await expect(page.getByTestId(`issue-${issue.id}`)).toBeVisible();
    await noOperations(page.locator('body'));
    assertReadOnly();
  } finally { f.close(); }
});
