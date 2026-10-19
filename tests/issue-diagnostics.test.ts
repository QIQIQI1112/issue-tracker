import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';
import { IssueRow } from '../src/ui/IssueRow.tsx';
import { DeliveryView } from '../src/ui/DeliveryView.tsx';
import type { Delivery } from '../src/workflow.ts';

const timestamp = '2026-10-15T00:00:00.000Z';
const delivery: Delivery = {
  schemaVersion: 1, runId: 'diagnostic-run', taskId: 'diagnostics', title: 'Stored audit', goal: 'Inspect recorded behavior.',
  status: 'blocked', startedAt: timestamp, completedAt: timestamp, baseline: null, sourceHash: null,
  defaults: [], changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 1,
  review: null, integration: null, limitations: [], evidence: [],
};

test('issue title and identifier controls open inspection without edit actions', () => {
  const issue = { id: 13, title: 'Inspect this issue', description: 'Read only.', status: 'open' as const, priority: 'high' as const, labels: ['diagnostics'], createdAt: timestamp, updatedAt: timestamp };
  const row = { issue, onDetails: () => {}, onEdit: () => {}, onDelete: () => {} };
  const html = renderToStaticMarkup(createElement(IssueRow, row));
  assert.match(html, /aria-label="View issue Inspect this issue"/, 'The identifier retains its inspection entry point.');
  assert.match(html, /aria-label="Inspect issue Inspect this issue"/, 'The title exposes an inspection action.');
  assert.doesNotMatch(html, /aria-label="Edit |Save changes|contenteditable/, 'Issue rows must not offer editing.');
});

test('issue workspace omits Workbench navigation and manual administration', () => {
  const html = renderToStaticMarkup(createElement(App));
  assert.doesNotMatch(html, /Workbench|Register repository|Create requirement/, 'Issue inspection replaces the Workbench administration view.');
  for (const name of ['Search issues', 'Filter by repository', 'Filter by status', 'Filter by label', 'Sort issues']) assert.ok(html.includes(`aria-label="${name}"`), `Retain ${name}.`);
  assert.match(html, /New issue/, 'Issue creation remains available.');
});

test('delivery audits distinguish approved rejected and missing independent review', () => {
  for (const approved of [true, false, null]) {
    const html = renderToStaticMarkup(createElement(DeliveryView, { runId: delivery.runId, delivery: { ...delivery, review: approved === null ? null : { approved, summary: 'Neutral recorded assessment.' } } }));
    const section = html.split('Independent agent review</h4>')[1]?.split('<h4>')[0] ?? '';
    assert.match(section, approved === null ? /No completed review|Unavailable|not recorded/i : approved ? /\bapproved\b/i : /\brejected\b/i, `Independent review must explicitly identify ${approved === null ? 'missing review' : approved ? 'approval' : 'rejection'} from stored fields.`);
    if (approved === null) assert.doesNotMatch(section, /\bapproved\b/i, 'Missing review cannot imply approval.');
  }
});

test('manifest evidence exposes bounded text preview controls and unchanged download URLs', () => {
  const html = renderToStaticMarkup(createElement(DeliveryView, { runId: delivery.runId, delivery: { ...delivery, evidence: [{ path: 'logs/unsafe & real.log', bytes: 1048576, sha256: 'a'.repeat(64) }, { path: 'screen.png', bytes: 40, sha256: 'b'.repeat(64) }] } }));
  assert.match(html, /aria-label="Select evidence artifact"/, 'Manifest evidence must expose an accessible artifact selector.');
  assert.match(html, /Evidence preview/, 'Manifest text evidence must offer an inline preview.');
  assert.ok(html.includes('/api/runs/diagnostic-run/evidence?file=logs%2Funsafe%20%26%20real.log'), 'Downloads retain the existing manifest-verified URL.');
  assert.match(html, /download=""/, 'Evidence retains download links.');
});
