import { expect } from '@playwright/test';
import { test } from './workspace.ts';

type CollapseProbe = { sampled: boolean; animations: Animation[] };
type ProbeWindow = Window & { toolbarCollapseProbe?: CollapseProbe };

test('toolbar labels remain painted during the normal-motion collapse fade', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('loop.theme', 'light'));
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Workspace views', exact: true });
  const sidebar = page.getByRole('complementary').filter({ has: navigation });
  const expand = sidebar.getByRole('button', { name: 'Expand navigation rail', exact: true });
  await expect(expand, 'The expansion control must exist before starting the collapse-fade scenario.').toBeVisible({ timeout: 3000 });
  await expect(expand).toBeEnabled();
  await expand.click();
  const collapse = sidebar.getByRole('button', { name: 'Collapse navigation rail', exact: true });
  await expect(collapse, 'The expanded rail must expose its named collapse control.').toBeVisible({ timeout: 3000 });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0, {
    timeout: 3000,
    message: 'Expansion must settle before observing a fresh collapse transition.',
  }).toBeCloseTo(256, 0);

  const row = navigation.getByRole('button', { name: 'All repositories', exact: true });
  const label = row.locator('.nav-text');
  await expect(label, 'The toolbar label itself must render independently of the matching main-area breadcrumb.').toBeVisible({ timeout: 3000 });
  await expect(label).toHaveText('All repositories');
  await expect(label).toHaveCSS('opacity', '1');
  await label.evaluate(element => {
    const workspace = element.closest('.workspace')!;
    const probe: CollapseProbe = { sampled: false, animations: [] };
    (window as ProbeWindow).toolbarCollapseProbe = probe;
    function sample(event: Event) {
      if (event.target !== element || (event as TransitionEvent).propertyName !== 'opacity') return;
      probe.animations = workspace.getAnimations({ subtree: true });
      for (const animation of probe.animations) {
        animation.pause();
        animation.currentTime = 70;
      }
      probe.sampled = true;
      workspace.removeEventListener('transitionrun', sample);
    }
    workspace.addEventListener('transitionrun', sample);
  });

  try {
    await expect(collapse, 'The collapse control must remain actionable before sampling its real transition.').toBeVisible({ timeout: 3000 });
    await expect(collapse).toBeEnabled();
    await collapse.click();
    await expect.poll(() => page.evaluate(() => (window as ProbeWindow).toolbarCollapseProbe?.sampled ?? false), {
      timeout: 3000,
      message: 'Normal-motion collapse must start a real label-opacity transition for intermediate-frame observation.',
    }).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const frame = await label.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      let effectiveOpacity = 1;
      let visible = true;
      const ancestors: { element: Element; style: CSSStyleDeclaration }[] = [];
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        effectiveOpacity *= Number(style.opacity);
        visible &&= style.display !== 'none' && style.visibility === 'visible';
        ancestors.push({ element: parent, style });
      }
      const clips = [...range.getClientRects()].map(rect => {
        let left = Math.max(0, rect.left);
        let right = Math.min(innerWidth, rect.right);
        let top = Math.max(0, rect.top);
        let bottom = Math.min(innerHeight, rect.bottom);
        for (const ancestor of ancestors) {
          const box = ancestor.element.getBoundingClientRect();
          if (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.style.overflowX)) {
            left = Math.max(left, box.left);
            right = Math.min(right, box.right);
          }
          if (['hidden', 'clip', 'auto', 'scroll'].includes(ancestor.style.overflowY)) {
            top = Math.max(top, box.top);
            bottom = Math.min(bottom, box.bottom);
          }
        }
        return { x: left, y: top, width: right - left, height: bottom - top };
      }).filter(rect => rect.width > 1 && rect.height > 1);
      return {
        opacity: Number(getComputedStyle(element).opacity),
        effectiveOpacity,
        clip: visible && effectiveOpacity > 0 ? clips[0] ?? null : null,
      };
    });
    expect(frame.opacity, 'The sampled label must be partway through its fade, rather than at either endpoint.').toBeGreaterThan(0);
    expect(frame.opacity, 'The sampled label must already have begun fading.').toBeLessThan(1);
    const width = (await sidebar.boundingBox())?.width ?? 0;
    expect(width, 'The sampled frame must occur while the rail is contracting.').toBeGreaterThan(60);
    expect(width, 'The rail must have left its fully expanded endpoint.').toBeLessThan(256);
    expect(frame.clip, 'Partially faded toolbar text must retain a paintable area through every clipping ancestor during collapse.').not.toBeNull();

    if (frame.clip) {
      const painted = await page.screenshot({ clip: frame.clip, animations: 'allow', caret: 'hide' });
      const previousStyle = await label.getAttribute('style');
      try {
        await label.evaluate(element => (element as HTMLElement).style.setProperty('visibility', 'hidden', 'important'));
        const background = await page.screenshot({ clip: frame.clip, animations: 'allow', caret: 'hide' });
        expect(painted.equals(background), 'The intermediate frame must contain actual rendered label ink, separately from accessible names and source text.').toBe(false);
      } finally {
        await label.evaluate((element, style) => {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        }, previousStyle);
      }
    }

    await page.evaluate(() => {
      for (const animation of (window as ProbeWindow).toolbarCollapseProbe?.animations ?? []) animation.play();
    });
    await expect(sidebar.getByRole('button', { name: 'Expand navigation rail', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(label, 'The label must finish fading after the sampled frame is released.').toHaveCSS('opacity', '0');
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0, {
      timeout: 3000,
      message: 'The painted intermediate fade must still settle at the existing collapsed rail width.',
    }).toBeCloseTo(60, 0);
  } finally {
    await page.goto('about:blank');
  }
});
