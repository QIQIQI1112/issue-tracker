import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export type ThemeMode = 'light' | 'dark';

export async function withThemeControl<T>(page: Page, observe: (control: Locator) => Promise<T>): Promise<T> {
  const direct = page.getByRole('switch', { name: /dark (?:mode|theme)/i });
  const trigger = page.getByRole('button', { name: 'User menu', exact: true });
  await expect.poll(async () => await direct.isVisible() || await trigger.isVisible(), { timeout: 3000, message: 'Theme switching must have a visible standalone control or named User menu entry.' }).toBe(true);
  if (await direct.isVisible()) {
    await expect(direct, 'The named theme control must be enabled.').toBeEnabled();
    return observe(direct);
  }
  const menu = page.getByRole('menu', { name: 'User menu', exact: true });
  await expect(trigger, 'Theme switching must have a visible standalone control or named User menu entry.').toBeVisible({ timeout: 3000 });
  await expect(trigger, 'The User menu entry must be enabled.').toBeEnabled();
  const opened = !await menu.isVisible();
  const previousFocus = opened ? await page.evaluateHandle(() => document.activeElement) : null;
  try {
    if (opened) await trigger.press('Enter');
    await expect(menu, 'Opening User menu must expose the named appearance menu.').toBeVisible({ timeout: 3000 });
    const control = menu.getByRole('switch', { name: /dark (?:mode|theme)/i }).or(menu.getByRole('menuitemcheckbox', { name: /dark (?:mode|theme)/i }));
    await expect(control, 'The opened User menu must expose a visible named theme control.').toBeVisible({ timeout: 3000 });
    await expect(control, 'The named theme control must be enabled.').toBeEnabled();
    return await observe(control);
  } finally {
    if (opened && await menu.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(menu, 'An observation must restore an initially closed User menu.').toBeHidden({ timeout: 3000 });
    }
    if (previousFocus) {
      await previousFocus.evaluate(element => {
        if (element instanceof HTMLElement && element.isConnected) {
          if (element === document.body && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          else element.focus({ preventScroll: true });
        }
      });
      await previousFocus.dispose();
    }
  }
}

export async function expectThemeMode(page: Page, expected: ThemeMode) {
  await withThemeControl(page, async control => {
    await expect(control, 'The control state must exactly match the effective theme.').toHaveAttribute('aria-checked', String(expected === 'dark'));
    await expect.poll(() => page.locator('html').evaluate(element => getComputedStyle(element).colorScheme), { message: 'The rendered root must apply the selected native color scheme.' }).toBe(expected);
  });
}
