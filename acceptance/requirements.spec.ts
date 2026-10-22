import { expect } from '@playwright/test';
import type { Locator, Page, Route, TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from './workspace.ts';
import { repositoryButton, observeRepositoryReads } from './repository-fixture.ts';
import { recordDiagnosticRun } from './diagnostic-fixture.ts';
import { IssueStore } from '../src/storage.ts';
import { saveDelivery } from '../factory/delivery.ts';
import type { Issue } from '../src/domain.ts';
import type { Job, Publication, Repo, Requirement, Workbench, WorkRun } from '../src/workflow.ts';

const timestamp = '2026-10-20T12:00:00.000Z';

function fixture(info: TestInfo) {
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const database = new DatabaseSync(store.path);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const root = info.outputPath('requirements-fixture');
  mkdirSync(root, { recursive: true });
  const prefix = `Requirements-${randomUUID()}`;
  const repos = ['Alpha', 'Beta', 'Empty'].map(name => store.work.addRepo({ name: `${prefix} ${name}`, path: join(root, name), targetBranch: 'main' }));
  const data: Workbench = { repos, requirements: [], jobs: [], runs: [] };
  const issues: Issue[] = [];
  const requirement = (title: string, repo = repos[0], changes: Partial<Requirement> = {}) => {
    const value = { ...store.work.addRequirement({ repoId: repo.id, title, goal: `Original customer outcome for ${title}.` }), createdAt: timestamp, ...changes };
    data.requirements.push(value);
    return value;
  };
  const child = (parent: Requirement | null, title: string, repo = repos[0], status: Issue['status'] = 'open') => {
    const issue = store.create({ title, description: `Complete diagnostics for ${title}.`, status: status === 'closed' ? 'open' : status, priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: parent?.id ?? null, dependsOn: [], acceptance: ['Read owned delivery evidence.'] } });
    if (status === 'closed') Object.assign(issue, { status, closure: { reason: 'Closed without integration.', closedAt: timestamp } });
    issues.push(issue);
    return issue;
  };
  const record = (parent: Requirement, kind: Job['kind'], status: 'completed' | 'blocked' | 'running', issueId: number | null = null, reason: string | null = null, report = false) => {
    const run = recordDiagnosticRun(store, database, { root, repoId: parent.repoId, requirementId: parent.id, issueId, kind, status, reason });
    data.jobs.push(store.work.jobs().find(job => job.id === run.jobId)!);
    data.runs.push(run);
    if (report) {
      writeFileSync(join(run.evidencePath, 'worker.log'), `Manifest evidence bytes for ${run.id}\n<script>retained text</script>\n`);
      saveDelivery(run.evidencePath, { schemaVersion: 1, runId: run.id, taskId: `requirement-${parent.id}`, title: parent.title, goal: parent.goal, summary: `Owned stage report ${run.id}`, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt ?? timestamp, baseline: null, sourceHash: null, defaults: [], changes: [], checks: [{ name: 'Recorded stage check', status: status === 'completed' ? 'passed' : 'failed' }], nodePassed: 1, browserPassed: 0, attempts: 1, review: null, integration: null, limitations: reason ? [reason] : [] });
    }
    return run;
  };
  return { data, issues, first: repos[0], second: repos[1], empty: repos[2], requirement, child, record,
    mount: async (page: Page) => {
      await page.route('**/api/workbench', route => route.fulfill({ json: data }));
      await page.route('**/api/issues', route => route.fulfill({ json: { issues } }));
    },
    close: () => {
      for (const repo of repos) {
        database.prepare("UPDATE jobs SET status='blocked', reason='Disposable requirement fixture closed.' WHERE repo_id=? AND status IN ('queued', 'running')").run(repo.id);
        database.prepare("UPDATE work_runs SET status='blocked', completed_at=? WHERE repo_id=? AND status='running'").run(timestamp, repo.id);
      }
      database.close();
      store.close();
    },
  };
}

const list = (page: Page) => page.getByRole('region', { name: 'Requirement list', exact: true });
const details = (page: Page) => page.getByRole('region', { name: 'Requirement inspection', exact: true });
const rows = (page: Page) => list(page).getByTestId(/^requirement-\d+$/);
const opener = (page: Page, value: Requirement) => list(page).getByRole('button', { name: `Inspect requirement ${value.title}`, exact: true });
const pagination = (page: Page) => page.getByRole('navigation', { name: 'Requirement pages', exact: true });
const previous = (page: Page) => pagination(page).getByRole('button', { name: /Previous(?: page)?/i });
const next = (page: Page) => pagination(page).getByRole('button', { name: /Next(?: page)?/i });
const section = (page: Page, name: string) => details(page).getByRole('region', { name, exact: true });

async function expectCurrentValue(field: Locator, expected: RegExp, message: string, matches = true) {
  await expect(field, message).toBeVisible();
  const observation = expect.poll(async () => (await field.innerText()).replace(/\s+/g, ' ').trim(), { message });
  if (matches) await observation.toMatch(expected);
  else await observation.not.toMatch(expected);
}

async function click(control: Locator, message = 'The planned inspection control must exist before activation.') {
  await expect(control, message).toBeVisible();
  await expect(control, message).toBeEnabled();
  await control.click();
}

async function select(control: Locator, value: string) {
  await expect(control, 'The reader selector must exist before selecting owned evidence.').toBeVisible();
  await expect(control).toBeEnabled();
  await expect.poll(() => control.locator('option').evaluateAll((options, expected) => options.some(option => (option as HTMLOptionElement).value === expected), value), { message: 'The owned selection must be offered before activation.' }).toBe(true);
  await control.selectOption(value);
}

async function chooseRequirements(page: Page, repo: Repo, navigate = true) {
  if (navigate) await page.goto('/');
  await click(repositoryButton(page, repo), 'An enrolled repository must be available before Requirements navigation.');
  const navigation = page.getByRole('navigation', { name: 'Workspace views', exact: true });
  const control = navigation.getByRole('button', { name: 'Requirements', exact: true }).or(navigation.getByRole('link', { name: 'Requirements', exact: true }));
  await click(control, 'A selected repository must expose the read-only Requirements subview.');
  await expect(control).toHaveAttribute('aria-current', /^(?:page|true)$/);
  await expect(page.getByRole('heading', { name: 'Requirements', level: 1, exact: true })).toBeVisible();
}

async function inspect(page: Page, value: Requirement) {
  await click(opener(page, value), 'Each listed requirement must offer an accessible inspection opener.');
  await expect(details(page), 'Selecting a requirement must expose its inspection surface.').toBeVisible();
  await expect(section(page, 'Original goal'), 'The original business goal must appear independently of selected report contents.').toContainText(value.goal);
}

