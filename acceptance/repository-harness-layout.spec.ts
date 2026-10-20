import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { test } from './workspace.ts';
import { chooseRepository, chooseSubview, observeRepositoryReads, repositoryButton, repositoryFixture, subview } from './repository-fixture.ts';
import { commitFiles, fixedSources, gitAt, sourceLimit } from '../tests/repository-harness-fixture.ts';
import type { RepositoryHarness } from '../src/harness.ts';

type Fixture = ReturnType<typeof repositoryFixture>;
const fullPath = 'factory/verification-contract.json';
const ciPath = 'factory/ci-verification-contract.json';
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const main = (page: Page) => page.getByRole('main');
const summary = (page: Page, path: string) => main(page).locator('details > summary').filter({ hasText: path }).first();
const disclosure = (page: Page, path: string) => summary(page, path).locator('..');
const rawDisclosure = (page: Page, path: string) => disclosure(page, path).locator('details').first();
const rawText = (page: Page, path: string) => rawDisclosure(page, path).locator('pre');

async function selectRepository(page: Page, repo: Fixture['first']) {
  await expect(repositoryButton(page, repo), 'The enrolled repository control must exist before changing inspection scope.').toBeVisible({ timeout: 2500 });
  await chooseRepository(page, repo);
}

async function enter(page: Page, f: Fixture): Promise<RepositoryHarness> {
  await page.goto('/');
  await selectRepository(page, f.first);
  await expect(subview(page, 'Repo harness'), 'Repo harness navigation must exist before opening the committed fixture.').toBeVisible({ timeout: 2500 });
  const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api/repos/${f.first.id}/harness` && value.request().method() === 'GET');
  await chooseSubview(page, 'Repo harness');
  const read = await response;
  expect(read.ok(), 'The fixture harness read must succeed before testing missing layout behavior.').toBe(true);
  const data = await read.json() as RepositoryHarness;
  expect(data.status, 'The disposable committed fixture must be available before layout assertions.').toBe('available');
  await expect(main(page).getByRole('region', { name: 'Repository harness', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(main(page), 'The successful committed read must render before layout assertions.').toContainText(data.commit!);
  return data;
}

async function generatedVisibleText(locator: Locator) {
  return locator.evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const result: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('pre')) continue;
      let hidden = false;
      for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(parent)) hidden = true;
        if (ancestor === root) break;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      if (!hidden && getComputedStyle(parent).visibility !== 'hidden' && range.getClientRects().length) result.push(node.textContent ?? '');
    }
    return result.join(' ').replace(/\s+/g, ' ').trim();
  });
}

function count(text: string, value: number, label: string, message: string) {
  expect(text, message).toMatch(new RegExp(`(?:\\b${value}\\b[^\\d]{0,35}(?:${label})|(?:${label})[^\\d]{0,35}\\b${value}\\b)`, 'i'));
}

async function expectClosed(page: Page, path: string, message: string) {
  await expect(summary(page, path), `${message}: a visible labelled pointer disclosure must exist for ${path}.`).toBeVisible({ timeout: 2500 });
  await expect(summary(page, path), `${path} disclosure must have an accessible source name.`).toHaveAccessibleName(new RegExp(escaped(path)));
  await expect(disclosure(page, path), message).toHaveJSProperty('open', false);
}

async function openSource(page: Page, path: string) {
  await expect(summary(page, path), `A visible ${path} disclosure must exist before pointer activation.`).toBeVisible({ timeout: 2500 });
  await summary(page, path).click();
  await expect(disclosure(page, path), `${path} must open after pointer activation.`).toHaveJSProperty('open', true);
}

async function openRaw(page: Page, path: string) {
  const control = rawDisclosure(page, path).locator(':scope > summary');
  await expect(control, `${path} must offer a separate labelled raw committed-source disclosure.`).toBeVisible({ timeout: 2500 });
  await expect(control).toHaveAccessibleName(/committed|raw|source text/i);
  await expect(rawDisclosure(page, path), 'Opening a source must leave its raw text independently collapsed.').toHaveJSProperty('open', false);
  await control.click();
  await expect(rawDisclosure(page, path)).toHaveJSProperty('open', true);
}

function largeSources(f: Fixture) {
  const node = Array.from({ length: 31 }, (_, index) => ({ file: `tests/layout-${index}.test.ts`, title: `${f.a.marker} Node identity ${index} ${'unbroken-case-'.repeat(index === 30 ? 45 : 1)}` }));
  const browser = Array.from({ length: 37 }, (_, index) => ({ file: `layout-${index}.spec.ts`, title: `${f.a.marker} browser identity ${index} ${'unbroken-browser-'.repeat(index === 36 ? 45 : 1)}` }));
  const command = `${f.a.marker}-verify-${'unbroken-command-'.repeat(110)}`;
  const full = { ...f.a.full, requiredNodeTests: node, requiredBrowserTests: browser };
  const critical = { ...f.a.critical, nodeFiles: ['tests/layout-0.test.ts', 'tests/layout-30.test.ts'], requiredNodeTests: [node[0], node[30]], requiredBrowserTests: [browser[0], browser[18], browser[36]] };
  const files: Record<string, string> = { ...f.a.files, ...Object.fromEntries(fixedSources.filter(path => !(path in f.a.files)).map(path => [path, `${f.a.marker} complete ${path}\n`])), 'package.json': JSON.stringify({ scripts: { verify: command, 'verify:ci': `${f.a.marker}-critical`, test: `${f.a.marker}-node`, lint: `${f.a.marker}-lint`, typecheck: `${f.a.marker}-types`, build: `${f.a.marker}-build`, 'test:e2e': `${f.a.marker}-browser`, format: `${f.a.marker}-format` } }), [fullPath]: JSON.stringify(full), [ciPath]: JSON.stringify(critical), 'AGENTS.md': `${f.a.marker} instructions begin\n${'Long documentation with <literal> markup and Unicode é.\n'.repeat(180)}${f.a.marker} instructions final\n`, 'README.md': '' };
  const commit = commitFiles(f.a.path, files);
  return { files, full, critical, command, commit };
}

test('compact harness overview derives counts and categories from supplied committed configuration', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const large = largeSources(f);
  const bCommit = commitFiles(f.b.path, { 'package.json': '{"scripts":{}}', [fullPath]: JSON.stringify({ schemaVersion: 1, requiredNodeTests: [], requiredBrowserTests: [] }), [ciPath]: JSON.stringify({ schemaVersion: 1, profile: 'ci-critical', nodeFiles: [], requiredNodeTests: [], requiredBrowserTests: [] }) });
  try {
    const data = await enter(page, f);
    const overview = main(page).getByRole('heading', { name: /overview|committed configuration/i }).locator('..');
    for (const value of [f.first.name, 'main', large.commit]) expect(await generatedVisibleText(overview), 'Selected repository, enrolled branch and actual commit must be immediately readable.').toContain(value);
    expect(await generatedVisibleText(overview), 'The selected repository ID must be immediately readable despite DOM text-node boundaries.').toMatch(new RegExp(`#\\s*${f.first.id}\\b`));
    const visible = await generatedVisibleText(main(page));
    expect(visible, 'The compact overview must explain configured checks are not execution or pass evidence.').toMatch(/configur/i);
    expect(visible, 'The compact overview must explicitly distinguish configuration from execution evidence.').toMatch(/not.{0,90}(?:execution|executed|run|pass|result)/i);
    count(await generatedVisibleText(overview), data.sources.length, 'sources?', 'Overview source counts must derive from the supplied source inventory.');
    for (const [path, nodes, browsers] of [[fullPath, 31, 37], [ciPath, 2, 3]] as const) {
      await expectClosed(page, path, 'Compact profile counts must be readable without opening cases.');
      const text = await summary(page, path).innerText();
      count(text, nodes, '(?:named[^\\d]{0,15})?Node', `${path} must report its own configured named Node count.`);
      count(text, browsers, '(?:named[^\\d]{0,15})?browser', `${path} must report its own configured named browser count.`);
    }
    count(await summary(page, 'package.json').innerText(), 8, 'commands?|scripts?', 'The package summary must count actual configured commands.');
    count(await summary(page, ciPath).innerText(), 2, 'Node files?', 'CI summary must preserve its configured Node file count.');
    for (const category of ['Full verification entry point', 'CI verification entry point', 'Lint', 'Type checking', 'Node tests', 'Build', 'Browser acceptance', 'Package script']) expect(visible, `Compact command categories must include actual supplied category ${category}.`).toContain(category);
    await selectRepository(page, f.second);
    await expect(main(page)).toContainText(bCommit);
    await expectClosed(page, 'package.json', 'A different empty configuration must also start compact.');
    count(await summary(page, 'package.json').innerText(), 0, 'commands?|scripts?', 'An empty package must report zero configured commands, not the previous repository count.');
    for (const path of [fullPath, ciPath]) {
      count(await summary(page, path).innerText(), 0, '(?:named[^\\d]{0,15})?Node', 'Empty profile summaries must report zero named requirements.');
      count(await summary(page, path).innerText(), 0, '(?:named[^\\d]{0,15})?browser', 'Empty browser requirement counts must derive from the current profile.');
    }
    await expect(main(page)).not.toContainText(large.command);
  } finally { f.close(); }
});

