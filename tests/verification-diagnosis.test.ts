import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function verify(kind: 'product' | 'test-contract') {
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  const processes = await import('../factory/process.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(fixtures && subprocess && processes && workspace, 'Diagnosis must come from real owned verifier execution and machine reports.');
  const root = subprocess.evidenceDirectory(`verification-diagnosis-${kind}`);
  const repository = fixtures.fixtureRepository(join(root, 'repo'));
  const contractPath = join(repository, 'factory/verification-contract.json');
  if (kind === 'test-contract') {
    writeFileSync(join(repository, 'src/value.ts'), "export const value = 'ready';\n");
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
    contract.requiredNodeTests = [{ file: 'tests/value.test.ts', title: 'required behavior that was not executed' }];
    writeFileSync(contractPath, JSON.stringify(contract));
  }
  const directory = join(root, 'verification');
  const result = await processes.runProcess({ command: process.execPath, args: [resolve('scripts/verify.mjs')], cwd: repository, env: workspace.processEnvironment({ VERIFY_RUN_DIR: directory, VERIFY_CONTRACT_PATH: contractPath, VERIFY_TOTAL_TIMEOUT_MS: '15000', VERIFY_STEP_TIMEOUT_MS: '5000', VERIFY_GRACE_MS: '100' }), timeoutMs: 20000, logPath: join(root, 'verification.log') });
  assert.equal(result.status, 'failed', 'The real verifier must reject the intentionally failing behavior or missing required identity.');
  const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'failed');
  const records = readFileSync(join(directory, 'node-results.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { summary, records };
}

test('real verifier classifies a named Node assertion failure as settled product diagnosis', { timeout: 30000 }, async () => {
  const { summary, records } = await verify('product');
  assert.ok(records.some(record => record.type === 'test:fail' && record.data.name === 'value is ready'), 'The behavior must actually fail in the machine Node report.');
  assert.equal(summary.diagnostics?.kind, 'product', 'The verifier must emit an actionable structured product diagnosis from actual Node failures.');
  assert.equal(summary.diagnostics.phase, 'test');
  assert.equal(summary.diagnostics.origin, 'node-report');
  assert.equal(summary.diagnostics.settled, true);
});

test('real verifier classifies a missing required case as settled test-contract diagnosis after passing Node execution', { timeout: 30000 }, async () => {
  const { summary, records } = await verify('test-contract');
  assert.ok(records.some(record => record.type === 'test:pass' && record.data.name === 'value is ready'), 'The implementation behavior must actually pass before contract validation rejects the missing case.');
  assert.ok(!records.some(record => record.type === 'test:fail'));
  assert.match(summary.error, /Missing required Node case/);
  assert.equal(summary.diagnostics?.kind, 'test-contract', 'The verifier must distinguish missing required evidence from a product assertion failure.');
  assert.equal(summary.diagnostics.phase, 'test');
  assert.equal(summary.diagnostics.origin, 'report-validation');
  assert.equal(summary.diagnostics.settled, true);
});