async function expectPage(page: Page, expected: Requirement[], number: number) {
  const values = [...expected].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const slice = values.slice((number - 1) * 10, number * 10);
  await expect(rows(page), 'The requirement list must render only the current bounded slice.').toHaveCount(slice.length);
  await expect.poll(() => rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))), { message: 'Newest-first requirement identities must be exact, including the descending ID tie break and ownership exclusion.' }).toEqual(slice.map(value => `requirement-${value.id}`));
  const start = values.length ? (number - 1) * 10 + 1 : 0;
  await expect(pagination(page).getByRole('status'), 'Pagination must expose the exact visible range.').toHaveText(new RegExp(`^${start}\\s*[–—-]\\s*${Math.min(number * 10, values.length)}\\s+of\\s+${values.length}\\s+requirements?\\.?$`, 'i'));
  await expect(previous(page)).toBeVisible();
  await expect(next(page)).toBeVisible();
  if (number === 1) await expect(previous(page)).toBeDisabled();
  else await expect(previous(page)).toBeEnabled();
  if (number * 10 >= values.length) await expect(next(page)).toBeDisabled();
  else await expect(next(page)).toBeEnabled();
}

async function tabTo(page: Page, destination: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab') {
  await expect(destination, 'A keyboard destination must exist before normal traversal.').toBeVisible();
  await expect(destination).toBeEnabled();
  for (let step = 0; step < 100; step++) {
    await page.keyboard.press(key);
    if (await destination.evaluate(element => element === document.activeElement)) {
      await expect(destination, `Normal ${key} traversal must reach the control.`).toBeFocused();
      return;
    }
  }
  await expect(destination, `The control must be reachable within 100 normal ${key} presses.`).toBeFocused();
}

async function openStage(page: Page, run: WorkRun) {
  const selector = details(page).getByLabel('Select execution run', { exact: true });
  await select(selector, run.id);
  return details(page).getByLabel('Selected report', { exact: true });
}

async function openEvidence(page: Page) {
  const report = details(page).getByRole('article', { name: 'Delivery report', exact: true });
  await expect(report).toBeVisible();
  const disclosure = report.locator('details').filter({ hasText: /^Evidence \(/ });
  await expect(disclosure, 'The existing report reader must expose its manifest evidence disclosure.').toBeVisible();
  if (await disclosure.getAttribute('open') === null) await click(disclosure.locator('summary'));
  await select(report.getByLabel('Select evidence artifact', { exact: true }), 'worker.log');
  return report.getByRole('region', { name: 'Evidence preview', exact: true });
}

test('requirements subview lists only owned requirements with deterministic ten-row pagination', async ({ page }, info) => {
  const f = fixture(info);
  const readOnly = observeRepositoryReads(page);
  const owned = Array.from({ length: 23 }, (_, index) => f.requirement(`Owned request ${index}`, f.first, { createdAt: index < 3 ? '2026-10-21T00:00:00.000Z' : timestamp, status: index % 2 ? 'blocked' : 'done' }));
  const foreign = f.requirement('Foreign repository requirement', f.second, { createdAt: '2026-10-22T00:00:00.000Z' });
  const child = f.child(owned[2], 'Merged owned child');
  f.child(owned[2], 'Recorded done without merge', f.first, 'done');
  f.record(owned[2], 'issue', 'completed', child.id);
  const retainedIssues = Array.from({ length: 23 }, (_, index) => {
    const issue = f.child(null, `Retained issue ${String((index * 7) % 23 + 1).padStart(2, '0')}`);
    issue.labels = ['retained-only'];
    return issue;
  }).sort((a, b) => a.title.localeCompare(b.title));
  const excludedIssues = [
    f.child(null, 'Retained issue wrong status', f.first, 'done'),
    f.child(null, 'Retained issue wrong label'),
    f.child(null, 'Unrelated search result'),
    f.child(null, 'Retained issue foreign repository', f.second),
  ];
  for (const issue of excludedIssues) issue.labels = ['retained-only'];
  excludedIssues[1].labels = ['excluded-only'];
  const issueList = page.getByRole('region', { name: 'Issue list', exact: true });
  const issuePages = page.getByRole('navigation', { name: 'Issue pages', exact: true });
  const expectRetainedIssuePage = async () => {
    await expect(repositoryButton(page, f.first), 'The Requirements round trip must retain the selected repository.').toHaveAttribute('aria-pressed', 'true');
    await expect(repositoryButton(page, null)).not.toHaveAttribute('aria-pressed', 'true');
    for (const [label, value] of [['Search issues', 'Retained issue'], ['Filter by status', 'open'], ['Filter by label', 'retained-only'], ['Sort issues', 'title']]) {
      await expect(page.getByLabel(label, { exact: true }), `The Requirements round trip must retain ${label}.`).toHaveValue(value);
    }
    await expect(issuePages.getByRole('status'), 'The later filtered issue page must survive the Requirements round trip.').toHaveText(/^11\s*[–—-]\s*20\s+of\s+23\s+issues\.?$/i);
    await expect(issueList.locator('.issue-row')).toHaveCount(10);
    await expect.poll(() => issueList.locator('.issue-row').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))), { message: 'The retained issue page must contain exactly the title-sorted owned matches after excluding wrong status, label, search and repository records.' }).toEqual(retainedIssues.slice(10, 20).map(issue => `issue-${issue.id}`));
    for (const issue of excludedIssues) await expect(issueList.getByTestId(`issue-${issue.id}`)).toHaveCount(0);
    await expect(issuePages.getByRole('button', { name: 'Previous page', exact: true })).toBeEnabled();
    await expect(issuePages.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled();
  };
  try {
    await f.mount(page);
    await page.goto('/');
    await click(repositoryButton(page, f.first));
    await expect(issueList).toHaveAttribute('aria-busy', 'false');
    const search = page.getByLabel('Search issues', { exact: true });
    await expect(search, 'Issue search must be available before establishing retained filters.').toBeVisible();
    await expect(search).toBeEditable();
    await search.fill('Retained issue');
    for (const [label, value] of [['Filter by status', 'open'], ['Filter by label', 'retained-only'], ['Sort issues', 'title']]) await select(page.getByLabel(label, { exact: true }), value);
    await click(issuePages.getByRole('button', { name: 'Next page', exact: true }));
    await expectRetainedIssuePage();
    await chooseRequirements(page, f.first, false);
    for (let number = 1; number <= 3; number++) {
      await expectPage(page, owned, number);
      for (const value of [...owned].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).slice((number - 1) * 10, number * 10)) {
        const row = list(page).getByTestId(`requirement-${value.id}`);
        const identity = row.getByTestId('requirement-identity');
        await expect(identity).toHaveText(`Requirement #${value.id}`);
        await expect(identity).toBeVisible();
        await expect(opener(page, value)).toBeVisible();
        await expect(opener(page, value), 'Each requirement opener must display its title, independently of its accessible inspection name.').toHaveText(value.title, { useInnerText: true });
        const recordedStatus = row.getByTestId('requirement-recorded-status');
        await expect(recordedStatus, 'The list recorded-status field must be visible independently of its expected value.').toBeVisible();
        await expect(recordedStatus, 'The complete recorded status must match; Not done cannot satisfy Done.').toHaveText(new RegExp(`^\\s*${value.status}\\s*$`, 'i'), { useInnerText: true });
        const mergeProgress = row.getByTestId('requirement-merge-progress');
        await expect(mergeProgress, 'Each list row must expose a visible child merge-progress field.').toBeVisible();
        await expect(mergeProgress, 'The complete list merge count must show the exact owned numerator and denominator.').toHaveText(value.id === owned[2].id ? /^\s*1\s*(?:\/|of)\s*2\s*(?:children\s*)?merged\.?\s*$/i : /^\s*(?:0\s*(?:\/|of)\s*0\s*(?:children\s*)?merged|no child issues)\.?\s*$/i, { useInnerText: true });
      }
      await expect(list(page)).not.toContainText(foreign.title);
      if (number < 3) await click(next(page));
    }
    await click(previous(page));
    await expectPage(page, owned, 2);
    const workspaceViews = page.getByRole('navigation', { name: 'Workspace views', exact: true });
    const issuesView = workspaceViews.getByRole('button', { name: 'Issues', exact: true }).or(workspaceViews.getByRole('link', { name: 'Issues', exact: true }));
    await click(issuesView, 'Requirements must offer a usable return to the existing Issues subview.');
    await expect(issuesView).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await expect(page.getByRole('heading', { name: 'Issues', level: 1, exact: true })).toBeVisible();
    await expectRetainedIssuePage();
    await click(repositoryButton(page, f.empty));
    await chooseRequirements(page, f.empty, false);
    await expect(rows(page)).toHaveCount(0);
    await expect(list(page)).toContainText(/no requirements/i);
    await expect(details(page)).toHaveCount(0);
    readOnly();
  } finally { f.close(); }
});

