import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IssueStore } from '../src/storage.ts';
import type { Issue, IssueStatus } from '../src/domain.ts';
import type { Delivery, WorkRun } from '../src/workflow.ts';
import { saveDelivery } from '../factory/delivery.ts';
import { recordDiagnosticRun } from './diagnostic-fixture.ts';
import { appUrl, test } from './workspace.ts';

function fixture(info: TestInfo) {
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const db = new DatabaseSync(store.path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const prefix = `Lifecycle-${randomUUID()}`;
  const root = info.outputPath(prefix);
  mkdirSync(root, { recursive: true });
  const repo = store.work.addRepo({ name: `${prefix} repository`, path: root, targetBranch: 'main' });
  const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Original delivery contract', goal: 'Deliver the original scoped behavior.' });
  const child = (title: string, status: Exclude<IssueStatus, 'closed'> = 'open', labels = ['lifecycle'], repoId = repo.id, description = 'Original diagnostic description.') => store.create({ title: `${prefix} ${title}`, description, status, priority: 'medium', labels, work: { repoId, requirementId: repoId === repo.id ? requirement.id : null, dependsOn: [], acceptance: ['Original observable behavior.'] } });
  const report = (run: WorkRun, limitation: string) => {
    mkdirSync(run.evidencePath, { recursive: true });
    writeFileSync(join(run.evidencePath, 'worker.log'), `Original log ${run.id}\n<script>untrusted retained log</script>\n`);
    writeFileSync(join(run.evidencePath, 'patch.diff'), `Original patch ${run.id}\n`);
    const delivery: Omit<Delivery, 'evidence'> = { schemaVersion: 1, runId: run.id, taskId: `lifecycle-${run.jobId}`, title: 'Recorded execution', goal: 'Original execution goal.', summary: `Recorded result ${run.id}`, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt!, baseline: null, sourceHash: null, defaults: [], changes: [], checks: [{ name: 'Original behavior', status: run.status === 'blocked' ? 'failed' : 'passed' }], nodePassed: 0, browserPassed: 0, attempts: 3, review: { approved: false, summary: 'Original review finding.' }, integration: null, limitations: [limitation], budget: { usedMs: 2700, implementationAttempts: 3, acceptanceAttempts: 2, maxAttempts: 3, totalTimeoutMs: 3600000 } };
    saveDelivery(run.evidencePath, delivery);
  };
  const record = (issue: Issue, reason: string, limitation: string, merged = false) => {
    const run = recordDiagnosticRun(store, db, { root, repoId: issue.work!.repoId, requirementId: issue.work!.requirementId, issueId: issue.id, status: merged ? 'completed' : 'blocked', reason });
    report(run, limitation);
    return run;
  };
  const history = () => {
    const original = child('original diagnosis', 'blocked');
    const older = record(original, 'Historical failure reason.', 'Historical report limitation.');
    const latest = record(original, 'Current failed execution reason.', 'Current retained limitation.');
    const replacement = child(`verified follow-up ${'R'.repeat(50)}`, 'done', ['replacement']);
    record(replacement, 'Separate verified merge.', 'Separate replacement observation.', true);
    db.prepare("UPDATE requirements SET status='blocked' WHERE id=?").run(requirement.id);
    const reason = `<img src=x onerror="window.closureInjected=true"> ${'Durable explanation '.repeat(80)}`;
    const closed = store.closeIssue(original.id, { reason, supersededBy: replacement.id })!;
    return { closed, older, latest, replacement, reason };
  };
  return { store, db, repo, requirement, prefix, root, child, record, report, history, close: () => { db.close(); store.close(); } };
}

async function click(control: Locator, name: string) {
  await expect(control, `${name} must exist before it can be activated.`).toBeVisible({ timeout: 1000 });
  await control.click();
}

async function choose(control: Locator, value: string, name: string) {
  await expect(control, `${name} must be available before selecting.`).toBeVisible({ timeout: 1000 });
  await expect(control.locator(`option[value="${value}"]`), `${name} must expose the requested ${value || 'default'} option.`).toHaveCount(1, { timeout: 1000 });
  await control.selectOption(value);
}

async function open(page: Page, issue: Issue, byTitle = true) {
  const opener = page.getByRole('button', { name: `${byTitle ? 'Inspect' : 'View'} issue ${issue.title}`, exact: true });
  await click(opener, 'Issue inspection opener');
  const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
  await expect(dialog.getByRole('heading', { name: issue.title, exact: true }), 'The requested issue details must hydrate.').toBeVisible();
  return dialog;
}

async function keyboardReach(page: Page, control: Locator, backwards = false) {
  await expect(control, 'The keyboard destination must exist before traversal.').toBeVisible({ timeout: 1000 });
  let reached = false;
  for (let step = 0; step < 100; step++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    if (await control.evaluate(element => element === document.activeElement)) { reached = true; break; }
  }
  expect(reached, `Normal ${backwards ? 'Shift+Tab' : 'Tab'} traversal must reach the requested inspection control.`).toBe(true);
  await expect(control).toBeFocused();
}

function observe(page: Page) {
  const mutations: string[] = [];
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return async () => {
    expect(mutations, 'Website inspection must send zero lifecycle, create, edit, delete or execution mutations.').toEqual([]);
    const operations = /^(?:Close issue\b|Reopen\b|Supersede\b|New issue\b|Create\b|Edit\b|Delete\b|Save changes\b|Start\b|Retry issue\b|Retry requirement\b|Execute\b)/i;
    for (const role of ['button', 'link'] as const) await expect(page.getByRole(role, { name: operations, includeHidden: true }), 'Operation controls must be absent, including hidden and disabled controls.').toHaveCount(0, { timeout: 1000 });
    await expect(page.locator('form, textarea, [contenteditable="true"], input:not([type="search"])'), 'Read-only diagnostics must not introduce mutation fields.').toHaveCount(0);
  };
}

async function expectClosure(dialog: Locator, issue: Issue, replacement?: Issue) {
  const closure = dialog.getByRole('region', { name: 'Closure context', exact: true });
  await expect(closure.getByText(issue.closure!.reason, { exact: true }), 'Closed diagnostics must display the recorded closure reason as text.').toBeVisible({ timeout: 1000 });
  const closedTime = closure.locator('dt').filter({ hasText: /^Closed (?:at|on)$/i }).locator('xpath=following-sibling::dd[1]');
  await expect(closedTime, 'Closure time must have its own label, distinct from Created and Updated timestamps.').toContainText(issue.closure!.closedAt, { timeout: 1000 });
  if (replacement) {
    const context = closure.locator('dt').filter({ hasText: /^(?:Replacement(?: issue)?|Superseded by)$/i }).locator('xpath=following-sibling::dd[1]');
    await expect(context, 'Replacement context must preserve the recorded issue identity.').toContainText(new RegExp(`#${replacement.id}\\b|LOC-${String(replacement.id).padStart(3, '0')}\\b`), { timeout: 1000 });
    await expect(context, 'Replacement title must resolve independently of visible filters.').toContainText(replacement.title, { timeout: 1000 });
  } else await expect(closure.getByText('No replacement issue recorded.', { exact: true }), 'Absent replacement context must be explicit.').toBeVisible({ timeout: 1000 });
  await expect(closure.getByText(/(?:clos(?:ure|ed).*(?:does not|not).*(?:success|deliver)|does not (?:mean|establish|represent).*(?:success|deliver))/i), 'Application-generated closure guidance must distinguish closure from successful delivery.').toBeVisible({ timeout: 1000 });
}

test('Blocked and Closed filter independently with repository search and label filters', async ({ page }, info) => {
  const f = fixture(info);
  const readOnly = observe(page);
  try {
    const foreign = f.store.work.addRepo({ name: `${f.prefix} excluded repository`, path: join(f.root, 'excluded'), targetBranch: 'main' });
    const blocked = f.child('needle blocked', 'blocked');
    const closed = f.store.closeIssue(f.child('neutral closed').id, { reason: 'Fixture closure.' })!;
    f.db.prepare('UPDATE issues SET description=? WHERE id=?').run('needle appears only in description', closed.id);
    const wrongLabel = f.child('needle wrong label', 'blocked', ['excluded']);
    const wrongSearch = f.child('unrelated search', 'blocked');
    const wrongRepo = f.child('needle foreign', 'blocked', ['lifecycle'], foreign.id);
    const existing = [f.child('needle open'), f.child('needle active', 'in_progress'), f.child('needle complete', 'done')];
    await page.goto(appUrl(info));
    const status = page.getByLabel('Filter by status', { exact: true });
    await expect(status, 'All statuses remains the browser default.').toHaveValue('all');
    await click(page.getByRole('button', { name: f.repo.name, exact: true }), 'Owned repository');
    const search = page.getByLabel('Search issues', { exact: true });
    await expect(search).toBeVisible();
    await search.fill('needle');
    await choose(page.getByLabel('Filter by label', { exact: true }), 'lifecycle', 'Label filter');
    const rows = page.getByRole('region', { name: 'Issue list', exact: true }).locator('.issue-row');
    for (const [value, issue] of [['blocked', blocked], ['closed', closed], ['open', existing[0]], ['in_progress', existing[1]], ['done', existing[2]]] as const) {
      await choose(status, value, `Independent ${value} status filter`);
      await expect(rows, `${value} combines repository, search and label scope.`).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-testid', `issue-${issue.id}`);
      await expect(page.locator('.list-heading span'), 'Matching count reflects the fully combined filters.').toHaveText('1 issue');
      await expect(rows.first().locator('.status-pill')).toHaveText({ blocked: 'Blocked', closed: 'Closed', open: 'Open', in_progress: 'In progress', done: 'Done' }[value]);
      const dialog = await open(page, issue);
      await expect(dialog.locator('dt').filter({ hasText: /^Status$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText({ blocked: 'Blocked', closed: 'Closed', open: 'Open', in_progress: 'In progress', done: 'Done' }[value]);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      for (const excluded of [wrongLabel, wrongSearch, wrongRepo]) await expect(page.getByTestId(`issue-${excluded.id}`)).toHaveCount(0);
    }
    await choose(status, 'closed', 'Closed status filter');
    await search.fill('no matching lifecycle record');
    await expect(page.getByRole('heading', { name: 'No matching issues', exact: true })).toBeVisible();
    await click(page.getByRole('button', { name: 'Reset filters', exact: true }), 'Reset filters');
    await expect(status).toHaveValue('all');
    await expect(search).toHaveValue('');
    await expect(page.getByLabel('Filter by label', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'All repositories', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const issue of [blocked, closed, wrongLabel, wrongSearch, wrongRepo, ...existing]) await expect(page.getByTestId(`issue-${issue.id}`)).toBeVisible();
    await readOnly();
  } finally { f.close(); }
});

test('closed diagnostics show closure context while preserving failed reports logs and current limitations', async ({ page }, info) => {
  const f = fixture(info);
  const readOnly = observe(page);
  try {
    const { closed, older, latest, replacement } = f.history();
    await page.goto(appUrl(info));
    await click(page.getByRole('button', { name: f.repo.name, exact: true }), 'Owned repository');
    await page.getByLabel('Search issues', { exact: true }).fill('original diagnosis');
    await choose(page.getByLabel('Filter by label', { exact: true }), 'lifecycle', 'Label filter');
    await expect(page.getByTestId(`issue-${replacement.id}`), 'The Done replacement must be excluded from the visible issue list.').toHaveCount(0);
    const dialog = await open(page, closed);
    await expectClosure(dialog, closed, replacement);
    await expect(dialog.locator('img, script'), 'Closure markup must remain inert text.').toHaveCount(0);
    expect(await page.evaluate(() => 'closureInjected' in window), 'Rendering a closure reason must not execute markup.').toBe(false);
    const requirement = dialog.getByRole('region', { name: 'Requirement context', exact: true });
    await expect(requirement).toContainText('Whole goal not yet verified');
    await expect(requirement).toContainText('1/2 child issues have recorded merges.');
    const selector = dialog.getByLabel('Select execution run', { exact: true });
    await expect(selector).toHaveValue(latest.id);
    await expect(selector.locator('option'), 'Original execution history must exclude the replacement run.').toHaveCount(2);
    const current = dialog.locator('.execution-warning:not(.selected-report .execution-warning)');
    await expect(current).toContainText(['Current failed execution reason.', 'Current retained limitation.']);
    await choose(selector, older.id, 'Original historical execution');
    const report = dialog.getByRole('article', { name: 'Delivery report', exact: true });
    await expect(report).toContainText(`Recorded result ${older.id}`);
    await expect(report.locator('.report-heading .status-pill')).toHaveText('blocked');
    await expect(report).toContainText('Historical report limitation.');
    await expect(current).toContainText(['Current failed execution reason.', 'Current retained limitation.']);
    await expect(current).not.toContainText(['Historical report limitation.']);
    await click(report.locator('summary').filter({ hasText: /^Evidence / }), 'Retained evidence disclosure');
    await choose(report.getByLabel('Select evidence artifact', { exact: true }), 'worker.log', 'Retained log selector');
    const preview = report.getByRole('region', { name: 'Evidence preview', exact: true });
    await expect(preview.locator('pre')).toHaveText(readFileSync(join(older.evidencePath, 'worker.log'), 'utf8'), { useInnerText: false });
    await expect(preview.locator('script')).toHaveCount(0);
    await choose(selector, latest.id, 'Latest failed execution');
    await expect(report).toContainText(`Recorded result ${latest.id}`);
    await expect(report).toContainText('Current retained limitation.');
    await readOnly();
  } finally { f.close(); }
});

test('closed diagnostics explicitly identify closure without a replacement', async ({ page }, info) => {
  const f = fixture(info);
  const readOnly = observe(page);
  try {
    const closed = f.store.closeIssue(f.child('retired record').id, { reason: 'Retired by the conversation owner.' })!;
    await page.goto(appUrl(info));
    const dialog = await open(page, closed, false);
    await expectClosure(dialog, closed);
    await expect(dialog.getByText('No executions yet.', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Select execution run', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const unavailable = f.child('unavailable replacement title');
    const missingTitle = f.store.closeIssue(f.child('retired with unavailable follow-up').id, { reason: 'A separately recorded follow-up exists.', supersededBy: unavailable.id })!;
    await page.route('**/api/issues', async route => {
      await route.fulfill({ json: { issues: f.store.list().filter(issue => issue.id !== unavailable.id) } });
    });
    await page.route(`**/api/issues/${unavailable.id}`, route => route.fulfill({ status: 404, json: { error: 'Issue not found.' } }));
    await page.reload();
    const fallback = await open(page, missingTitle);
    const replacementContext = fallback.locator('dt').filter({ hasText: /^(?:Replacement(?: issue)?|Superseded by)$/i }).locator('xpath=following-sibling::dd[1]');
    await expect(replacementContext, 'Unavailable replacement titles must retain the recorded issue identity.').toContainText(new RegExp(`#${unavailable.id}\\b|LOC-${String(unavailable.id).padStart(3, '0')}\\b`), { timeout: 1000 });
    await expect(replacementContext, 'Unavailable replacement titles require an explicit application-generated explanation.').toContainText(/title.*unavailable|unavailable.*title|issue.*unavailable|unavailable.*issue/i, { timeout: 1000 });
    await readOnly();
  } finally { f.close(); }
});

test('closed diagnostics keep focus mobile layout and read-only recovery usable', async ({ page }, info) => {
  const f = fixture(info);
  const readOnly = observe(page);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const blocked = f.child('separate blocked record', 'blocked');
    const { closed, replacement } = f.history();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl(info));
    await click(page.getByRole('button', { name: f.repo.name, exact: true }), 'Owned repository');
    await page.getByLabel('Search issues', { exact: true }).fill('original diagnosis');
    await page.route(`**/api/issues/${closed.id}`, route => route.fulfill({ status: 503, json: { error: 'Closure detail read failed.' } }));
    const opener = page.getByRole('button', { name: `Inspect issue ${closed.title}`, exact: true });
    await keyboardReach(page, opener);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Issue #${closed.id}`, exact: true });
    await expect(dialog.getByRole('alert')).toHaveText('Closure detail read failed.');
    await page.unroute(`**/api/issues/${closed.id}`);
    await click(dialog.getByRole('button', { name: 'Retry details', exact: true }), 'Detail read retry');
    await expectClosure(dialog, closed, replacement);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    const run = dialog.getByLabel('Select execution run', { exact: true });
    await keyboardReach(page, close, true);
    await keyboardReach(page, run);
    await keyboardReach(page, close, true);
    await expect(close).toBeInViewport();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), 'Long closure and replacement text must fit the 390px dialog.').toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Lifecycle inspection must fit the 390px viewport.').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    const identifier = page.getByRole('button', { name: `View issue ${closed.title}`, exact: true });
    await keyboardReach(page, identifier, true);
    await page.keyboard.press('Enter');
    await expectClosure(dialog, closed, replacement);
    await click(close, 'Close diagnostics');
    await expect(identifier).toBeFocused();
    await choose(page.getByLabel('Filter by status', { exact: true }), 'closed', 'Closed status filter');
    await click(page.getByRole('button', { name: 'Repo harness', exact: true }), 'Repository harness subview');
    await expect(page.getByRole('heading', { name: 'Repo harness', exact: true })).toBeVisible();
    await click(page.getByRole('button', { name: 'Issues', exact: true }), 'Issues subview');
    await expect(page.getByLabel('Filter by status', { exact: true })).toHaveValue('closed');
    await expect(page.getByLabel('Search issues', { exact: true })).toHaveValue('original diagnosis');
    let held = false;
    await page.route(`**/api/issues/${closed.id}`, async route => { held = true; await gate; await route.fulfill({ json: { issue: closed, runs: [] } }); });
    await click(identifier, 'Identifier inspection opener');
    await expect.poll(() => held, 'A detail read must still be pending when diagnostics are dismissed.').toBe(true);
    await expect(dialog.getByText('Loading issue…', { exact: true })).toBeVisible();
    const allRepositories = page.getByRole('button', { name: 'All repositories', exact: true });
    await expect(allRepositories, 'Repository selection must exist before testing pending detail cleanup.').toBeVisible({ timeout: 1000 });
    await allRepositories.dispatchEvent('click');
    await expect(allRepositories, 'The repository transition must occur while the detail read is still pending.').toHaveAttribute('aria-pressed', 'true');
    await expect(dialog, 'Changing repository must dismiss the active pending diagnostics without a manual close or reset.').toHaveCount(0);
    await choose(page.getByLabel('Filter by status', { exact: true }), 'blocked', 'Blocked status filter');
    await page.getByLabel('Search issues', { exact: true }).fill('separate blocked record');
    const next = await open(page, blocked);
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(next.getByRole('heading', { name: blocked.title, exact: true })).toBeVisible();
    await expect(next.getByText(closed.closure!.reason, { exact: true }), 'A delayed closed-issue response must not contaminate the current Blocked issue.').toHaveCount(0);
    await expect(next.getByText(replacement.title, { exact: true })).toHaveCount(0);
    await readOnly();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); f.close(); }
});

test('pinned agent supersession retains the failed immutable requirement and all recorded evidence', async ({ page, request }, info) => {
  const f = fixture(info);
  const readOnly = observe(page);
  try {
    const plan = { schemaVersion: 1, submissionId: `lifecycle-${randomUUID()}`, repoId: f.repo.id, requirement: { title: 'Immutable original request', goal: 'Deliver the immutable original goal.' }, source: { kind: 'codex', reference: 'disposable-lifecycle-conversation', summary: 'Original immutable source.' }, assumptions: [], issues: [{ key: 'original', title: `${f.prefix} submitted original`, description: 'Immutable original description.', acceptance: ['Immutable original acceptance.'], dependsOn: [] }] };
    const receipt = f.store.work.submitPlan(plan);
    const review = f.store.work.claim(f.root)!;
    expect(review.job.requirementId, 'The disposable plan review must own the submitted requirement.').toBe(receipt.requirement.id);
    f.store.work.finish(review.run.id, 'passed');
    const execution = f.store.work.claim(f.root)!;
    const original = receipt.issues[0].issue;
    expect(execution.job.issueId, 'The failed execution must own the original immutable issue.').toBe(original.id);
    f.store.work.finish(execution.run.id, 'blocked', 'Original immutable acceptance exhausted its budget.');
    f.report(f.store.work.run(execution.run.id)!, 'Original immutable limitation.');
    const replacement = f.child('separate delivered replacement', 'done', ['replacement']);
    f.record(replacement, 'Verified separate delivery.', 'Separate delivery observation.', true);
    const snapshot = () => ({ submission: f.db.prepare('SELECT * FROM plan_submissions WHERE id=?').get(plan.submissionId), jobs: f.db.prepare('SELECT * FROM jobs WHERE repo_id=? ORDER BY id').all(f.repo.id), runs: f.db.prepare('SELECT * FROM work_runs WHERE repo_id=? ORDER BY id').all(f.repo.id), requirement: f.store.work.requirement(receipt.requirement.id), evidence: f.store.work.runs().filter(run => run.repoId === f.repo.id).map(run => ({ id: run.id, files: readdirSync(run.evidencePath).sort().map(file => ({ file, bytes: readFileSync(join(run.evidencePath, file)).toString('base64') })) })) });
    mkdirSync(review.run.evidencePath, { recursive: true });
    writeFileSync(join(review.run.evidencePath, 'review.log'), 'Original accepted plan review.');
    const before = snapshot();
    const beforeIssue = f.store.get(original.id)!;
    const rejected = await request.post(`${appUrl(info)}/api/issues/${original.id}/close`, { data: { reason: 'x'.repeat(2001), supersededBy: replacement.id } });
    expect(rejected.status(), 'The pinned API must reject a reason beyond the exact limit.').toBe(400);
    expect(f.store.get(original.id), 'Rejected closure must not be admitted.').toEqual(beforeIssue);
    expect(snapshot(), 'Rejected closure must preserve the immutable plan, history, evidence and budgets.').toEqual(before);
    const reason = 'x'.repeat(2000);
    const data = { reason, supersededBy: replacement.id };
    const response = await request.post(`${appUrl(info)}/api/issues/${original.id}/close`, { data });
    expect(response.status(), 'The owned pinned close API must accept an exact-limit durable reason.').toBe(200);
    const { issue: closed } = await response.json() as { issue: Issue };
    expect(closed.status).toBe('closed');
    expect(closed.closure?.reason).toBe(reason);
    expect(closed.closure?.supersededBy).toBe(replacement.id);
    expect(Number.isFinite(Date.parse(closed.closure!.closedAt))).toBe(true);
    const replay = await request.post(`${appUrl(info)}/api/issues/${original.id}/close`, { data });
    expect(replay.status()).toBe(200);
    expect(await replay.json(), 'Idempotent closure retains its original timestamp and metadata.').toEqual({ issue: closed });
    const detail = await request.get(`${appUrl(info)}/api/issues/${original.id}`);
    expect(detail.status()).toBe(200);
    const inspected = await detail.json() as { issue: Issue; runs: WorkRun[] };
    expect(inspected.issue).toEqual(closed);
    expect(inspected.runs).toEqual([f.store.work.run(execution.run.id)]);
    const replacementRead = await request.get(`${appUrl(info)}/api/issues/${replacement.id}`);
    expect(replacementRead.status()).toBe(200);
    expect((await replacementRead.json()).issue.status).toBe('done');
    const workbench = await request.get(`${appUrl(info)}/api/workbench`);
    expect(workbench.status()).toBe(200);
    expect((await workbench.json()).requirements.find((item: { id: number }) => item.id === receipt.requirement.id).status).toBe('blocked');
    expect(snapshot(), 'Successful supersession must preserve immutable plan bytes, failed jobs/runs, all report/log/evidence bytes and consumed budgets.').toEqual(before);
    const reportRead = await request.get(`${appUrl(info)}/api/runs/${execution.run.id}`);
    expect(reportRead.status()).toBe(200);
    expect((await reportRead.json()).delivery.budget).toEqual({ usedMs: 2700, implementationAttempts: 3, acceptanceAttempts: 2, maxAttempts: 3, totalTimeoutMs: 3600000 });
    await page.goto(appUrl(info));
    const dialog = await open(page, closed);
    await expectClosure(dialog, closed, replacement);
    await expect(dialog.getByRole('region', { name: 'Requirement context', exact: true })).toContainText('Whole goal not yet verified');
    await expect(dialog.getByRole('article', { name: 'Delivery report', exact: true })).toContainText(`Recorded result ${execution.run.id}`);
    await expect(dialog.getByRole('article', { name: 'Delivery report', exact: true }).locator('.report-heading .status-pill')).toHaveText('blocked');
    await readOnly();
    expect(snapshot(), 'Read-only browser inspection must leave all retained immutable evidence unchanged.').toEqual(before);
  } finally { f.close(); }
});
