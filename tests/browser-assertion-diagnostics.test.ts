import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { proveRegression } from '../factory/regression.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

for (const allowAlreadyPassed of [false, true]) {
  for (const mode of ['custom-assertion', 'setup-error'] as const) test(`${allowAlreadyPassed ? 'initial' : 'regression'} browser proof distinguishes ${mode} from source excerpt text`, { timeout: 15000 }, async () => {
    const root = evidenceDirectory(`browser-diagnostics-${mode}-${allowAlreadyPassed}`);
    const repository = fixtureRepository(join(root, 'repo'));
    const title = 'observable diagnostic behavior';
    const body = mode === 'custom-assertion'
      ? `test(${JSON.stringify(title)},()=>expect(value,'No operation button may remain in the read only interface.').toBe('ready'));`
      : `test.beforeEach(()=>{throw new Error('Fixture setup failed.');expect(value).toBe('ready');});\ntest(${JSON.stringify(title)},()=>expect(value).toBe('ready'));`;
    writeFileSync(join(repository, 'acceptance/diagnostic.spec.ts'), `import {test,expect} from ${JSON.stringify(resolve('node_modules/@playwright/test/index.mjs'))};\nimport {value} from '../src/value.ts';\n${body}\n`);
    const prefix = join(root, 'proof');
    const proof = () => proveRegression({ check: { file: 'diagnostic.spec.ts', title }, browser: true, cwd: repository, prefix, env: { PATH: process.env.PATH }, reporter: resolve('factory/node-reporter.mjs'), timeoutMs: 10000, signal: new AbortController().signal, allowAlreadyPassed });
    if (mode === 'custom-assertion') {
      const result = await proof().catch(error => assert.fail(`A normal custom-message assertion must establish a named behavior proof: ${String(error)}`));
      assert.equal(result.status, 'expected_failure');
      assert.equal(result.file, 'diagnostic.spec.ts');
      assert.equal(result.title, title);
      assert.match(readFileSync(result.reportPath!, 'utf8'), /No operation button may remain/);
    } else {
      await assert.rejects(proof(), /named behavior assertion/);
      const report = readFileSync(`${prefix}.json`, 'utf8');
      assert.match(report, /Fixture setup failed/);
      assert.match(report, /expect\(value\)/, 'The setup error excerpt intentionally contains an expect call.');
    }
  });
}
