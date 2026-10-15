import { useEffect, useRef, useState } from 'react';
import type { Issue, IssueStatus, NewIssue } from '../domain.ts';
import { apiRequest, errorMessage } from './client.ts';
import { Icon } from './Icon.tsx';
import { IssueForm } from './IssueForm.tsx';
import { IssueRow, statusLabels } from './IssueRow.tsx';
import { Modal } from './Modal.tsx';
import { Workbench } from './Workbench.tsx';
import { IssueDetails } from './IssueDetails.tsx';
import type { Workbench as WorkbenchData } from '../workflow.ts';

type Filter = 'all' | IssueStatus;
type Editor = { mode: 'create' } | { mode: 'edit' | 'delete'; issue: Issue };

export function App() {
  const [view, setView] = useState<'issues' | 'workbench'>('issues');
  const [workbench, setWorkbench] = useState<WorkbenchData>({ repos: [], requirements: [], jobs: [], runs: [] });
  const [detailId, setDetailId] = useState<number | null>(null);
  const [repoFilter, setRepoFilter] = useState('');
  const [workbenchError, setWorkbenchError] = useState('');
  const previousJobs = useRef('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [labelFilter, setLabelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const mutationLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void apiRequest<{ issues: Issue[] }>('/api/issues', { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setIssues(result.issues);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reloadVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void apiRequest<WorkbenchData>('/api/workbench', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setWorkbench(result); setWorkbenchError('');
      const jobs = JSON.stringify(result.jobs.map(job => [job.id, job.status]));
      if (previousJobs.current && previousJobs.current !== jobs) setReloadVersion(value => value + 1);
      previousJobs.current = jobs;
    }).catch(error => { if (!controller.signal.aborted) setWorkbenchError(errorMessage(error)); }); };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [reloadVersion]);

  function openEditor(next: Editor) {
    setMutationError(null);
    setEditor(next);
  }
  function dismissEditor() {
    if (mutationLock.current) return;
    setEditor(null);
    setMutationError(null);
  }
  async function saveIssue(values: NewIssue) {
    if (!editor || editor.mode === 'delete' || mutationLock.current) return;
    mutationLock.current = true;
    setPending(true);
    setMutationError(null);
    const isNew = editor.mode === 'create';
    try {
      const result = await apiRequest<{ issue: Issue }>(isNew ? '/api/issues' : `/api/issues/${editor.issue.id}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(values) });
      setIssues((current) => isNew ? [result.issue, ...current] : current.map((issue) => issue.id === result.issue.id ? result.issue : issue));
      if (isNew) { setFilter('all'); setLabelFilter(''); setSearch(''); }
      setNotice(isNew ? 'Issue created.' : 'Changes saved.');
      setEditor(null);
      if (loadError) setReloadVersion((value) => value + 1);
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      mutationLock.current = false;
      setPending(false);
    }
  }
  async function deleteIssue() {
    if (editor?.mode !== 'delete' || mutationLock.current) return;
    mutationLock.current = true;
    setPending(true);
    setMutationError(null);
    try {
      await apiRequest<void>(`/api/issues/${editor.issue.id}`, { method: 'DELETE' });
      setIssues((current) => current.filter((issue) => issue.id !== editor.issue.id));
      setNotice('Issue deleted.');
      setEditor(null);
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      mutationLock.current = false;
      setPending(false);
    }
  }
  const query = search.trim().toLocaleLowerCase();
  const hasFilters = query.length > 0 || filter !== 'all' || labelFilter !== '' || repoFilter !== '';
  const labelOptions = [...new Set([...issues.flatMap(issue => issue.labels), ...(labelFilter ? [labelFilter] : [])])].sort((left, right) => left.localeCompare(right));
  const priorityRank = { low: 1, medium: 2, high: 3 } as const;
  const visibleIssues = issues.filter((issue) => (!repoFilter || String(issue.work?.repoId) === repoFilter) && (filter === 'all' || issue.status === filter) && (!labelFilter || issue.labels.includes(labelFilter)) && (!query || issue.title.toLocaleLowerCase().includes(query) || issue.description.toLocaleLowerCase().includes(query))).sort((left, right) => {
    if (sort === 'title') return left.title.localeCompare(right.title) || right.id - left.id;
    if (sort === 'priority') return priorityRank[right.priority] - priorityRank[left.priority] || right.createdAt.localeCompare(left.createdAt) || right.id - left.id;
    return right.createdAt.localeCompare(left.createdAt) || right.id - left.id;
  });
  function resetFilters() { setSearch(''); setFilter('all'); setLabelFilter(''); setRepoFilter(''); }

  return <div className="workspace">
    <a className="skip-link" href="#main-content">{view === 'workbench' ? 'Skip to Workbench' : 'Skip to issues'}</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">l</span><div><strong>Loop</strong><span>Local issue tracker</span></div></div>
      <div className="workspace-label"><span className="workspace-dot" />Local workspace</div>
      <nav aria-label="Workspace views"><span className="nav-label">WORKSPACE</span>{(['all', 'open', 'in_progress', 'done'] as const).map((issueView) => <button key={issueView} type="button" className={`nav-button ${view === 'issues' && filter === issueView ? 'active' : ''}`} aria-pressed={view === 'issues' && filter === issueView} onClick={() => { setFilter(issueView); setView('issues'); }}>{issueView === 'all' ? <Icon name="issues" /> : <span className={`status-dot ${issueView}`} />}<span>{issueView === 'all' ? 'All issues' : statusLabels[issueView]}</span>{!loading && !loadError && <span className="nav-count" aria-hidden="true">{issueView === 'all' ? issues.length : issues.filter((issue) => issue.status === issueView).length}</span>}</button>)}<button type="button" className={`nav-button ${view === 'workbench' ? 'active' : ''}`} aria-pressed={view === 'workbench'} onClick={() => setView('workbench')}>Workbench</button></nav>
      <div className="persistence"><Icon name="database" /><div><strong>SQLite persistence</strong><span>Stored on this machine</span></div></div>
    </aside>
    <main id="main-content" className="main" tabIndex={-1}>
      {view === 'workbench' && workbenchError && <p className="form-error" role="alert">{workbenchError}</p>}
      <div className="breadcrumb"><span className="breadcrumb-workspace">Local workspace</span><Icon name="chevron" /><span>{view === 'workbench' ? 'Workbench' : 'Issues'}</span><span className="local-badge">LOCAL</span></div>
      {view === 'workbench' ? <Workbench data={workbench} issues={issues} refresh={() => setReloadVersion(value => value + 1)} openIssue={setDetailId} /> : <><section className="page-header"><div><div className="title-line"><h1>Issues</h1>{!loading && !loadError && <span className="issue-count" aria-label={`${issues.length} total issues`}>{issues.length}</span>}</div><p>A little structure for what comes next.</p></div><button id="new-issue" className="button primary" type="button" disabled={loading || pending} onClick={() => openEditor({ mode: 'create' })}><Icon name="plus" />New issue</button></section>
      <div className="toolbar"><div className="search-field"><Icon name="search" /><input type="search" aria-label="Search issues" placeholder="Search issues…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="toolbar-selects"><label className="select-field"><span>Repo</span><select aria-label="Filter by repository" value={repoFilter} onChange={event => setRepoFilter(event.target.value)}><option value="">All repositories</option>{workbench.repos.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><label className="select-field"><span>Status</span><select aria-label="Filter by status" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label><label className="select-field"><span>Label</span><select aria-label="Filter by label" value={labelFilter} onChange={event => setLabelFilter(event.target.value)}><option value="">All labels</option>{labelOptions.map(label => <option key={label} value={label}>{label}</option>)}</select></label><label className="select-field"><span>Sort</span><select aria-label="Sort issues" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="priority">Priority</option><option value="title">Title A–Z</option></select></label></div></div>
      <p className={`live-notice ${notice ? '' : 'sr-only'}`} role="status" aria-live="polite">{notice}</p>
      <section className="issue-panel" aria-label="Issue list" aria-busy={loading}>
        {loading ? <div className="state-panel" role="status"><span className="spinner" aria-hidden="true" /><h2>Loading issues…</h2><p>Opening your local workspace.</p></div> : loadError ? <div className="state-panel"><Icon name="database" /><h2>Couldn’t load issues</h2><p role="alert">{loadError}</p><button className="button" type="button" onClick={() => setReloadVersion((value) => value + 1)}>Retry</button></div> : <><div className="list-heading"><strong>{filter === 'all' ? 'All issues' : statusLabels[filter]}</strong><span>{visibleIssues.length} {visibleIssues.length === 1 ? 'issue' : 'issues'}</span></div>{visibleIssues.length ? <ul className="issue-list">{visibleIssues.map((issue) => <IssueRow key={issue.id} issue={issue} onDetails={item => setDetailId(item.id)} onEdit={(item) => openEditor({ mode: 'edit', issue: item })} onDelete={(item) => openEditor({ mode: 'delete', issue: item })} />)}</ul> : <div className="state-panel"><Icon name="issues" /><h2>{hasFilters ? 'No matching issues' : 'No issues yet'}</h2><p>{hasFilters ? 'Try another search or reset your filters to see all issues.' : 'Capture your first task, bug, or idea. Everything stays in your local workspace.'}</p>{hasFilters ? <button className="button" type="button" onClick={resetFilters}>Reset filters</button> : <button className="button primary" type="button" onClick={() => openEditor({ mode: 'create' })}><Icon name="plus" />Create your first issue</button>}</div>}</>}
      </section>
      <footer className="page-footer"><span>Private by default. Local by design.</span><span>Loop / Local workspace</span></footer></>}
    </main>
    {detailId !== null && <Modal title={`Issue #${detailId}`} onDismiss={() => setDetailId(null)}><IssueDetails id={detailId} workbench={workbench} onStarted={() => setReloadVersion(value => value + 1)} /></Modal>}
    {editor && <Modal title={editor.mode === 'create' ? 'Create issue' : editor.mode === 'edit' ? 'Edit issue' : 'Delete issue'} pending={pending} onDismiss={dismissEditor}>{editor.mode === 'delete' ? <div className="delete-body"><p>Delete <strong>{editor.issue.title}</strong>?</p><p>This permanently removes the issue from your local workspace. This action cannot be undone.</p>{mutationError && <p className="form-error" role="alert">{mutationError}</p>}<div className="form-footer"><button className="button" type="button" data-autofocus disabled={pending} onClick={dismissEditor}>Cancel</button><button className="button danger" type="button" disabled={pending} aria-label="Delete issue" onClick={() => { void deleteIssue(); }}>{pending ? 'Deleting…' : 'Delete issue'}</button></div></div> : <IssueForm workbench={workbench} issue={editor.mode === 'edit' ? editor.issue : undefined} pending={pending} serverError={mutationError} onSave={saveIssue} onCancel={dismissEditor} />}</Modal>}
  </div>;
}
