import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { build } from 'vite';
import { test } from './workspace.ts';

const previewHeading = (page: Page) => page.getByRole('heading', { name: 'Component preview', exact: true });

async function click(control: Locator) {
  await expect(control, 'The preview control must be visible before activation.').toBeVisible();
  await expect(control, 'The preview control must be enabled before activation.').toBeEnabled();
  await control.click();
}

async function reach(page: Page, control: Locator, key: 'Tab' | 'Shift+Tab', dialog?: Locator) {
  await expect(control, `The ${key} destination must exist before normal keyboard traversal.`).toBeVisible();
  await expect(control, 'The keyboard destination must be enabled.').toBeEnabled();
  for (let step = 0; step < 60; step++) {
    await page.keyboard.press(key);
    if (dialog) expect(await dialog.evaluate(element => element.contains(document.activeElement)), 'Keyboard traversal must stay inside the active preview modal.').toBe(true);
    if (await control.evaluate(element => document.activeElement === element)) break;
  }
  await expect(control, `Normal ${key} traversal must reach the preview control without programmatic focus.`).toBeFocused();
  await expect(control, 'The keyboard destination must be on screen.').toBeInViewport();
}

async function expectRange(control: Locator, start: number, end: number, total: number) {
  const span = start === end ? `${start}(?:\\s*[–−-]\\s*${end})?` : `${start}\\s*[–−-]\\s*${end}`;
  await expect(control, 'The visible pagination range must describe the current sample slice exactly.').toHaveText(new RegExp(`^(?:Showing\\s+)?${span}\\s+of\\s+${total}\\s+(?:samples?|items?)\\.?$`, 'i'));
}

async function isolate(page: Page) {
  const requests: string[] = [];
  page.on('request', request => {
    if (/^\/api(?:\/|$)/.test(new URL(request.url()).pathname)) requests.push(`${request.method()} ${request.url()}`);
  });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Backend-only isolation sentinel' } }));
  return requests;
}

async function fits(page: Page, width: number, content?: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `The preview must fit the ${width}px document without horizontal overflow.`).toBe(true);
  expect(await page.locator('html, body, main').evaluateAll(elements => elements.map(element => getComputedStyle(element).overflowX)), 'Clipping the page must not disguise preview overflow.').not.toContain('hidden');
  if (content) {
    await expect(content, 'The long-content sample must remain visible at this width.').toBeVisible();
    expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Long sample text must fit its own visible element.').toBe(true);
  }
}

test('development component preview exposes representative primitive states without application API requests', async ({ page }) => {
  const requests = await isolate(page);
  await page.goto('/__ui/components');
  await expect(previewHeading(page), 'The development route must render the component preview rather than the live application.').toBeVisible();
  const buttons = page.getByRole('region', { name: 'Buttons', exact: true });
  await expect(buttons, 'The button examples must be visible preview content.').toBeVisible();
  await expect(buttons.getByRole('button', { name: 'Disabled action', exact: true })).toBeVisible();
  await expect(buttons.getByRole('button', { name: 'Preview action', exact: true }), 'A normal shared button must be available.').toBeEnabled();
  await expect(buttons.getByRole('button', { name: 'Disabled action', exact: true }), 'The disabled example must use an actually disabled button.').toBeDisabled();
  const loading = buttons.getByRole('button', { name: 'Loading action', exact: true });
  await expect(loading, 'The loading example must be visible.').toBeVisible();
  await expect(loading, 'Loading must be represented on the button itself.').toHaveAttribute('aria-busy', 'true');
  await expect(loading, 'The loading action must not admit duplicate activation.').toBeDisabled();
  await expect(buttons.getByRole('button', { name: 'Icon action', exact: true }), 'The shared icon-button example must have a usable accessible name.').toBeVisible();
  const badges = page.getByRole('region', { name: 'Badges', exact: true });
  await expect(badges.getByLabel('Sample issue status', { exact: true }), 'The sample status badge must be visible.').toBeVisible();
  await expect(badges.getByLabel('Sample issue status', { exact: true }), 'The actual status badge must expose its sample state independently of headings or descriptions.').toHaveText('In progress');
  const empty = page.getByRole('region', { name: 'Empty state', exact: true });
  await expect(empty.getByRole('heading', { name: 'No sample items', exact: true }), 'The shared empty-state component must render its own message.').toBeVisible();
  const error = page.getByRole('region', { name: 'Error state', exact: true });
  await expect(error.getByRole('alert'), 'The rendered error sample must be an application-generated alert, separate from descriptive fixture text.').toHaveText(/Sample read failed/);
  const long = page.getByLabel('Long content sample', { exact: true });
  await expect(long, 'The preview needs a real long-content sample rather than only a state heading.').toHaveText(/\S[\s\S]{159}/);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page, width, long);
    await expect(buttons.getByRole('button', { name: 'Preview action', exact: true }), 'The normal action must remain visible on desktop and narrow screens.').toBeVisible();
    await expect(error.getByRole('alert')).toBeVisible();
  }
  await page.waitForTimeout(2200);
  expect(requests, 'Preview entry and a complete normal polling interval must perform no application API reads or mutations, even with an unavailable backend.').toEqual([]);
  await expect(page.getByText('Backend-only isolation sentinel', { exact: true }), 'A backend response must never become preview sample content.').toHaveCount(0);
});

