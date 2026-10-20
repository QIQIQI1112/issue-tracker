import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('lifecycle acceptance revision is durably staged independently before atomic owner activation and retains post-publication acceptance', () => {
  const document = 'docs/issue-lifecycle-contract.md';
  const path = 'tickets/010-issue-lifecycle-acceptance.json';
  assert.ok(existsSync(document), 'The inactive lifecycle acceptance revision must have its own durable English contract document.');
  assert.ok(existsSync(path), 'The inactive lifecycle acceptance revision must have its own machine-readable contract ticket.');
  const ticket = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(ticket.schemaVersion, 1);
  assert.equal(ticket.recordType, 'acceptance-contract-revision');
  assert.equal(ticket.issueId, 35);
  assert.equal(ticket.activatedByIssue, 36);
  assert.equal(ticket.stage, 'inactive-at-prerequisite');
  assert.deepEqual(ticket.revision, {
    file: 'tests/queue.test.ts',
    testTitle: 'dependency admission, editing guards, failed cascades, and interrupted recovery preserve state',
    before: "    assert.equal(store.get(first.id)?.status, 'open');",
    after: "    assert.equal(store.get(first.id)?.status, 'blocked');",
    scope: 'single-assertion',
  });
  assert.deepEqual(ticket.verification, { command: 'npm run verify', gates: ['lint', 'typecheck', 'test', 'build', 'test:e2e'], contracts: ['factory/verification-contract.json', 'factory/ci-verification-contract.json'] });
  assert.deepEqual(ticket.preserved, ['roles', 'budgets', 'required-test-identities', 'all-other-existing-test-bytes']);
  assert.deepEqual(ticket.activation, { requires: ['owner-red-proofs', 'independent-acceptance-review', 'atomic-core-implementation', 'fresh-full-verification', 'source-bound-independent-review', 'verified-integration'], priorIssuesMustPassUnchanged: true });
  assert.deepEqual(ticket.postPublication, { closeIssueId: 20, supersededBy: 22, expectedReplacementStatus: 'done', preserveRequirementId: 4, preserve: ['immutable-plan', 'jobs', 'runs', 'reports', 'evidence', 'cumulative-budgets'], receiptRequired: true });
  const explanation = readFileSync(document, 'utf8');
  assert.match(explanation, /inactive/i);
  assert.match(explanation, /atomic/i);
  assert.match(explanation, /GitHub/i);
  assert.match(explanation, /post.publication/i);
});
