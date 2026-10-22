import { useEffect, useRef, useState } from 'react';
import { ISSUE_STATUSES } from '../domain.ts';
import type { Issue, IssueStatus } from '../domain.ts';
import { apiRequest, errorMessage } from './client.ts';
import { Icon } from './Icon.tsx';
import { RepositoryHarness } from './RepositoryHarness.tsx';
import { IssueRow, statusLabels } from './IssueRow.tsx';
import { Modal } from './Modal.tsx';
import { IssueDetails } from './IssueDetails.tsx';
import type { Workbench as WorkbenchData } from '../workflow.ts';

type Filter = 'all' | IssueStatus;
const PAGE_SIZE = 10;

export function App() {
  const [workbench, setWorkbench] = useState<WorkbenchData>({ repos: [], requirements: [], jobs: [], runs: [] });
  const [detailId, setDetailId] = useState<number | null>(null);
  const [repoFilter, setRepoFilter] = useState('');
  const [workbenchError, setWorkbenchError] = useState('');
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryVersion, setRegistryVersion] = useState(0);
  const [subview, setSubview] = useState<'issues' | 'harness'>('issues');
  const previousJobs = useRef('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [labelFilter, setLabelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLUListElement>(null);

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
      setWorkbench(result); setWorkbenchError(''); setRegistryLoading(false);
      const jobs = JSON.stringify(result.jobs.map(job => [job.id, job.status]));
      if (previousJobs.current && previousJobs.current !== jobs) setReloadVersion(value => value + 1);
      previousJobs.current = jobs;
    }).catch(error => { if (!controller.signal.aborted) { setWorkbenchError(errorMessage(error)); setRegistryLoading(false); } }); };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [reloadVersion, registryVersion]);

  const selectedRepo = workbench.repos.find(repo => String(repo.id) === repoFilter);
  const repositoryIssues = issues.filter(issue => !repoFilter || String(issue.work?.repoId) === repoFilter);
  const query = search.trim().toLocaleLowerCase();
  const hasFilters = query.length > 0 || filter !== 'all' || labelFilter !== '' || repoFilter !== '';
  const labelOptions = [...new Set([...repositoryIssues.flatMap(issue => issue.labels), ...(labelFilter ? [labelFilter] : [])])].sort((left, right) => left.localeCompare(right));
  const priorityRank = { low: 1, medium: 2, high: 3 } as const;
  const matchingIssues = repositoryIssues.filter((issue) => (filter === 'all' || issue.status === filter) && (!labelFilter || issue.labels.includes(labelFilter)) && (!query || issue.title.toLocaleLowerCase().includes(query) || issue.description.toLocaleLowerCase().includes(query))).sort((left, right) => {
    if (sort === 'title') return left.title.localeCompare(right.title) || right.id - left.id;
    if (sort === 'priority') return priorityRank[right.priority] - priorityRank[left.priority] || right.createdAt.localeCompare(left.createdAt) || right.id - left.id;
    return right.createdAt.localeCompare(left.createdAt) || right.id - left.id;
  });
  const pageCount = Math.max(1, Math.ceil(matchingIssues.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageOffset = (currentPage - 1) * PAGE_SIZE;
  const visibleIssues = matchingIssues.slice(pageOffset, pageOffset + PAGE_SIZE);

  useEffect(() => { setPage(value => Math.min(value, pageCount)); }, [pageCount]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [currentPage, search, filter, labelFilter, sort, repoFilter]);

  function chooseRepository(id: string) {
    if (!id) setSubview('issues');
    if (id === repoFilter) return;
    setRepoFilter(id); setSearch(''); setFilter('all'); setLabelFilter(''); setSort('newest'); setPage(1); setDetailId(null);
  }
  function resetFilters() { chooseRepository(''); setSearch(''); setFilter('all'); setLabelFilter(''); setSort('newest'); setPage(1); }

  return <div className="workspace">
    <a className="skip-link" href="#main-content">Skip to issues</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">l</span><div><strong>Loop</strong><span>Local issue tracker</span></div></div>
      <div className="workspace-label"><span className="workspace-dot" />Local workspace</div>
      <nav aria-label="Workspace views"><div role="group" aria-label="Repositories" aria-busy={registryLoading}>
        <span className="nav-label">REPOSITORIES</span>
        <button type="button" className={`nav-button ${!repoFilter ? 'active' : ''}`} aria-pressed={!repoFilter} onClick={() => chooseRepository('')}><Icon name="issues" /><span>All repositories</span></button>
        {registryLoading && <p className="registry-message" role="status">Loading repositories…</p>}
        <div className="registry-message">{workbenchError && <p role="alert">Repository metadata unavailable: {workbenchError}</p>}<button className="button" type="button" onClick={() => { setRegistryLoading(true); setRegistryVersion(value => value + 1); }}>{workbenchError ? 'Retry repositories' : 'Refresh repositories'}</button></div>
        {!registryLoading && !workbenchError && workbench.repos.length === 0 && <p className="registry-message">No enrolled repositories.</p>}
        {workbench.repos.map(repo => <div key={repo.id} className="repository-entry"><button type="button" className={`nav-button ${repoFilter === String(repo.id) ? 'active' : ''}`} aria-pressed={repoFilter === String(repo.id)} onClick={() => chooseRepository(String(repo.id))}><Icon name="database" /><span>{repo.name}</span></button>{repoFilter === String(repo.id) && <div className="repository-subviews">{(['issues', 'harness'] as const).map(view => <button key={view} type="button" className={`nav-button ${subview === view ? 'active' : ''}`} aria-current={subview === view ? 'page' : undefined} onClick={() => setSubview(view)}>{view === 'issues' ? 'Issues' : 'Repo harness'}</button>)}</div>}</div>)}
      </div></nav>
      <div className="persistence"><Icon name="database" /><div><strong>SQLite persistence</strong><span>Stored on this machine</span></div></div>
    </aside>
    <main id="main-content" className="main" tabIndex={-1}>
      <div className="breadcrumb"><span className="breadcrumb-workspace">Local workspace</span><Icon name="chevron" /><span className="breadcrumb-repository">{selectedRepo?.name ?? (repoFilter ? `Repository #${repoFilter} unavailable` : 'All repositories')}</span><Icon name="chevron" /><span>{subview === 'issues' ? 'Issues' : 'Repo harness'}</span><span className="local-badge">LOCAL</span></div>
      {subview === 'harness' && selectedRepo ? <><section className="page-header"><div><h1>Repo harness</h1><p>{selectedRepo.name}</p></div></section><RepositoryHarness key={selectedRepo.id} repoId={selectedRepo.id} /></> : <><section className="page-header"><div><div className="title-line"><h1>Issues</h1>{!loading && !loadError && <span className="issue-count" aria-label={`${repositoryIssues.length} total issues`}>{repositoryIssues.length}</span>}</div><p>A little structure for what comes next.</p></div></section>
      <div className="toolbar"><div className="search-field"><Icon name="search" /><input type="search" aria-label="Search issues" placeholder="Search issues…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div><div className="toolbar-selects"><label className="select-field"><span>Status</span><select aria-label="Filter by status" value={filter} onChange={(event) => { setFilter(event.target.value as Filter); setPage(1); }}><option value="all">All statuses</option>{ISSUE_STATUSES.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label><label className="select-field"><span>Label</span><select aria-label="Filter by label" value={labelFilter} onChange={event => { setLabelFilter(event.target.value); setPage(1); }}><option value="">All labels</option>{labelOptions.map(label => <option key={label} value={label}>{label}</option>)}</select></label><label className="select-field"><span>Sort</span><select aria-label="Sort issues" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="newest">Newest first</option><option value="priority">Priority</option><option value="title">Title A–Z</option></select></label></div></div>
      <section className="issue-panel" aria-label="Issue list" aria-busy={loading}>
        {loading && issues.length === 0 ? <div className="state-panel" role="status"><span className="spinner" aria-hidden="true" /><h2>Loading issues…</h2><p>Opening your local workspace.</p></div> : loadError && issues.length === 0 ? <div className="state-panel"><Icon name="database" /><h2>Couldn’t load issues</h2><p role="alert">{loadError}</p><button className="button" type="button" onClick={() => setReloadVersion((value) => value + 1)}>Retry</button></div> : <>
          {loading && <p className="issue-refresh-status" role="status">Refreshing issues…</p>}
          {loadError && <div className="issue-refresh-error"><div><h2>Couldn’t refresh issues</h2><p role="alert">{loadError}</p><p>Showing previously loaded issues.</p></div><button className="button" type="button" onClick={() => setReloadVersion(value => value + 1)}>Retry</button></div>}
          <div className="list-heading"><strong>{filter === 'all' ? 'All issues' : statusLabels[filter]}</strong><span>{matchingIssues.length} {matchingIssues.length === 1 ? 'issue' : 'issues'}</span></div>{visibleIssues.length ? <ul ref={listRef} className="issue-list" aria-label="Issues on this page" tabIndex={0}>{visibleIssues.map((issue) => <IssueRow key={issue.id} issue={issue} onDetails={item => setDetailId(item.id)} />)}</ul> : <div className="state-panel"><Icon name="issues" /><h2>{hasFilters ? 'No matching issues' : 'No issues yet'}</h2><p>{hasFilters ? 'Try another search or reset your filters to see all issues.' : 'Ask your agent to create and manage issues. Inspect issues and execution evidence here.'}</p>{hasFilters && <button className="button" type="button" onClick={resetFilters}>Reset filters</button>}</div>}
          <nav className="issue-pagination" aria-label="Issue pages"><span className="issue-range" role="status" aria-live="polite" aria-atomic="true">{matchingIssues.length ? pageOffset + 1 : 0}–{Math.min(pageOffset + PAGE_SIZE, matchingIssues.length)} of {matchingIssues.length} {matchingIssues.length === 1 ? 'issue' : 'issues'}</span><div className="page-buttons"><button className="button" type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="button" type="button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></nav></>}
      </section>
      <footer className="page-footer"><span>Private by default. Local by design.</span><span>Loop / Local workspace</span></footer></>}
    </main>
    {detailId !== null && <Modal wide title={`Issue #${detailId}`} onDismiss={() => setDetailId(null)}><IssueDetails key={detailId} id={detailId} issues={issues} metadataError={workbenchError} workbench={workbench} /></Modal>}
  </div>;
}
