import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';
import { IssueRow } from '../src/ui/IssueRow.tsx';

test('inspection workspace initial render omits creation controls and mutation forms', () => {
  const html = renderToStaticMarkup(createElement(App));
  assert.match(html, /<h1>Issues<\/h1>/, 'The issue inspection workspace renders before checking absent operations.');
  assert.doesNotMatch(html, /New issue|Create issue|Create your first issue|id="new-issue"/i, 'Inspection must omit creation controls, including disabled initial controls.');
  assert.doesNotMatch(html, /<form\b|<textarea\b|contenteditable="true"/i, 'Inspection must not render mutation forms or editable issue content.');
});

test('inspection issue rows expose only title and identifier openers', () => {
  const now = '2026-10-20T00:00:00.000Z';
  const issue = { id: 20, title: 'Inspect persisted work', description: 'Retained diagnostics.', status: 'open' as const, priority: 'high' as const, labels: ['inspection'], createdAt: now, updatedAt: now };
  const props = { issue, onDetails: () => {}, onDelete: () => {} };
  const html = renderToStaticMarkup(createElement(IssueRow, props));
  assert.match(html, /aria-label="View issue Inspect persisted work"/, 'The identifier remains an inspection opener.');
  assert.match(html, /aria-label="Inspect issue Inspect persisted work"/, 'The title remains an inspection opener.');
  assert.doesNotMatch(html, /aria-label="(?:Delete|Edit)\b|delete-button|<form\b|contenteditable="true"/i, 'Inspection rows must omit delete, edit and mutation controls.');
  assert.equal([...html.matchAll(/<button\b/g)].length, 2, 'Only the title and identifier buttons belong in an inspection row.');
});