test('requirement inspection preserves the original goal provenance and owned child diagnostic return', async ({ page }, info) => {
  const f = fixture(info);
  const source = { kind: 'codex' as const, reference: 'conversation://requirement-original-46', summary: 'Customer asked to inspect complete original delivery progress.' };
  const parent = f.requirement('Original customer request', f.first, { submission: { id: 'submission-original-46', planHash: 'a'.repeat(64), source } });
  const sibling = f.requirement('Other requirement');
  const owned = f.child(parent, 'Owned child diagnostics');
  const unmerged = f.child(parent, 'Owned unresolved diagnostics', f.first, 'done');
  const foreignChild = f.child(null, 'Foreign repository child', f.second);
  foreignChild.work!.requirementId = parent.id;
  const excluded = [f.child(null, 'Standalone excluded child'), f.child(sibling, 'Foreign requirement child'), foreignChild];
  f.record(parent, 'issue', 'completed', owned.id);
  const wrong = f.record(sibling, 'issue', 'blocked', excluded[1].id, 'Foreign child blocker');
  f.data.jobs.push({ ...f.data.jobs.find(job => job.id === wrong.jobId)!, id: 99999, requirementId: parent.id });
  try {
    await f.mount(page);
    await chooseRequirements(page, f.first);
    await inspect(page, parent);
    for (const text of [parent.goal, f.first.name, source.reference, source.summary, parent.submission!.id, parent.submission!.planHash]) await expect(details(page)).toContainText(text);
    const requirementIdentity = details(page).getByTestId('requirement-identity');
    await expect(requirementIdentity).toHaveText(`Requirement #${parent.id}`);
    await expect(requirementIdentity).toBeVisible();
    const repositoryIdentity = details(page).getByTestId('requirement-repository-identity');
    await expect(repositoryIdentity).toHaveText(`Repository #${f.first.id}`);
    await expect(repositoryIdentity).toBeVisible();
    const children = section(page, 'Child issues');
    const mergedRow = children.getByTestId(`issue-${owned.id}`);
    const unmergedRow = children.getByTestId(`issue-${unmerged.id}`);
    await expect(mergedRow, 'The owned child with merge evidence must have its own inspection row.').toBeVisible();
    await expect(mergedRow).toContainText(owned.title);
    await expect(mergedRow.getByTestId('child-recorded-status')).toBeVisible();
    await expect(mergedRow.getByTestId('child-merge-state')).toBeVisible();
    await expect(mergedRow.getByTestId('child-recorded-status'), 'The merged child must expose a dedicated current recorded status.').toHaveText(/^\s*open\s*$/i, { useInnerText: true });
    await expect(mergedRow.getByTestId('child-merge-state'), 'The child with an owned merged run must show affirmative merge progress in its own current field.').toHaveText(/^\s*merged\s*$/i, { useInnerText: true });
    await expect(mergedRow.getByTestId('child-merge-state')).not.toHaveText(/^\s*(?:not\s+merged|unmerged)\s*$/i, { useInnerText: true });
    await expect(unmergedRow, 'An owned Done child without merge evidence must remain inspectable.').toBeVisible();
    await expect(unmergedRow).toContainText(unmerged.title);
    await expect(unmergedRow.getByTestId('child-recorded-status')).toBeVisible();
    await expect(unmergedRow.getByTestId('child-merge-state')).toBeVisible();
    await expect(unmergedRow.getByTestId('child-recorded-status'), 'The unmerged child must expose its current recorded Done status separately from merge progress.').toHaveText(/^\s*done\s*$/i, { useInnerText: true });
    await expect(unmergedRow.getByTestId('child-merge-state'), 'A Done label must not substitute for actual current child merge evidence.').toHaveText(/^\s*(?:not\s+merged|unmerged)\s*$/i, { useInnerText: true });
    await expect(unmergedRow.getByTestId('child-merge-state')).not.toHaveText(/^\s*merged\s*$/i, { useInnerText: true });
    for (const value of excluded) await expect(children).not.toContainText(value.title);
    await expect(section(page, 'Current blockers')).not.toContainText('Foreign child blocker');
    const control = children.getByRole('button', { name: `Inspect issue ${owned.title}`, exact: true });
    await click(control);
    const dialog = page.getByRole('dialog', { name: `Issue #${owned.id}`, exact: true });
    await expect(dialog).toContainText(owned.description);
    await expect(dialog).toContainText(parent.title);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(control, 'Closing child diagnostics must restore its opener within the retained requirement context.').toBeFocused();
    await expect(details(page)).toContainText(parent.goal);
    await expect(opener(page, parent)).toBeVisible();
    const noProvenance = sibling;
    await inspect(page, noProvenance);
    await expect(details(page)).toContainText(/no (?:conversation |submission )?(?:provenance|source)|provenance (?:unavailable|not recorded)/i);
  } finally { f.close(); }
});

function publication(state: Publication['state']): Publication {
  return { repository: 'example/requirements', remote: 'origin', workflow: 'verify.yml', branch: 'codex/requirement-46', baseBranch: 'main', state, number: 46, url: 'https://github.com/example/requirements/pull/46', ciRunId: 4600, ciUrl: 'https://github.com/example/requirements/actions/runs/4600', headCommit: 'b'.repeat(40), ...(state === 'merged' ? { mergeCommit: 'c'.repeat(40) } : {}) };
}

