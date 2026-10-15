import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
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

async function openWorkbench(page: Page, info: TestInfo) {
  await page.goto(appUrl(info));
  const navigation = page.getByRole('button', { name: /^(Development|Workbench)$/ });
  await expect(navigation, 'Workbench must remain reachable from Issues.').toBeVisible();
  await navigation.click();
}

const card = (page: Page, title: string) => page.locator('.requirement-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const manual = (page: Page) => page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Create requirement manually$/ }) });

async function reportState(container: Locator, expected: string) {
  const state = container.getByRole('status');
  await expect(state, 'Selected report must explain its state in visible status content outside run options.').toHaveText(expected);
  await expect(state).toBeVisible();
  expect(await state.evaluate(element => element.closest('select, option') === null), 'Report explanations must not come from selector options.').toBe(true);
}

test('Workbench navigation identifies the active view and returns to issues', async ({ page }, info) => {
  await page.goto(appUrl(info));
  const nav = page.getByRole('navigation', { name: 'Workspace views' });
  const workbench = nav.getByRole('button', { name: 'Workbench', exact: true });
  await expect(workbench, 'Sidebar must identify Workbench.').toHaveAttribute('aria-pressed', 'false');
  await workbench.focus();
  await page.keyboard.press('Enter');
  await expect(workbench).toHaveAttribute('aria-pressed', 'true');
  await expect(nav.locator('[aria-pressed="true"]'), 'Only the current workspace view may appear active.').toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible();
  await expect(page.locator('.breadcrumb')).toContainText('Workbench');
  await nav.getByRole('button', { name: 'All issues', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Issues', exact: true })).toBeVisible();
  await expect(workbench).toHaveAttribute('aria-pressed', 'false');
  await expect(nav.locator('[aria-pressed="true"]')).toHaveCount(1);
});

test('execution content precedes collapsed manual creation and repository setup with Codex empty guidance', async ({ page }, info) => {
  await page.route('**/api/workbench', route => route.fulfill({ json: { repos: [], requirements: [], jobs: [], runs: [] } }));
  await openWorkbench(page, info);
  await expect(manual(page), 'Manual entry must be an initially closed disclosure.').not.toHaveAttribute('open');
  await expect(page.getByLabel('Requirement title', { exact: true })).not.toBeVisible();
  let previous: Locator | undefined;
  for (const name of ['Execution summary', 'Requirements', 'Execution queue', 'Current blockers', 'Delivery history']) {
    const section = page.getByRole('region', { name, exact: true });
    await expect(section, `Execution region ${name} must be visible.`).toBeVisible();
    if (previous) expect(await previous.evaluate((element, next) => Boolean(element.compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await section.elementHandle()), `${name} must follow the preceding execution content.`).toBe(true);
    previous = section;
  }
  expect(await previous!.evaluate((element, next) => Boolean(element.compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await manual(page).elementHandle()), 'Execution content must precede optional manual entry.').toBe(true);
  const repositories = page.getByRole('heading', { name: 'Repositories', exact: true });
  expect(await manual(page).evaluate((element, next) => Boolean(element.compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await repositories.elementHandle()), 'Repository administration must follow manual entry.').toBe(true);
  const guidance = page.getByRole('region', { name: 'Requirements', exact: true });
  await expect(guidance).toContainText(/Codex/);
  await expect(guidance).toContainText(/business goal/i);
  await expect(guidance).toContainText(/without.{0,40}(form|manual)|no.{0,30}(website form|form required)/i);
});

test('manual requirement controls support keyboard creation and expose recoverable errors', async ({ page, request }, info) => {
  const f = fixture(info, 'Keyboard controls');
  try {
    await openWorkbench(page, info);
    const disclosure = manual(page);
    await expect(disclosure).not.toHaveAttribute('open');
    await disclosure.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(disclosure).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Requirement repository', { exact: true })).toBeFocused();
    const repos = await (await request.get(`${appUrl(info)}/api/repos`)).json();
    await expect(page.getByLabel('Requirement repository', { exact: true }), 'Manual creation must retain the first-repository default.').toHaveValue(String(repos.repos[0].id));
    await page.getByLabel('Requirement repository', { exact: true }).selectOption(String(f.repo.id));
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Requirement title', { exact: true })).toBeFocused();
    await page.keyboard.type('Keyboard-created requirement');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Business goal', { exact: true })).toBeFocused();
    await page.keyboard.type('Keep all entered values when creation fails.');
    await page.route('**/api/requirements', async route => {
      if (route.request().method() === 'POST') await route.fulfill({ status: 400, json: { error: 'Recoverable fixture creation error.' } });
      else await route.continue();
    }, { times: 1 });
    await page.keyboard.press('Tab');
    await expect(disclosure.getByRole('button', { name: 'Create requirement', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Recoverable fixture creation error.');
    await expect(page.getByLabel('Requirement title', { exact: true })).toHaveValue('Keyboard-created requirement');
    await expect(page.getByLabel('Business goal', { exact: true })).toHaveValue('Keep all entered values when creation fails.');
    await disclosure.getByRole('button', { name: 'Create requirement', exact: true }).click();
    const created = card(page, 'Keyboard-created requirement');
    await expect(created).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Requirement created.' })).toBeVisible();
    await created.getByRole('button', { name: 'Start requirement Keyboard-created requirement', exact: true }).click();
    await expect(created.getByRole('button', { name: 'Start requirement Keyboard-created requirement', exact: true })).toBeDisabled();
    const work = await (await request.get(`${appUrl(info)}/api/workbench`)).json();
    const item = work.requirements.find((value: { title: string }) => value.title === 'Keyboard-created requirement');
    expect(item.repoId).toBe(f.repo.id);
    expect(work.jobs.filter((value: Job) => value.requirementId === item.id)).toHaveLength(1);
    const registration = page.locator('summary').filter({ hasText: /^Register a repository$/ });
    await registration.focus();
    await page.keyboard.press('Enter');
    for (const label of ['Repository name', 'Local repository path', 'Target branch']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  } finally { f.close(); }
});

test('requirement progress counts merged children and separates whole-goal verification from plan approval', async ({ page }, info) => {
  const f = fixture(info, 'Verified goal text cannot establish delivery');
  try {
    const first = f.child('Manually Done child', [], 'done');
    const second = f.child('Second child');
    f.status('done');
    await openWorkbench(page, info);
    const entry = card(page, f.requirement.title);
    const progress = entry.getByLabel('Verified child progress', { exact: true });
    const outcome = entry.getByLabel('Whole-requirement outcome', { exact: true });
    await expect(progress, 'Manually Done issues must not imply verified delivery.').toHaveText('0 of 2 child issues merged');
    await expect(outcome).toHaveText('Whole goal not yet verified');
    f.record('issue', 'completed', first.id);
    f.record('issue', 'completed', first.id);
    await expect(progress, 'Repeated merge records for one child count once.').toHaveText('1 of 2 child issues merged');
    f.record('issue', 'completed', second.id);
    f.record('plan_review', 'completed');
    await expect(progress).toHaveText('2 of 2 child issues merged');
    await expect(outcome, 'A passed planning review cannot verify the whole requirement.').toHaveText('Whole goal not yet verified');
    f.record('requirement_verify', 'completed');
    await expect(outcome).toHaveText('Whole goal verified');
    f.record('requirement_verify', 'blocked', null, 'Latest whole-goal review failed.');
    await expect(outcome, 'An older pass cannot override a newer blocked final review.').toHaveText('Whole-goal verification blocked');
  } finally { f.close(); }
});

test('current queue explains dependency waiting and retry without stale blockers', async ({ page, request }, info) => {
  const f = fixture(info, 'Current blocker requirement');
  try {
    const first = f.child('Recovered prerequisite', [], 'done');
    const waiting = f.child('Waiting dependent', [first.id]);
    const sibling = f.child('Unresolved sibling');
    const manualDone = f.child('Manually Done prerequisite', [], 'done');
    const unready = f.child('Dependency waiting child', [manualDone.id]);
    const activeChild = f.child('Running child');
    f.record('issue', 'blocked', first.id, 'Historical prerequisite failure.');
    f.record('issue', 'completed', first.id, null, true);
    f.record('issue', 'blocked', sibling.id, 'Current sibling failure.');
    f.store.work.startIssue(waiting.id);
    f.store.work.startIssue(unready.id);
    f.record('issue', 'running', activeChild.id);
    f.status('blocked');
    await openWorkbench(page, info);
    const blockers = page.getByRole('region', { name: 'Current blockers', exact: true });
    await expect(blockers).toContainText('Current sibling failure.');
    await expect(blockers).not.toContainText('Historical prerequisite failure.');
    const queue = page.getByRole('region', { name: 'Execution queue', exact: true });
    await expect(queue).toContainText('Waiting dependent');
    await expect(queue).toContainText('Ready');
    await expect(queue).toContainText('Dependency waiting child');
    await expect(queue).toContainText('Waiting for dependencies');
    await expect(queue).toContainText(`#${manualDone.id}`);
    await expect(queue).toContainText('Running child');
    await expect(queue).toContainText('Running');
    await expect(queue).toContainText(f.repo.name);
    const entry = card(page, f.requirement.title);
    await expect(entry.getByRole('button', { name: /^(Retry|Start) requirement Current blocker requirement$/ })).toBeDisabled();
    const idle = fixture(info, 'Retry planning approval');
    try {
      const submission = idle.store.work.submitPlan({ schemaVersion: 1, submissionId: randomUUID(), repoId: idle.repo.id, requirement: { title: 'Retry submitted plan', goal: 'Review before execution.' }, source: { kind: 'codex', reference: 'codex://retry', summary: 'Retry still needs review.' }, assumptions: [], issues: [{ key: 'one', title: 'Reviewed child', description: 'Review this child.', acceptance: ['Review is required.'], dependsOn: [] }] });
      const db = new DatabaseSync(idle.store.path);
      try {
        db.prepare("UPDATE jobs SET status='blocked', reason='Current planning review failure.' WHERE id=?").run(submission.jobs[0].id);
        db.prepare("UPDATE requirements SET status='blocked' WHERE id=?").run(submission.requirement.id);
      } finally { db.close(); }
      const retry = card(page, 'Retry submitted plan').getByRole('button', { name: 'Retry requirement Retry submitted plan', exact: true });
      await expect(retry, 'Blocked inactive submitted work must expose retry.').toBeEnabled();
      const response = page.waitForResponse(value => value.url().endsWith(`/api/requirements/${submission.requirement.id}/start`) && value.request().method() === 'POST');
      await retry.click();
      expect((await response).status()).toBe(202);
      await expect(retry).toBeDisabled();
      const work = await (await request.get(`${appUrl(info)}/api/workbench`)).json();
      const active = work.jobs.filter((value: Job) => value.requirementId === submission.requirement.id && ['queued', 'running'].includes(value.status));
      expect(active, 'Retry must queue a fresh independent planning review.').toHaveLength(1);
      expect(active[0].kind).toBe('plan_review');
    } finally { idle.close(); }
  } finally { f.close(); }
});

test('delivery inspection opens associated real runs and historical failed evidence', async ({ page, request }, info) => {
  const f = fixture(info, 'Inspectable delivery');
  try {
    const issue = f.child('Retried delivery child');
    const failed = f.record('issue', 'blocked', issue.id, 'Historical failed review.', true);
    const merged = f.record('issue', 'completed', issue.id, null, true);
    await openWorkbench(page, info);
    const history = page.getByRole('region', { name: 'Delivery history', exact: true });
    const selector = history.getByLabel('Select delivery run', { exact: true });
    for (const run of [failed, merged]) {
      const option = selector.locator(`option[value="${run.id}"]`);
      for (const context of [f.repo.name, f.requirement.title, issue.title, run.status]) await expect(option, `Run ${run.id} must retain ownership and outcome context.`).toContainText(context);
      const loaded = page.waitForResponse(response => response.url().endsWith(`/api/runs/${run.id}`));
      await selector.selectOption(run.id);
      expect((await loaded).status()).toBe(200);
      const report = history.getByRole('article', { name: 'Delivery report', exact: true });
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

test('selected report content distinguishes running from terminal unavailable reports', async ({ page }, info) => {
  const f = fixture(info, 'Report state fixture');
  try {
    const issue = f.child('Unavailable terminal child');
    const historical = f.record('issue', 'blocked', issue.id, 'Historical failure.', true);
    const unavailable = f.record('issue', 'blocked', issue.id, 'Terminal failure without report.');
    const running = f.record('issue', 'running', issue.id);
    await openWorkbench(page, info);
    for (const location of ['Workbench', 'Issue details']) {
      let scope: Locator;
      let selector: Locator;
      if (location === 'Workbench') {
        scope = page.getByRole('region', { name: 'Delivery history', exact: true });
        selector = scope.getByLabel('Select delivery run', { exact: true });
      } else {
        await card(page, f.requirement.title).getByRole('button', { name: `#${issue.id} ${issue.title}`, exact: true }).click();
        scope = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
        selector = scope.getByLabel('Select execution run', { exact: true });
      }
      await selector.selectOption(historical.id);
      await expect(scope.getByRole('article', { name: 'Delivery report' })).toContainText(`Report result ${historical.id}`);
      let release: () => void = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      await page.route(`**/api/runs/${running.id}`, async route => { await held; await route.continue(); });
      try {
        await selector.selectOption(running.id);
        const selected = scope.getByLabel('Selected report', { exact: true });
        await expect(scope.getByRole('article', { name: 'Delivery report' }), `${location}: switching runs must clear stale delivery content.`).toHaveCount(0);
        await reportState(selected, 'Loading delivery report…');
        release();
        await reportState(selected, 'Execution is in progress. The delivery report will appear here.');
        await page.unroute(`**/api/runs/${running.id}`);
        await selector.selectOption(unavailable.id);
        await reportState(selected, 'Delivery report unavailable for this execution.');
        await expect(selected, `${location}: terminal missing reports must not be described as running.`).not.toContainText(/in progress|running/i);
        await page.route(`**/api/runs/${historical.id}`, route => route.fulfill({ status: 503, json: { error: 'Report request failed for this fixture.' } }));
        await selector.selectOption(historical.id);
        await expect(selected.getByRole('alert'), `${location}: report errors must be visible and recoverable.`).toHaveText('Report request failed for this fixture.');
        await page.unroute(`**/api/runs/${historical.id}`);
        await selector.selectOption(unavailable.id);
        await reportState(selected, 'Delivery report unavailable for this execution.');
      } finally { release(); await page.unroute(`**/api/runs/${running.id}`); }
    }
  } finally { f.close(); }
});

test('Workbench and expanded controls fit a 390px viewport with long content', async ({ page }, info) => {
  const f = fixture(info, 'Phone layout');
  try {
    const long = 'long-unbroken-reference'.repeat(18);
    const imported = f.store.work.submitPlan({ schemaVersion: 1, submissionId: randomUUID(), repoId: f.repo.id, requirement: { title: 'Long goal '.repeat(10).trim(), goal: `Original phone goal ${long}` }, source: { kind: 'codex', reference: `codex://${long}`, summary: long }, assumptions: [], issues: [{ key: 'long', title: 'Long child '.repeat(10).trim(), description: long, acceptance: ['Long content stays inspectable.'], dependsOn: [] }] });
    const issue = f.child('Phone delivery child');
    const run = f.record('issue', 'blocked', issue.id, long, true);
    const db = new DatabaseSync(f.store.path);
    try { db.prepare('UPDATE repos SET path=? WHERE id=?').run(`/disposable/${long}`, f.repo.id); } finally { db.close(); }
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkbench(page, info);
    await card(page, imported.requirement.title).getByText('Conversation plan', { exact: true }).click();
    await manual(page).locator('summary').click();
    await page.getByLabel('Requirement title', { exact: true }).fill('Long manual title '.repeat(6));
    await page.getByLabel('Business goal', { exact: true }).fill(long);
    await page.locator('summary').filter({ hasText: /^Register a repository$/ }).click();
    await page.getByLabel('Local repository path', { exact: true }).fill(`/disposable/${long}`);
    await page.getByLabel('Select delivery run', { exact: true }).selectOption(run.id);
    const report = page.getByRole('article', { name: 'Delivery report' });
    await expect(report).toBeVisible();
    await report.locator('summary').filter({ hasText: /^Evidence / }).click();
    expect(await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })), 'Phone document must fit without horizontal scrolling.').toEqual({ scroll: 390, width: 390 });
    const failures = await page.locator('main button, main input, main textarea, main select, main summary, main a, main code').evaluateAll(elements => elements.filter(element => element.getClientRects().length > 0).flatMap(element => {
      const box = element.getBoundingClientRect();
      return box.left < -1 || box.right > innerWidth + 1 ? [{ tag: element.tagName, text: element.textContent?.slice(0, 60), left: box.left, right: box.right }] : [];
    }));
    expect(failures, 'Visible actions, evidence, and long source references must stay inside the phone viewport.').toEqual([]);
    expect(await page.locator('html, body, main, .workbench').evaluateAll(elements => elements.map(element => getComputedStyle(element).overflowX)), 'Layout must wrap content rather than conceal page overflow.').not.toContain('hidden');
    await page.screenshot({ path: info.outputPath('dashboard-phone.png'), fullPage: true });
  } finally { f.close(); }
});
