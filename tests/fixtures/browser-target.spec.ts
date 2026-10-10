import { existsSync, writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { appUrl, test } from '../../acceptance/workspace.ts';

async function waitFor(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Owned swap coordination timed out: ${path}`);
}

// Selected only by the Node regression's disposable Playwright config.
test('browser mutation refuses an API replaced after loading', async ({ page, workspace }, info) => {
  const { OWNED_SWAP_READY: ready, OWNED_SWAP_DONE: replaced, OWNED_SWAP_OBSERVED: observed, OWNED_SWAP_RESTORED: restored, OWNED_MUTATION: method } = process.env;
  if (!ready || !replaced || !observed || !restored || !method) throw new Error('Missing owned browser-swap coordination.');
  await page.goto(appUrl(info));
  const row = page.getByTestId('issue-1');
  await expect(row).toBeVisible();
  if (method === 'POST') await page.getByRole('button', { name: 'New issue', exact: true }).click();
  else await row.getByRole('button', { name: method === 'PATCH' ? /^Edit / : /^Delete / }).click();
  const dialog = page.getByRole('dialog');
  if (method !== 'DELETE') await dialog.getByLabel('Title', { exact: true }).fill(`${workspace.prefix} Wrong-target draft`);
  let sentIdentity: string | undefined;
  await page.route('**/api/issues{,/**}', async route => {
    if (route.request().method() === method) {
      sentIdentity = route.request().headers()['x-issue-tracker-target'];
      writeFileSync(ready, JSON.stringify({ id: 1, method, sentIdentity }));
      await waitFor(replaced);
    }
    // Preserve the context guard through real delayed transport.
    await route.continue();
  });
  const responsePromise = page.waitForResponse(response => response.request().method() === method && response.url().includes('/api/issues'));
  await dialog.getByRole('button', { name: method === 'POST' ? 'Create issue' : method === 'PATCH' ? 'Save changes' : 'Delete issue', exact: true }).click();
  const response = await responsePromise;
  writeFileSync(observed, JSON.stringify({ status: response.status(), sentIdentity, body: response.status() === 204 ? '' : await response.text() }));
  // Restore the owned API before ordinary fixture teardown runs.
  await waitFor(restored);
  expect(response.status()).toBe(409);
  expect(sentIdentity).toBe(encodeURIComponent(JSON.stringify([info.project.metadata.instanceId, info.project.metadata.databasePath])));
  await expect(dialog.getByRole('alert')).toHaveText('Owned API target identity mismatch. Refusing mutation.');
});