test('requirement progress separates child integration latest acceptance and final GitHub delivery', async ({ page }, info) => {
  test.setTimeout(90000);
  const f = fixture(info);
  const parent = f.requirement('Recorded status is not delivery', f.first, { status: 'done', goal: 'Customer source mentions passed verified delivered; these words are not evidence.' });
  const owned = f.child(parent, 'Closed unmerged child', f.first, 'closed');
  const other = f.requirement('Unrelated verification', f.second);
  const merged = f.record(parent, 'issue', 'completed', owned.id);
  const passed = f.record(parent, 'requirement_verify', 'completed', null, null, true);
  const baseJobs = [...f.data.jobs];
  const baseRuns = [...f.data.runs];
  const verification = baseJobs.find(job => job.id === passed.jobId)!;
  const affirmativeAcceptance = /^(?:passed|verified)\.?$/i;
  const unverifiedAcceptance = /^(?:unverified|not (?:yet )?(?:verified|passed)|no (?:whole-goal )?verification(?: evidence)?|unavailable|incomplete|missing(?: (?:verification|run|evidence))?|running)\.?$/i;
  const incompleteDelivery = /^(?:not (?:yet )?(?:delivered|verified)|incomplete|pending|blocked)\.?$/i;
  const localDelivery = /^(?:local(?:-only)? (?:delivery )?(?:verified|delivered)|(?:verified|delivered) (?:locally|local(?:-only)?(?: delivery)?))\.?$/i;
  const githubDelivery = /^(?:GitHub (?:delivery )?merged|merged (?:on )?GitHub|delivered (?:on|via) GitHub)\.?$/i;
  const cases: { name: string; jobs: Job[]; runs: WorkRun[]; children?: Issue[]; publication?: Publication; acceptance: RegExp; accepted?: boolean; delivery: RegExp; delivered?: boolean; integration?: RegExp; historical?: WorkRun }[] = [
    { name: 'manual Done and closed unmerged child', jobs: [], runs: [], acceptance: unverifiedAcceptance, delivery: incompleteDelivery, integration: /0\s*(?:\/|of)\s*1/i },
    { name: 'all children merged without acceptance', jobs: baseJobs.filter(job => job.kind === 'issue'), runs: [merged], acceptance: unverifiedAcceptance, delivery: incompleteDelivery },
    { name: 'local-only verified delivery', jobs: baseJobs, runs: baseRuns, acceptance: affirmativeAcceptance, accepted: true, delivery: localDelivery, delivered: true },
    { name: 'zero children despite passing evidence', jobs: baseJobs, runs: [passed], children: [], acceptance: affirmativeAcceptance, accepted: true, delivery: /^(?:no child(?: issues)?|zero child(?: issues)?|incomplete|not (?:yet )?(?:verified|delivered))\.?$/i },
    { name: 'GitHub awaits CI after acceptance', jobs: baseJobs, runs: baseRuns, publication: publication('awaiting_ci'), acceptance: affirmativeAcceptance, accepted: true, delivery: /^awaiting[ _-]?(?:CI|checks)\.?$/i },
    { name: 'GitHub publication merged', jobs: baseJobs, runs: baseRuns, publication: publication('merged'), acceptance: affirmativeAcceptance, accepted: true, delivery: githubDelivery, delivered: true },
  ];
  for (const status of ['queued', 'running', 'blocked'] as const) {
    const latest: Job = { ...verification, id: verification.id + 500, runId: null, status };
    cases.push({ name: `older pass then ${status}`, jobs: [...baseJobs, latest], runs: baseRuns, publication: publication('merged'), acceptance: new RegExp(`^(?:verification )?${status}\\.?$`, 'i'), delivery: incompleteDelivery, historical: passed });
  }
  for (const [name, changes] of Object.entries({ 'wrong run ID': { id: 'unmatched-run' }, 'wrong job ID': { jobId: 999999 }, 'foreign repository run': { repoId: f.second.id }, 'foreign requirement run': { requirementId: other.id }, 'child-owned final run': { issueId: owned.id }, 'missing completion': { completedAt: null }, 'running final run': { status: 'running' as const } })) {
    cases.push({ name, jobs: baseJobs, runs: [merged, { ...passed, ...changes }], publication: publication('merged'), acceptance: unverifiedAcceptance, delivery: incompleteDelivery });
  }
  cases.push({ name: 'completed latest job with missing run', jobs: [...baseJobs, { ...verification, id: verification.id + 900, runId: 'absent-run' }], runs: baseRuns, acceptance: unverifiedAcceptance, delivery: incompleteDelivery });
  const unmerged = f.child(parent, 'Unmerged sibling');
  cases.push({ name: 'acceptance remains independent of child integration', jobs: baseJobs, runs: baseRuns, children: [owned, unmerged], acceptance: affirmativeAcceptance, accepted: true, delivery: incompleteDelivery, integration: /1\s*(?:\/|of)\s*2/i });
  try {
    await f.mount(page);
    for (const value of cases) await test.step(value.name, async () => {
      f.data.jobs = value.jobs;
      f.data.runs = value.runs;
      f.issues.splice(0, f.issues.length, ...(value.children ?? [owned]));
      if (value.publication) parent.publication = value.publication;
      else delete parent.publication;
      await chooseRequirements(page, f.first);
      await inspect(page, parent);
      const recordedStatus = section(page, 'Recorded status').getByTestId('requirement-recorded-status');
      await expect(recordedStatus, 'The current recorded-status field must be visible independently of the section heading.').toBeVisible();
      await expect(recordedStatus, 'Recorded Done must remain separate from generated acceptance and delivery observations; Not done is not Done.').toHaveText(/^\s*done\s*$/i, { useInnerText: true });
      const currentAcceptance = section(page, 'Whole-goal acceptance').getByRole('status');
      const currentDelivery = section(page, 'Final delivery').getByRole('status');
      await expect(currentAcceptance, 'Current acceptance must have one distinct application-generated observation, separate from source text and historical reports.').toHaveCount(1);
      await expect(currentDelivery, 'Current delivery must have one distinct application-generated observation, separate from publication and historical reports.').toHaveCount(1);
      await expect(currentAcceptance, `Current acceptance for ${value.name} must be unambiguous.`).toBeVisible();
      await expectCurrentValue(currentAcceptance, value.acceptance, `Current acceptance for ${value.name} must match the exact latest-evidence state without contradictory passed text.`);
      if (value.accepted) await expectCurrentValue(currentAcceptance, affirmativeAcceptance, 'Valid exact latest evidence must establish affirmative current acceptance; Unverified is not Verified.');
      else await expectCurrentValue(currentAcceptance, affirmativeAcceptance, 'Missing, mismatched or superseded evidence must not establish current passed acceptance.', false);
      await expect(currentDelivery, `Current delivery for ${value.name} must be unambiguous.`).toBeVisible();
      await expectCurrentValue(currentDelivery, value.delivery, `Current delivery for ${value.name} must match the exact evidence-based state.`);
      if (!value.delivered) {
        await expectCurrentValue(currentDelivery, localDelivery, 'Incomplete integration, acceptance or publication must exclude affirmative local delivery.', false);
        await expectCurrentValue(currentDelivery, githubDelivery, 'A recorded merged publication cannot substitute for current acceptance and child integration.', false);
      }
      const mergeProgress = section(page, 'Child integration').getByTestId('requirement-merge-progress');
      const mergeRatio = value.integration ?? (value.children?.length === 0 ? /0\s*(?:\/|of)\s*0/ : /1\s*(?:\/|of)\s*1/);
      await expect(mergeProgress, 'The inspection child merge-progress field must be visible independently of its heading and empty-state prose.').toBeVisible();
      await expect(mergeProgress, 'The complete inspection merge count must show the exact numerator and denominator; 11/10 cannot satisfy 1/1.').toHaveText(new RegExp(`^\\s*(?:(?:${mergeRatio.source})(?:\\s*(?:children\\s*)?merged)?${value.children?.length === 0 ? '|no child(?: issues)?' : ''})\\.?\\s*$`, 'i'), { useInnerText: true });
      if (!value.publication) await expect(section(page, 'Publication')).toContainText(/local.only|local delivery|not enrolled/i);
      if (value.publication) {
        const publicationState = section(page, 'Publication').getByTestId('requirement-publication-state');
        await expect(publicationState, 'The current publication-state field must be visible independently of its heading and PR or CI links.').toBeVisible();
        await expect(publicationState, 'The complete recorded publication state must match; Not merged cannot satisfy Merged.').toHaveText(new RegExp(`^\\s*${value.publication.state.replace('_', '[ _-]?')}\\s*$`, 'i'), { useInnerText: true });
        for (const url of [value.publication.url!, value.publication.ciUrl!]) await expect(section(page, 'Publication').getByRole('link').filter({ hasText: /\S/ }).and(section(page, 'Publication').locator(`a[href="${url}"]`))).toBeVisible();
      }
      if (value.historical) {
        await openStage(page, value.historical);
        const report = details(page).getByRole('article', { name: 'Delivery report', exact: true });
        await expect(report, 'The superseded passing attempt must remain independently inspectable in history.').toContainText(`Owned stage report ${value.historical.id}`);
        await expect(report.locator('.report-heading').getByText('passed', { exact: true }), 'The selected historical report may show its own recorded passing result.').toBeVisible();
        await expectCurrentValue(currentAcceptance, value.acceptance, 'Inspecting a historical pass must not replace the newer queued, running or blocked current acceptance.');
        await expectCurrentValue(currentDelivery, value.delivery, 'Inspecting a historical pass must not establish final delivery.');
      }
    });
  } finally { f.close(); }
});

