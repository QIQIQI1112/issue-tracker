import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { test } from './workspace.ts';
import { repositoryButton, repositoryFixture, observeRepositoryReads } from './repository-fixture.ts';
import { withThemeControl } from './theme-observation.ts';
import type { Issue } from '../src/domain.ts';

const trigger = (page: Page) => page.getByRole('button', { name: 'User menu', exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'User menu', exact: true });
const appearance = (page: Page) => menu(page).getByRole('switch', { name: /dark (?:mode|theme)/i }).or(menu(page).getByRole('menuitemcheckbox', { name: /dark (?:mode|theme)/i }));
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Workspace views', exact: true });
const rail = (page: Page) => page.getByRole('complementary').filter({ has: navigation(page) });
const expand = (page: Page) => page.getByRole('button', { name: /expand.*(?:rail|sidebar|navigation)/i });
const collapse = (page: Page) => page.getByRole('button', { name: /collapse.*(?:rail|sidebar|navigation)/i });
const view = (page: Page, name: string) => navigation(page).getByRole('button', { name, exact: true }).or(navigation(page).getByRole('link', { name, exact: true }));

async function ready(control: Locator, reason: string) {
  await expect(control, reason).toBeVisible({ timeout: 3000 });
  await expect(control, reason).toBeEnabled();
}

async function click(control: Locator, reason = 'The planned shell or browsing control must exist before activation.') {
  await ready(control, reason);
  await control.click();
}

async function reach(page: Page, control: Locator, key: 'Tab' | 'Shift+Tab') {
  await ready(control, 'The keyboard destination must exist before normal traversal.');
  for (let step = 0; step < 100; step++) {
    if (await control.evaluate(element => document.activeElement === element)) break;
    await page.keyboard.press(key);
    if (!await control.isVisible()) break;
  }
  await expect(control, `Ordinary ${key} traversal must reach the actual control.`).toBeFocused({ timeout: 3000 });
  await expect(control, 'Keyboard traversal must reveal the focused control.').toBeInViewport();
}

async function fits(page: Page, controls: Locator[]) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The document must have no horizontal overflow at the selected width.').toBe(true);
  for (const control of controls) {
    await expect(control, 'Workspace and popup controls must remain visible.').toBeVisible({ timeout: 3000 });
    await control.scrollIntoViewIfNeeded();
    await expect(control, 'Scrolling must reveal the control.').toBeInViewport();
    expect(await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    }), 'The control must fit without clipped content or horizontal viewport escape.').toBe(true);
  }
}

async function completeLabel(label: Locator) {
  await expect(label, 'The complete repository label must be visible within the viewport and all clipping ancestors after focus or hover.').toBeInViewport({ ratio: 1, timeout: 3000 });
}

async function box(control: Locator, reason: string) {
  await expect(control, reason).toBeVisible({ timeout: 3000 });
  const result = await control.boundingBox();
  expect(result, reason).not.toBeNull();
  return result!;
}

function near(actual: number, expected: number, reason: string) {
  expect(Math.abs(actual - expected), reason).toBeLessThanOrEqual(1);
}

async function seed(page: Page) {
  await page.addInitScript(() => localStorage.setItem('loop.theme', 'light'));
}

