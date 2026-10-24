import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { inspectNodeReport, parseVerificationContract, snapshot } from '../factory/evidence.ts';
import { processEnvironment } from '../factory/workspace.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory, run } from './helpers/subprocess.ts';

const modes = ['success', 'missing', 'skipped', 'failed', 'source-drift', 'contract-drift'] as const;

for (const mode of modes) {
  test(`critical CI runner enforces ${mode} evidence`, { timeout: 45000 }, async () => {
    assert.ok(existsSync('scripts/verify-ci.mjs'), 'The separate critical CI runner is missing.');
    const root = fixtureRepository(evidenceDirectory(`ci-critical-${mode}`));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, '.runs'));
    copyFileSync(resolve('scripts/verify-ci.mjs'), join(root, 'scripts/verify-ci.mjs'));
    for (const file of ['ci-contract.ts', 'evidence.ts', 'process.ts', 'ownership.ts', 'node-reporter.mjs']) {
      copyFileSync(resolve('factory', file), join(root, 'factory', file));
    }
    writeFileSync(join(root, 'src/value.ts'), `export const value = '${mode === 'failed' ? 'broken' : 'ready'}';\n`);
    writeFileSync(join(root, 'tests/unselected.test.ts'), "import {test} from 'node:test';test('unselected failure',()=>{throw new Error('unselected Node test executed');});\n");
    const contract = {
      schemaVersion: 2,
      profile: 'ci-critical',
      nodeFiles: ['tests/value.test.ts'],
      requiredNodeTests: [{ file: 'tests/value.test.ts', title: mode === 'missing' ? 'missing required case' : 'value is ready' }],
      requiredBrowserTests: [],
    };
    writeFileSync(join(root, 'factory/ci-verification-contract.json'), JSON.stringify(contract));
    const full = { schemaVersion: 2, profile: 'code-only', requiredNodeTests: [...contract.requiredNodeTests, { file: 'tests/unselected.test.ts', title: 'unselected failure' }], requiredBrowserTests: [] };
    writeFileSync(join(root, 'factory/verification-contract.json'), JSON.stringify(full));
    if (mode === 'skipped') writeFileSync(join(root, 'tests/value.test.ts'), "import {test} from 'node:test';test.skip('value is ready',()=>{});\n");
    if (mode === 'source-drift' || mode === 'contract-drift') {
      const path = mode === 'source-drift' ? 'src/value.ts' : 'factory/ci-verification-contract.json';
      const mutation = `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(path)},${JSON.stringify('\n')});\n`;
      writeFileSync(join(root, 'tests/value.test.ts'), mutation + readFileSync(join(root, 'tests/value.test.ts'), 'utf8'));
    }
    const sentinel = '{"fullAcceptance":"untouched"}\n';
    writeFileSync(join(root, '.runs/latest.json'), sentinel);
    const directory = join(root, '.runs/critical');
    const expectedSource = snapshot(root).hash;
    const expectedContract = createHash('sha256').update(readFileSync(join(root, 'factory/ci-verification-contract.json'))).digest('hex');
    const result = await run(process.execPath, ['scripts/verify-ci.mjs'], processEnvironment({ CI_VERIFY_RUN_DIR: directory, VERIFY_STEP_TIMEOUT_MS: '20000', VERIFY_TOTAL_TIMEOUT_MS: '35000', VERIFY_GRACE_MS: '300' }), join(root, 'execution.log'), root, { timeoutMs: 40000 });
    const latest = JSON.parse(readFileSync(join(root, '.runs/ci-latest.json'), 'utf8'));
    assert.equal(latest.summaryPath, join(directory, 'ci-summary.json'));
    const summary = JSON.parse(readFileSync(latest.summaryPath, 'utf8'));
    assert.equal(summary.profile, 'ci-critical');
    assert.equal(summary.contract.profile, 'ci-critical');
    assert.equal(summary.contract.hash, expectedContract);
    assert.equal(summary.snapshot.hash, expectedSource);
    assert.equal(readFileSync(join(root, '.runs/latest.json'), 'utf8'), sentinel);
    if (mode === 'success') {
      assert.equal(result.code, 0, result.output);
      assert.equal(summary.status, 'passed');
      assert.equal(summary.node.passed, 1);
      assert.deepEqual(summary.checks.map((item: { name: string }) => item.name), ['lint', 'typecheck', 'test', 'build']);
      assert.throws(() => inspectNodeReport(join(directory, 'node-results.jsonl'), parseVerificationContract(full).requiredNodeTests), /Missing required Node case/);
    } else {
      assert.equal(result.code, 1, result.output);
      assert.equal(summary.status, 'failed');
      const expected = { missing: /Missing required Node case/, skipped: /summary|skipped/, failed: /test: failed/, 'source-drift': /snapshot changed/, 'contract-drift': /contract changed/ };
      assert.match(summary.error, expected[mode]);
    }
  });
}
