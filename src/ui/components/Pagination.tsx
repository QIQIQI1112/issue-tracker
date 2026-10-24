import { Button } from './Button.tsx';

export function Pagination({ label, total, page, pageSize, singular, plural = `${singular}s`, onPage, explicitNames = true }: { label: string; total: number; page: number; pageSize: number; singular: string; plural?: string; onPage: (page: number) => void; explicitNames?: boolean }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  return <nav className="issue-pagination" aria-label={label}><span className="issue-range" role="status" aria-live="polite" aria-atomic="true">{total ? offset + 1 : 0}–{Math.min(offset + pageSize, total)} of {total} {total === 1 ? singular : plural}</span><div className="page-buttons"><Button aria-label={explicitNames ? 'Previous page' : undefined} disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button><Button aria-label={explicitNames ? 'Next page' : undefined} disabled={page === pageCount} onClick={() => onPage(page + 1)}>Next</Button></div></nav>;
}
