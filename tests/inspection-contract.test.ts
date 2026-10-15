import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectBrowserReport, parseVerificationContract } from '../factory/evidence.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('inspection contract requires persistent API changes and rejects omitted real browser evidence', () => {
  const contract = parseVerificationContract(JSON.parse(readFileSync('factory/verification-contract.json', 'utf8')));
  const changed = new Map([
    ['a UI rename survives a full server process restart', 'an API update remains inspectable after a full server process restart'],
    ['create, reload, edit and confirmed deletion persist through the real API', 'create, reload, inspect API updates and confirmed deletion persist'],
    ['labels can be created, edited, filtered, and cleared through the UI', 'created labels and API label updates remain filterable and clearable'],
  ]);
  const cases = contract.requiredBrowserTests.map(item => ({ ...item, title: changed.get(item.title) ?? item.title }));
  const path = join(evidenceDirectory('inspection-contract'), 'browser.json');
  const report = { stats: { skipped: 0, unexpected: 0, flaky: 0, expected: cases.length }, errors: [], suites: [{ specs: cases.map(item => ({ ...item, ok: true, tests: [{ expectedStatus: 'passed', results: [{ status: 'passed' }] }] })) }] };
  writeFileSync(path, JSON.stringify(report));
  assert.deepEqual(inspectBrowserReport(path, contract), { passed: cases.length, required: cases.length });
  const missing = report.suites[0].specs.splice(0, 1)[0];
  report.stats.expected -= 1;
  writeFileSync(path, JSON.stringify(report));
  assert.throws(() => inspectBrowserReport(path, contract), new RegExp(`Missing required browser case: ${missing.file}`));
});
