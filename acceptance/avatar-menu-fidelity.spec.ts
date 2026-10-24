import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { test } from './workspace.ts';

const localAvatar = (page: Page) => page.getByRole('button', { name: 'User menu', exact: true }).or(page.getByRole('img', { name: 'Local workspace avatar', exact: true }));

function near(actual: number, expected: number, reason: string) {
  expect.soft(Math.abs(actual - expected), reason).toBeLessThanOrEqual(1);
}

async function textStyle(label: Locator, value: string, ink: string, lineHeight = '20px') {
  await expect(label, `The visible ${value} field must exist before observing its typography.`).toBeVisible({ timeout: 3000 });
  const observed = await label.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const runs = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent || !node.parentElement?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const boxes = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0);
      if (!boxes.length) continue;
      const style = getComputedStyle(node.parentElement);
      const painted = boxes.every(box => {
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !!hit && (node.parentElement!.contains(hit) || hit.contains(node.parentElement));
      });
      const x = Math.min(...boxes.map(box => box.x));
      const y = Math.min(...boxes.map(box => box.y));
      runs.push({ text: node.textContent, painted, color: style.color, size: style.fontSize, weight: style.fontWeight, line: style.lineHeight, smoothing: style.getPropertyValue('-webkit-font-smoothing'), font: style.fontFamily, x, y, right: Math.max(...boxes.map(box => box.right)), bottom: Math.max(...boxes.map(box => box.bottom)) });
    }
    if (!runs.length) return null;
    const x = Math.min(...runs.map(run => run.x));
    const y = Math.min(...runs.map(run => run.y));
    return { text: runs.map(run => run.text).join('').replace(/\s+/g, ' ').trim(), runs, x, y, width: Math.max(...runs.map(run => run.right)) - x, height: Math.max(...runs.map(run => run.bottom)) - y };
  });
  expect.soft(observed?.text, `The application must paint the complete ${value} label across its rendered text runs.`).toBe(value);
  for (const run of observed?.runs ?? []) {
    expect.soft(run, `Each rendered ${value} text run must use the pinned ink and regular typography.`).toMatchObject({ painted: true, color: ink, size: '14px', weight: '400', line: lineHeight, smoothing: 'antialiased' });
    expect.soft(run.font, 'Avatar text must retain the local Han/system font cascade.').toMatch(/(?:Loop Han|Pulse Han).*system-ui/);
  }
  return observed;
}

test('local avatar retains the pinned light rendered initial typography and alignment in app and preview', async ({ page }, info) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.setItem('loop.theme', 'light'));
  try {
    for (const path of ['/', '/__ui/components']) {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await expect(page.locator('html'), 'Avatar fidelity must be observed in the light entry.').toHaveCSS('color-scheme', 'light');
        const avatar = localAvatar(page);
        await expect(avatar, 'Each entry must render exactly one named local avatar.').toHaveCount(1);
        await expect(avatar, 'The local avatar must visibly identify Loop with L instead of a person glyph.').toHaveText('L', { timeout: 3000 });
        await expect(avatar).toBeVisible({ timeout: 3000 });
        await expect(avatar).toBeInViewport({ ratio: 1 });
        await expect(avatar, 'The avatar must retain its neutral light fill.').toHaveCSS('background-color', 'rgb(237, 236, 232)');
        expect.soft(await avatar.evaluate(element => parseFloat(getComputedStyle(element).borderRadius)), 'The local avatar must remain circular.').toBeGreaterThanOrEqual(16);
        const initial = await textStyle(avatar, 'L', 'rgb(11, 11, 11)', '14px');
        const box = await avatar.boundingBox();
        expect(box, 'The named avatar must have actual rendered bounds.').not.toBeNull();
        near(box!.width, 32, 'The local avatar retains its 32px width.');
        near(box!.height, 32, 'The local avatar retains its 32px height.');
        if (initial) {
          near(initial.x + initial.width / 2, box!.x + box!.width / 2, 'The visible initial must be horizontally centered.');
          near(initial.y + initial.height / 2, box!.y + box!.height / 2, 'The visible initial must be vertically centered.');
        }
        await info.attach(`local-avatar-${path === '/' ? 'app' : 'preview'}-light-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
        await page.goto('about:blank');
      }
    }
  } finally { await page.goto('about:blank'); }
});
