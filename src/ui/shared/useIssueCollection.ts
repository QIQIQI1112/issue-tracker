import { useEffect, useRef, useState } from 'react';
import type { Issue, IssueStatus } from '../../domain.ts';

export type Filter = 'all' | IssueStatus;
const PAGE_SIZE = 10;

export function useIssueCollection(issues: Issue[], repoFilter: string) {
  const [filter, setFilter] = useState<Filter>('all');
  const [labelFilter, setLabelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLUListElement>(null);

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


  function resetFilters() { setSearch(''); setFilter('all'); setLabelFilter(''); setSort('newest'); setPage(1); }
  return { filter, labelFilter, search, sort, setPage, listRef, repositoryIssues, hasFilters, labelOptions, matchingIssues, pageCount, currentPage, pageOffset, visibleIssues, resetFilters,
    changeSearch: (value: string) => { setSearch(value); setPage(1); },
    changeFilter: (value: Filter) => { setFilter(value); setPage(1); },
    changeLabel: (value: string) => { setLabelFilter(value); setPage(1); },
    changeSort: (value: string) => { setSort(value); setPage(1); },
  };
}
