import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { test } from './workspace.ts';

const trigger = (page: Page) => page.getByRole('button', { name: 'User menu', exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'User menu', exact: true });
const appearance = (page: Page) => menu(page).getByRole('menuitemcheckbox', { name: 'Dark mode', exact: true }).or(menu(page).getByRole('switch', { name: 'Dark mode', exact: true }));
const moon = '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>';
const check = '<path d="M20 6 9 17l-5-5"/>';

async function ready(control: Locator, reason: string) {
  await expect(control, reason).toBeVisible({ timeout: 3000 });
  await expect(control, reason).toBeEnabled();
}

async function reach(page: Page, control: Locator, key: 'Tab' | 'Shift+Tab') {
  await ready(control, 'The menu keyboard destination must exist before ordinary traversal.');
  for (let step = 0; step < 80; step++) {
    if (await control.evaluate(element => element === document.activeElement)) break;
    await page.keyboard.press(key);
  }
  await expect(control, `Normal ${key} traversal must reach the menu destination.`).toBeFocused({ timeout: 3000 });
}

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
    expect.soft(run.font, 'Menu text must retain the local Han/system font cascade.').toMatch(/(?:Loop Han|Pulse Han).*system-ui/);
  }
  return observed;
}

async function paintedIcon(icon: Locator, drawing: string, size: number, ink: string, name: string) {
  await expect(icon, `The ${name} glyph must be rendered before its paint is assessed.`).toBeVisible({ timeout: 3000 });
  await expect.poll(() => icon.evaluate((element, expectedInk) => {
    const shapes = [...element.querySelectorAll('path, ellipse, circle, line, polyline, polygon, rect')];
    return shapes.length > 0 && shapes.every(shape => getComputedStyle(shape).stroke === expectedInk);
  }, ink), { timeout: 3000, message: `The ${name} glyph must settle to the exact destination theme ink after its permitted color transition.` }).toBe(true);
  const observed = await icon.evaluate(async (element, reference) => {
    const root = element as SVGSVGElement;
    const box = root.getBoundingClientRect();
    const rootStyle = getComputedStyle(root);
    const paintWidth = parseFloat(rootStyle.width) || box.width;
    const paintHeight = parseFloat(rootStyle.height) || box.height;
    const shapes = [...root.querySelectorAll('path, ellipse, circle, line, polyline, polygon, rect')];
    const strokes = shapes.map(shape => {
      const style = getComputedStyle(shape);
      let opacity = parseFloat(style.strokeOpacity) / (style.strokeOpacity.endsWith('%') ? 100 : 1);
      for (let node: Element | null = shape; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return { ink: style.stroke, width: parseFloat(style.strokeWidth), cap: style.strokeLinecap, join: style.strokeLinejoin, fill: style.fill, opacity, visible: style.display !== 'none' && style.visibility === 'visible' };
    });
    const clone = root.cloneNode(true) as SVGSVGElement;
    const originals = [root, ...root.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    for (let index = 0; index < originals.length; index++) {
      const style = getComputedStyle(originals[index]);
      const copy = copies[index];
      copy.removeAttribute('class');
      copy.removeAttribute('style');
      for (const [property, value] of Object.entries({ fill: style.fill === 'none' ? 'none' : 'black', stroke: style.stroke === 'none' ? 'none' : 'black', 'stroke-width': style.strokeWidth, 'stroke-linecap': style.strokeLinecap, 'stroke-linejoin': style.strokeLinejoin, opacity: style.opacity, 'stroke-opacity': style.strokeOpacity, 'fill-opacity': style.fillOpacity, visibility: style.visibility, display: style.display })) copy.setAttribute(property, value);
      copy.setAttribute('style', `transform:${style.transform};transform-origin:${style.transformOrigin};transform-box:${style.transformBox};translate:${style.translate};rotate:${style.rotate};scale:${style.scale};overflow:${style.overflow}`);
    }
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(paintWidth));
    clone.setAttribute('height', String(paintHeight));
    async function raster(source: string) {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, 192, 192).data;
    }
    const actual = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 ${paintWidth} ${paintHeight}">${new XMLSerializer().serializeToString(clone)}</svg>`);
    const expected = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${reference}</svg>`);
    let difference = 0;
    let ink = 0;
    for (let index = 3; index < actual.length; index += 4) {
      difference += Math.abs(actual[index] - expected[index]);
      ink += expected[index];
    }
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { x: box.x, right: box.right, y: box.y, width: box.width, height: box.height, strokes, unobscured: !!hit && (root.contains(hit) || hit.contains(root)), difference: difference / ink };
  }, drawing);
  near(observed.width, size, `${name} must paint at the pinned ${size}px width.`);
  near(observed.height, size, `${name} must paint at the pinned ${size}px height.`);
  expect.soft(observed.unobscured, `${name} must be painted in the visible menu rather than covered by another element.`).toBe(true);
  expect.soft(observed.strokes.length, `${name} must contain actual painted geometry.`).toBeGreaterThan(0);
  for (const stroke of observed.strokes) expect.soft(stroke, `${name} must paint full-opacity theme ink with 1.5px round Lucide strokes.`).toEqual({ ink, width: 1.5, cap: 'round', join: 'round', fill: 'none', opacity: 1, visible: true });
  expect.soft(observed.difference, `${name} must render the pinned drawing, allowing equivalent SVG path encoding.`).toBeLessThan(0.03);
  return observed;
}

async function transition(row: Locator, property: string) {
  const observed = await row.evaluate((element, property) => {
    const style = getComputedStyle(element);
    const properties = style.transitionProperty.split(',').map(value => value.trim());
    const durations = style.transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000));
    const easings = style.transitionTimingFunction.match(/cubic-bezier\([^)]*\)|steps\([^)]*\)|[\w-]+/g) ?? [];
    const index = properties.findLastIndex(value => value === property || value === 'all');
    return index < 0 ? null : { duration: durations[index % durations.length], easing: easings[index % easings.length] };
  }, property);
  expect.soft(observed, `Menu ${property} must use the pinned fast transition.`).toEqual({ duration: 140, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
}

test('avatar menu renders the pinned UTG context and appearance row in light and dark in app and preview', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  try {
    for (const path of ['/', '/__ui/components']) {
      for (const mode of ['light', 'dark'] as const) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(path);
        await page.evaluate(mode => localStorage.setItem('loop.theme', mode), mode);
        await page.reload();
        await ready(trigger(page), 'The shared User menu trigger must exist before opening it.');
        await expect(page.locator('html'), 'Menu fidelity must be observed in the effective requested theme.').toHaveCSS('color-scheme', mode);
        const ink = mode === 'light' ? 'rgb(11, 11, 11)' : 'rgb(249, 249, 247)';
        const hover = mode === 'light' ? 'rgb(243, 243, 240)' : 'rgb(32, 32, 31)';
        await expect(trigger(page), 'The local avatar must visibly identify Loop with L instead of a person glyph.').toHaveText('L', { timeout: 3000 });
        const initial = await textStyle(trigger(page), 'L', ink, '14px');
        const avatar = await trigger(page).boundingBox();
        if (initial && avatar) {
          near(initial.x + initial.width / 2, avatar.x + avatar.width / 2, 'The visible initial must be horizontally centered.');
          near(initial.y + initial.height / 2, avatar.y + avatar.height / 2, 'The visible initial must be vertically centered.');
        }
        await trigger(page).click();
        await expect(menu(page), 'Opening the avatar must render the shared menu.').toBeVisible({ timeout: 3000 });
        const caption = menu(page).getByText('Local workspace', { exact: true });
        const captionText = await textStyle(caption, 'Local workspace', mode === 'light' ? 'rgb(151, 149, 141)' : 'rgb(123, 121, 116)');
        expect.soft(await caption.evaluate(element => {
          const panel = element.closest('[role="menu"]');
          for (let node: Element | null = element; node && node !== panel; node = node.parentElement) {
            if (node.matches('button, a, input, select, [tabindex], [role="menuitem"], [role="menuitemcheckbox"], [role="switch"]')) return true;
          }
          return false;
        }), 'Local workspace must be contextual information rather than an account action.').toBe(false);
        const separator = menu(page).getByRole('separator');
        await expect(separator, 'The context must be separated from the appearance action by a rendered divider.').toBeVisible({ timeout: 3000 });
        const row = appearance(page);
        await ready(row, 'The icon row must expose the existing Dark mode action.');
        await expect(row, 'The selected indicator must correspond to the effective theme.').toHaveAttribute('aria-checked', String(mode === 'dark'));
        const label = row.getByText('Dark mode', { exact: true });
        const labelText = await textStyle(label, 'Dark mode', ink);
        await expect(row.getByText(/^(?:On|Off)$/), 'The icon row must replace the visible On/Off pill text.').not.toBeVisible();
        await expect(row.locator('.theme-switch-track'), 'The menu-specific icon row must replace the existing embedded switch track.').not.toBeVisible();
        const layout = await menu(page).evaluate((element) => {
          const panel = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { x: panel.x, right: panel.right, shadows: style.boxShadow.split(/,(?![^()]*\))/).map(value => value.trim()), outline: { width: style.outlineWidth, color: style.outlineColor, style: style.outlineStyle }, borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], borderColors: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor] };
        });
        const shortAlpha = mode === 'light' ? '0.08' : '0.24';
        const longAlpha = mode === 'light' ? '0.12' : '0.36';
        const ring = mode === 'light' ? 'rgba(11, 11, 11, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const hairline = `${ring} 0px 0px 0px 1px`;
        expect.soft(layout.shadows.filter(layer => layer !== hairline), 'The menu must use the two pinned raised shadow layers in each theme.').toEqual([`rgba(0, 0, 0, ${shortAlpha}) 0px 2px 6px 0px`, `rgba(0, 0, 0, ${longAlpha}) 0px 8px 24px 0px`]);
        expect.soft(layout.shadows.includes(hairline) || layout.outline.width === '1px' && layout.outline.color === ring && layout.outline.style === 'solid' || layout.borders.every(width => width === '1px') && layout.borderColors.every(color => color === ring), 'The menu must paint its one-pixel theme ink hairline.').toBe(true);
        const captionBox = await caption.evaluate(element => {
          const panel = element.closest('[role="menu"]')!;
          const style = getComputedStyle(panel);
          const width = panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          for (let node: Element | null = element; node && node !== panel; node = node.parentElement) {
            const box = node.getBoundingClientRect();
            if (Math.abs(box.width - width) <= 1) return { x: box.x, y: box.y, height: box.height };
          }
          return null;
        });
        const divider = await separator.evaluate(element => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { x: box.x, right: box.right, y: box.y, height: box.height, background: style.backgroundColor, border: style.borderTopColor, borderWidth: parseFloat(style.borderTopWidth) };
        });
        const rowBox = (await row.boundingBox())!;
        expect.soft(captionBox, 'The visible local context must occupy its own full-width information row.').not.toBeNull();
        if (captionBox) {
          near(captionBox.x, layout.x + 8, 'The context row starts inside the existing panel padding.');
          expect.soft(captionBox.height, 'The context row must be at least 32px high.').toBeGreaterThanOrEqual(32);
          near(divider.y - captionBox.y - captionBox.height, 4, 'The divider retains its upper 4px breathing space.');
        }
        near(divider.height, 1, 'The context divider must paint a one-pixel line.');
        near(divider.x, layout.x + 8 + 12, 'The divider retains its 12px inner start inset.');
        near(layout.right - divider.right, 8 + 12, 'The divider retains its 12px inner end inset.');
        near(rowBox.y - divider.y - divider.height, 4, 'The divider retains its lower 4px breathing space.');
        expect.soft(divider.background === (mode === 'light' ? 'rgba(11, 11, 11, 0.09)' : 'rgba(255, 255, 255, 0.09)') || divider.borderWidth === 1 && divider.border === (mode === 'light' ? 'rgba(11, 11, 11, 0.09)' : 'rgba(255, 255, 255, 0.09)'), 'The visible separator must paint the theme divider ink.').toBe(true);
        if (captionText) near(captionText.x, layout.x + 8 + 12, 'The visible context text starts at the 12px inner padding.');
        const icons = row.locator('svg:visible');
        await expect(icons, 'Light paints only Moon; dark adds exactly one selected Check.').toHaveCount(mode === 'dark' ? 2 : 1);
        const moonBox = await paintedIcon(icons.nth(0), moon, 20, ink, 'Moon');
        near(moonBox.x - rowBox.x, 12, 'The leading Moon starts at the 12px row padding.');
        near(moonBox.y + moonBox.height / 2, rowBox.y + rowBox.height / 2, 'Moon is vertically centered in the row.');
        if (labelText) near(labelText.x - moonBox.right, 12, 'The row label follows Moon with the reference 12px gap.');
        if (mode === 'dark') {
          const checkBox = await paintedIcon(icons.nth(1), check, 16, 'rgb(124, 143, 230)', 'Selected Check');
          near(rowBox.x + rowBox.width - checkBox.right, 12, 'The selected Check stays at the trailing 12px inset.');
          near(checkBox.y + checkBox.height / 2, rowBox.y + rowBox.height / 2, 'The selected Check is vertically centered.');
        }
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 800 });
          const observed = await row.evaluate(element => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const leading = element.querySelector('svg')?.getBoundingClientRect();
            const trailing = [...element.querySelectorAll('svg')].filter(icon => icon.checkVisibility()).at(-1)?.getBoundingClientRect();
            return { height: box.height, radius: style.borderRadius, leadingInset: leading ? leading.x - box.x : null, trailingInset: trailing ? box.right - trailing.right : null, fits: box.x >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1 };
          });
          expect.soft(observed, `The ${width}px menu row retains its reference radius and visible content fit.`).toMatchObject({ radius: '8px', fits: true });
          near(observed.leadingInset ?? -1, 12, `The ${width}px row retains its 12px leading padding.`);
          if (mode === 'dark') near(observed.trailingInset ?? -1, 12, `The ${width}px row retains its 12px trailing padding.`);
          expect.soft(observed.height, `The ${width}px row must remain at least 32px high.`).toBeGreaterThanOrEqual(32);
        }
        await page.setViewportSize({ width: 1280, height: 800 });
        await transition(row, 'background-color');
        await transition(row, 'color');
        await page.mouse.move(0, 0);
        await expect.soft(row, 'The resting icon row has a transparent fill.').toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await ready(row, 'The appearance row must exist before genuine pointer hover.');
        await row.hover();
        await expect.soft(row, 'Real pointer hover paints the pinned theme fill.').toHaveCSS('background-color', hover);
        await textStyle(label, 'Dark mode', ink);
        await page.mouse.move(0, 0);
        await page.keyboard.press('Escape');
        await ready(trigger(page), 'The shared avatar must remain reachable before keyboard opening.');
        await page.keyboard.press('Shift+Tab');
        await reach(page, trigger(page), 'Tab');
        await page.keyboard.press('Enter');
        await reach(page, appearance(page), 'Tab');
        await expect.soft(appearance(page), 'Intentional keyboard focus paints the same pinned fill as hover.').toHaveCSS('background-color', hover);
        await textStyle(appearance(page).getByText('Dark mode', { exact: true }), 'Dark mode', ink);
        await page.keyboard.press('Shift+Tab');
        await expect(trigger(page), 'Reverse traversal must reach the actual avatar without programmatic focus.').toBeFocused({ timeout: 3000 });
        await reach(page, appearance(page), 'Tab');
        await expect.soft(appearance(page), 'Forward traversal restores the visible keyboard focus fill.').toHaveCSS('background-color', hover);
        await info.attach(`avatar-menu-${path === '/' ? 'app' : 'preview'}-${mode}`, { body: await page.screenshot(), contentType: 'image/png' });
        if (mode === 'light') {
          for (const activation of ['keyboard', 'pointer'] as const) {
            const next = activation === 'keyboard' ? 'dark' : 'light';
            await ready(appearance(page), 'The appearance action must exist before observing its live selected indicator.');
            if (activation === 'keyboard') {
              await expect(appearance(page), 'Normal traversal must leave the appearance action focused before keyboard activation.').toBeFocused({ timeout: 3000 });
              await page.keyboard.press('Space');
            } else await appearance(page).click();
            await expect(page.locator('html'), `Actual ${activation} activation must apply ${next} before observing its indicator.`).toHaveCSS('color-scheme', next);
            if (!await menu(page).isVisible()) {
              await ready(trigger(page), 'A dismissed appearance menu must be available to reopen for indicator observation.');
              await trigger(page).click();
            }
            await ready(appearance(page), 'The current appearance action must be visible before observing its updated indicator.');
            await expect(appearance(page), `The live ${next} action state must match the effective page theme.`).toHaveAttribute('aria-checked', String(next === 'dark'));
            const currentIcons = appearance(page).locator('svg:visible');
            await expect(currentIcons, `Actual ${activation} activation to ${next} must ${next === 'dark' ? 'paint' : 'remove'} the selected Check without a forced menu reset.`).toHaveCount(next === 'dark' ? 2 : 1, { timeout: 3000 });
            await paintedIcon(currentIcons.nth(0), moon, 20, next === 'light' ? 'rgb(11, 11, 11)' : 'rgb(249, 249, 247)', `Moon after ${activation} activation`);
            if (next === 'dark') await paintedIcon(currentIcons.nth(1), check, 16, 'rgb(124, 143, 230)', 'Selected Check after keyboard activation');
          }
        }
        await page.goto('about:blank');
      }
    }
  } finally { await page.goto('about:blank'); }
});
