import { Dropdown } from '../../components/Dropdown.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Button } from '../../components/Button.tsx';
import { ISSUE_STATUSES } from '../../../domain.ts';
import type { Workbench } from '../../../workflow.ts';
import { mergedIssue } from '../../shared/workbench-state.ts';
import type { Issue } from '../../../domain.ts';
import { Icon } from '../../components/Icon.tsx';
import { Pagination } from '../../components/Pagination.tsx';
import { IssueRow, statusLabels } from './IssueRow.tsx';
import type { Filter, useIssueCollection } from '../../shared/useIssueCollection.ts';

type Collection = ReturnType<typeof useIssueCollection>;
export function Issues({ collection, issues, loading, loadError, retryIssues, resetFilters, onIssue, title = 'Issues', workbench }: { collection: Collection; issues: Issue[]; loading: boolean; loadError: string | null; retryIssues?: () => void; resetFilters: () => void; onIssue: (id: number) => void; title?: string; workbench?: Workbench }) {
  const { filter, labelFilter, search, sort, setPage, listRef, repositoryIssues, hasFilters, labelOptions, matchingIssues, currentPage, visibleIssues, changeSearch, changeFilter, changeLabel, changeSort } = collection;
  const Heading = workbench ? 'h3' : 'h1';
  return <><section className="page-header"><div><div className="title-line"><Heading>{title}</Heading>{!loading && !loadError && <span className="issue-count" aria-label={`${repositoryIssues.length} total issues`}>{repositoryIssues.length}</span>}</div></div></section>
      <div className="toolbar"><div className="search-field"><Icon name="search" /><input type="search" aria-label="Search issues" placeholder="Search issues…" value={search} onChange={(event) => { changeSearch(event.target.value); }} /></div><div className="toolbar-selects"><div className="select-field"><span>Status</span><Dropdown aria-label="Filter by status" value={filter} onChange={value => changeFilter(value as Filter)}><option value="all">All statuses</option>{ISSUE_STATUSES.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</Dropdown></div><div className="select-field"><span>Label</span><Dropdown aria-label="Filter by label" value={labelFilter} onChange={changeLabel}><option value="">All labels</option>{labelOptions.map(label => <option key={label} value={label}>{label}</option>)}</Dropdown></div><div className="select-field"><span>Sort</span><Dropdown aria-label="Sort issues" value={sort} onChange={changeSort}><option value="newest">Newest first</option><option value="priority">Priority</option><option value="title">Title A–Z</option></Dropdown></div></div></div>
      <section className="issue-panel" aria-label="Issue list" aria-busy={loading}>
        {loading && issues.length === 0 ? <EmptyState title="Loading issues…" loading role="status" /> : loadError && issues.length === 0 ? <EmptyState title="Couldn’t load issues" icon="database"><p role="alert">{loadError}</p>{retryIssues && <Button className="button" type="button" onClick={retryIssues}>Retry</Button>}</EmptyState> : <>
          {loading && <p className="issue-refresh-status" role="status">Refreshing issues…</p>}
          {loadError && <div className="issue-refresh-error"><div><h2>Couldn’t refresh issues</h2><p role="alert">{loadError}</p><p>Showing previously loaded issues.</p></div>{retryIssues && <Button className="button" type="button" onClick={retryIssues}>Retry</Button>}</div>}
          <div className="list-heading"><strong>{filter === 'all' ? 'All issues' : statusLabels[filter]}</strong><span>{matchingIssues.length} {matchingIssues.length === 1 ? 'issue' : 'issues'}</span></div>{visibleIssues.length ? <ul ref={listRef} className="issue-list" aria-label="Issues on this page" tabIndex={0}>{visibleIssues.map((issue) => <IssueRow key={issue.id} issue={issue} merged={workbench ? mergedIssue(workbench, issue) : undefined} onDetails={item => onIssue(item.id)} />)}</ul> : <EmptyState icon="issues" title={hasFilters ? 'No matching issues' : 'No issues yet'}>{hasFilters && <Button className="button" type="button" onClick={resetFilters}>Reset filters</Button>}</EmptyState>}
          <Pagination label="Issue pages" total={matchingIssues.length} page={currentPage} pageSize={10} singular="issue" onPage={setPage} /></>}
      </section>
      </>;
}
