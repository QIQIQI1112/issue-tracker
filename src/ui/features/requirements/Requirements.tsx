import { Dropdown } from '../../components/Dropdown.tsx';
import { Pagination } from '../../components/Pagination.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Button } from '../../components/Button.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Issue } from '../../../domain.ts';
import type { Repo, Requirement, Workbench } from '../../../workflow.ts';
import { Issues } from '../issues/Issues.tsx';
import { useIssueCollection } from '../../shared/useIssueCollection.ts';
import { SelectedReport } from '../reports/SelectedReport.tsx';
import { currentBlockers, matchingRun, requirementJobs, requirementProgress, requirementStages } from '../../shared/workbench-state.ts';

const PAGE_SIZE = 10;

function RequirementOpener({ requirement, selected, onSelect, headingRef }: { requirement: Requirement; selected: boolean; onSelect: (id: number) => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const openerRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    return () => {
      if (document.activeElement !== node) return;
      queueMicrotask(() => {
        if (document.activeElement === document.body) headingRef.current?.focus({ preventScroll: true });
      });
    };
  }, [headingRef]);
  return <Button ref={openerRef} className="text-button requirement-title" type="button" aria-label={`Inspect requirement ${requirement.title}`} aria-pressed={selected} onClick={() => onSelect(requirement.id)}>{requirement.title}</Button>;
}

