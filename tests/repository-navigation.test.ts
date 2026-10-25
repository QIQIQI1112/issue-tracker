import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceLayout } from '../src/ui/layout/WorkspaceLayout.tsx';
import { IssueFixture, repo } from './dropdown-fixture.ts';

test('repository sidebar initially selects All repositories without status navigation', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceLayout, {
    repos: [repo], repoFilter: String(repo.id), selectedRepo: repo, subview: 'requirements', registryLoading: false, workbenchError: '',
    chooseRepository: () => {}, setSubview: () => {}, refreshRepositories: () => {}, children: createElement(IssueFixture),
  }));
  const navigation = html.match(/<nav\b[^>]*aria-label="Workspace views"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.match(navigation, /(?:role="group"[^>]*aria-label="Repositories"|aria-label="Repositories"[^>]*role="group")/, 'The primary sidebar must expose the Repositories group.');
  const buttons = [...navigation.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const selected = buttons.find(item => item[1].includes(`aria-label="${repo.name}"`));
  assert.ok(selected, 'The selected repository must be a reachable primary sidebar button.');
  assert.match(selected[1], /aria-pressed="true"/, 'The explicit repository selection must be active.');
  assert.equal(buttons.filter(item => item[1].includes('aria-pressed="true"')).length, 1, 'Only one primary repository selection may be active.');
  for (const button of buttons) assert.doesNotMatch(button[2].replace(/<[^>]+>/g, '').trim(), /^(?:All issues|Open|In progress|Done)$/, 'Status filtering belongs in the issue toolbar.');
  assert.match(html, /aria-label="Filter by status"/, 'Status filtering remains available.');
});
