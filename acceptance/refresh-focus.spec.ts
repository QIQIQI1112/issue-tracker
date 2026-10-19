import { expect } from '@playwright/test';
import { test } from './workspace.ts';

test('issue openers retain focus through background refresh success and failure', async ({ page, workspace }) => {
  const issue = await workspace.create({ title: 'Refresh focus regression' });
  for (const control of ['identifier', 'title']) for (const outcome of ['success', 'failure']) {
    let armed = false;
    let changed = false;
    let observed = false;
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/workbench', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.jobs = [{ id: -1, status: armed ? 'completed' : 'queued' }];
      if (armed) changed = true;
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/issues', async route => {
      if (changed) {
        observed = true;
        await held;
        if (outcome === 'failure') return route.fulfill({ status: 503, json: { error: 'Owned refresh failure' } });
      }
      await route.continue();
    });
    try {
      await page.goto('/');
      const opener = page.getByRole('button', { name: `${control === 'title' ? 'Inspect' : 'View'} issue ${issue.title}`, exact: true });
      await expect(opener).toBeVisible();
      const handle = await opener.elementHandle();
      expect(handle).not.toBeNull();
      await opener.click();
      const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
      await expect(dialog).toBeVisible();
      armed = true;
      await expect.poll(() => observed, { timeout: 10000 }).toBe(true);
      await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'true');
      expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
      release();
      await expect(page.getByRole('region', { name: 'Issue list', exact: true })).toHaveAttribute('aria-busy', 'false');
      if (outcome === 'failure') await expect(page.getByText('Owned refresh failure', { exact: false })).toBeVisible();
      if (control === 'identifier') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
});
