import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePlan, parseTask } from '../factory/contracts.ts';
import { parseVerificationContract } from '../factory/evidence.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory, run } from './helpers/subprocess.ts';

const required = { file: 'tests/value.test.ts', title: 'value is ready' };
const contract = { schemaVersion: 2, profile: 'code-only', requiredNodeTests: [required], requiredBrowserTests: [] };
const modes = ['valid', 'missing-report', 'missing-case', 'skipped', 'failed', 'lint', 'typecheck', 'build'] as const;

for (const mode of modes) test(`code-only verification enforces ${mode} with four code gates and no browser dependency`, { timeout: 30000 }, async () => {
  const repository = fixtureRepository(evidenceDirectory(`code-only-${mode}`));
  mkdirSync(join(repository, '.runs'), { recursive: true });
  writeFileSync(join(repository, 'src/value.ts'), `export const value = '${mode === 'failed' ? 'broken' : 'ready'}';\n`);
  if (mode === 'skipped') writeFileSync(join(repository, required.file), "import {test} from 'node:test';test.skip('value is ready',()=>{});\n");
  if (mode === 'missing-case') writeFileSync(join(repository, required.file), "import {test} from 'node:test';test('unrelated passing case',()=>{});\n");
  const pkg = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  if (mode === 'missing-report') pkg.scripts.test = 'node -e "process.exit(0)"';
  if (['lint', 'typecheck', 'build'].includes(mode)) pkg.scripts[mode] = 'node -e "process.exit(7)"';
  assert.equal('test:e2e' in pkg.scripts, false, 'Fixture must not provide a browser script.');
  assert.equal(existsSync(join(repository, 'playwright.config.ts')), false);
  writeFileSync(join(repository, 'package.json'), JSON.stringify(pkg));
  const directory = join(repository, '.runs/verification');
  const result = await run(process.execPath, [resolve('scripts/verify.mjs')], { ...process.env, VERIFY_RUN_DIR: directory, VERIFY_CONTRACT_PATH: join(repository, 'factory/verification-contract.json'), VERIFY_STEP_TIMEOUT_MS: '10000', VERIFY_TOTAL_TIMEOUT_MS: '20000' }, join(repository, '.runs/execution.log'), repository, { timeoutMs: 25000 });
  const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(existsSync(join(directory, 'browser-results.json')), false);
  if (mode === 'valid') {
    assert.equal(result.code, 0, result.output);
    assert.equal(summary.status, 'passed');
    assert.equal(summary.profile, 'code-only');
    assert.deepEqual(summary.checks.map((item: { name: string }) => item.name), ['lint', 'typecheck', 'test', 'build']);
    assert.ok(summary.checks.every((item: { status: string }) => item.status === 'passed'));
    assert.deepEqual(summary.node, { passed: 1, required: 1 });
    assert.equal(summary.browser, undefined);
  } else {
    assert.equal(result.code, 1, result.output);
    assert.equal(summary.status, 'failed');
    const expected = { 'missing-report': /report|ENOENT/i, 'missing-case': /Missing required Node case/, skipped: /summary|skip/i, failed: /test: failed/, lint: /lint: failed/, typecheck: /typecheck: failed/, build: /build: failed/ };
    assert.match(summary.error, expected[mode]);
  }
});

test('code-only contract requires named Node proofs and rejects browser or historical profiles', () => {
  assert.deepEqual(parseVerificationContract(contract), contract);
  for (const input of [
    { ...contract, schemaVersion: 1 },
    { ...contract, profile: 'full' },
    { ...contract, requiredNodeTests: [] },
    { ...contract, requiredNodeTests: [required, required] },
    { ...contract, requiredNodeTests: [{ ...required, file: '../outside.test.ts' }] },
    { ...contract, requiredNodeTests: [{ ...required, title: '' }] },
    { ...contract, requiredBrowserTests: [{ file: 'value.spec.ts', title: 'retired browser requirement' }] },
  ]) assert.throws(() => parseVerificationContract(input), `Unexpected contract admitted: ${JSON.stringify(input)}`);
});

for (const schemaVersion of [1, 2]) test(`version-${schemaVersion} plans map every acceptance item to Node checks and reject browser obligations`, () => {
  const task = parseTask({ schemaVersion, id: 'code-plan', title: 'Ready', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'Ready is returned.' }, { id: 'second', description: 'Second result is correct.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 10000 } });
  const plan = { schemaVersion, taskId: task.id, ...(schemaVersion === 2 ? { coverage: { mode: 'reuse', reason: 'Named Node checks cover both outputs.' } } : {}), assumptions: [], slices: [{ id: 'ready', goal: task.goal, acceptanceIds: ['ready', 'second'], checks: [required] }], browserChecks: [] };
  assert.equal(parsePlan(plan, task).taskId, task.id);
  assert.throws(() => parsePlan({ ...plan, browserChecks: [{ file: 'value.spec.ts', title: 'retired browser requirement', acceptanceIds: ['second'] }] }, task));
  assert.throws(() => parsePlan({ ...plan, slices: [{ ...plan.slices[0], acceptanceIds: ['ready'] }] }, task));
  assert.throws(() => parsePlan({ ...plan, slices: [{ ...plan.slices[0], checks: [] }] }, task));
});
