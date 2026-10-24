import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { test } from './workspace.ts';
import { repositoryButton, repositoryFixture } from './repository-fixture.ts';

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Workspace views', exact: true });
const rail = (page: Page) => page.getByRole('complementary').filter({ has: navigation(page) });
const toggle = (page: Page) => rail(page).getByRole('button', { name: /(?:Expand|Collapse) navigation rail/ });
const fastEase = 'cubic-bezier(0.4, 0, 0.2, 1)';
const expansionEase = 'cubic-bezier(0.22, 1, 0.36, 1)';
const glyphs = {
  list: '<path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  chevrons: '<path d="m11 17-5-5 5-5m7 10-5-5 5-5"/>',
};

async function ready(control: Locator, reason: string) {
  await expect(control, reason).toBeVisible({ timeout: 3000 });
  await expect(control, reason).toBeEnabled();
}

async function click(control: Locator) {
  await ready(control, 'The named toolbar control must exist before activation.');
  await control.click();
}

async function reach(page: Page, control: Locator, key: 'Tab' | 'Shift+Tab') {
  await ready(control, 'The toolbar destination must exist before ordinary keyboard traversal.');
  for (let step = 0; step < 80; step++) {
    if (await control.evaluate(element => element === document.activeElement)) break;
    await page.keyboard.press(key);
  }
  await expect(control, `Normal ${key} traversal must reach the toolbar control.`).toBeFocused({ timeout: 3000 });
}

async function transition(control: Locator, property: string, duration: number, easing: string) {
  const observed = await control.evaluate((element, property) => {
    const style = getComputedStyle(element);
    const properties = style.transitionProperty.split(',').map(value => value.trim());
    const durations = style.transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000));
    const easings = style.transitionTimingFunction.match(/cubic-bezier\([^)]*\)|steps\([^)]*\)|[\w-]+/g) ?? [];
    const equivalent = property === 'padding' ? ['padding', 'padding-left', 'padding-inline', 'padding-inline-start'] : [property];
    const index = properties.findLastIndex(value => equivalent.includes(value) || value === 'all');
    return index < 0 ? null : { duration: durations[index % durations.length], easing: easings[index % easings.length] };
  }, property);
  expect.soft(observed, `${property} must use the pinned ${duration}ms transition and easing.`).toEqual({ duration, easing });
}

async function visibleText(control: Locator) {
  return control.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const painted: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const visible = [...range.getClientRects()].some(rect => {
        let left = Math.max(0, rect.left);
        let right = Math.min(innerWidth, rect.right);
        let top = Math.max(0, rect.top);
        let bottom = Math.min(innerHeight, rect.bottom);
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
          if (style.clipPath === 'inset(50%)' || /^rect\(0px[ ,]+0px[ ,]+0px[ ,]+0px\)$/.test(style.clip)) return false;
          const box = parent.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
            left = Math.max(left, box.left);
            right = Math.min(right, box.right);
          }
          if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
            top = Math.max(top, box.top);
            bottom = Math.min(bottom, box.bottom);
          }
        }
        return right > left && bottom > top;
      });
      if (visible) painted.push(text);
    }
    return painted;
  });
}