test('compact overview does not equate omitted named Node requirements with zero discovered tests', async ({ page }, info) => {
  const f = repositoryFixture(info);
  commitFiles(f.a.path, { [fullPath]: JSON.stringify({ schemaVersion: 1, requiredBrowserTests: f.a.full.requiredBrowserTests }), 'README.md': 'SOURCE_ONLY_DECOY: 0 discovered Node tests; all checks passed.' });
  try {
    await enter(page, f);
    await expectClosed(page, fullPath, 'Omitted Node names must be explained in the closed overview.');
    const visible = await generatedVisibleText(main(page));
    expect(visible, 'Application summaries must explain omitted named Node requirements independently of raw fixture text.').toMatch(/(?:no explicit|omitted|unspecified|not (?:declared|configured)).{0,90}(?:Node|named)|(?:Node|named).{0,90}(?:omitted|unspecified|no explicit|not (?:declared|configured))/i);
    expect(visible, 'The initially compact view must explain that Node discovery is unknown or may still occur.').toMatch(/discover.{0,100}(?:unknown|runner|may|still)|(?:may|still|unknown).{0,100}discover/i);
    expect(visible, 'Zero named requirements must never be labelled zero discovered Node tests.').not.toMatch(/(?:0|zero|no)\s+(?:discovered\s+)?Node tests|all checks passed/i);
    await openSource(page, fullPath);
    await expect(disclosure(page, fullPath)).toContainText('Node test files may still be discovered by the runner');
    await expect(rawDisclosure(page, fullPath)).toHaveJSProperty('open', false);
  } finally { f.close(); }
});