test('development component preview supports modal focus return and local pagination at desktop and 390px without application API requests', async ({ page }) => {
  const requests = await isolate(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/__ui/components');
    await expect(previewHeading(page), 'The interactive preview must exist before exercising controls.').toBeVisible();
    const opener = page.getByRole('button', { name: 'Open preview dialog', exact: true });
    await reach(page, opener, 'Tab');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Preview dialog', exact: true });
    await expect(dialog, 'The shared modal must open as a named dialog.').toBeVisible();
    await expect(dialog, 'Shared neutral modal entry must preserve the production focus contract.').toBeFocused();
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    await reach(page, close, 'Tab', dialog);
    await reach(page, close, 'Shift+Tab', dialog);
    await fits(page, width);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'The open modal must fit at desktop and 390px.').toBe(true);
    expect(await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1; }), 'The complete modal must stay within the horizontal viewport.').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog, 'Escape must dismiss the sample modal.').toHaveCount(0);
    await expect(opener, 'Escape must restore the exact preview opener.').toBeFocused();
    await click(opener);
    await expect(dialog, 'The modal must reopen before testing its Close action.').toBeVisible();
    await click(close);
    await expect(dialog, 'Close must dismiss the modal.').toHaveCount(0);
    await expect(opener, 'Close must restore the same opener.').toBeFocused();
    const paging = page.getByRole('navigation', { name: 'Sample pages', exact: true });
    const previous = paging.getByRole('button', { name: 'Previous page', exact: true });
    const next = paging.getByRole('button', { name: 'Next page', exact: true });
    const range = paging.getByRole('status');
    const items = page.getByRole('list', { name: 'Sample items', exact: true }).getByRole('listitem');
    await expect(range, 'The preview pagination needs a real visible range field.').toBeVisible();
    await expect(range, 'The first page range must describe the visible sample collection.').toHaveText(/^(?:Showing\s+)?1(?:\s*[–−-]\s*\d+)?\s+of\s+\d+\s+(?:samples?|items?)\.?$/i);
    const initial = await items.allTextContents();
    expect(initial.length, 'The first preview page must contain actual sample items.').toBeGreaterThan(0);
    expect(initial.every(value => value.trim().length > 0), 'Visible sample items must have actual text identities.').toBe(true);
    const total = Number((await range.innerText()).match(/of\s+(\d+)/i)![1]);
    expect(total, 'Static samples must include more than one page to exercise local paging.').toBeGreaterThan(initial.length);
    await expectRange(range, 1, initial.length, total);
    await expect(previous, 'The first page must reject backward paging.').toBeDisabled();
    await reach(page, next, 'Tab');
    await page.keyboard.press('Enter');
    await expectRange(range, initial.length + 1, Math.min(initial.length * 2, total), total);
    const second = await items.allTextContents();
    expect(second.some(value => initial.includes(value)), 'The next page must replace the visible sample identities rather than merely changing a page label.').toBe(false);
    expect(second.length).toBe(Math.min(initial.length, total - initial.length));
    await reach(page, previous, 'Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(items, 'Previous must restore the exact initial sample page.').toHaveText(initial);
    await expectRange(range, 1, initial.length, total);
    await expect(previous).toBeDisabled();
    const seen = [...initial];
    let end = initial.length;
    for (let step = 0; end < total && step < 20; step++) {
      await click(next);
      const start = end + 1;
      end = Math.min(end + initial.length, total);
      await expectRange(range, start, end, total);
      await expect(items, 'Only the current sample slice may remain visible.').toHaveCount(end - start + 1);
      seen.push(...await items.allTextContents());
    }
    expect(end, 'The finite sample collection must reach its last page.').toBe(total);
    expect(new Set(seen).size, 'Every reported sample must appear once across pages, with no repeated or omitted identities.').toBe(total);
    await expect(next, 'The last page must reject forward paging.').toBeDisabled();
    await fits(page, width);
    await click(opener);
    await expect(dialog, 'Leave the preview with local modal state still active.').toBeVisible();
    await expect(page.getByRole('button', { name: 'Loading action', exact: true, includeHidden: true }), 'The pending-state example must still exist behind the active modal during preview cleanup.').toHaveAttribute('aria-busy', 'true');
    await page.waitForTimeout(2200);
    expect(requests, 'All modal, keyboard, boundary and pagination interactions must remain local, including a polling interval with a modal open.').toEqual([]);
    await page.goto('about:blank');
    await expect(dialog, 'Leaving while the modal is open must remove preview dialog state.').toHaveCount(0);
    await page.waitForTimeout(2200);
    expect(requests, 'Leaving active modal, pagination and pending sample state must not start background application traffic.').toEqual([]);
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Issues', exact: true }), 'Default navigation must still enter the ordinary application.').toBeVisible();
});

