import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App.tsx';

test('repository sidebar initially selects All repositories without status navigation', () => {
  const html = renderToStaticMarkup(createElement(App));
  const navigation = html.match(/<nav\b[^>]*aria-label="Workspace views"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.match(navigation, /(?:role="group"[^>]*aria-label="Repositories"|aria-label="Repositories"[^>]*role="group")/, 'The primary sidebar must expose the Repositories group.');
  const buttons = [...navigation.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const all = buttons.find(item => item[2].includes('All repositories'));
  assert.ok(all, 'All repositories must be a reachable primary sidebar button.');
  assert.match(all[1], /aria-pressed="true"/, 'All repositories must be the initial active primary selection.');
  assert.equal(buttons.filter(item => item[1].includes('aria-pressed="true"')).length, 1, 'Only one primary repository selection may be active.');
  for (const button of buttons) assert.doesNotMatch(button[2].replace(/<[^>]+>/g, '').trim(), /^(?:All issues|Open|In progress|Done)$/, 'Status filtering belongs in the issue toolbar.');
  assert.match(html, /aria-label="Filter by status"/, 'Status filtering remains available.');
});
