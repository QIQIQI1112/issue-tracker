import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectBrowserReport, parseVerificationContract } from '../factory/evidence.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const previousTitle = 'title and description search, both status controls, and all sort orders operate on real issues';
const requiredTitle = 'title and description search, status filtering, and all sort orders operate on real issues';
const contract = () => parseVerificationContract(JSON.parse(readFileSync('factory/verification-contract.json', 'utf8')));

function passingEvidence(title: string): string {
  const cases = contract().requiredBrowserTests.map(item => ({ ...item, title: item.file === 'ui.spec.ts' && [previousTitle, requiredTitle].includes(item.title) ? title : item.title }));
  const report = { stats: { skipped: 0, unexpected: 0, flaky: 0, expected: cases.length }, errors: [], suites: [{ specs: cases.map(item => ({ ...item, ok: true, tests: [{ expectedStatus: 'passed', results: [{ status: 'passed' }] }] })) }] };
  const path = join(evidenceDirectory('repository-navigation-contract'), 'browser.json');
  writeFileSync(path, JSON.stringify(report));
  return path;
}

test('repository navigation contract admits complete evidence for the equivalent status filtering case', () => {
  const value = contract();
  assert.equal(value.requiredBrowserTests.length, 17);
  assert.equal(value.requiredBrowserTests.filter(item => item.file === 'ui.spec.ts' && item.title === requiredTitle).length, 1, 'The required case must describe retained status filtering rather than retired sidebar synchronization.');
  assert.equal(value.requiredBrowserTests.some(item => item.title === previousTitle), false);
  assert.deepEqual(inspectBrowserReport(passingEvidence(requiredTitle), value), { passed: 17, required: 17 });
});

test('repository navigation contract rejects otherwise complete passing evidence with the retired status controls identity', () => {
  assert.throws(() => inspectBrowserReport(passingEvidence(previousTitle), contract()), error => error instanceof Error && error.message === `Missing required browser case: ui.spec.ts#${requiredTitle}`);
});