test('production application entry remains usable and never exposes the component preview', async ({ page }, info) => {
  test.setTimeout(60000);
  const output = info.outputPath('production-ui');
  await build({ configLoader: 'native', mode: 'production', logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
  const assets = new Map<string, Buffer>();
  function collect(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) collect(path, url);
      else assets.set(url, readFileSync(path));
    }
  }
  collect(output);
  const served: string[] = [];
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (/^\/api(?:\/|$)/.test(url.pathname)) return route.continue();
    const body = assets.get(url.pathname);
    if (body) {
      served.push(url.pathname);
      return route.fulfill({ body, contentType: types[extname(url.pathname)] ?? 'application/octet-stream' });
    }
    if (route.request().isNavigationRequest()) return route.fulfill({ body: assets.get('/index.html')!, contentType: 'text/html' });
    return route.fulfill({ status: 404, body: 'Not found' });
  });
  for (const path of ['/', '/__ui/components', '/']) {
    await page.goto(path);
    if (path === '/') {
      await expect(page.getByRole('heading', { name: 'Issues', exact: true }), 'The built application entry must remain usable.').toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Workspace views', exact: true })).toBeVisible();
      await expect(page.getByLabel('Search issues', { exact: true })).toBeEnabled();
      await expect(page.getByRole('region', { name: 'Issue list', exact: true }), 'The built application must complete its ordinary initial read.').toHaveAttribute('aria-busy', 'false');
    } else {
      await expect(page.locator('#root'), 'Production must settle to the app fallback or an unavailable-route message before observing preview exclusion.').not.toBeEmpty();
      await page.waitForLoadState('networkidle');
    }
    await expect(page.getByRole('region', { name: 'Buttons', exact: true }), 'Production routes must never expose the component gallery, including at the preview URL.').toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open preview dialog', exact: true }), 'Production must not expose sample interactions.').toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Sample items', exact: true }), 'Production must not expose preview fixtures.').toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Sample pages', exact: true }), 'Production must not expose local preview pagination.').toHaveCount(0);
  }
  expect(served.some(path => path.endsWith('.js')), 'The browser must execute actual emitted production JavaScript.').toBe(true);
  expect(served.some(path => path.endsWith('.css')), 'The browser must load the centrally emitted production stylesheet.').toBe(true);
});