test('large harness sources and case lists are collapsed on initial entry', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const large = largeSources(f);
  try {
    const data = await enter(page, f);
    for (const name of ['Configuration and check manifests', 'Workflow and documentation']) await expect(main(page).getByRole('heading', { name, exact: true }), 'Compact source groups must have scannable category headings.').toBeVisible({ timeout: 2500 });
    for (const source of data.sources) {
      await expectClosed(page, source.path, 'All lengthy source bodies must be collapsed on initial entry.');
      if (source.content !== undefined) for (const body of await disclosure(page, source.path).locator('pre, li').all()) await expect(body, 'Commands, required-case lists and committed text must not expand the initial page.').toBeHidden();
    }
    for (const value of [large.command, large.full.requiredNodeTests.at(-1)!.title, large.full.requiredBrowserTests.at(-1)!.title, `${f.a.marker} instructions final`]) {
      await expect(main(page), 'All supplied content must remain inspectable in the DOM while visually collapsed.').toContainText(value);
      expect(await generatedVisibleText(main(page)), 'Commands, case identities and long document prose must not be visible initially.').not.toContain(value);
    }
  } finally { f.close(); }
});

test('source disclosures toggle independently and keep committed raw text collapsed', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const large = largeSources(f);
  try {
    await enter(page, f);
    for (const path of ['package.json', fullPath, ciPath, 'AGENTS.md']) await expectClosed(page, path, 'Sources must start independently collapsed.');
    await openSource(page, fullPath);
    for (const item of [...large.full.requiredNodeTests, ...large.full.requiredBrowserTests]) await expect(disclosure(page, fullPath).getByText(item.title).filter({ visible: true }), 'Opening the full profile must reveal each named requirement outside raw JSON.').toBeVisible();
    await expect(rawDisclosure(page, fullPath), 'Opening a profile must not also dump its raw JSON.').toHaveJSProperty('open', false);
    await expect(disclosure(page, fullPath).locator('pre')).toBeHidden();
    await openSource(page, 'package.json');
    await expect(disclosure(page, 'package.json').getByText(large.command, { exact: true })).toBeVisible();
    await expect(disclosure(page, fullPath), 'Opening package scripts must leave the full profile open.').toHaveJSProperty('open', true);
    await expectClosed(page, ciPath, 'Unrelated CI source must remain collapsed.');
    await expectClosed(page, 'AGENTS.md', 'Unrelated document must remain collapsed.');
    await openRaw(page, fullPath);
    await expect(rawText(page, fullPath)).toHaveText(large.files[fullPath]);
    await expect(summary(page, 'package.json'), 'The package pointer must remain available before closing only that source.').toBeVisible({ timeout: 2500 });
    await summary(page, 'package.json').click();
    await expect(disclosure(page, 'package.json')).toHaveJSProperty('open', false);
    await expect(disclosure(page, fullPath), 'Closing package scripts must preserve another expanded profile.').toHaveJSProperty('open', true);
    await expect(rawDisclosure(page, fullPath), 'Closing another source must preserve independently opened raw text.').toHaveJSProperty('open', true);
    const rawControl = rawDisclosure(page, fullPath).locator(':scope > summary');
    await expect(rawControl, 'The raw-source pointer must remain visible before closing.').toBeVisible({ timeout: 2500 });
    await rawControl.click();
    await expect(rawDisclosure(page, fullPath)).toHaveJSProperty('open', false);
    await expect(disclosure(page, fullPath)).toHaveJSProperty('open', true);
  } finally { f.close(); }
});

