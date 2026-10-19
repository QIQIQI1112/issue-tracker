import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evidenceDirectory, run } from './helpers/subprocess.ts';
import { processEnvironment } from '../factory/workspace.ts';

test('Node verification executes every isolated file with its configured concurrency and rejects invalid limits before spawning', { timeout: 30000 }, async () => {
  const root = evidenceDirectory('node-concurrency');
  for (const directory of ['scripts', 'tests', 'active', 'observed']) mkdirSync(join(root, directory));
  copyFileSync(resolve('scripts/test.mjs'), join(root, 'scripts/test.mjs'));
  symlinkSync(resolve('factory'), join(root, 'factory'), 'dir');
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  for (let index = 0; index < 3; index += 1) writeFileSync(join(root, 'tests', `${index}.test.ts`), [
    "import {test} from 'node:test';",
    "import {writeFileSync,readdirSync,unlinkSync} from 'node:fs';",
    "import {join} from 'node:path';",
    "test('isolated worker',async()=>{",
    "const root=process.env.NODE_CONCURRENCY_ROOT;",
    "const marker=join(root,'active',String(process.pid));writeFileSync(marker,'active');",
    "let peak=0;try{for(let tick=0;tick<100;tick++){peak=Math.max(peak,readdirSync(join(root,'active')).length);await new Promise(resolve=>setTimeout(resolve,20));}}",
    "finally{unlinkSync(marker);writeFileSync(join(root,'observed',String(process.pid)),JSON.stringify({peak}));}",
    '});',
  ].join('\n'));
  const env = processEnvironment({ RUN_DIR: join(root, 'reports'), NODE_CONCURRENCY_ROOT: root, NODE_TEST_CONCURRENCY: '2' });
  const result = await run(process.execPath, ['scripts/test.mjs'], env, join(root, 'configured.log'), root, { timeoutMs: 15000 });
  assert.equal(result.code, 0, result.output);
  const observed = readdirSync(join(root, 'observed'));
  assert.equal(observed.length, 3, 'Every discovered test file must execute.');
  const peak = Math.max(...observed.map(name => (JSON.parse(readFileSync(join(root, 'observed', name), 'utf8')) as { peak: number }).peak));
  assert.equal(peak, 2, 'Configured file scheduling must overlap two workers and never exceed two.');
  assert.deepEqual(readdirSync(join(root, 'active')), []);
  const invalid = await run(process.execPath, ['scripts/test.mjs'], { ...env, NODE_TEST_CONCURRENCY: '0', RUN_DIR: join(root, 'invalid-reports') }, join(root, 'invalid.log'), root, { timeoutMs: 5000 });
  assert.equal(invalid.code, 1, invalid.output);
  assert.match(invalid.output, /NODE_TEST_CONCURRENCY must be a positive integer/);
  assert.deepEqual(readdirSync(join(root, 'observed')).sort(), observed.sort(), 'Invalid limits must not spawn additional test workers.');
  writeFileSync(join(root, 'observation.json'), JSON.stringify({ executed: observed.length, peak, invalidExit: invalid.code }));
});
