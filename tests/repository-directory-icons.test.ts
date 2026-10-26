import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { WorkspaceLayout } from '../src/ui/layout/WorkspaceLayout.tsx';
import { Fixture, repo } from './dropdown-fixture.ts';

test('repository directory omits row icons while preserving ordered repository controls identities and retained graphics', async () => {
  const fixture = new Fixture();
  const selections: string[] = [];
  let refreshes = 0;
  const props = {
    repos: [
      { ...repo, id: 2, name: 'repo2', path: '/disposable/maintenance' },
      { ...repo, name: 'Alpha repository', path: '/disposable/alpha' },
    ],
    repoFilter: '', selectedRepo: undefined, subview: 'requirements' as const,
    registryLoading: false, workbenchError: '', children: null,
    chooseRepository: (id: string) => { selections.push(id); },
    setSubview: () => {}, refreshRepositories: () => { refreshes += 1; },
  };
  try {
    await fixture.mount(createElement(WorkspaceLayout, props));
    const directory = fixture.named('Repository directory');
    assert.ok(directory, 'Fixture readiness requires the production repository directory.');
    const rows = [...directory.querySelectorAll('li')];
    const controls = rows.map(row => row.querySelector('button'));
    assert.deepEqual(controls.map(button => button?.textContent), ['repo2', 'Alpha repository'], 'All enrolled repository name controls retain their supplied order.');
    assert.deepEqual(rows.map(row => row.querySelector('.repository-context > span')?.textContent), [
      'Repository #2 · /disposable/maintenance', 'Repository #1 · /disposable/alpha',
    ], 'Each row retains its complete actual repository ID and path.');
    const rowIcons = rows.flatMap(row => [...row.querySelectorAll('svg')]);
    for (const button of controls) {
      assert.ok(button, 'Each repository has a native name button.');
      assert.equal(button.disabled, false, 'Repository name controls remain enabled.');
      assert.equal(button.closest('[hidden], [aria-hidden="true"], [inert]'), null, 'Repository controls remain exposed for selection.');
      await fixture.click(button);
      assert.equal(fixture.document.activeElement, button, 'The native name control accepts focus in the DOM fixture.');
    }
    assert.deepEqual(selections, ['2', '1'], 'Each name control selects its own actual repository ID.');
    const navigation = fixture.root.querySelector('nav[aria-label="Workspace views"] button[aria-label="Repositories"]');
    assert.ok(navigation?.querySelector('svg'), 'The fixed primary Repositories destination retains its graphic.');
    const refresh = [...fixture.root.querySelectorAll('main button')].find(button => button.textContent === 'Refresh repositories');
    assert.ok(refresh?.querySelector('svg'), 'Refresh repositories retains its arrow graphic.');
    await fixture.click(refresh as HTMLButtonElement);
    assert.equal(refreshes, 1, 'Refresh retains its callback.');

    await fixture.mount(createElement(WorkspaceLayout, { ...props, workbenchError: 'Registry unavailable' }));
    const retry = [...fixture.root.querySelectorAll('main button')].find(button => button.textContent === 'Retry repositories');
    assert.ok(retry?.querySelector('svg'), 'Retry repositories retains its arrow graphic.');
    await fixture.click(retry as HTMLButtonElement);
    assert.equal(refreshes, 2, 'Retry retains the registry refresh callback.');

    await fixture.mount(createElement(WorkspaceLayout, { ...props, repos: [] }));
    const emptyDirectory = fixture.named('Repository directory');
    assert.equal(emptyDirectory?.querySelector('h2')?.textContent, 'No enrolled repositories');
    assert.ok(emptyDirectory?.querySelector('svg'), 'The empty directory retains its graphic independently of populated rows.');
    assert.equal(rowIcons.length, 0, 'Populated repository directory rows omit decorative database icons.');
  } finally { await fixture.dispose(); }
});
