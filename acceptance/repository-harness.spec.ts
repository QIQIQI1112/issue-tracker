import { expect } from '@playwright/test';
import { test } from './workspace.ts';
import { chooseRepository, chooseSubview, observeRepositoryReads, repositoryFixture, subview } from './repository-fixture.ts';
import { commitFiles, gitAt, sourceLimit } from '../tests/repository-harness-fixture.ts';

test('two enrolled repositories show their own committed harness commands cases docs and CI provenance', async ({ page }, info) => {
  const f = repositoryFixture(info);
  try {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('group', { name: 'Repositories', exact: true }), 'The sidebar must list enrolled repositories before inspecting their committed harness.').toBeVisible();
    for (const [repo, source, other] of [[f.first, f.a, f.b], [f.second, f.b, f.a]] as const) {
      await chooseRepository(page, repo); await chooseSubview(page, 'Repo harness');
      const main = page.getByRole('main');
      for (const value of [repo.name, 'main', source.commit, `${source.marker}-lint --check`, `${source.marker} required Node case`, `${source.marker} required browser case`, `${source.marker} critical Node case`, `${source.marker} critical browser case`, `${source.marker} repository instructions`, `${source.marker} verification documentation`, `${source.marker} CI`, 'package.json', 'AGENTS.md', 'docs/verification.md', 'factory/verification-contract.json', 'factory/ci-verification-contract.json', '.github/workflows/verify.yml', 'ci-critical']) await expect(main, `Harness must show actual committed ${value}.`).toContainText(value);
      await expect(main).not.toContainText(`${other.marker}-lint`);
      await expect(main).toContainText(/configur|not (?:run|executed)/i);
      await expect(main).not.toContainText(/verification (?:passed|succeeded)|all checks passed/i);
    }
  } finally { f.close(); }
  await checkApplicationHarnessExplanationUI(page, info);
});

test('harness source failures explain missing malformed oversized and unsupported configuration', async ({ page }, info) => {
  const f = repositoryFixture(info);
  commitFiles(f.a.path, { 'package.json': '{invalid', 'AGENTS.md': 'x'.repeat(sourceLimit + 1), 'factory/verification-contract.json': JSON.stringify({ ...f.a.full, schemaVersion: 88 }), 'factory/ci-verification-contract.json': JSON.stringify({ ...f.a.critical, profile: 'unsupported-profile' }) });
  try {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('group', { name: 'Repositories', exact: true }), 'The sidebar must list enrolled repositories before inspecting source failures.').toBeVisible();
    await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
    const main = page.getByRole('main');
    for (const value of ['package.json', 'AGENTS.md', 'factory/verification-contract.json', 'factory/ci-verification-contract.json', 'docs/architecture.md']) await expect(main).toContainText(value);
    for (const state of [/malformed|invalid/i, /oversiz|too large|limit/i, /unsupported/i, /missing|not found|unavailable/i]) await expect(main).toContainText(state);
    await expect(main).toContainText(`${f.a.marker} verification documentation`);
    await expect(main).not.toContainText(`${f.b.marker}-lint`);
    await chooseSubview(page, 'Issues'); await expect(page.getByTestId(`issue-${f.alpha.id}`)).toBeVisible();
    commitFiles(f.a.path, f.a.files);
    await chooseRepository(page, f.second); await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
    await expect(main).toContainText(`${f.a.marker}-lint --check`);
    await expect(main).not.toContainText('unsupported-profile');
  } finally { f.close(); }
});

test('harness loading failed reads and retry recovery do not break Issues', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const readOnly = observeRepositoryReads(page);
  let mode = 'pending'; let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.route(`**/api/repos/${f.first.id}/harness`, async route => {
      if (mode === 'pending') await gate;
      if (mode === 'failed') return route.fulfill({ status: 503, json: { error: 'Owned harness read failed' } });
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('group', { name: 'Repositories', exact: true }), 'The sidebar must list enrolled repositories before testing harness loading and recovery.').toBeVisible();
    await chooseRepository(page, f.second); await chooseSubview(page, 'Repo harness');
    await expect(page.getByRole('main')).toContainText(`${f.b.marker}-lint --check`);
    await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
    await expect(page.getByRole('main').getByRole('status')).toContainText(/load|read/i);
    await expect(page.getByRole('main'), 'A pending repository read must immediately clear the previous repository harness.').not.toContainText(`${f.b.marker}-lint`);
    await expect(subview(page, 'Issues')).toBeEnabled();
    mode = 'failed'; release();
    await expect(page.getByRole('alert')).toContainText('Owned harness read failed');
    await chooseSubview(page, 'Issues'); await expect(page.getByTestId(`issue-${f.alpha.id}`)).toBeVisible();
    await chooseSubview(page, 'Repo harness');
    const retry = page.getByRole('main').getByRole('button', { name: /retry/i });
    await expect(retry).toBeVisible(); mode = 'ready'; await retry.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toContainText(`${f.a.marker}-lint --check`);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement !== document.body), 'Read recovery must retain meaningful keyboard focus.').toBe(true);
    gitAt(f.a.path, ['checkout', '-b', 'retained-fixture']); gitAt(f.a.path, ['branch', '-D', 'main']);
    await chooseRepository(page, f.second); await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
    await expect(page.getByRole('main')).toContainText(/unavailable|not available|missing.*(?:branch|ref)/i);
    await expect(page.getByRole('main')).not.toContainText(`${f.a.marker}-lint`);
    await chooseSubview(page, 'Issues'); await expect(page.getByTestId(`issue-${f.alpha.id}`)).toBeVisible();
    gitAt(f.a.path, ['branch', 'main', f.a.commit]);
    await chooseRepository(page, f.second); await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
    await expect(page.getByRole('main')).toContainText(`${f.a.marker}-lint --check`);
    readOnly();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); f.close(); }
});