function RequirementInspection({ requirement, repo, data, issues, onIssue, headingRef, loading, error, retryIssues }: { requirement: Requirement; repo: Repo; data: Workbench; issues: Issue[]; onIssue: (id: number) => void; headingRef: RefObject<HTMLHeadingElement | null>; loading: boolean; error: string | null; retryIssues?: () => void }) {
  const [selectedRun, setSelectedRun] = useState('');
  const progress = requirementProgress(data, issues, requirement);
  const collection = useIssueCollection(progress.children, '');
  const jobs = requirementJobs(data, requirement, progress.children);
  const stageRuns = jobs.filter(job => job.issueId === null).flatMap(job => {
    const run = matchingRun(data, job);
    return run ? [{ job, run }] : [];
  });
  const runId = stageRuns.some(item => item.run.id === selectedRun) ? selectedRun : '';
  const blockers = currentBlockers({ ...data, jobs }, progress.children);
  const verification = jobs.find(job => job.kind === 'requirement_verify' && job.issueId === null);
  const verificationRun = verification && matchingRun(data, verification);
  const publication = requirement.publication;
  const submission = requirement.submission;
  return <section aria-label="Requirement inspection" className="requirement-inspection">
    <header><span className="eyebrow" data-testid="requirement-identity">Requirement #{requirement.id}</span>{' '}<h2 ref={headingRef} tabIndex={-1}>{requirement.title}</h2><p><span data-testid="requirement-repository-identity">Repository #{repo.id}</span> · {repo.name}</p></header>
    <section aria-label="Original goal"><h3>Original goal</h3><p>{requirement.goal}</p></section>
    <section aria-label="Provenance"><h3>Conversation provenance</h3>{submission ? <dl>
      <dt>Submission</dt><dd>{submission.id}</dd><dt>Plan hash</dt><dd><code>{submission.planHash}</code></dd>
      <dt>Source kind</dt><dd>{submission.source.kind}</dd><dt>Source reference</dt><dd>{submission.source.reference}</dd><dt>Source summary</dt><dd>{submission.source.summary}</dd>
    </dl> : <p>No conversation provenance recorded.</p>}
      <p>Created <time dateTime={requirement.createdAt}>{requirement.createdAt}</time><br />Updated <time dateTime={requirement.updatedAt}>{requirement.updatedAt}</time></p>
    </section>
    <div className="requirement-observations">
      <section aria-label="Recorded status"><h3>Recorded status</h3><p data-testid="requirement-recorded-status">{requirement.status}</p></section>
      <section aria-label="Child integration"><h3>Child integration</h3><p data-testid="requirement-merge-progress">{progress.merged}/{progress.children.length} children merged</p>{!progress.children.length && <p>No child issues.</p>}</section>
      <section aria-label="Whole-goal acceptance"><h3>Whole-goal acceptance</h3><p role="status">{progress.acceptance}</p>{verification ? <><p>Latest job #{verification.id} · {verification.status}</p>{verificationRun ? <p>Run <code>{verificationRun.id}</code> · {verificationRun.status}{verificationRun.completedAt && <><br />Completed <time dateTime={verificationRun.completedAt}>{verificationRun.completedAt}</time></>}</p> : <p>Matching run evidence unavailable.</p>}</> : <p>No whole-goal verification admitted.</p>}</section>
      <section aria-label="Final delivery"><h3>Final delivery</h3><p role="status">{progress.delivery}</p></section>
    </div>
    <section aria-label="Publication"><h3>Publication</h3>{publication ? <>
      <p data-testid="requirement-publication-state">{({ pending: 'Pending', awaiting_ci: 'Awaiting CI', blocked: 'Blocked', merged: 'Merged' })[publication.state]}</p>
      <p>{publication.repository} · <code>{publication.branch}</code> → <code>{publication.baseBranch}</code></p>
      {publication.url ? <p><a href={publication.url} target="_blank" rel="noreferrer">GitHub PR {publication.number ? `#${publication.number}` : ''}</a></p> : <p>No PR link recorded.</p>}
      {publication.ciUrl ? <p><a href={publication.ciUrl} target="_blank" rel="noreferrer">GitHub CI run</a></p> : <p>No CI link recorded.</p>}
      {publication.headCommit && <p>Head commit <code>{publication.headCommit}</code></p>}
      {publication.mergeCommit && <p>Merge commit <code>{publication.mergeCommit}</code></p>}
    </> : <p>Local-only delivery. GitHub publication is not enrolled.</p>}</section>
    <section aria-label="Current blockers"><h3>Current blockers</h3>{blockers.map(job => <div key={job.id}><h4>Job #{job.id} · {job.kind.replaceAll('_', ' ')}</h4><p>{job.reason || matchingRun(data, job)?.reason || 'No blocking reason recorded.'}</p></div>)}
      {publication?.state === 'blocked' && <p>{publication.reason || 'Publication blocked. No blocking reason recorded.'}</p>}
      {!blockers.length && publication?.state !== 'blocked' && <p>No current blockers.</p>}
    </section>
    <section aria-label="Child issues"><Issues workbench={data} collection={collection} issues={progress.children} loading={loading} loadError={error} retryIssues={retryIssues} resetFilters={collection.resetFilters} onIssue={onIssue} /></section>
    <section aria-label="Requirement stage history"><h3>Requirement stage history</h3>
      {stageRuns.length ? <><div className="diagnostic-selector">Run<Dropdown aria-label="Select execution run" value={runId} onChange={setSelectedRun}><option value="">Select a stage run</option>{stageRuns.map(({ job, run }) => <option key={run.id} value={run.id}>{requirementStages[job.kind as keyof typeof requirementStages]} · {run.id} · {run.startedAt} · {run.status}</option>)}</Dropdown></div>{runId && <SelectedReport key={runId} runId={runId} />}</> : <p>No requirement-stage runs.</p>}
    </section>
  </section>;
}

export function Requirements({ repo, data, issues, loading, error, onIssue, retryIssues }: { repo: Repo; data: Workbench; issues: Issue[]; loading: boolean; error: string | null; retryIssues?: () => void; onIssue: (id: number | null) => void }) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requirements = data.requirements.filter(item => item.repoId === repo.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const pageCount = Math.max(1, Math.ceil(requirements.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const selected = requirements.find(item => item.id === selectedId);
  useEffect(() => { setPage(value => Math.min(value, pageCount)); }, [pageCount]);
  useEffect(() => { if (selectedId !== null && !selected) { setSelectedId(null); onIssue(null); } }, [selectedId, selected, onIssue]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [currentPage]);
  return <>
    <section className="page-header"><div><h1>Requirements</h1></div></section>
    {loading && <p role="status">Loading child issue metadata…</p>}
    {error && <p className="form-error" role="alert">Child issue metadata unavailable: {error}</p>}
    <section aria-label="Requirement list" className="issue-panel requirement-panel">
      <div className="list-heading"><strong>Newest requirements</strong><span>{requirements.length} total</span></div>
      {requirements.length ? <ul className="requirement-list" ref={listRef} aria-label="Requirements on this page">{requirements.slice(offset, offset + PAGE_SIZE).map(item => {
        const progress = requirementProgress(data, issues, item);
        return <li className="requirement-row" key={item.id} data-testid={`requirement-${item.id}`}>
          <span className="issue-id" data-testid="requirement-identity">Requirement #{item.id}</span>{' '}<RequirementOpener requirement={item} selected={selectedId === item.id} onSelect={id => { setSelectedId(id); onIssue(null); }} headingRef={headingRef} />{' '}
          <span className="requirement-row-status" data-testid="requirement-recorded-status">{item.status}</span>{' '}<span className="requirement-row-progress" data-testid="requirement-merge-progress">{progress.merged}/{progress.children.length} children merged</span>
        </li>;
      })}</ul> : <EmptyState title="No requirements" />}
      <Pagination label="Requirement pages" total={requirements.length} page={currentPage} pageSize={PAGE_SIZE} singular="requirement" onPage={setPage} explicitNames={false} />
    </section>
    {selected && <RequirementInspection key={selected.id} requirement={selected} repo={repo} data={data} issues={issues} onIssue={onIssue} headingRef={headingRef} loading={loading} error={error} retryIssues={retryIssues} />}
  </>;
}