test('requirement inspection shows current blockers and opens only owned stage reports and evidence', async ({ page }, info) => {
  const f = fixture(info);
  const parent = f.requirement('Stage history without child issues', f.first, { publication: { ...publication('awaiting_ci'), reason: 'Resolved publication failure.' } });
  const sibling = f.requirement('Other stage owner');
  const foreign = f.requirement('Foreign stage owner', f.second);
  const historical = f.record(parent, 'plan_review', 'blocked', null, 'Recovered planning failure.', true);
  const recovered = f.record(parent, 'plan_review', 'completed', null, null, true);
  const current = f.record(parent, 'requirement_verify', 'blocked', null, 'Current acceptance run reason.', true);
  f.data.jobs.find(job => job.id === current.jobId)!.reason = null;
  const decomposition = f.record(parent, 'decompose', 'completed');
  const publish = f.record(parent, 'requirement_publish', 'running');
  const excluded = [f.record(sibling, 'requirement_verify', 'blocked', null, 'Foreign requirement blocker.', true), f.record(foreign, 'requirement_verify', 'blocked', null, 'Foreign repository blocker.', true)];
  const child = f.child(sibling, 'Wrong stage child');
  excluded.push(f.record(parent, 'issue', 'blocked', child.id, 'Foreign child job blocker.', true));
  const invalid = f.record(parent, 'plan_review', 'blocked', null, 'Mismatched pair blocker.', true);
  f.data.jobs.find(job => job.id === invalid.jobId)!.runId = 'different-run';
  excluded.push(invalid);
  excluded.push(f.record(parent, 'maintenance', 'completed'));
  const noHistory = f.requirement('No stage history');
  const noReason = f.requirement('Blocked stage without a recorded reason');
  f.record(noReason, 'decompose', 'blocked');
  const reads: string[] = [];
  page.on('request', request => { if (/\/api\/runs\//.test(request.url())) reads.push(new URL(request.url()).pathname); });
  try {
    await f.mount(page);
    await chooseRequirements(page, f.first);
    await inspect(page, parent);
    const blockers = section(page, 'Current blockers');
    await expect(blockers, 'A latest blocked stage may use its matching run reason when the job reason is absent.').toContainText('Current acceptance run reason.');
    for (const text of ['Recovered planning failure.', 'Resolved publication failure.', 'Foreign requirement blocker.', 'Foreign repository blocker.', 'Foreign child job blocker.']) await expect(blockers).not.toContainText(text);
    parent.publication = { ...publication('blocked'), reason: 'Current publication gate failure.' };
    await refresh(page);
    await expect(blockers, 'Blocked publication reasons must remain current independently of acceptance blockers.').toContainText('Current publication gate failure.');
    parent.publication = { ...publication('awaiting_ci'), reason: 'Current publication gate failure.' };
    await refresh(page);
    await expect(blockers, 'A recovered publication attempt must not retain its old reason as a current blocker.').not.toContainText('Current publication gate failure.');
    const selector = details(page).getByLabel('Select execution run', { exact: true });
    await expect(selector).toBeVisible();
    await expect.poll(() => selector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean))).toEqual([publish, decomposition, current, recovered, historical].sort((a, b) => b.jobId - a.jobId).map(run => run.id));
    for (const run of [historical, recovered, current]) {
      await openStage(page, run);
      const report = details(page).getByRole('article', { name: 'Delivery report', exact: true });
      await expect(report).toContainText(`Owned stage report ${run.id}`);
      const preview = await openEvidence(page);
      await expect(preview.locator('pre')).toHaveText(`Manifest evidence bytes for ${run.id}\n<script>retained text</script>\n`);
      await expect(preview.locator('script')).toHaveCount(0);
      await expect(report.getByRole('link', { name: 'worker.log', exact: true })).toHaveAttribute('href', `/api/runs/${run.id}/evidence?file=worker.log`);
      await expect(blockers).toContainText('Current acceptance run reason.');
      await expect(blockers).not.toContainText('Recovered planning failure.');
    }
    await openStage(page, publish);
    await expect(details(page).getByLabel('Selected report').getByRole('status')).toHaveText('Execution is in progress. The delivery report will appear here.');
    await openStage(page, decomposition);
    await expect(details(page).getByLabel('Selected report').getByRole('status')).toHaveText('Delivery report unavailable for this execution.');
    await inspect(page, noHistory);
    await expect(details(page)).toContainText(/no (?:requirement.stage |stage |execution |delivery )?(?:runs|executions|history|reports)/i);
    await expect(details(page).getByRole('article', { name: 'Delivery report' })).toHaveCount(0);
    await expect(section(page, 'Child issues')).toContainText(/no child issues/i);
    await expect(section(page, 'Current blockers')).toContainText(/no (?:current |recorded )?blockers/i);
    await inspect(page, noReason);
    await expect(section(page, 'Current blockers'), 'A blocked stage with missing reason metadata must say that its reason is unavailable.').toContainText(/(?:no (?:blocking )?reason (?:was )?recorded|reason (?:unavailable|not recorded))/i);
    for (const run of excluded) expect(reads, 'Excluded stage runs must not be offered or fetched by the requirement reader.').not.toContain(`/api/runs/${run.id}`);
  } finally { f.close(); }
});

async function refresh(page: Page) {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/workbench' && value.status() === 200);
  await click(page.getByRole('button', { name: 'Refresh repositories', exact: true }));
  await response;
}

async function expectRequirementsReadOnly(page: Page) {
  const root = page.getByRole('main');
  const operations = /^(?!(?:Retry repositories|Retry report|Retry evidence)$)(?:new\b|create\b|start\b|retry\b|execute\b|run\b|publish\b|merge\b|edit\b|save\b|delete\b|cancel\b|stop\b|resume\b|enqueue\b|queue\b|close\s+(?:issue|requirement)\b|reopen\b|mark\b|approve\b|reject\b)/i;
  await expect(page.getByRole('heading', { name: 'Requirements', level: 1, exact: true }), 'Read-only scope checks must inspect the active Requirements subview.').toBeVisible();
  await expect(list(page), 'The requirement list must be present before proving operation controls absent.').toBeVisible();
  await expect(root.getByRole('button', { name: operations, includeHidden: true }), 'The entire Requirements subview must omit mutation and execution buttons, including hidden or disabled controls.').toHaveCount(0);
  await expect(root.getByRole('link', { name: operations, includeHidden: true }), 'The entire Requirements subview must omit operation links, including hidden or disabled controls.').toHaveCount(0);
  await expect(root.locator('form, input, textarea, [contenteditable="true"]'), 'The requirement list and inspection must contain no mutation forms or editable fields, even hidden ones.').toHaveCount(0);
}

test('requirement refresh preserves page selection and focus while repository switches reject stale reads', async ({ page }, info) => {
  test.setTimeout(60000);
  const f = fixture(info);
  const values = Array.from({ length: 21 }, (_, index) => f.requirement(`Refresh request ${index}`));
  const selected = values[10];
  const child = f.child(selected, 'Refresh progress child');
  const historical = f.record(selected, 'plan_review', 'blocked', null, 'Historical delayed report.', true);
  const latest = f.record(selected, 'requirement_verify', 'completed', null, null, true);
  const beta = f.requirement('Beta retained context', f.second);
  try {
    await f.mount(page);
    await chooseRequirements(page, f.first);
    await click(next(page));
    await expectPage(page, values, 2);
    await inspect(page, selected);
    await tabTo(page, opener(page, selected));
    const handle = await opener(page, selected).elementHandle();
    expect(handle).not.toBeNull();
    const currentProgress = section(page, 'Child integration').getByTestId('requirement-merge-progress');
    await expectCurrentValue(currentProgress, /^0\s*(?:\/|of)\s*1(?:\s*(?:children\s*)?merged)?\.?$/i, 'Before polling, the owned child must be unmerged.');
    f.record(selected, 'issue', 'completed', child.id);
    const polling = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workbench' && response.status() === 200);
    await polling;
    await expectCurrentValue(currentProgress, /^1\s*(?:\/|of)\s*1(?:\s*(?:children\s*)?merged)?\.?$/i, 'Polling must update the exact visible owned merge ratio from 0/1 to 1/1.');
    await expectPage(page, values, 2);
    await expect(opener(page, selected), 'A background metadata update must retain keyboard focus.').toBeFocused();
    expect(await handle!.evaluate(element => element.isConnected), 'Refresh must retain the selected opener node.').toBe(true);
    const metadataFailure = (route: Route) => route.fulfill({ status: 503, json: { error: 'Background requirement metadata failure.' } });
    await page.route('**/api/workbench', metadataFailure);
    const failedPolling = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workbench' && response.status() === 503);
    await failedPolling;
    await expect(page.getByRole('alert')).toContainText('Background requirement metadata failure.');
    await expect(opener(page, selected), 'A failed background refresh must retain selection and keyboard focus.').toBeFocused();
    await expect(details(page)).toContainText(selected.goal);
    await page.unroute('**/api/workbench', metadataFailure);
    f.data.requirements = f.data.requirements.filter(value => value.repoId !== f.first.id || value.id <= selected.id);
    await refresh(page);
    await expectPage(page, values.filter(value => value.id <= selected.id), 2);
    await expect(details(page)).toContainText(selected.goal);
    await inspect(page, values[0]);
    f.data.requirements = f.data.requirements.filter(value => value.repoId !== f.first.id || value.id <= values[4].id);
    await refresh(page);
    await expectPage(page, values.slice(0, 5), 1);
    await expect(details(page)).toContainText(values[0].goal);
    f.data.requirements.push(selected);
    await refresh(page);
    await inspect(page, selected);
    for (const artifact of [false, true]) for (const failure of [false, true]) for (const returnBeforeSettlement of [false, true]) {
      let release = () => {};
      let requested = false;
      let settled = false;
      const held = new Promise<void>(resolve => { release = resolve; });
      const pattern = artifact ? `**/api/runs/${latest.id}/evidence?file=worker.log` : `**/api/runs/${historical.id}`;
      await page.route(pattern, async route => {
        const response = await route.fetch();
        requested = true;
        await held;
        await route.fulfill(failure ? { status: 503, json: { error: 'Obsolete requirement read failure.' } } : { response });
        settled = true;
      });
      try {
        if (artifact) {
          await openStage(page, latest);
          await expect(details(page).getByRole('article', { name: 'Delivery report' })).toContainText(latest.id);
          const preview = await openEvidence(page);
          await expect(preview, 'The old evidence must still be loading when repository cleanup begins.').toHaveAttribute('aria-busy', 'true');
          await expect(preview.getByRole('status')).toHaveText('Loading evidence…');
        } else {
          const report = await openStage(page, historical);
          await expect(report.getByRole('status'), 'The old report must still be loading when repository cleanup begins.').toHaveText('Loading delivery report…');
        }
        await expect.poll(() => requested, { message: 'The old requirement read must still be pending when repository cleanup occurs.' }).toBe(true);
        await click(repositoryButton(page, f.second));
        await expect(details(page), 'Repository switching must clear active requirement and report content before the old response settles.').toHaveCount(0);
        await chooseRequirements(page, f.second, false);
        await inspect(page, beta);
        if (returnBeforeSettlement) {
          await chooseRequirements(page, f.first, false);
          await expect(details(page), 'Returning before the old response settles must retain a cleared inspection context.').toHaveCount(0);
          await inspect(page, values[0]);
        }
        release();
        await expect.poll(() => settled, { message: 'The stale success or failure must settle before checking that it was discarded.' }).toBe(true);
        await page.unroute(pattern);
        await expect(details(page)).toContainText(returnBeforeSettlement ? values[0].goal : beta.goal);
        await expect(page.getByRole('main')).not.toContainText(selected.goal);
        await expect(page.getByRole('main')).not.toContainText('Obsolete requirement read failure.');
        await expect(page.getByRole('main')).not.toContainText(`Owned stage report ${historical.id}`);
        await expect(page.getByRole('main')).not.toContainText(`Manifest evidence bytes for ${latest.id}`);
        if (returnBeforeSettlement) await chooseRequirements(page, f.second, false);
        await chooseRequirements(page, f.first, false);
        await expect(details(page), 'Returning to a repository must not restore obsolete selection or reports.').toHaveCount(0);
        await inspect(page, selected);
      } finally { release(); await page.unroute(pattern); }
    }
  } finally { f.close(); }
});

test('requirement loading metadata and report read failures recover using read requests only', async ({ page }, info) => {
  const f = fixture(info);
  const readOnly = observeRepositoryReads(page);
  const parent = f.requirement('Recoverable requirement reads');
  const run = f.record(parent, 'requirement_verify', 'completed', null, null, true);
  let release = () => {};
  let metadataFailure = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.mount(page);
    await page.route('**/api/workbench', async route => {
      await held;
      await route.fulfill(metadataFailure ? { status: 503, json: { error: 'Requirement metadata fixture unavailable.' } } : { json: f.data });
    });
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: /loading repositories/i }), 'Initial repository metadata loading must be understandable before Requirements can be selected.').toBeVisible();
    metadataFailure = true;
    release();
    await expect(page.getByRole('alert')).toContainText('Requirement metadata fixture unavailable.');
    metadataFailure = false;
    await click(page.getByRole('button', { name: 'Retry repositories', exact: true }));
    await chooseRequirements(page, f.first, false);
    await expectRequirementsReadOnly(page);
    await inspect(page, parent);
    await expectRequirementsReadOnly(page);
    metadataFailure = true;
    await click(page.getByRole('button', { name: 'Refresh repositories', exact: true }));
    await expect(page.getByRole('alert')).toContainText('Requirement metadata fixture unavailable.');
    await expect(details(page), 'Refresh errors must retain useful loaded requirement details.').toContainText(parent.goal);
    metadataFailure = false;
    await click(page.getByRole('button', { name: 'Retry repositories', exact: true }));
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ status: 503, json: { error: 'Owned requirement report unavailable.' } }));
    await openStage(page, run);
    const selected = details(page).getByLabel('Selected report', { exact: true });
    await expect(selected.getByRole('alert')).toHaveText('Owned requirement report unavailable.');
    await expectRequirementsReadOnly(page);
    await page.unroute(`**/api/runs/${run.id}`);
    await click(selected.getByRole('button', { name: 'Retry report', exact: true }));
    await expect(selected.getByRole('article', { name: 'Delivery report' })).toContainText(`Owned stage report ${run.id}`);
    const pattern = `**/api/runs/${run.id}/evidence?file=worker.log`;
    await page.route(pattern, route => route.fulfill({ status: 503, json: { error: 'Owned requirement evidence unavailable.' } }));
    const preview = await openEvidence(page);
    await expect(preview.getByRole('alert')).toHaveText('Owned requirement evidence unavailable.');
    await expectRequirementsReadOnly(page);
    await page.unroute(pattern);
    await click(preview.getByRole('button', { name: 'Retry evidence', exact: true }));
    await expect(preview.locator('pre')).toContainText(`Manifest evidence bytes for ${run.id}`);
    await expectRequirementsReadOnly(page);
    readOnly();
  } finally { release(); f.close(); }
});

