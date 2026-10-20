import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseVerificationContract } from '../factory/evidence.ts';
import { parseCiContract } from '../factory/ci-contract.ts';

test('agent-owned operation contract retains full and critical inspection evidence', () => {
  assert.ok(existsSync('docs/read-only-acceptance.md'), 'The reviewed agent-owned operation contract is missing.');
  const full = parseVerificationContract(JSON.parse(readFileSync('factory/verification-contract.json', 'utf8')));
  const critical = parseCiContract(JSON.parse(readFileSync('factory/ci-verification-contract.json', 'utf8')));
  const required = [
    ['ui.spec.ts', 'API-created issues, API updates and deletions remain visible across reloads'],
    ['ui.spec.ts', 'invalid API titles are rejected without changing the inspected collection'],
    ['ui.spec.ts', 'an empty isolated workspace remains inspectable and receives agent-created issues'],
    ['ui.spec.ts', 'a failed detail request allows read retry without losing the issue'],
    ['ui.spec.ts', 'pending details can be dismissed without leaking stale content'],
    ['labels.spec.ts', 'invalid API labels leave the inspected issue unchanged'],
    ['labels.spec.ts', 'API-assigned labels survive a full server restart'],
  ];
  for (const [file, title] of required) assert.ok(full.requiredBrowserTests.some(item => item.file === file && item.title === title), `Missing replacement: ${file}#${title}`);
  assert.ok(full.requiredBrowserTests.length >= 17);
  assert.equal(critical.requiredBrowserTests.length, 6);
  for (const item of critical.requiredBrowserTests) assert.ok(full.requiredBrowserTests.some(check => check.file === item.file && check.title === item.title) || ['github-publication.spec.ts', 'refresh-focus.spec.ts'].includes(item.file));
  assert.equal(critical.requiredNodeTests.filter(item => item.file === 'tests/github-publication.test.ts').length, 22);
  const retired = ['create, reload, inspect API updates and confirmed deletion persist', 'whitespace-only titles are rejected accessibly without a mutation', 'an empty isolated workspace offers a working first-issue action', 'a real server validation error preserves draft values and allows retry', 'pending creation blocks duplicate submission and dialog dismissal', 'invalid label drafts are rejected accessibly without a write', 'UI-assigned labels survive a full server restart'];
  const document = readFileSync('docs/read-only-acceptance.md', 'utf8');
  for (const title of retired) {
    assert.ok(!full.requiredBrowserTests.some(item => item.title === title));
    assert.ok(document.includes(title), `Document the retired requirement: ${title}`);
  }
  const guard = readFileSync('tests/fixtures/browser-target.spec.ts', 'utf8');
  assert.ok(guard.includes('apiRequest'), 'Wrong-target browser writes must exercise the real pinned client without retired UI forms.');
});