async function paintedStroke(control: Locator, ink: string) {
  const svg = control.locator('svg');
  await expect(svg, 'The named toolbar control must contain one icon before observing its unnormalized stroke ink.').toHaveCount(1);
  await expect(svg, 'Toolbar stroke ink must be observed on a rendered icon.').toBeVisible({ timeout: 3000 });
  const segments = await svg.evaluate(element => [...element.querySelectorAll('path, ellipse, circle, line, polyline, polygon, rect')].map(shape => {
    const style = getComputedStyle(shape);
    let opacity = parseFloat(style.strokeOpacity) / (style.strokeOpacity.endsWith('%') ? 100 : 1);
    for (let node: Element | null = shape; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return { stroke: style.stroke, opacity };
  }));
  expect.soft(segments.length, 'The toolbar icon must contain painted drawing segments before stroke ink is assessed.').toBeGreaterThan(0);
  for (const segment of segments) expect.soft(segment, 'Every toolbar glyph segment paints the required light ink at full effective opacity before color normalization.').toEqual({ stroke: ink, opacity: 1 });
}

async function icon(control: Locator, drawing: string, rotation = 0) {
  const svg = control.locator('svg');
  await expect(svg, 'Each toolbar control must expose one rendered SVG icon.').toHaveCount(1);
  await expect(svg, 'Toolbar SVG geometry must be visible before measuring it.').toBeVisible({ timeout: 3000 });
  const observed = await svg.evaluate(async (element, reference) => {
    const root = element as SVGSVGElement;
    const rect = root.getBoundingClientRect();
    const controlBox = root.closest('button')!.getBoundingClientRect();
    const controlStyle = getComputedStyle(root.closest('button')!);
    const shapes = [...root.querySelectorAll('path, ellipse, circle, line, polyline, polygon, rect')];
    const styles = shapes.map(shape => {
      const style = getComputedStyle(shape);
      return { stroke: parseFloat(style.strokeWidth), cap: style.strokeLinecap, join: style.strokeLinejoin, fill: style.fill };
    });
    let slotBox: { x: number; width: number } | null = null;
    for (let layout = root.parentElement; layout; layout = layout.parentElement) {
      const box = layout.getBoundingClientRect();
      const style = getComputedStyle(layout);
      if (layout !== root.closest('button') && Math.abs(box.width - 24) <= 0.5) {
        slotBox = box;
        break;
      }
      if (style.display === 'grid' || style.display === 'inline-grid') {
        const firstColumn = parseFloat(style.gridTemplateColumns.replace(/\[[^\]]*\]/g, '').trim());
        if (Number.isFinite(firstColumn) && Math.abs(firstColumn - 24) <= 0.5) {
          slotBox = { x: box.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), width: firstColumn };
          break;
        }
      }
      if (layout === root.closest('button')) break;
    }
    const clone = root.cloneNode(true) as SVGSVGElement;
    const originals = [root, ...root.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    for (let index = 0; index < originals.length; index++) {
      const style = getComputedStyle(originals[index]);
      const copy = copies[index];
      copy.removeAttribute('class');
      copy.removeAttribute('style');
      copy.setAttribute('fill', style.fill === 'none' ? 'none' : 'black');
      copy.setAttribute('stroke', style.stroke === 'none' ? 'none' : 'black');
      copy.setAttribute('stroke-width', style.strokeWidth);
      copy.setAttribute('stroke-linecap', style.strokeLinecap);
      copy.setAttribute('stroke-linejoin', style.strokeLinejoin);
      copy.setAttribute('opacity', style.opacity);
      copy.setAttribute('stroke-opacity', style.strokeOpacity);
      copy.setAttribute('fill-opacity', style.fillOpacity);
      copy.setAttribute('visibility', style.visibility);
      if (originals[index] !== root) {
        copy.setAttribute('style', `transform:${style.transform};transform-origin:${style.transformOrigin};rotate:${style.rotate}`);
      }
    }
    let angle = 0;
    for (let node: Element | null = root; node && node !== root.closest('button'); node = node.parentElement) {
      const style = getComputedStyle(node);
      angle += style.rotate === 'none' ? 0 : parseFloat(style.rotate);
      if (style.transform !== 'none') {
        const matrix = new DOMMatrix(style.transform);
        angle += Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      }
    }
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '192');
    clone.setAttribute('height', '192');
    clone.removeAttribute('transform');
    clone.removeAttribute('style');
    const rotated = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    rotated.setAttribute('transform', `rotate(${angle} 12 12)`);
    while (clone.firstChild) rotated.appendChild(clone.firstChild);
    clone.appendChild(rotated);
    const expected = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(${reference.rotation} 12 12)">${reference.drawing}</g></svg>`;
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
    const actual = await raster(new XMLSerializer().serializeToString(clone));
    const target = await raster(expected);
    let difference = 0;
    let ink = 0;
    for (let index = 3; index < actual.length; index += 4) {
      difference += Math.abs(actual[index] - target[index]);
      ink += target[index];
    }
    return { width: rect.width, height: rect.height, styles, slotWidth: slotBox?.width, centered: slotBox ? Math.abs(rect.x + rect.width / 2 - slotBox.x - slotBox.width / 2) <= 0.5 : false, aligned: slotBox ? Math.abs(slotBox.x - controlBox.x - parseFloat(controlStyle.paddingLeft)) <= 1 : false, difference: difference / ink };
  }, { drawing, rotation });
  expect.soft(observed.width, 'Toolbar icons render at 20px width.').toBeCloseTo(20, 1);
  expect.soft(observed.height, 'Toolbar icons render at 20px height.').toBeCloseTo(20, 1);
  expect.soft(observed.slotWidth ?? 0, 'Toolbar icons occupy fixed 24px slots.').toBeCloseTo(24, 1);
  expect.soft(observed.centered, 'The 20px glyph is centered in its icon slot.').toBe(true);
  expect.soft(observed.aligned, 'The icon slot starts at the reference row padding.').toBe(true);
  expect.soft(observed.styles.length, 'The rendered SVG must contain actual drawing geometry.').toBeGreaterThan(0);
  for (const style of observed.styles) expect.soft(style, 'Every rendered glyph segment uses actual 1.5px round Lucide strokes without solid fill.').toEqual({ stroke: 1.5, cap: 'round', join: 'round', fill: 'none' });
  expect.soft(observed.difference, 'Rendered drawing must match the pinned Lucide geometry and direction, allowing equivalent SVG path encoding.').toBeLessThan(0.03);
}