async function readable(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  expect(await control.evaluate(element => {
    const style = getComputedStyle(element);
    return { fits: element.scrollWidth <= element.clientWidth + 1, ellipsis: style.textOverflow === 'ellipsis', clipped: style.overflow === 'hidden' || style.overflowY === 'hidden' };
  }), 'Full inspection text must wrap and remain readable rather than clipping long content.').toEqual({ fits: true, ellipsis: false, clipped: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Requirements must not cause horizontal page overflow.').toBe(true);
  expect(await page.locator('html, body, main').evaluateAll(elements => elements.map(element => getComputedStyle(element).overflowX)), 'Page overflow must not be hidden to disguise unreadable content.').not.toContain('hidden');
}

test('requirement lists and long inspection content remain compact keyboard usable and fit 390px', async ({ page }, info) => {
  const f = fixture(info);
  const long = 'Unbroken-customer-context-'.repeat(70);
  const parent = f.requirement('Long requirement title '.padEnd(200, 'X'), f.first, { goal: long, submission: { id: 'long-submission', planHash: 'd'.repeat(64), source: { kind: 'codex', reference: 'conversation-'.repeat(60), summary: 'Full customer provenance '.repeat(50) } } });
  f.child(parent, 'Keyboard child diagnostics');
  f.record(parent, 'requirement_verify', 'blocked', null, long);
  Array.from({ length: 10 }, (_, index) => f.requirement(`Compact sibling ${index}`, f.first, { createdAt: '2026-10-19T00:00:00.000Z' }));
  try {
    await f.mount(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await chooseRequirements(page, f.first);
      await expectPage(page, f.data.requirements, 1);
      const row = list(page).getByTestId(`requirement-${parent.id}`);
      await expect(row, 'The long-title requirement must remain visible in the compact list.').toBeVisible();
      await expect(row, 'Compact rows must keep full business goals in inspection.').not.toContainText(long);
      expect((await row.boundingBox())!.height, 'Long titles must retain a compact summary row.').toBeLessThanOrEqual(width === 390 ? 220 : 150);
      await tabTo(page, opener(page, parent));
      await page.keyboard.press('Enter');
      await expect(details(page)).toBeVisible();
      await readable(page, section(page, 'Original goal').getByText(parent.goal, { exact: true }));
      await readable(page, section(page, 'Current blockers').getByText(long, { exact: true }));
      await readable(page, details(page).getByText(parent.submission!.source.reference, { exact: true }));
      const child = section(page, 'Child issues').getByRole('button', { name: 'Inspect issue Keyboard child diagnostics', exact: true });
      await tabTo(page, child);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toContainText('Complete diagnostics for Keyboard child diagnostics.');
      await page.keyboard.press('Escape');
      await expect(child).toBeFocused();
      await tabTo(page, opener(page, parent), 'Shift+Tab');
      await tabTo(page, next(page));
      await page.keyboard.press('Enter');
      await expectPage(page, f.data.requirements, 2);
      await tabTo(page, previous(page), 'Shift+Tab');
      await page.keyboard.press('Enter');
      await expectPage(page, f.data.requirements, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { f.close(); }
});

test('requirement pagination refresh preserves keyboard focus when a newer requirement shifts the focused row across a page boundary', async ({ page }, info) => {
  const f = fixture(info);
  const values = Array.from({ length: 11 }, (_, index) => f.requirement(`Page-boundary request ${index}`));
  const selected = [...values].sort((a, b) => b.id - a.id)[9];
  f.requirement('Excluded foreign page-boundary request', f.second, { createdAt: '2026-10-22T12:00:00.000Z' });
  let armed = false;
  let requested = false;
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.mount(page);
    await page.route('**/api/workbench', async route => {
      if (armed) {
        requested = true;
        await held;
      }
      await route.fulfill({ json: f.data });
    });
    await chooseRequirements(page, f.first);
    await expectPage(page, values, 1);
    await tabTo(page, opener(page, selected));
    await page.keyboard.press('Enter');
    const heading = details(page).getByRole('heading', { name: selected.title, level: 2, exact: true });
    const identity = details(page).getByTestId('requirement-identity');
    await expect(heading, 'Keyboard selection must open the tenth requirement before the background refresh.').toBeVisible();
    await expect(identity).toBeVisible();
    await expect(identity, 'The selected inspection identity must match the focused tenth row.').toHaveText(`Requirement #${selected.id}`);
    await expect(opener(page, selected), 'The tenth-row opener must own keyboard focus before it is evicted.').toBeFocused();
    armed = true;
    await expect.poll(() => requested, { timeout: 10000, message: 'Normal workbench polling must request the controlled background refresh without moving keyboard focus.' }).toBe(true);
    await expect(opener(page, selected), 'A pending background refresh must preserve the focused opener.').toBeFocused();
    const newer = f.requirement('Newer page-boundary request', f.first, { createdAt: '2026-10-21T12:00:00.000Z' });
    release();
    await expectPage(page, [...values, newer], 1);
    await expect(opener(page, selected), 'The newer requirement must move the selected tenth-row opener off page one.').toHaveCount(0);
    await expect(identity, 'Refresh must retain the exact selected requirement after its opener moves to page two.').toHaveText(`Requirement #${selected.id}`);
    await expect(identity).toBeVisible();
    const repositoryIdentity = details(page).getByTestId('requirement-repository-identity');
    await expect(repositoryIdentity).toHaveText(`Repository #${f.first.id}`);
    await expect(repositoryIdentity).toBeVisible();
    await expect(section(page, 'Original goal')).toContainText(selected.goal);
    await expect(heading, 'When background refresh removes the focused opener, keyboard focus must move to the retained selected requirement inspection heading.').toBeFocused();
    await tabTo(page, next(page), 'Shift+Tab');
    await page.keyboard.press('Enter');
    await expectPage(page, [...values, newer], 2);
    await expect(opener(page, selected), 'The selected requirement must still be available on the next page.').toHaveAttribute('aria-pressed', 'true');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    f.close();
  }
});

test('historical local requirement stays locally delivered after repository GitHub enrollment', async ({ page }, info) => {
  const f = fixture(info);
  const readOnly = observeRepositoryReads(page);
  const local = f.requirement('Historical local delivery', f.first, { status: 'done' });
  const localChild = f.child(local, 'Historical locally merged child', f.first, 'done');
  f.record(local, 'issue', 'completed', localChild.id);
  f.record(local, 'requirement_verify', 'completed');
  const currentAcceptance = section(page, 'Whole-goal acceptance').getByRole('status');
  const currentDelivery = section(page, 'Final delivery').getByRole('status');
  const accepted = /^(?:passed|verified)\.?$/i;
  const localDelivery = /^(?:local(?:-only)? (?:delivery )?(?:verified|delivered)|(?:verified|delivered) (?:locally|local(?:-only)?(?: delivery)?))\.?$/i;
  const githubDelivery = /^(?:GitHub (?:delivery )?merged|merged (?:on )?GitHub|delivered (?:on|via) GitHub)\.?$/i;
  const expectSelected = async (value: Requirement) => {
    const identity = details(page).getByTestId('requirement-identity');
    await expect(identity, 'Enrollment refresh and requirement selection must retain an independently observed exact requirement identity.').toHaveText(`Requirement #${value.id}`);
    await expect(identity).toBeVisible();
    const repositoryIdentity = details(page).getByTestId('requirement-repository-identity');
    await expect(repositoryIdentity).toHaveText(`Repository #${f.first.id}`);
    await expect(repositoryIdentity).toBeVisible();
    await expect(currentAcceptance, 'Each requirement must expose one current acceptance field independently of fixture prose and historical evidence.').toHaveCount(1);
    await expect(currentAcceptance).toBeVisible();
    await expectCurrentValue(currentAcceptance, accepted, 'Exact completed latest verification must remain passed independently of publication enrollment.');
    await expect(currentDelivery, 'Final delivery must have one independently observable current state.').toHaveCount(1);
    await expect(currentDelivery).toBeVisible();
  };
  try {
    await f.mount(page);
    await chooseRequirements(page, f.first);
    await inspect(page, local);
    await expectSelected(local);
    await expectCurrentValue(currentDelivery, localDelivery, 'A locally merged and verified requirement must be locally delivered before repository enrollment.');
    f.first.github = { repository: 'example/requirements', remote: 'origin', workflow: 'verify.yml' };
    const github = f.requirement('Requirement with its own GitHub publication', f.first, { publication: publication('awaiting_ci'), createdAt: '2026-10-21T12:00:00.000Z' });
    const githubChild = f.child(github, 'GitHub merged child');
    f.record(github, 'issue', 'completed', githubChild.id);
    f.record(github, 'requirement_verify', 'completed');
    await refresh(page);
    await expectPage(page, [local, github], 1);
    await expectSelected(local);
    await expectCurrentValue(currentDelivery, localDelivery, 'Later repository GitHub enrollment must not retroactively change a historical requirement without a publication snapshot from local verified delivery to Pending.');
    await expect(section(page, 'Publication'), 'The historical requirement must keep explicit local-only publication context.').toContainText(/local.only|local delivery|not enrolled/i);
    await inspect(page, github);
    await expectSelected(github);
    await expectCurrentValue(currentDelivery, /^awaiting[ _-]?(?:CI|checks)\.?$/i, 'A requirement with its own GitHub publication snapshot must await CI despite merged children and passed acceptance.');
    await expectCurrentValue(currentDelivery, localDelivery, 'Repository enrollment must not make every requirement locally delivered.', false);
    await expectCurrentValue(currentDelivery, githubDelivery, 'Awaiting CI must not claim recorded merged GitHub delivery.', false);
    for (const url of [github.publication!.url!, github.publication!.ciUrl!]) await expect(section(page, 'Publication').getByRole('link').and(section(page, 'Publication').locator(`a[href="${url}"]`)), 'The enrolled requirement must retain its own recorded PR and CI links.').toBeVisible();
    github.publication = publication('merged');
    await refresh(page);
    await expectSelected(github);
    await expectCurrentValue(currentDelivery, githubDelivery, 'The enrolled requirement becomes delivered only after its own publication records a merge.');
    await inspect(page, local);
    await expectSelected(local);
    await expectCurrentValue(currentDelivery, localDelivery, 'Another requirement publication must never change the historical local requirement delivery mode.');
    readOnly();
  } finally { f.close(); }
});
