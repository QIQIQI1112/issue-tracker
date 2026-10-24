import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test } from './workspace.ts';

type MountPalette = { scheme: string; frame: string; titleInk: string | null };
type LightOnlyObservation = { first: MountPalette | null; readSaved: () => string | null };

async function installObservation(page: Page, saved: string | null) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(value => {
    const storage = window.localStorage;
    if (!sessionStorage.getItem('light-only-seeded')) {
      if (value === null) storage.removeItem('loop.theme');
      else storage.setItem('loop.theme', value === 'unavailable' ? 'dark' : value);
      sessionStorage.setItem('light-only-seeded', 'true');
    }
    if (value === 'unavailable') Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('Storage denied', 'SecurityError'); } });
    const observation = { first: null as MountPalette | null, readSaved: () => storage.getItem('loop.theme') };
    Object.assign(window, { lightOnlyObservation: observation });
    const observer = new MutationObserver(() => {
      const root = document.getElementById('root');
      if (!root?.firstElementChild || observation.first) return;
      const style = getComputedStyle(document.documentElement);
      const title = root.querySelector('h1');
      observation.first = { scheme: style.colorScheme, frame: style.backgroundColor, titleInk: title ? getComputedStyle(title).color : null };
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }, saved);
}

async function lightEntry(page: Page, path: string, stage: string, saved: string | null) {
  const title = page.getByRole('heading', { name: path === '/' ? 'Issues' : 'Component preview', exact: true, level: 1 });
  await expect(title, `${stage}: storage handling must leave the actual entry mounted and usable.`).toBeVisible({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { lightOnlyObservation: LightOnlyObservation }).lightOnlyObservation.first), { timeout: 3000, message: `${stage}: the pre-navigation observer must record the first populated mount.` }).not.toBeNull();
  const first = await page.evaluate(() => (window as unknown as { lightOnlyObservation: LightOnlyObservation }).lightOnlyObservation.first);
  expect.soft(first, `${stage}: the first populated mount must use light scheme, frame and title ink despite historical storage and dark OS preference.`).toEqual({ scheme: 'light', frame: 'rgb(252, 252, 251)', titleInk: 'rgb(11, 11, 11)' });
  const current = {
    scheme: await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme),
    frame: await page.locator('html').evaluate(element => getComputedStyle(element).backgroundColor),
    titleInk: await title.evaluate(element => getComputedStyle(element).color),
  };
  expect.soft(current, `${stage}: the mounted entry must retain the exact light palette.`).toEqual({ scheme: 'light', frame: 'rgb(252, 252, 251)', titleInk: 'rgb(11, 11, 11)' });
  if (saved === 'dark' || saved === 'unavailable') {
    const retained = await page.evaluate(() => (window as unknown as { lightOnlyObservation: LightOnlyObservation }).lightOnlyObservation.readSaved());
    expect.soft(retained, `${stage}: the obsolete dark value must remain inert without being erased or rewritten.`).toBe('dark');
  }
}

