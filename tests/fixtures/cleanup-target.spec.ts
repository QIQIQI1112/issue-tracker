import { existsSync, writeFileSync } from 'node:fs';
import { test } from '../../acceptance/workspace.ts';

// Selected only by the Node regression's disposable Playwright config.
test('cleanup refuses a replacement target', async ({ workspace }) => {
  const ready = process.env.OWNED_SWAP_READY;
  const replaced = process.env.OWNED_SWAP_DONE;
  if (!ready || !replaced) throw new Error('Missing owned target-swap coordination paths.');
  await workspace.create({ title: 'Original fixture' });
  writeFileSync(ready, JSON.stringify({ prefix: workspace.prefix }));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(replaced)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Owned replacement API did not become ready.');
});