test('expanded harness sources preserve exact content provenance and escaped read-only inspection', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const large = largeSources(f);
  const hostile = '<script>globalThis.LAYOUT_INJECTED = true</script><img src=x onerror="globalThis.LAYOUT_INJECTED = true">';
  const files: Record<string, string> = { ...large.files, 'AGENTS.md': `${hostile}\n${large.files['AGENTS.md']}` };
  const commit = commitFiles(f.a.path, files);
  const readOnly = observeRepositoryReads(page);
  try {
    const data = await enter(page, f);
    for (const source of data.sources) {
      expect(source.status, 'Complete committed fixture sources must be available before content inspection.').toBe('available');
      await openSource(page, source.path);
      const card = disclosure(page, source.path);
      for (const value of [source.path, commit, gitAt(f.a.path, ['rev-parse', `${commit}:${source.path}`]), `${Buffer.byteLength(files[source.path])}`]) expect(await generatedVisibleText(card), `${source.path} must show exact committed path, commit, blob and UTF-8 byte provenance outside raw text.`).toContain(value);
      for (const command of source.commands ?? []) {
        for (const value of [command.name, command.category]) expect(await generatedVisibleText(card), 'Every supplied script name and category must be visibly rendered outside raw JSON.').toContain(value);
        await expect(card.getByText(command.command, { exact: true }).filter({ visible: true }), 'Every configured command value must be visible before raw JSON opens.').toBeVisible();
      }
      if (source.profile) {
        expect(await generatedVisibleText(card), 'The profile explanation must be application metadata outside the raw JSON.').toContain(source.profile.explanation);
        for (const file of source.profile.nodeFiles ?? []) await expect(card.getByText(file, { exact: true }).first(), 'Configured Node files must be visible before raw text opens.').toBeVisible();
        for (const item of [...source.profile.requiredNodeTests, ...source.profile.requiredBrowserTests]) {
          await expect(card.getByText(item.title).filter({ visible: true }), 'Every full and CI case title, including final long entries, must be visible independently of raw JSON.').toBeVisible();
          await expect(card.getByText(item.file, { exact: true }).first(), 'Case file identities must remain visible beside titles.').toBeVisible();
        }
      }
      await openRaw(page, source.path);
      const text = rawText(page, source.path);
      await expect(text, 'Committed raw source must become visible after its secondary disclosure opens.').toBeVisible();
      expect(await text.textContent(), 'Raw source must preserve exact Unicode, whitespace and full supplied text, including final lines.').toBe(files[source.path] || '(Empty committed file)');
    }
    await expect(main(page).locator('script, img[onerror], [onclick], form, textarea, [contenteditable="true"]'), 'Inspection must render hostile source as plain text without mutation controls.').toHaveCount(0);
    expect(await page.evaluate(() => 'LAYOUT_INJECTED' in globalThis), 'Opening committed source must never execute markup.').toBe(false);
    await expect(main(page).getByRole('button', { name: /^(?:run|execute|start|save|edit|delete)\b/i })).toHaveCount(0);
    for (const path of fixedSources) {
      await expect(summary(page, path), 'An open source must retain its pointer control before closing.').toBeVisible({ timeout: 2500 });
      await summary(page, path).click();
    }
    readOnly();
  } finally { f.close(); }
});

