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
  assert.match(navigation, /aria-label="Repositories"/, 'Repository navigation must remain accessible.');
  const buttons = [...navigation.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const selected = buttons.filter(item => item[1].includes('aria-pressed="true"'));
  assert.equal(selected.length, 1, 'The explicit navigation state must expose exactly one active primary selection.');
  assert.match(selected[0][1], /aria-label="[^"]+"/, 'The active primary selection must have an accessible name.');
  for (const button of buttons) assert.doesNotMatch(button[2].replace(/<[^>]+>/g, '').trim(), /^(?:All issues|Open|In progress|Done)$/, 'Status filtering belongs in the issue toolbar.');
  assert.match(html, /aria-label="Filter by status"/, 'Status filtering remains available.');
});