test('repository source text is escaped and harness navigation offers read actions only', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const payload = '<script>globalThis.HARNESS_INJECTED = true</script><img src=x onerror="globalThis.HARNESS_INJECTED = true">';
  commitFiles(f.a.path, { 'AGENTS.md': payload, 'package.json': JSON.stringify({ scripts: { verify: payload } }) });
  const readOnly = observeRepositoryReads(page);
  try {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('group', { name: 'Repositories', exact: true }), 'The sidebar must list enrolled repositories before inspecting escaped read-only sources.').toBeVisible();
    await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
    await expect(page.getByRole('main')).toContainText(payload);
    await expect(page.getByRole('main').locator('script, img[onerror], [onclick], form, textarea, [contenteditable="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => 'HARNESS_INJECTED' in globalThis), 'Committed repository text must never become executable markup.').toBe(false);
    await expect(page.getByRole('main').getByRole('button', { name: /^(?:run|execute|start|save|edit|delete)\b/i })).toHaveCount(0);
    await chooseSubview(page, 'Issues');
    await page.getByRole('button', { name: `View issue ${f.alpha.title}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
    await chooseRepository(page, f.second); await chooseSubview(page, 'Repo harness');
    await expect(page.getByRole('main')).not.toContainText(payload);
    readOnly();
  } finally { f.close(); }
});

async function checkApplicationHarnessExplanationUI(page: Parameters<typeof chooseRepository>[0], info: Parameters<typeof repositoryFixture>[0]) {
  const f = repositoryFixture(info);
  const files = { ...f.a.files, 'factory/verification-contract.json': JSON.stringify({ schemaVersion: 1, requiredBrowserTests: f.a.full.requiredBrowserTests }) };
  commitFiles(f.a.path, files);
  try {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('group', { name: 'Repositories', exact: true }), 'Repository navigation must exist before checking application-owned explanations.').toBeVisible();
    await chooseRepository(page, f.first); await chooseSubview(page, 'Repo harness');
    const main = page.getByRole('main');
    await expect(main).toContainText(`${f.a.marker}-lint --check`);
    await expect(main).toContainText(`${f.a.marker} critical Node case`);
    const explanation = await main.evaluate((element, sourceTexts) => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('pre, code').forEach(source => source.remove());
      const fragments = sourceTexts.flatMap(value => [value, ...value.split('\n')]).filter(value => value.trim().length > 0).sort((a, b) => b.length - a.length);
      return fragments.reduce((text, fragment) => text.replaceAll(fragment, ''), copy.textContent ?? '');
    }, Object.values(files));
    expect(explanation, 'Application UI must identify committed configuration separately from repository source displays.').toMatch(/configur/i);
    expect(explanation, 'Application UI must explain that reading configuration is not evidence of executed or passing checks.').toMatch(/(?:(?:not|no |cannot|without|unknown|unavailable|unverified).{0,120}(?:execut|run\b|pass|success|evidence)|(?:execut|run\b|pass|success|evidence).{0,120}(?:not|unknown|unavailable|unverified))/i);
    expect(explanation, 'Application UI must explain that omitted full-profile named Node requirements do not mean no Node tests.').toMatch(/(?:(?:no explicit|no named|not explicitly|unspecified|not (?:configured|specified|declared)|omitted|does not (?:declare|specify)).{0,140}(?:Node|requiredNodeTests)|(?:Node|requiredNodeTests).{0,140}(?:no explicit|no named|not explicitly|unspecified|not (?:configured|specified|declared)|omitted|does not (?:declare|specify)))/i);
    expect(explanation, 'Application UI must distinguish missing explicit names from an absence of Node tests.').toMatch(/(?:discover|(?:does not|doesn't|cannot).{0,100}(?:mean|imply|establish).{0,100}(?:no|zero|absence)|(?:Node tests|test files).{0,100}(?:may|can|could|still))/i);
  } finally { f.close(); }
}