test('collapsed source summaries distinguish availability failures alongside valid sources', async ({ page }, info) => {
  const f = repositoryFixture(info);
  const rejected = 'REJECTED_CONFIGURATION_MUST_NOT_BE_ADMITTED';
  const allowed = 'EXACT_LIMIT_VALID_SOURCE';
  const exact = allowed + 'é'.repeat(Math.floor((sourceLimit - allowed.length) / 2)) + ' '.repeat((sourceLimit - allowed.length) % 2);
  commitFiles(f.a.path, { 'package.json': JSON.stringify({ scripts: { verify: rejected, invalid: 42 } }), [fullPath]: JSON.stringify({ ...f.a.full, schemaVersion: 88, requiredNodeTests: [{ file: 'tests/rejected.test.ts', title: rejected }] }), 'AGENTS.md': `${rejected}${'x'.repeat(sourceLimit)}`, 'README.md': Buffer.from([0xff, 0xfe, 0xff]), 'docs/verification.md': exact });
  try {
    const data = await enter(page, f);
    for (const [path, status] of [['package.json', 'malformed'], [fullPath, 'unsupported'], ['AGENTS.md', 'oversized'], ['README.md', 'unreadable'], ['docs/architecture.md', 'missing']] as const) {
      await expectClosed(page, path, 'Unavailable source status must be visible without expanding cards.');
      await expect(summary(page, path), `${path} must visibly identify its distinct ${status} state.`).toContainText(new RegExp(status, 'i'));
      const source = data.sources.find(value => value.path === path)!;
      await expect(summary(page, path), 'Closed unavailable summaries must preserve the supplied useful diagnostic.').toContainText(source.message);
      await openSource(page, path);
      await expect(disclosure(page, path).locator('pre'), 'Rejected sources must admit neither raw payloads nor parsed commands/cases.').toHaveCount(0);
      await expect(summary(page, path)).toBeVisible({ timeout: 2500 });
      await summary(page, path).click();
    }
    await expect(main(page), 'Rejected malformed, unsupported and oversized content must never be admitted anywhere in the view.').not.toContainText(rejected);
    await openSource(page, ciPath);
    await expect(disclosure(page, ciPath).getByText(f.a.critical.requiredNodeTests[0].title).filter({ visible: true }), 'Valid profiles must remain inspectable beside failed sources.').toBeVisible();
    await openSource(page, 'docs/verification.md');
    await openRaw(page, 'docs/verification.md');
    expect(Buffer.byteLength(exact)).toBe(sourceLimit);
    expect(await rawText(page, 'docs/verification.md').textContent(), 'A source at the exact valid byte limit must remain completely inspectable beside oversized rejections.').toBe(exact);
  } finally { f.close(); }
});