async function staticAvatar(page: Page, entry: string) {
  const avatar = page.getByRole('img', { name: 'Local workspace avatar', exact: true });
  await expect.soft(avatar, `${entry}: the appearance trigger must be replaced by exactly one static local avatar.`).toHaveCount(1, { timeout: 1000 });
  if (await avatar.count() === 1) {
    await expect(avatar, `${entry}: the static avatar must be visible before inspecting or clicking it.`).toBeVisible({ timeout: 3000 });
    await expect.soft(avatar, `${entry}: the static avatar must retain the visible L identity.`).toHaveText('L');
    if (entry === '/__ui/components') {
      const viewport = page.viewportSize();
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(avatar, `Preview at ${width}px: the static avatar must remain fully visible before measuring its placement.`).toBeInViewport({ ratio: 1, timeout: 3000 });
        const main = page.getByRole('main');
        const title = main.getByRole('heading', { name: 'Component preview', exact: true, level: 1 });
        await expect(main, `Preview at ${width}px: the content frame must be visible before measuring its right corner.`).toBeVisible({ timeout: 3000 });
        await expect(title, `Preview at ${width}px: the heading must be visible before observing avatar alignment.`).toBeVisible({ timeout: 3000 });
        const content = await main.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { right: bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight), top: bounds.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) };
        });
        const titleBottom = await title.evaluate(element => element.getBoundingClientRect().bottom);
        const bounds = await avatar.boundingBox();
        expect(bounds, `Preview at ${width}px: the static avatar must have rendered bounds.`).not.toBeNull();
        expect.soft(Math.abs(bounds!.x + bounds!.width - content.right), `Preview at ${width}px: the avatar must retain the content's right-corner alignment instead of moving beside the title on the left.`).toBeLessThanOrEqual(2);
        expect.soft(Math.abs(bounds!.y + bounds!.height / 2 - (content.top + titleBottom) / 2), `Preview at ${width}px: the avatar must remain vertically centered in the top heading block.`).toBeLessThanOrEqual(2);
      }
      if (viewport) await page.setViewportSize(viewport);
    }
    expect.soft(await avatar.evaluate(element => {
      if (element.querySelector('button, a[href], [role="button"], [aria-haspopup]')) return false;
      if ([...element.querySelectorAll<HTMLElement>('[tabindex]')].some(child => child.tabIndex >= 0)) return false;
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (node.matches('button, a[href], [role="button"], [aria-haspopup]') || node instanceof HTMLElement && node.tabIndex >= 0) return false;
      }
      return true;
    }), `${entry}: the static avatar must have no interactive wrapper, child control or keyboard tab stop.`).toBe(true);
    await avatar.click();
  }
  await expect.soft(page.getByRole('button', { name: /^(?:User menu|(?:Dark|Light) (?:mode|theme)|Theme|Appearance|(?:Change|Switch|Toggle|Select) (?:theme|appearance))$/i }), `${entry}: no appearance action or empty avatar-menu trigger may remain.`).toHaveCount(0, { timeout: 1000 });
  await expect.soft(page.getByRole('switch', { name: /dark|theme|appearance/i }).or(page.getByRole('menuitemcheckbox', { name: /dark|theme|appearance/i })).or(page.getByRole('menuitemradio', { name: /dark|theme|appearance/i })).or(page.getByRole('menuitem', { name: /dark|theme|appearance/i })), `${entry}: neither standalone nor menu theme-switch actions may be exposed.`).toHaveCount(0, { timeout: 1000 });
  await expect.soft(page.getByRole('menu', { name: /^(?:User menu|Theme|Appearance)$/i }), `${entry}: clicking the static avatar must not expose an appearance menu, even an empty one.`).toHaveCount(0, { timeout: 1000 });
}

test('app and preview remain light through saved dark startup reload and navigation with a static avatar', async ({ context }) => {
  test.setTimeout(90000);
  for (const saved of ['dark', null, 'DARK', 'system', 'unavailable']) {
    for (const start of saved === 'dark' ? ['/', '/__ui/components'] : ['/']) {
      const page = await context.newPage();
      try {
        await installObservation(page, saved);
        await page.goto(start);
        if (saved === 'dark') {
          await lightEntry(page, start, `${start}: saved dark direct startup`, saved);
          await staticAvatar(page, start);
        } else {
          await expect(page.getByRole('heading', { name: 'Issues', exact: true, level: 1 }), 'The baseline storage startup must mount before lifecycle observations.').toBeVisible({ timeout: 5000 });
        }
        await page.reload();
        await lightEntry(page, start, `${start}: saved ${String(saved)} reload`, saved);
        const destination = start === '/' ? '/__ui/components' : '/';
        await page.goto(destination);
        await lightEntry(page, destination, `${destination}: saved ${String(saved)} navigation`, saved);
        await page.reload();
        await lightEntry(page, destination, `${destination}: saved ${String(saved)} reload after navigation`, saved);
        await page.goto(start);
        await lightEntry(page, start, `${start}: saved ${String(saved)} return navigation`, saved);
      } finally { await page.close(); }
    }
  }
});