test('toolbar colors typography and real hover match the pinned light UTG reference', async ({ page }, info) => {
  test.setTimeout(90000);
  const f = repositoryFixture(info);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => localStorage.setItem('loop.theme', 'light'));
    await page.goto('/');
    await expect(page.locator('html'), 'Fidelity observations must run in the light workspace.').toHaveCSS('color-scheme', 'light');
    const all = repositoryButton(page, null);
    const other = repositoryButton(page, f.first);
    const text = 'rgb(11, 11, 11)';
    const selected = 'rgb(237, 236, 232)';
    const hover = 'rgb(243, 243, 240)';
    await ready(other, 'The long-name repository must be available before genuine unfocused pointer discovery.');
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect.soft(rail(page), 'Toolbar frame uses the pinned light surface.').toHaveCSS('background-color', 'rgb(252, 252, 251)');
    await expect.soft(all).toHaveCSS('background-color', selected);
    for (const row of [all, other, toggle(page)]) {
      await ready(row, 'Toolbar typography must be measured on a visible named control.');
      await paintedStroke(row, text);
      await expect.soft(row).toHaveCSS('color', text);
      await expect.soft(row).toHaveCSS('font-size', '14px');
      await expect.soft(row).toHaveCSS('line-height', '20px');
      await expect.soft(row).toHaveCSS('font-weight', '400');
      await expect.soft(row, 'Toolbar text uses antialiased rendering.').toHaveCSS('-webkit-font-smoothing', 'antialiased');
      const font = await row.evaluate(element => getComputedStyle(element).fontFamily);
      expect.soft(font, 'Toolbar text retains an equivalent local Han/system font cascade.').toMatch(/(?:Loop Han|Pulse Han).*system-ui/);
      await transition(row, 'background-color', 140, fastEase);
      await transition(row, 'color', 140, fastEase);
    }
    await expect(other, 'Pointer discovery must be tested without keyboard focus on this repository.').not.toBeFocused();
    await expect(other.locator('svg'), 'The inactive icon must render before comparing hover geometry.').toBeVisible({ timeout: 3000 });
    const restingIcon = await other.locator('svg').boundingBox();
    await other.hover();
    await expect.soft(other, 'An inactive row reaches the pinned hover fill.').toHaveCSS('background-color', hover);
    const hoveredIcon = await other.locator('svg').boundingBox();
    expect.soft(hoveredIcon?.width, 'Hover leaves the rendered icon width unchanged.').toBe(restingIcon?.width);
    expect.soft(hoveredIcon?.height, 'Hover leaves the rendered icon height unchanged.').toBe(restingIcon?.height);
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip, 'An unfocused hovered repository reveals its application-generated full name.').toBeVisible({ timeout: 3000 });
    await expect(tooltip).toHaveText(f.first.name);
    await expect(tooltip).toBeInViewport({ ratio: 1 });
    await expect(other, 'Hover must not claim keyboard focus.').not.toBeFocused();
    await ready(all, 'The selected row must exist before testing selected hover precedence.');
    await all.hover();
    await expect.soft(all, 'Hovering a selected row retains the selected fill.').toHaveCSS('background-color', selected);
    await expect.soft(other, 'Leaving an inactive row restores its transparent surface.').toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await click(other);
    await expect(other, 'The repository must be selected before observing its subviews.').toHaveAttribute('aria-pressed', 'true');
    const requirements = navigation(page).getByRole('button', { name: 'Requirements', exact: true });
    await click(requirements);
    await expect(requirements, 'The named Requirements subview must independently report its current state.').toHaveAttribute('aria-current', 'page');
    const refresh = navigation(page).getByRole('button', { name: 'Refresh repositories', exact: true });
    for (const row of [requirements, refresh]) await paintedStroke(row, text);
    await page.mouse.move(1200, 10);
    expect(await requirements.evaluate(element => element.matches(':hover')), 'Resting selected-subview observations must run without pointer hover.').toBe(false);
    await expect.soft(requirements, 'The current subview uses the pinned selected fill before hover.').toHaveCSS('background-color', selected);
    await expect.soft(requirements, 'The current subview has no inset selection stripe before hover.').toHaveCSS('box-shadow', 'none');
    await ready(requirements, 'The current subview must exist before observing real selected hover.');
    await requirements.hover();
    await expect.soft(requirements, 'Hovering the current subview retains the pinned selected fill.').toHaveCSS('background-color', selected);
    await expect.soft(requirements, 'Hovering the current subview does not restore an inset selection stripe.').toHaveCSS('box-shadow', 'none');
    await click(toggle(page));
    await expect(toggle(page), 'Visible-label typography is observed with the navigation rail expanded.').toHaveAttribute('aria-expanded', 'true');
    for (const [row, name] of [[all, 'All repositories'], [other, f.first.name], [requirements, 'Requirements'], [refresh, 'Refresh repositories']] as const) {
      const label = row.getByText(name, { exact: true });
      await expect(label, 'The named expanded navigation label must be visible before its typography is measured.').toBeVisible({ timeout: 3000 });
      await expect.poll(() => visibleText(label), { timeout: 3000, message: 'Expanded typography must be measured on the painted label rather than a hidden control label.' }).not.toEqual([]);
      const style = await label.evaluate(element => {
        const computed = getComputedStyle(element);
        return { color: computed.color, fontSize: computed.fontSize, lineHeight: computed.lineHeight, fontWeight: computed.fontWeight, smoothing: computed.getPropertyValue('-webkit-font-smoothing'), fontFamily: computed.fontFamily };
      });
      expect.soft(style, 'Visible expanded labels use pinned light text, 14px/20px regular typography and antialiased rendering in the light workspace.').toMatchObject({ color: text, fontSize: '14px', lineHeight: '20px', fontWeight: '400', smoothing: 'antialiased' });
      expect.soft(style.fontFamily, 'Visible expanded labels retain the equivalent local Han/system font cascade.').toMatch(/(?:Loop Han|Pulse Han).*system-ui/);
    }
    await click(toggle(page));
    await expect(toggle(page), 'Collapsed full-name discovery is restored before checking active-tooltip cleanup.').toHaveAttribute('aria-expanded', 'false');
    await ready(other, 'The selected repository must exist before restoring active tooltip discovery.');
    await other.hover();
    await expect(tooltip, 'The active hover label must exist before leaving the workspace.').toBeVisible({ timeout: 3000 });
    await page.goto('about:blank');
    await expect(tooltip, 'Leaving with an active hover label cleans up the portal.').toHaveCount(0);
  } finally { await page.goto('about:blank'); f.close(); }
});

