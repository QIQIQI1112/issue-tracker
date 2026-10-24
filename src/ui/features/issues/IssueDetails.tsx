import { Button } from '../../components/Button.tsx';
import { useEffect, useState } from 'react';
import type { Issue } from '../../../domain.ts';
import type { Delivery, Workbench, WorkRun } from '../../../workflow.ts';
import { apiRequest, errorMessage } from '../../shared/client.ts';
import { SelectedReport } from '../reports/SelectedReport.tsx';
import { statusLabels } from './IssueRow.tsx';
import { activeJob, requirementProgress, waitingDependencies } from '../../shared/workbench-state.ts';

function CurrentLimitations({ runId }: { runId: string }) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await apiRequest<{ delivery: Delivery | null }>('/api/runs/' + encodeURIComponent(runId), { signal: controller.signal });
        if (!controller.signal.aborted) { setDelivery(result.delivery); setError(''); }
      } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
      finally { fetching = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [runId]);
  return <>{delivery?.limitations.map((text, index) => <p className="execution-warning" key={index}>{text}</p>)}{error && <p>Current delivery limitations unavailable: {error}. Retrying automatically.</p>}</>;
}

export function IssueDetails({ id, workbench, issues = [], metadataError = '' }: { id: number; workbench: Workbench; issues?: Issue[]; metadataError?: string }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [runs, setRuns] = useState<WorkRun[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await apiRequest<{ issue: Issue; runs: WorkRun[] }>('/api/issues/' + id, { signal: controller.signal });
        if (!controller.signal.aborted) { setIssue(result.issue); setRuns(result.runs); setError(''); }
      } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
      finally { fetching = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [id, retry]);

  const owned = (item: { repoId: number; requirementId: number | null }) => item.repoId === issue?.work?.repoId && item.requirementId === issue?.work?.requirementId;
  const jobs = workbench.jobs.filter(job => owned(job) && job.issueId === id).sort((a, b) => b.id - a.id);
  const issueRuns = runs.filter(run => owned(run) && run.issueId === id).sort((a, b) => b.jobId - a.jobId || b.startedAt.localeCompare(a.startedAt));
  const requirement = workbench.requirements.find(item => item.id === issue?.work?.requirementId && item.repoId === issue?.work?.repoId);
  const requirementRuns = requirement ? workbench.runs.filter(run => owned(run) && run.issueId === null && workbench.jobs.some(job => job.id === run.jobId && job.runId === run.id && owned(job) && job.issueId === null && ['decompose', 'plan_review', 'requirement_verify', 'requirement_publish'].includes(job.kind))).sort((a, b) => b.jobId - a.jobId) : [];
  const allRuns = [...issueRuns, ...requirementRuns];
  const runId = allRuns.some(run => run.id === selected) ? selected : issueRuns[0]?.id ?? requirementRuns[0]?.id;
  const latestJob = jobs[0];
  const latestRun = issueRuns[0];
  const currentRun = latestJob ? issueRuns.find(run => run.jobId === latestJob.id && run.id === latestJob.runId) : latestRun;
  const active = jobs.some(activeJob) || currentRun?.status === 'running';
  const waiting = latestJob && issue ? waitingDependencies(workbench, [...issues.filter(item => item.id !== id), issue], latestJob) : [];
  const progress = requirement ? requirementProgress(workbench, [...issues.filter(item => item.id !== id), ...(issue ? [issue] : [])], requirement) : null;
  const currentReason = latestJob?.reason || currentRun?.reason;
  const replacement = issues.find(item => item.id === issue?.closure?.supersededBy);
  const stage = (run: WorkRun) => {
    const kind = workbench.jobs.find(job => job.id === run.jobId && job.runId === run.id && owned(job))?.kind;
    return kind === 'decompose' ? 'Decomposition' : kind === 'plan_review' ? 'Plan review' : kind === 'requirement_publish' ? 'GitHub publication' : kind === 'requirement_verify' ? 'Whole-goal verification' : 'Issue execution';
  };
  const option = (run: WorkRun) => <option key={run.id} value={run.id}>{stage(run)} · {run.id} · {run.startedAt} · {run.status}{run.completedAt ? ' · completed ' + run.completedAt : ''}</option>;
  return <div className="detail-body">
    {metadataError && <p className="form-error">Execution metadata unavailable: {metadataError}. Retrying automatically.</p>}
    {error && <><p role="alert" className="form-error">{error}</p><Button className="button" type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry details</Button></>}
    {issue ? <>
      <h3>{issue.title}</h3><p>{issue.description || 'No description recorded.'}</p>
      <dl className="issue-metadata">
        <dt>Identity</dt><dd>Issue #{issue.id} · LOC-{String(issue.id).padStart(3, '0')}</dd>
        <dt>Status</dt><dd>{statusLabels[issue.status]}</dd>
        <dt>Priority</dt><dd>{({ low: 'Low', medium: 'Medium', high: 'High' })[issue.priority]}</dd>
        <dt>Labels</dt><dd>{issue.labels.join(', ') || 'None'}</dd>
        <dt>Created</dt><dd><time dateTime={issue.createdAt}>{issue.createdAt}</time></dd>
        <dt>Updated</dt><dd><time dateTime={issue.updatedAt}>{issue.updatedAt}</time></dd>
        <dt>Repository</dt><dd>{workbench.repos.find(repo => repo.id === issue.work?.repoId)?.name ?? (issue.work ? 'Repository #' + issue.work.repoId + ' unavailable' : 'Unassigned')}</dd>
        <dt>Requirement</dt><dd>{requirement?.title ?? (issue.work?.requirementId ? 'Requirement #' + issue.work.requirementId + ' unavailable' : 'Standalone issue')}</dd>
        <dt>Dependencies</dt><dd>{issue.work?.dependsOn.map(id => '#' + id).join(', ') || 'None'}</dd>
      </dl>
      {issue.closure && <section aria-label="Closure context" className="diagnostic-section">
        <h3>Issue closure</h3><p>Closure does not establish successful delivery.</p>
        <dl>
          <dt>Closure reason</dt><dd>{issue.closure.reason}</dd>
          <dt>Closed at</dt><dd><time dateTime={issue.closure.closedAt}>{issue.closure.closedAt}</time></dd>
          <dt>Replacement issue</dt><dd>{issue.closure.supersededBy === undefined ? 'No replacement issue recorded.' : <>Issue #{issue.closure.supersededBy} · {replacement?.title ?? 'Replacement title unavailable.'}</>}</dd>
        </dl>
      </section>}
      <h4>Acceptance conditions</h4>{issue.work?.acceptance.length ? <ul>{issue.work.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>No acceptance conditions recorded.</p>}
      {requirement && <section aria-label="Requirement context" className="diagnostic-section">
        <h3>Original requirement goal</h3><p>{requirement.goal}</p>
        {requirement.publication && <div className="diagnostic-section">
          <h4>GitHub delivery</h4><p>{({ pending: 'GitHub publication pending', awaiting_ci: 'Awaiting GitHub CI', blocked: 'GitHub publication blocked', merged: 'GitHub PR merged' })[requirement.publication.state]}</p>
          <p>Branch <code>{requirement.publication.branch}</code></p>
          {requirement.publication.url && <p><a href={requirement.publication.url} target="_blank" rel="noreferrer">GitHub PR #{requirement.publication.number}</a></p>}
          {requirement.publication.ciUrl && <p><a href={requirement.publication.ciUrl} target="_blank" rel="noreferrer">GitHub CI run</a></p>}
          {requirement.publication.headCommit && <p>Verified head <code>{requirement.publication.headCommit}</code></p>}
          {requirement.publication.mergeCommit && <p>GitHub merge <code>{requirement.publication.mergeCommit}</code></p>}
          {requirement.publication.reason && <p className="execution-warning">{requirement.publication.reason}</p>}
        </div>}
        {requirement.submission ? <><h4>Conversation plan provenance</h4><dl>
          <dt>Submission</dt><dd>{requirement.submission.id}</dd><dt>Plan hash</dt><dd><code>{requirement.submission.planHash}</code></dd>
          <dt>Source kind</dt><dd>{requirement.submission.source.kind}</dd><dt>Source reference</dt><dd>{requirement.submission.source.reference}</dd><dt>Source summary</dt><dd>{requirement.submission.source.summary}</dd>
        </dl></> : <p>Submission provenance unavailable: no conversation submission recorded.</p>}
        <p>{progress?.outcome}</p><p>{progress?.merged}/{progress?.children.length} child issues have recorded merges. Delivery requires recorded execution evidence, regardless of issue status.</p>
        {workbench.jobs.filter(job => owned(job) && job.issueId === null && job.kind === 'requirement_verify').sort((a, b) => b.id - a.id).slice(0, 1).map(job => <p key={job.id}>Latest whole-goal job #{job.id} · {job.status}{job.reason ? ' · ' + job.reason : ''}</p>)}
      </section>}
      <h3>Execution history</h3>
      <p>{latestJob ? 'Job #' + latestJob.id + ' · ' + latestJob.status : currentRun ? 'Latest execution · ' + currentRun.status : 'No execution admitted.'}</p>
      {currentRun && <p>Run <code>{currentRun.id}</code> · {currentRun.status}</p>}
      {currentReason && <p className="execution-warning">{currentReason}</p>}
      {waiting.length > 0 && <p>Waiting for dependencies with recorded merges: {waiting.map(id => '#' + id).join(', ')}.</p>}
      {active && <p>{latestJob?.status === 'queued' ? latestJob.kind === 'maintenance' ? 'Awaiting owner maintenance verification.' : 'Queued for execution.' : 'Execution is in progress.'}</p>}
      {currentRun && <CurrentLimitations key={currentRun.id} runId={currentRun.id} />}
      {!issueRuns.length && <p>No executions yet.</p>}
      {allRuns.length > 0 && <><label className="diagnostic-selector">Run<select aria-label="Select execution run" value={runId} onChange={event => setSelected(event.target.value)} onKeyDown={event => {
        if (event.key !== 'Home' && event.key !== 'End') return;
        const options = event.currentTarget.options;
        const option = options.item(event.key === 'Home' ? 0 : options.length - 1);
        if (option) { event.preventDefault(); setSelected(option.value); }
      }}>
        {issueRuns.length > 0 && <optgroup label="Issue executions">{issueRuns.map(option)}</optgroup>}
        {requirementRuns.length > 0 && <optgroup label="Requirement audits">{requirementRuns.map(option)}</optgroup>}
      </select></label>{runId && <SelectedReport key={runId} runId={runId} />}</>}
    </> : !error && <p role="status">Loading issue…</p>}
  </div>;
}
