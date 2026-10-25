import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { Issues } from '../src/ui/features/issues/Issues.tsx';
import { useIssueCollection } from '../src/ui/shared/useIssueCollection.ts';
import { useWorkbenchData } from '../src/ui/shared/useWorkbenchData.ts';
import { parseCreateIssue } from '../src/domain.ts';
import { IssueStore } from '../src/storage.ts';
import { Fixture } from './dropdown-fixture.ts';

function RefreshingIssues({ repoId }: { repoId: number }) {
  const { issues, loading, loadError, retryIssues } = useWorkbenchData();
  const collection = useIssueCollection(issues, String(repoId));
  return createElement(Issues, { collection, issues, loading, loadError, retryIssues, resetFilters: collection.resetFilters, onIssue: () => {} });
}

test('background refresh shows a blocked issue closing without job changes and preserves the focused search and current row', async () => {
  const fixture = new Fixture();
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Refresh fixture', path: '/disposable/refresh-fixture', targetBranch: 'main' });
    const issue = store.create({ ...parseCreateIssue({ title: 'Retained item' }), work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Inspect the current issue.'] } });
    const unrelated = store.create({ ...parseCreateIssue({ title: 'Unrelated item' }), work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Exclude by search.'] } });
    const job = store.work.startIssue(issue.id);
    const claimed = store.work.claim('/disposable/refresh-evidence', job.id)!;
    store.work.finish(claimed.run.id, 'blocked', 'Retained failed execution.');
    const data = { repos: store.work.repos(), requirements: store.work.requirements(), jobs: store.work.jobs(), runs: store.work.runs() };
    fixture.response = url => url === '/api/issues' ? { issues: store.list() } : data;
    await fixture.mount(createElement(RefreshingIssues, { repoId: repo.id }));
    await fixture.settle();
    const row = () => fixture.root.querySelector<HTMLElement>(`[data-testid="issue-${issue.id}"]`);
    assert.ok(row(), 'The real Issues component must load the persisted issue before checking refresh.');
    assert.equal(row()!.querySelector('.status-pill')?.textContent, 'Blocked');
    assert.ok(fixture.root.querySelector(`[data-testid="issue-${unrelated.id}"]`), 'The same-repository nonmatching issue is present before searching.');
    const search = fixture.named('Search issues') as HTMLInputElement;
    assert.ok(search?.matches('input'), 'Issues exposes its real controlled search input.');
    await fixture.focus(search);
    await act(async () => {
      Object.getOwnPropertyDescriptor(fixture.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(search, 'Retained');
      search.dispatchEvent(new fixture.dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(search.value, 'Retained');
    assert.deepEqual(fixture.all().filter(node => node.matches('li[data-testid]')).map(node => node.dataset.testid), [`issue-${issue.id}`], 'The actual search callback filters the current rows.');
    const retained = row();
    assert.equal(store.closeIssue(issue.id, { reason: 'Replaced by a follow-up.' })?.status, 'closed');
    assert.deepEqual(store.work.jobs(), data.jobs, 'Supported closure leaves the existing job rows unchanged.');
    assert.deepEqual(store.work.runs(), data.runs, 'Supported closure retains the same execution history.');
    await fixture.refresh();
    await fixture.settle();
    assert.equal(fixture.document.activeElement, search, 'Background metadata refresh retains the focused search element.');
    assert.equal(search.value, 'Retained', 'Refresh retains the active search value.');
    assert.equal(row(), retained, 'Refresh retains the existing issue row instead of replacing it with an initial loading surface.');
    assert.equal(row()!.querySelector('.status-pill')?.textContent, 'Closed', 'Background reads must display supported issue changes even when job IDs and statuses do not change.');
  } finally { await fixture.dispose(); store.close(); }
});
