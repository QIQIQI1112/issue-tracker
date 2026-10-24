import { EmptyState } from '../../components/EmptyState.tsx';
import { Button } from '../../components/Button.tsx';
import { ISSUE_STATUSES } from '../../../domain.ts';
import type { Issue } from '../../../domain.ts';
import { Icon } from '../../components/Icon.tsx';
import { Pagination } from '../../components/Pagination.tsx';
import { IssueRow, statusLabels } from './IssueRow.tsx';
import type { Filter, useIssueCollection } from '../../shared/useIssueCollection.ts';

type Collection = ReturnType<typeof useIssueCollection>;
export function Issues({ collection, issues, loading, loadError, retryIssues, resetFilters, onIssue }: { collection: Collection; issues: Issue[]; loading: boolean; loadError: string | null; retryIssues: () => void; resetFilters: () => void; onIssue: (id: number) => void }) {
  const { filter, labelFilter, search, sort, setPage, listRef, repositoryIssues, hasFilters, labelOptions, matchingIssues, currentPage, visibleIssues, changeSearch, changeFilter, changeLabel, changeSort } = collection;
  return <><section className="page-header"><div><div className="title-line"><h1>Issues</h1>{!loading && !loadError && <span className="issue-count" aria-label={`${repositoryIssues.length} total issues`}>{repositoryIssues.length}</span>}</div><p>A little structure for what comes next.</p></div></section>
      <div className="toolbar"><div className="search-field"><Icon name="search" /><input type="search" aria-label="Search issues" placeholder="Search issues…" value={search} onChange={(event) => { changeSearch(event.target.value); }} /></div><div className="toolbar-selects"><label className="select-field"><span>Status</span><select aria-label="Filter by status" value={filter} onChange={(event) => { changeFilter(event.target.value as Filter); }}><option value="all">All statuses</option>{ISSUE_STATUSES.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label><label className="select-field"><span>Label</span><select aria-label="Filter by label" value={labelFilter} onChange={event => { changeLabel(event.target.value); }}><option value="">All labels</option>{labelOptions.map(label => <option key={label} value={label}>{label}</option>)}</select></label><label className="select-field"><span>Sort</span><select aria-label="Sort issues" value={sort} onChange={(event) => { changeSort(event.target.value); }}><option value="newest">Newest first</option><option value="priority">Priority</option><option value="title">Title A–Z</option></select></label></div></div>
      <section className="issue-panel" aria-label="Issue list" aria-busy={loading}>
        {loading && issues.length === 0 ? <EmptyState title="Loading issues…" loading role="status"><p>Opening your local workspace.</p></EmptyState> : loadError && issues.length === 0 ? <EmptyState title="Couldn’t load issues" icon="database"><p role="alert">{loadError}</p><Button className="button" type="button" onClick={() => retryIssues()}>Retry</Button></EmptyState> : <>
          {loading && <p className="issue-refresh-status" role="status">Refreshing issues…</p>}
          {loadError && <div className="issue-refresh-error"><div><h2>Couldn’t refresh issues</h2><p role="alert">{loadError}</p><p>Showing previously loaded issues.</p></div><Button className="button" type="button" onClick={() => retryIssues()}>Retry</Button></div>}
          <div className="list-heading"><strong>{filter === 'all' ? 'All issues' : statusLabels[filter]}</strong><span>{matchingIssues.length} {matchingIssues.length === 1 ? 'issue' : 'issues'}</span></div>{visibleIssues.length ? <ul ref={listRef} className="issue-list" aria-label="Issues on this page" tabIndex={0}>{visibleIssues.map((issue) => <IssueRow key={issue.id} issue={issue} onDetails={item => onIssue(item.id)} />)}</ul> : <EmptyState icon="issues" title={hasFilters ? 'No matching issues' : 'No issues yet'}><p>{hasFilters ? 'Try another search or reset your filters to see all issues.' : 'Ask your agent to create and manage issues. Inspect issues and execution evidence here.'}</p>{hasFilters && <Button className="button" type="button" onClick={resetFilters}>Reset filters</Button>}</EmptyState>}
          <Pagination label="Issue pages" total={matchingIssues.length} page={currentPage} pageSize={10} singular="issue" onPage={setPage} /></>}
      </section>
      <footer className="page-footer"><span>Private by default. Local by design.</span><span>Loop / Local workspace</span></footer></>;
}
