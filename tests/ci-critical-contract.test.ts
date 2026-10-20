import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('critical CI policy validates its fixed selection without replacing full acceptance', async () => {
  assert.ok(existsSync('factory/ci-verification-contract.json'), 'The separate critical CI contract is missing.');
  const { parseCiContract } = await import('../factory/ci-contract.ts');
  const input = JSON.parse(readFileSync('factory/ci-verification-contract.json', 'utf8'));
  const contract = parseCiContract(input);
  assert.equal(contract.profile, 'ci-critical');
  for (const file of ['domain', 'api', 'storage', 'ownership', 'budget', 'github-publication', 'ci-critical-contract', 'ci-critical-runner']) {
    assert.ok(contract.nodeFiles.includes(`tests/${file}.test.ts`), `Missing critical coverage: ${file}`);
  }
  const browser = [
    { file: 'ui.spec.ts', title: 'create, reload, inspect API updates and confirmed deletion persist' },
    { file: 'ui.spec.ts', title: 'whitespace-only titles are rejected accessibly without a mutation' },
    { file: 'persistence.spec.ts', title: 'an API update remains inspectable after a full server process restart' },
    { file: 'workbench.spec.ts', title: 'a Codex conversation plan submitted through the CLI appears with provenance and completes in the existing queue' },
    { file: 'github-publication.spec.ts', title: 'issue diagnostics expose GitHub PR CI and final merge without treating local acceptance as delivery' },
    { file: 'refresh-focus.spec.ts', title: 'issue openers retain focus through background refresh success and failure' },
  ];
  assert.deepEqual(contract.requiredBrowserTests, browser);
  const full = JSON.parse(readFileSync('factory/verification-contract.json', 'utf8'));
  assert.ok(full.requiredBrowserTests.length > contract.requiredBrowserTests.length);
  const invalid = [
    { ...input, profile: 'full' },
    { ...input, schemaVersion: 2 },
    { ...input, nodeFiles: [] },
    { ...input, nodeFiles: [...input.nodeFiles, input.nodeFiles[0]] },
    { ...input, nodeFiles: ['tests/../domain.test.ts'] },
    { ...input, nodeFiles: ['--test.test.ts'] },
    { ...input, requiredNodeTests: [] },
    { ...input, requiredNodeTests: [{ file: input.nodeFiles[0], title: ' ' }] },
    { ...input, requiredNodeTests: [...input.requiredNodeTests, input.requiredNodeTests[0]] },
    { ...input, nodeFiles: [...input.nodeFiles, 'tests/unmapped.test.ts'] },
    { ...input, requiredNodeTests: [...input.requiredNodeTests, { file: 'tests/unselected.test.ts', title: 'unselected' }] },
    { ...input, requiredBrowserTests: [] },
    { ...input, requiredBrowserTests: [...input.requiredBrowserTests, input.requiredBrowserTests[0]] },
    { ...input, requiredBrowserTests: [{ file: '../ui.spec.ts', title: 'invalid path' }] },
    { ...input, requiredBrowserTests: [{ file: 'ui.spec.ts', title: ' ' }] },
    { ...input, surprise: true },
  ];
  for (const value of invalid) assert.throws(() => parseCiContract(value));
});