test('repository changes reset source and raw disclosures without obsolete content', async ({ page }, info) => {
  const f = repositoryFixture(info);
  try {
    await enter(page, f);
    await openSource(page, fullPath);
    await openRaw(page, fullPath);
    await openSource(page, 'AGENTS.md');
    await openRaw(page, 'AGENTS.md');
    await selectRepository(page, f.second);
    await expect(main(page), 'Switching while A source and raw state remain open must replace the committed snapshot.').toContainText(f.b.commit);
    await expect(main(page), 'Obsolete A content must be removed from visible and hidden source bodies.').not.toContainText(f.a.marker);
    for (const path of [fullPath, 'AGENTS.md', 'package.json']) await expectClosed(page, path, 'Repository B must start collapsed despite active A disclosures.');
    await openSource(page, fullPath);
    await expect(rawDisclosure(page, fullPath), 'B must not inherit A raw-source expansion.').toHaveJSProperty('open', false);
    await openRaw(page, fullPath);
    await selectRepository(page, f.first);
    await expect(main(page)).toContainText(f.a.commit);
    await expect(main(page)).not.toContainText(f.b.marker);
    for (const path of [fullPath, 'AGENTS.md', 'package.json']) await expectClosed(page, path, 'Returning to A must start compact rather than restoring obsolete expansion.');
    await openSource(page, fullPath);
    await expect(rawDisclosure(page, fullPath), 'Returning to A must reset its former raw-source state.').toHaveJSProperty('open', false);
  } finally { f.close(); }
});

async function reachByTab(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab') {
  await expect(target, 'The intended disclosure or read control must exist before normal keyboard traversal.').toBeVisible({ timeout: 2500 });
  for (let step = 0; step < 90; step++) {
    await page.keyboard.press(key);
    if (await target.evaluate(element => document.activeElement === element)) return;
  }
  await expect(target, `The named harness control must be reachable within 90 normal ${key} presses without programmatic focus.`).toBeFocused();
}

async function expectFocusIndicator(control: Locator) {
  await expect(control, 'Toggling must retain meaningful focus on its source summary.').toBeFocused();
  expect(await control.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible') && ((style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.outlineColor)) || style.boxShadow !== 'none');
  }), 'Keyboard-focused source controls must have a visible focus indicator.').toBe(true);
}

test('harness disclosures support keyboard focus and fit desktop and 390px widths', async ({ page }, info) => {
  const f = repositoryFixture(info);
  largeSources(f);
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await enter(page, f);
      await expectClosed(page, 'package.json', 'Keyboard inspection must begin from compact sources at each viewport.');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Closed summaries must fit the ${width}px document.`).toBe(true);
      const control = summary(page, 'package.json');
      await reachByTab(page, control, 'Tab');
      await expectFocusIndicator(control);
      await page.keyboard.press('Enter');
      await expect(disclosure(page, 'package.json'), 'Enter must open the focused source disclosure.').toHaveJSProperty('open', true);
      await expectFocusIndicator(control);
      const rawControl = rawDisclosure(page, 'package.json').locator(':scope > summary');
      await reachByTab(page, rawControl, 'Tab');
      await expectFocusIndicator(rawControl);
      await page.keyboard.press('Space');
      await expect(rawDisclosure(page, 'package.json'), 'Space must open the focused secondary disclosure.').toHaveJSProperty('open', true);
      await expectFocusIndicator(rawControl);
      await reachByTab(page, control, 'Shift+Tab');
      await page.keyboard.press('Space');
      await expect(disclosure(page, 'package.json'), 'Space must close the focused outer source.').toHaveJSProperty('open', false);
      await expectFocusIndicator(control);
      await page.keyboard.press('Enter');
      await expect(disclosure(page, 'package.json')).toHaveJSProperty('open', true);
      for (const path of [fullPath, ciPath, 'AGENTS.md']) {
        await openSource(page, path);
        await openRaw(page, path);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Expanded commands, long case names and raw documents must fit the ${width}px document.`).toBe(true);
      const refresh = main(page).getByRole('button', { name: 'Refresh harness', exact: true });
      await reachByTab(page, refresh, 'Shift+Tab');
      await expectFocusIndicator(refresh);
      const read = page.waitForResponse(response => new URL(response.url()).pathname === `/api/repos/${f.first.id}/harness`);
      await page.keyboard.press('Enter');
      expect((await read).ok(), 'The keyboard read refresh must succeed.').toBe(true);
      await expect(main(page).getByRole('region', { name: 'Repository harness', exact: true })).toHaveAttribute('aria-busy', 'false');
      await expect(refresh, 'A completed read refresh must retain focus on the meaningful read control.').toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `A refreshed harness must still fit ${width}px.`).toBe(true);
    }
  } finally { f.close(); }
});