function fixture(info: TestInfo) {
  const f = repositoryFixture(info);
  const requirements = Array.from({ length: 12 }, (_, index) => f.store.work.addRequirement({ repoId: f.first.id, title: `Rail requirement ${index}`, goal: `Preserve selected rail inspection ${index}.` }));
  const matches: Issue[] = [];
  for (let index = 0; index < 23; index++) {
    const issue = f.store.create({ title: `Rail record ${String((index * 7) % 23).padStart(2, '0')}`, description: 'Retain filtered browsing across rail toggles.', status: 'open', priority: 'medium', labels: ['rail-owned'], work: { repoId: f.first.id, requirementId: requirements[0].id, dependsOn: [], acceptance: ['Preserve shell browsing state.'] } });
    matches.push(issue); f.issues.push(issue);
  }
  for (const [title, repo, status, label] of [
    ['Rail record wrong repository', f.second, 'open', 'rail-owned'],
    ['Rail record wrong status', f.first, 'done', 'rail-owned'],
    ['Rail record wrong label', f.first, 'open', 'excluded'],
    ['Excluded search record', f.first, 'open', 'rail-owned'],
  ] as const) f.issues.push(f.store.create({ title, description: '', status, priority: 'low', labels: [label], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Exclude confounding browsing records.'] } }));
  matches.sort((a, b) => a.title.localeCompare(b.title));
  return { ...f, matches, requirements, close: () => {
    for (const issue of f.issues) f.store.delete(issue.id);
    const database = new DatabaseSync(f.store.path);
    try { database.prepare('DELETE FROM requirements WHERE repo_id=?').run(f.first.id); }
    finally { database.close(); f.close(); }
  } };
}

test('literal UTG shell geometry and typography remain correct in light and dark at desktop and 390px', async ({ page }, info) => {
  test.setTimeout(90000);
  const f = repositoryFixture(info);
  try {
    await seed(page);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/');
      for (const mode of ['light', 'dark'] as const) {
        await withThemeControl(page, async control => {
          if (await control.getAttribute('aria-checked') !== String(mode === 'dark')) await click(control);
        });
        const topbar = page.getByRole('banner');
        const top = await box(topbar, 'The global topbar must span the viewport above both rail and frame.');
        near(top.x, 0, 'Topbar starts at the left viewport edge.');
        near(top.y, 0, 'Topbar starts at the top viewport edge.');
        near(top.width, width, 'Topbar spans the complete viewport width.');
        near(top.height, 60, 'The pinned topbar is 60px high.');
        const brand = topbar.getByText('Loop', { exact: true });
        const brandBox = await box(brand, 'Loop identity belongs in the upper-left global topbar.');
        expect(brandBox.x, 'Loop identity remains at the left of the global bar.').toBeLessThan(80);
        const r = await box(rail(page), 'The collapsed tool rail must remain beside the frame.');
        near(r.x, 0, 'Rail starts at the left viewport edge.');
        near(r.y, 60, 'Rail starts below the global bar.');
        near(r.width, 60, 'The default rail is 60px at desktop and 390px.');
        near(r.height, 660, 'Rail fills the height below the bar.');
        const main = page.getByRole('main');
        const frame = await box(main, 'The central main frame must be visible.');
        near(frame.x, 60, 'Frame begins beside the rail.');
        near(frame.y, 60, 'Frame begins below the global bar.');
        near(width - frame.x - frame.width, 8, 'Frame retains the 8px right inset.');
        near(720 - frame.y - frame.height, 8, 'Frame retains the 8px bottom inset.');
        await expect(main, 'The frame must clip to the pinned 20px corners.').toHaveCSS('border-top-left-radius', '20px');
        const edge = await main.evaluate(element => {
          const style = getComputedStyle(element);
          return { width: parseFloat(style.borderTopWidth), color: style.borderTopColor, shadow: style.boxShadow, clipping: ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) && ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) };
        });
        expect(edge.width, 'The frame must retain a visible rasterized .5px hairline.').toBeGreaterThan(0);
        expect(edge.width, 'The hairline may round to one device pixel.').toBeLessThanOrEqual(1);
        expect(edge.color, 'The frame uses the pinned ten-percent ink hairline.').toBe(mode === 'light' ? 'rgba(11, 11, 11, 0.1)' : 'rgba(255, 255, 255, 0.1)');
        expect(edge.shadow, 'The central frame has no raised-card shadow.').toBe('none');
        expect(edge.clipping, 'The central frame clips its rounded corners.').toBe(true);
        await expect(main).toHaveCSS('background-color', mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(21, 21, 21)');
        await expect(rail(page)).toHaveCSS('background-color', mode === 'light' ? 'rgb(252, 252, 251)' : 'rgb(17, 17, 17)');
        await click(repositoryButton(page, f.first));
        await click(view(page, 'Repo harness'));
        const heading = main.getByRole('heading', { level: 1, name: 'Repo harness', exact: true });
        await expect(heading).toHaveCSS('font-size', '22px');
        await expect(heading, 'The literal title uses weight 500.').toHaveCSS('font-weight', '500');
        await expect(heading).toHaveCSS('line-height', '28px');
        const scroll = await heading.evaluate(element => {
          const main = element.closest('main');
          for (let node = element.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (['auto', 'scroll'].includes(style.overflowY)) {
              return { padding: parseFloat(style.paddingLeft), bounded: node.getBoundingClientRect().bottom <= innerHeight, documentScroll: document.scrollingElement!.scrollHeight <= innerHeight + 1 };
            }
            if (node === main) break;
          }
          return null;
        });
        expect(scroll, 'Workspace content must own an internal scroll container.').not.toBeNull();
        expect(scroll?.padding, 'Internal content uses 24px desktop and 16px narrow padding.').toBe(width === 1280 ? 24 : 16);
        expect(scroll?.bounded, 'Internal content stays within the viewport frame.').toBe(true);
        expect(scroll?.documentScroll, 'Production scrolling belongs inside the frame.').toBe(true);
        await expect(page.getByRole('region', { name: 'Repository harness', exact: true })).toHaveAttribute('aria-busy', 'false');
        const source = page.locator('details.harness-source').filter({ has: page.locator('.harness-source-path', { hasText: /^package\.json$/ }) });
        await expect(source, 'Real package harness content must exist before testing internal scrolling.').toBeVisible({ timeout: 3000 });
        if (!await source.evaluate(element => (element as HTMLDetailsElement).open)) await click(source.locator('summary').first());
        const internalScroll = await source.evaluate(element => {
          for (let node = element.parentElement; node; node = node.parentElement) {
            if (!['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) continue;
            node.scrollTop = 0;
            node.scrollTop = node.scrollHeight;
            const moved = node.scrollTop > 0;
            node.scrollTop = 0;
            return moved;
          }
          return false;
        });
        expect(internalScroll, 'Real expanded harness content must scroll inside the frame.').toBe(true);
        await info.attach(`${mode}-${width}-literal-shell`, { body: await page.screenshot(), contentType: 'image/png' });
        const avatar = await box(trigger(page), 'The upper-right local User menu entry must be visible.');
        near(avatar.width, 32, 'Neutral user entry is 32px wide.');
        near(avatar.height, 32, 'Neutral user entry is 32px high.');
        near(avatar.x, width - 44, 'User entry retains the 12px right inset.');
        near(avatar.y, 14, 'User entry is centered in the 60px bar.');
        expect(await trigger(page).evaluate(element => parseFloat(getComputedStyle(element).borderRadius)), 'The local user entry must be circular.').toBeGreaterThanOrEqual(16);
        const avatarStyle = await trigger(page).evaluate(element => {
          const face = [element, ...element.querySelectorAll('*')].find(node => {
            const rect = node.getBoundingClientRect();
            return Math.abs(rect.width - 32) <= 1 && Math.abs(rect.height - 32) <= 1 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(node).backgroundColor);
          });
          if (!face) return null;
          const style = getComputedStyle(face);
          return { background: style.backgroundColor, color: style.color, size: style.fontSize, weight: style.fontWeight };
        });
        expect(avatarStyle, 'The local avatar uses a neutral fill and normal 14px text.').toEqual({ background: mode === 'light' ? 'rgb(237, 236, 232)' : 'rgb(44, 44, 42)', color: mode === 'light' ? 'rgb(11, 11, 11)' : 'rgb(249, 249, 247)', size: '14px', weight: '400' });
        await click(trigger(page));
        const popup = await box(menu(page), 'User menu must render a bottom-end anchored popup.');
        near(popup.width, 232, 'Appearance popup uses the pinned 232px width.');
        near(popup.x + popup.width, avatar.x + avatar.width, 'Popup aligns to the end of its user entry.');
        near(popup.y, avatar.y + avatar.height + 8, 'Popup opens below the avatar with the pinned gap.');
        await expect(menu(page)).toHaveCSS('border-radius', '14px');
        await expect(menu(page)).toHaveCSS('padding-top', '8px');
        await expect(menu(page)).toHaveCSS('background-color', mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 26, 25)');
        await expect(menu(page), 'The appearance popup must have visible elevation.').not.toHaveCSS('box-shadow', 'none');
        await fits(page, [trigger(page), menu(page), appearance(page)]);
        await info.attach(`${mode}-${width}-user-popup`, { body: await page.screenshot(), contentType: 'image/png' });
        await page.keyboard.press('Escape');
        await expect(menu(page)).toBeHidden();
      }
    }
  } finally { await page.goto('about:blank'); f.close(); }
});

test('User menu exposes only appearance selection with pointer keyboard dismissal and focus handling in app and preview', async ({ page }, info) => {
  test.setTimeout(90000);
  const mutations: string[] = [];
  const previewReads: string[] = [];
  let inPreview = false;
  page.on('request', request => {
    if (!/^\/api(?:\/|$)/.test(new URL(request.url()).pathname)) return;
    if (inPreview) previewReads.push(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await seed(page);
  for (const path of ['/', '/__ui/components']) {
    for (const width of [1280, 390]) {
      inPreview = path !== '/';
      await page.setViewportSize({ width, height: 720 });
      await page.goto(path);
      await ready(trigger(page), 'Appearance switching requires an accessible User menu entry.');
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(menu(page), 'The user popup must initially be closed.').toBeHidden();
      await expect(page.getByRole('switch', { name: /dark (?:mode|theme)/i }).or(page.getByRole('menuitemcheckbox', { name: /dark (?:mode|theme)/i })), 'The closed popup must leave no visible standalone appearance control in either supported role.').toHaveCount(0);
      await click(trigger(page));
      await expect(menu(page), 'Pointer activation must open the appearance popup.').toBeVisible();
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
      await ready(appearance(page), 'The popup must expose the existing light/dark choice.');
      await expect(appearance(page)).toHaveAttribute('aria-checked', 'false');
      await expect(menu(page).getByRole('button').or(menu(page).getByRole('switch')).or(menu(page).getByRole('menuitemcheckbox')).or(menu(page).getByRole('menuitem')).or(menu(page).getByRole('link')).or(menu(page).getByRole('menuitemradio')), 'Only one light/dark action belongs in the local user popup.').toHaveCount(1);
      await expect(menu(page), 'Account, authentication and system-theme options are outside this menu.').not.toContainText(/sign\s*(?:in|out)|log\s*(?:in|out)|account|settings|system/i);
      await click(appearance(page));
      await expect(page.locator('html'), 'Pointer selection must change the effective rendered theme.').toHaveCSS('color-scheme', 'dark');
      if (!await menu(page).isVisible()) await click(trigger(page));
      await expect(appearance(page), 'Reopened appearance state must reflect the active dark theme.').toHaveAttribute('aria-checked', 'true');
      await reach(page, appearance(page), 'Tab');
      await expect(appearance(page), 'Escape must start from the focused appearance action rather than the user entry.').toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu(page), 'Escape must dismiss the active popup.').toBeHidden();
      await expect(trigger(page), 'Escape must return focus to the exact user entry.').toBeFocused();
      await page.keyboard.press('Tab');
      await expect(trigger(page), 'Tab must leave the closed user entry.').not.toBeFocused();
      await reach(page, trigger(page), 'Shift+Tab');
      await page.keyboard.press('Enter');
      await expect(menu(page), 'Keyboard Enter must open the popup.').toBeVisible();
      await ready(appearance(page), 'Appearance action must exist before keyboard traversal.');
      await reach(page, appearance(page), 'Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      await expect(menu(page), 'Tab dismissal or Escape must close the first keyboard path before reopening.').toBeHidden();
      await reach(page, trigger(page), 'Shift+Tab');
      await page.keyboard.press('Space');
      await expect(menu(page), 'The independent reverse keyboard path must reopen the popup.').toBeVisible();
      await reach(page, appearance(page), 'Shift+Tab');
      await page.keyboard.press('Space');
      await expect(page.locator('html'), 'Keyboard activation must apply light mode.').toHaveCSS('color-scheme', 'light');
      if (!await menu(page).isVisible()) await click(trigger(page));
      await expect(appearance(page)).toHaveAttribute('aria-checked', 'false');
      const outside = path === '/' ? page.getByLabel('Search issues', { exact: true }) : page.getByRole('button', { name: 'Preview action', exact: true });
      await fits(page, [trigger(page), menu(page), appearance(page)]);
      await click(outside, 'A real outside control must remain usable while the popup is active.');
      await expect(menu(page), 'An outside click must dismiss the still-active popup.').toBeHidden();
      await expect(outside, 'Outside dismissal must preserve focus on the clicked destination.').toBeFocused();
      await reach(page, trigger(page), 'Tab');
      await page.keyboard.press('Space');
      await expect(menu(page), 'Keyboard Space must also open the popup.').toBeVisible();
      await info.attach(`menu-interaction-${path === '/' ? 'app' : 'preview'}-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.goto('about:blank');
      await expect(menu(page), 'Leaving the entry with an active popup must clean up that popup.').toHaveCount(0);
    }
  }
  expect(mutations, 'Local appearance and menu interactions must never write application data.').toEqual([]);
  expect(previewReads, 'The shared preview menu must remain backend-independent.').toEqual([]);
});

test('rail expansion preserves browsing and inspection state while collapsed navigation remains discoverable at 390px', async ({ page }, info) => {
  test.setTimeout(90000);
  const f = fixture(info);
  const readOnly = observeRepositoryReads(page);
  try {
    await seed(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await click(repositoryButton(page, f.first));
    const search = page.getByLabel('Search issues', { exact: true });
    await ready(search, 'Search must exist before establishing retained browsing state.');
    await search.fill('Rail record');
    for (const [label, value] of [['Filter by status', 'open'], ['Filter by label', 'rail-owned'], ['Sort issues', 'title']]) {
      const control = page.getByLabel(label, { exact: true });
      await ready(control, `${label} must exist before selecting retained filters.`);
      await expect.poll(() => control.locator('option').evaluateAll((options, selected) => options.some(option => (option as HTMLOptionElement).value === selected), value), { message: `${label} must offer the intended option.` }).toBe(true);
      await control.selectOption(value);
    }
    const pages = page.getByRole('navigation', { name: 'Issue pages', exact: true });
    await click(pages.getByRole('button', { name: 'Next page', exact: true }));
    const retainedIssues = async () => {
      await expect(repositoryButton(page, f.first)).toHaveAttribute('aria-pressed', 'true');
      await expect(view(page, 'Issues')).toHaveAttribute('aria-current', /^(?:page|true)$/);
      for (const [label, value] of [['Search issues', 'Rail record'], ['Filter by status', 'open'], ['Filter by label', 'rail-owned'], ['Sort issues', 'title']]) {
        const control = page.getByLabel(label, { exact: true });
        await reach(page, control, 'Tab');
        await expect(control, `Rail toggling must preserve the visible, reachable ${label}.`).toHaveValue(value);
      }
      await expect(pages.getByRole('status'), 'Rail toggling must preserve the exact filtered page range.').toHaveText(/^11\s*[–−—-]\s*20\s+of\s+23\s+issues\.?$/i);
      await expect.poll(() => page.getByRole('list', { name: 'Issues on this page', exact: true }).getByTestId(/^issue-\d+$/).evaluateAll(elements => elements.map(element => element.getAttribute('data-testid'))), { message: 'Rail toggling must retain exact row identities and exclude wrong repository, search, status and label records.' }).toEqual(f.matches.slice(10, 20).map(issue => `issue-${issue.id}`));
    };
    const cycle = async (observe: () => Promise<void>) => {
      await observe();
      await click(expand(page), 'The default collapsed rail must offer explicit expansion.');
      await expect.poll(async () => (await rail(page).boundingBox())?.width, { message: 'Explicit desktop expansion must use 256px.' }).toBe(256);
      near((await box(page.getByRole('main'), 'Expanded frame must remain visible.')).x, 256, 'The expanded rail moves the frame origin.');
      const expandedName = repositoryButton(page, f.first).getByText(f.first.name, { exact: true });
      await expect(expandedName, 'The expanded rail must display the complete repository identity.').toBeVisible();
      await completeLabel(expandedName);
      await fits(page, [expandedName]);
      await observe();
      await info.attach('expanded-rail-state', { body: await page.screenshot(), contentType: 'image/png' });
      await click(collapse(page), 'The expanded rail must offer collapse.');
      await expect.poll(async () => (await rail(page).boundingBox())?.width, { message: 'Collapsing restores the 60px rail.' }).toBe(60);
      await observe();
    };
    await cycle(retainedIssues);
    await click(view(page, 'Requirements'));
    const requirementPages = page.getByRole('navigation', { name: 'Requirement pages', exact: true });
    await click(requirementPages.getByRole('button', { name: /Next(?: page)?$/i }));
    const requirementRows = page.getByRole('list', { name: 'Requirements on this page', exact: true }).getByTestId(/^requirement-\d+$/);
    const expectedRequirements = [...f.requirements].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).slice(10, 12);
    await expect(requirementRows).toHaveCount(2);
    const selected = expectedRequirements[0];
    const opener = page.getByRole('button', { name: `Inspect requirement ${selected.title}`, exact: true });
    await click(opener);
    await cycle(async () => {
      await expect(repositoryButton(page, f.first)).toHaveAttribute('aria-pressed', 'true');
      await expect(view(page, 'Requirements')).toHaveAttribute('aria-current', /^(?:page|true)$/);
      await reach(page, opener, 'Tab');
      await expect(opener).toHaveAttribute('aria-pressed', 'true');
      const identity = page.getByRole('region', { name: 'Requirement inspection', exact: true }).getByTestId('requirement-identity');
      await fits(page, [identity]);
      await expect(identity, 'The visible selected inspection identity must survive rail changes.').toHaveText(`Requirement #${selected.id}`);
      await expect(requirementPages.getByRole('status')).toHaveText(/^11\s*[–−—-]\s*12\s+of\s+12\s+requirements\.?$/i);
      expect(await requirementRows.evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')))).toEqual(expectedRequirements.map(item => `requirement-${item.id}`));
    });
    await click(view(page, 'Repo harness'));
    const source = page.locator('details.harness-source').filter({ has: page.locator('.harness-source-path', { hasText: /^package\.json$/ }) });
    await click(source.locator('summary').first());
    const raw = source.locator('details').filter({ has: page.locator('summary', { hasText: /^Committed source text/ }) });
    await click(raw.locator('summary'));
    await cycle(async () => {
      await expect(repositoryButton(page, f.first)).toHaveAttribute('aria-pressed', 'true');
      await expect(view(page, 'Repo harness')).toHaveAttribute('aria-current', /^(?:page|true)$/);
      await expect(source, 'Expanded source disclosure must survive rail toggling.').toHaveJSProperty('open', true);
      await expect(raw, 'Raw source disclosure must survive rail toggling.').toHaveJSProperty('open', true);
      await expect(raw.getByLabel('package.json committed source', { exact: true })).toBeVisible();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    near((await box(rail(page), 'Narrow navigation keeps the icon rail.')).width, 60, 'Narrow rail remains 60px.');
    await reach(page, repositoryButton(page, f.first), 'Tab');
    const visibleName = repositoryButton(page, f.first).getByText(f.first.name, { exact: true }).filter({ visible: true }).or(page.getByRole('tooltip').filter({ visible: true }));
    await expect(visibleName, 'Collapsed keyboard focus must reveal the complete long repository identity.').not.toHaveCount(0);
    await expect(visibleName.first(), 'The focused rail label must show the actual complete repository name.').toHaveText(f.first.name);
    await completeLabel(visibleName.first());
    await fits(page, [visibleName.first()]);
    await ready(repositoryButton(page, f.second), 'The other collapsed repository control must exist before hover.');
    await reach(page, repositoryButton(page, f.second), 'Tab');
    await repositoryButton(page, f.second).hover();
    const hoveredName = repositoryButton(page, f.second).getByText(f.second.name, { exact: true }).filter({ visible: true }).or(page.getByRole('tooltip').filter({ visible: true }));
    await expect(hoveredName, 'Collapsed hover must reveal the complete other repository identity.').not.toHaveCount(0);
    await expect(hoveredName.first(), 'The hovered rail label must show the actual complete other repository name.').toHaveText(f.second.name);
    await completeLabel(hoveredName.first());
    await fits(page, [hoveredName.first()]);
    await reach(page, view(page, 'Issues'), 'Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(view(page, 'Issues')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await retainedIssues();
    await reach(page, view(page, 'Requirements'), 'Tab');
    await page.keyboard.press('Enter');
    await expect(view(page, 'Requirements')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await reach(page, view(page, 'Repo harness'), 'Tab');
    await page.keyboard.press('Enter');
    await expect(view(page, 'Repo harness')).toHaveAttribute('aria-current', /^(?:page|true)$/);
    await fits(page, [repositoryButton(page, f.first), repositoryButton(page, f.second), view(page, 'Issues'), view(page, 'Requirements'), view(page, 'Repo harness'), trigger(page)]);
    await info.attach('collapsed-390-navigation', { body: await page.screenshot(), contentType: 'image/png' });
    readOnly();
  } finally { await page.goto('about:blank'); f.close(); }
});
