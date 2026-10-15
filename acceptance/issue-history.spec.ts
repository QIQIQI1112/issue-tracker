import { expect } from '@playwright/test';
import type { Locator, TestInfo } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appUrl, test } from './workspace.ts';
import { IssueStore } from '../src/storage.ts';
import { saveDelivery } from '../factory/delivery.ts';
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
      const id = randomUUID();
      const now = new Date().toISOString();
      const jobId = Number(database.prepare('INSERT INTO jobs (repo_id, requirement_id, issue_id, kind, status, payload, run_id, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(repo.id, requirement.id, issueId, kind, status, '{}', id, reason, now, now).lastInsertRowid);
      const runStatus = status === 'completed' ? kind === 'issue' ? 'merged' : 'passed' : status === 'blocked' ? 'blocked' : 'running';
      const evidencePath = join(root, id);
      mkdirSync(evidencePath, { recursive: true });
      database.prepare('INSERT INTO work_runs (id, job_id, repo_id, requirement_id, issue_id, status, evidence_path, reason, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, jobId, repo.id, requirement.id, issueId, runStatus, evidencePath, reason, now, status === 'running' ? null : now);
      if (report) {
        writeFileSync(join(evidencePath, 'patch.diff'), `Retained ${runStatus} evidence for ${id}.`);
        saveDelivery(evidencePath, { schemaVersion: 1, runId: id, taskId: `dashboard-${jobId}`, title, goal: requirement.goal, summary: `Report result ${id}`, status: runStatus, startedAt: now, completedAt: now, baseline: null, sourceHash: null, defaults: [], changes: [], checks: [{ name: 'Fixture behavior', status: runStatus === 'blocked' ? 'failed' : 'passed' }], nodePassed: 1, browserPassed: 1, attempts: 1, review: null, integration: null, limitations: reason ? [reason] : [] });
      }
      return store.work.run(id)!;
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

import { currentBlockers, requirementProgress, waitingDependencies } from '../src/ui/workbench-state.ts';

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
  await nav.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
  await nav.getByRole('button', { name: 'All issues', exact: true }).click();
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

test('requirement metadata counts real merges and distinguishes latest whole-goal verification', async ({ request }, info) => {
  const f = fixture(info, 'Verified goal text cannot establish delivery');
  const progress = async () => {
    const data = await (await request.get(`${appUrl(info)}/api/workbench`)).json();
    const { issues } = await (await request.get(`${appUrl(info)}/api/issues`)).json();
    const state = requirementProgress(data, issues, f.requirement);
    return { merged: state.merged, verified: state.verified, outcome: state.outcome };
  };
  try {
    const first = f.child('Manually Done child', [], 'done');
    const second = f.child('Second child');
    f.status('done');
    expect(await progress()).toEqual({ merged: 0, verified: false, outcome: 'Whole goal not yet verified' });
    f.record('issue', 'completed', first.id);
    f.record('issue', 'completed', first.id);
    expect((await progress()).merged).toBe(1);
    f.record('issue', 'completed', second.id);
    f.record('plan_review', 'completed');
    expect(await progress()).toEqual({ merged: 2, verified: false, outcome: 'Whole goal not yet verified' });
    f.record('requirement_verify', 'completed');
    expect(await progress()).toEqual({ merged: 2, verified: true, outcome: 'Whole goal verified' });
    f.record('requirement_verify', 'blocked', null, 'Latest whole-goal review failed.');
    expect(await progress()).toEqual({ merged: 2, verified: false, outcome: 'Whole-goal verification blocked' });
  } finally { f.close(); }
});

test('queue metadata preserves dependency waiting current blockers and independently reviewed retry', async ({ request }, info) => {
  const f = fixture(info, 'Current blocker requirement');
  try {
    const first = f.child('Recovered prerequisite', [], 'done');
    const waiting = f.child('Waiting dependent', [first.id]);
    const sibling = f.child('Unresolved sibling');
    const manualDone = f.child('Manually Done prerequisite', [], 'done');
    const unready = f.child('Dependency waiting child', [manualDone.id]);
    f.record('issue', 'blocked', first.id, 'Historical prerequisite failure.');
    f.record('issue', 'completed', first.id, null, true);
    f.record('issue', 'blocked', sibling.id, 'Current sibling failure.');
    f.store.work.startIssue(waiting.id);
    f.store.work.startIssue(unready.id);
    const work = await (await request.get(`${appUrl(info)}/api/workbench`)).json();
    const { issues } = await (await request.get(`${appUrl(info)}/api/issues`)).json();
    expect(currentBlockers(work, issues).map(job => job.reason)).toContain('Current sibling failure.');
    expect(currentBlockers(work, issues).map(job => job.reason)).not.toContain('Historical prerequisite failure.');
    expect(waitingDependencies(work, issues, work.jobs.find((job: Job) => job.issueId === waiting.id && job.status === 'queued'))).toEqual([]);
    expect(waitingDependencies(work, issues, work.jobs.find((job: Job) => job.issueId === unready.id && job.status === 'queued'))).toEqual([manualDone.id]);
    expect((await request.post(`${appUrl(info)}/api/issues/${waiting.id}/start`, { data: {} })).status()).toBe(409);
    const idle = fixture(info, 'Retry planning approval');
    try {
      const submission = idle.store.work.submitPlan({ schemaVersion: 1, submissionId: randomUUID(), repoId: idle.repo.id, requirement: { title: 'Retry submitted plan', goal: 'Review before execution.' }, source: { kind: 'codex', reference: 'codex://retry', summary: 'Retry still needs review.' }, assumptions: [], issues: [{ key: 'one', title: 'Reviewed child', description: 'Review this child.', acceptance: ['Review is required.'], dependsOn: [] }] });
      const db = new DatabaseSync(idle.store.path);
      try {
        db.prepare("UPDATE jobs SET status='blocked', reason='Current planning review failure.' WHERE id=?").run(submission.jobs[0].id);
        db.prepare("UPDATE requirements SET status='blocked' WHERE id=?").run(submission.requirement.id);
      } finally { db.close(); }
      expect((await request.post(`${appUrl(info)}/api/requirements/${submission.requirement.id}/start`, { data: {} })).status()).toBe(202);
      const refreshed = await (await request.get(`${appUrl(info)}/api/workbench`)).json();
      const active = refreshed.jobs.filter((job: Job) => job.requirementId === submission.requirement.id && ['queued', 'running'].includes(job.status));
      expect(active).toHaveLength(1);
      expect(active[0].kind).toBe('plan_review');
    } finally { idle.close(); }
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