test('toolbar Lucide geometry spacing and expansion motion match the pinned UTG reference', async ({ page }, info) => {
  test.setTimeout(90000);
  const f = repositoryFixture(info);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await click(repositoryButton(page, f.first));
    const requirements = navigation(page).getByRole('button', { name: 'Requirements', exact: true });
    await click(requirements);
    await expect(requirements, 'Geometry and stripe observations must include the selected named subview.').toHaveAttribute('aria-current', 'page');
    const rows = [repositoryButton(page, null), repositoryButton(page, f.first), requirements, navigation(page).getByRole('button', { name: 'Refresh repositories', exact: true })];
    const drawings = [glyphs.list, glyphs.database, glyphs.check, glyphs.arrow];
    await expect.soft(rail(page)).toHaveCSS('padding', '8px 12px 12px');
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      await ready(row, 'Each representative repository and subview row must render before fidelity measurements.');
      await icon(row, drawings[index]);
      await expect.soft(row).toHaveCSS('min-height', '32px');
      expect.soft((await row.boundingBox())?.height ?? 0, 'Collapsed toolbar rows render at the reference 32px height.').toBeCloseTo(32, 1);
      await expect.soft(row).toHaveCSS('border-radius', '8px');
      await expect.soft(row).toHaveCSS('column-gap', '8px');
      await expect.soft(row).toHaveCSS('padding', '0px 12px 0px 6px');
      await expect.soft(row, 'Navigation has no inset selection stripe.').toHaveCSS('box-shadow', 'none');
      await transition(row, 'padding', 220, expansionEase);
    }
    const separation = await rows[0].evaluate(element => {
      const next = element.nextElementSibling;
      return next ? next.getBoundingClientRect().top - element.getBoundingClientRect().bottom : null;
    });
    expect.soft(separation ?? 0, 'Adjacent toolbar rows retain 2px separation.').toBeCloseTo(2, 1);
    const workspace = page.locator('.workspace');
    await transition(workspace, 'grid-template-columns', 220, expansionEase);
    const button = toggle(page);
    await ready(button, 'The accessible icon-only expansion control must exist.');
    await expect(button).toHaveAccessibleName('Expand navigation rail');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await icon(button, glyphs.chevrons, 180);
    expect.soft((await button.boundingBox())?.width ?? 0, 'Collapsed expansion control has intrinsic 42px width.').toBeCloseTo(42, 1);
    expect.soft(await visibleText(button), 'Expansion control has no painted text label, allowing visually hidden accessible text.').toEqual([]);
    await transition(button, 'padding', 220, expansionEase);
    const rotationTransition = await button.locator('svg').evaluate((element, expectedEase) => {
      for (let node: Element | null = element; node && node !== element.closest('button'); node = node.parentElement) {
        const style = getComputedStyle(node);
        const properties = style.transitionProperty.split(',').map(value => value.trim());
        const durations = style.transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000));
        const easings = style.transitionTimingFunction.match(/cubic-bezier\([^)]*\)|steps\([^)]*\)|[\w-]+/g) ?? [];
        if (properties.some((property, index) => ['rotate', 'transform', 'all'].includes(property) && Math.abs(durations[index % durations.length] - 220) < 0.1 && easings[index % easings.length] === expectedEase)) return true;
      }
      return false;
    }, expansionEase);
    expect.soft(rotationTransition, 'Chevron rotation uses the pinned 220ms expansion easing.').toBe(true);
    await reach(page, button, 'Tab');
    const expansionWidths = rail(page).evaluate(element => new Promise<number[]>(resolve => {
      const samples: number[] = [];
      const started = performance.now();
      function sample() {
        samples.push(element.getBoundingClientRect().width);
        if (performance.now() - started < 300) requestAnimationFrame(sample);
        else resolve(samples);
      }
      requestAnimationFrame(sample);
    }));
    await page.keyboard.press('Enter');
    expect.soft((await expansionWidths).some(width => width > 61 && width < 255), 'Normal-motion expansion must render intermediate rail widths instead of jumping directly to the final size.').toBe(true);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).toHaveAccessibleName('Collapse navigation rail');
    await expect.poll(async () => (await rail(page).boundingBox())?.width ?? 0, { message: 'Desktop expansion must settle at the reference 256px rail width.' }).toBeCloseTo(256, 0);
    await expect(button, 'Expanding must preserve focus on the control that owns the action.').toBeFocused();
    await icon(button, glyphs.chevrons);
    expect.soft((await button.boundingBox())?.width ?? 0, 'Expanded icon-only control has intrinsic 48px width.').toBeCloseTo(48, 1);
    expect.soft(await visibleText(button), 'Expanded toggle remains icon-only, allowing visually hidden accessible text.').toEqual([]);
    await expect.soft(rows[0]).toHaveCSS('padding', '0px 12px');
    const label = rows[1].getByText(f.first.name, { exact: true });
    await expect(label, 'Expanded long repository name remains readable.').toBeVisible({ timeout: 3000 });
    await expect(label).toBeInViewport({ ratio: 1 });
    await transition(label, 'opacity', 140, fastEase);
    await reach(page, rows[1], 'Shift+Tab');
    await reach(page, button, 'Tab');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const control of [workspace, button, button.locator('svg'), rows[0], label]) {
      const durations = await control.evaluate(element => getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000)));
      expect.soft(Math.max(...durations), 'Reduced-motion preference suppresses toolbar expansion and hover transitions.').toBeLessThanOrEqual(1);
    }
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await rail(page).boundingBox())?.width ?? 0).toBeCloseTo(60, 0);
    await expect(button, 'Reduced-motion collapse must preserve intentional keyboard focus.').toBeFocused();
    await expect(repositoryButton(page, f.first), 'Rail motion preserves the selected repository.').toHaveAttribute('aria-pressed', 'true');
  } finally { await page.goto('about:blank'); f.close(); }
});
