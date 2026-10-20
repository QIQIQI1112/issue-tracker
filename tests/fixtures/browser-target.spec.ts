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

test('browser mutation refuses an API replaced after loading', async ({ page, workspace }, info) => {
  const { OWNED_SWAP_READY: ready, OWNED_SWAP_DONE: replaced, OWNED_SWAP_OBSERVED: observed, OWNED_SWAP_RESTORED: restored, OWNED_MUTATION: method } = process.env;
  if (!ready || !replaced || !observed || !restored || !method) throw new Error('Missing owned browser-swap coordination.');
  await page.goto(appUrl(info));
  await expect(page.getByTestId('issue-1')).toBeVisible();
  let sentIdentity: string | undefined;
  await page.route('**/api/issues{,/**}', async route => {
    if (route.request().method() === method) {
      sentIdentity = route.request().headers()['x-issue-tracker-target'];
      writeFileSync(ready, JSON.stringify({ id: 1, method, sentIdentity }));
      await waitFor(replaced);
    }
    await route.continue();
  });
  const responsePromise = page.waitForResponse(response => response.request().method() === method && response.url().includes('/api/issues'));
  const mutation = page.evaluate(async ({ method, title }) => {
    const path = '/src/ui/client.ts';
    const { apiRequest } = await import(path);
    try {
      await apiRequest(method === 'POST' ? '/api/issues' : '/api/issues/1', { method, ...(method === 'DELETE' ? {} : { body: JSON.stringify({ title }) }) });
      return { error: null };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, { method, title: `${workspace.prefix} Wrong-target draft` });
  const response = await responsePromise;
  writeFileSync(observed, JSON.stringify({ status: response.status(), sentIdentity, body: response.status() === 204 ? '' : await response.text() }));
  await waitFor(restored);
  expect(response.status()).toBe(409);
  expect(sentIdentity).toBe(encodeURIComponent(JSON.stringify([info.project.metadata.instanceId, info.project.metadata.databasePath])));
  expect(await mutation).toEqual({ error: 'Owned API target identity mismatch. Refusing mutation.' });
});
