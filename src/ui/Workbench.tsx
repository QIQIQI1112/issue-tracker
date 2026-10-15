import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Issue } from '../domain.ts';
import type { Requirement, Workbench as WorkbenchData } from '../workflow.ts';
import { apiRequest, errorMessage } from './client.ts';
import { SelectedReport } from './SelectedReport.tsx';
import { activeJob, currentBlockers, executionContext, requirementProgress, waitingDependencies } from './workbench-state.ts';

export function Workbench({ data, issues, refresh, openIssue }: { data: WorkbenchData; issues: Issue[]; refresh: () => void; openIssue: (id: number) => void }) {
  const [repoId, setRepoId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const mutationLock = useRef(false);
  const [selectedRun, setSelectedRun] = useState('');
  const active = data.jobs.filter(activeJob).sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || a.id - b.id);
  const blockers = currentBlockers(data, issues);
  const progress = new Map(data.requirements.map(item => [item.id, requirementProgress(data, issues, item)]));
  const hasActiveWork = (item: Requirement) => active.some(job => job.requirementId === item.id && job.repoId === item.repoId);
  const rank = (item: Requirement) => active.some(job => job.requirementId === item.id && job.repoId === item.repoId && job.status === 'running') || item.status === 'running' ? 0 : hasActiveWork(item) || item.status === 'queued' ? 1 : item.status === 'blocked' ? 2 : 3;
  const requirements = [...data.requirements].sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  const selected = data.runs.find(run => run.id === selectedRun);
  const orphanBlockers = data.requirements.filter(item => item.status === 'blocked' && !hasActiveWork(item) && !blockers.some(job => job.requirementId === item.id && job.repoId === item.repoId));
  async function mutate(path: string, body: unknown, message: string) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setPending(true); setError(''); setNotice('');
    try { await apiRequest(path, { method: 'POST', body: JSON.stringify(body) }); setNotice(message); refresh(); }
    catch (error) { setError(errorMessage(error)); }
    finally { mutationLock.current = false; setPending(false); }
  }
  function requirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void mutate('/api/requirements', { repoId: Number(repoId || data.repos[0]?.id), title: values.get('title'), goal: values.get('goal') }, 'Requirement created.');
  }
  function startButton(item: Requirement) {
    const inProgress = hasActiveWork(item);
    const retry = item.status === 'blocked' || inProgress && data.jobs.some(job => job.repoId === item.repoId && job.requirementId === item.id && job.status === 'blocked');
    return <button className="button" type="button" disabled={pending || item.status === 'done' || inProgress} aria-label={`${retry ? 'Retry' : 'Start'} requirement ${item.title}`} onClick={() => { void mutate(`/api/requirements/${item.id}/start`, {}, 'Requirement queued.'); }}>{retry ? 'Retry requirement' : 'Start requirement'}</button>;
  }
  return <section className="workbench">
    <div className="page-header"><div><h1>Workbench</h1><p>Follow business goals from Codex through execution, review, and verified delivery.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}<p className={`live-notice ${notice ? '' : 'sr-only'}`} role="status">{notice}</p>
    <section className="work-card" aria-label="Execution summary"><h2>Execution summary</h2>
      <dl className="execution-summary"><div><dt>Running</dt><dd>{active.filter(job => job.status === 'running').length}</dd></div><div><dt>Queued</dt><dd>{active.filter(job => job.status === 'queued').length}</dd></div><div><dt>Blocked attempts</dt><dd>{blockers.length + orphanBlockers.length}</dd></div><div><dt>Verified goals</dt><dd>{[...progress.values()].filter(item => item.verified).length} of {data.requirements.length}</dd></div></dl>
      <p>One execution at a time. Child merges and whole-goal verification are recorded separately.</p>
      {!data.requirements.length && <p>Submit a business goal from Codex to begin. No website form required.</p>}
    </section>
    <section className="work-card" aria-label="Requirements"><h2>Requirements</h2>{requirements.length ? requirements.map(item => {
      const state = progress.get(item.id)!;
      return <article className="requirement-card" key={item.id}>
        <div className="report-heading"><h3>{item.title}</h3><span className="status-pill">{item.status}</span></div>
        <p className="business-goal">{item.goal}</p>
        <p>Repository: <strong>{data.repos.find(repo => repo.id === item.repoId)?.name ?? `#${item.repoId}`}</strong></p>
        {item.submission && <details><summary>Conversation plan</summary><p>Submitted from Codex</p><p>{item.submission.source.summary}</p><p>Source: <code>{item.submission.source.reference}</code></p><p>Submission: <code>{item.submission.id}</code></p></details>}
        <div className="requirement-progress"><p aria-label="Verified child progress">{state.merged} of {state.children.length} child issues merged</p><p aria-label="Whole-requirement outcome">{state.outcome}</p></div>
        {startButton(item)}
        {item.status === 'blocked' && <p className="form-hint">Inspect the current blocker and retained reports, then retry after resolving the cause. Retry preserves merged children and all required reviews.</p>}
        {state.children.length ? <ul>{state.children.map(issue => <li key={issue.id}><button type="button" className="text-button" onClick={() => openIssue(issue.id)}>#{issue.id} {issue.title}</button> · {issue.status}</li>)}</ul> : <p>No child issues yet. Delivery has not been verified.</p>}
      </article>;
    }) : <p>No requirements yet. Submit a business goal from Codex without a website form. Your original goal and execution progress will appear here.</p>}</section>
    <section className="work-card" aria-label="Execution queue"><h2>Execution queue</h2><p>Dependencies run after their prerequisites have recorded merges. A manually selected Done status does not release dependent work.</p>{active.length ? <ul className="execution-list">{active.map(job => {
      const waiting = waitingDependencies(data, issues, job);
      return <li key={job.id}><div className="report-heading"><strong>Job #{job.id} · {job.kind}</strong><span className="status-pill">{job.status === 'running' ? 'Running' : waiting.length ? 'Waiting for dependencies' : 'Ready'}</span></div><p>{executionContext(data, issues, job)}</p>{waiting.length > 0 && <p>Waiting for recorded merges: {waiting.map(id => `#${id}`).join(', ')}.</p>}</li>;
    })}</ul> : <p>The queue is empty. Submitted Codex plans enter independent review automatically.</p>}</section>
    <section className="work-card" aria-label="Current blockers"><h2>Current blockers</h2>{blockers.length || orphanBlockers.length ? <><ul className="execution-list">{blockers.map(job => <li key={job.id}><strong>Job #{job.id} · {job.kind}</strong><p>{executionContext(data, issues, job)}</p><p>{job.reason || 'Execution blocked. Inspect the associated report for details.'}</p>{job.runId && data.runs.some(run => run.id === job.runId && run.jobId === job.id) && <button className="text-button" type="button" onClick={() => setSelectedRun(job.runId!)}>Inspect report for job #{job.id}</button>}</li>)}{orphanBlockers.map(item => <li key={`requirement-${item.id}`}><strong>{item.title}</strong><p>Requirement is blocked. Inspect its delivery history before retrying.</p></li>)}</ul><p>Retry inactive blocked work from its requirement above. Historical failed attempts remain in Delivery history.</p></> : <p>No unresolved current blockers. Historical failed attempts remain inspectable in Delivery history.</p>}</section>
    <section className="work-card" aria-label="Delivery history"><h2>Delivery history</h2>{data.runs.length ? <><label>Delivery run<select aria-label="Select delivery run" value={selectedRun} onChange={event => setSelectedRun(event.target.value)}><option value="">Select a run</option>{data.runs.map(run => <option key={run.id} value={run.id}>{executionContext(data, issues, run)} · {data.jobs.find(job => job.id === run.jobId)?.kind ?? 'Execution'} · {run.status} · {run.startedAt} · {run.id}</option>)}</select></label>{selected ? <><p>{executionContext(data, issues, selected)} · {data.jobs.find(job => job.id === selected.jobId)?.kind ?? 'Execution'} · {selected.status}</p><SelectedReport key={selected.id} runId={selected.id} /></> : <p>Select an execution to inspect its report and downloadable evidence, including historical failed attempts.</p>}</> : <p>Reports will appear after execution begins. Current and historical attempts will remain inspectable here.</p>}</section>
    <details className="work-card manual-requirement"><summary>Create requirement manually</summary><form className="work-form" onSubmit={requirement}><label>Requirement repository<select aria-label="Requirement repository" value={repoId || data.repos[0]?.id || ''} onChange={event => setRepoId(event.target.value)} required>{data.repos.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><label>Requirement title<input name="title" required maxLength={120} /></label><label>Business goal<textarea name="goal" required maxLength={10000} rows={4} placeholder="Describe the behavior you want and why it matters." /></label><button type="submit" className="button primary" disabled={pending || !data.repos.length}>Create requirement</button></form>{!data.repos.length && <p>Register a repository below before creating a manual requirement.</p>}</details>
    <section className="work-card" aria-label="Repositories"><h2>Repositories</h2><p>Repository setup is available here when you need another local target.</p>{data.repos.length ? <ul>{data.repos.map(repo => <li key={repo.id}><strong>{repo.name}</strong><span> · {repo.targetBranch}</span><p><code>{repo.path}</code></p></li>)}</ul> : <p>No repositories registered.</p>}<details><summary>Register a repository</summary><form className="work-form" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void mutate('/api/repos', { name: values.get('name'), path: values.get('path'), targetBranch: values.get('branch') }, 'Repository registered.'); }}><label>Repository name<input name="name" required maxLength={120} /></label><label>Local repository path<input name="path" required placeholder="/Users/you/project" /></label><label>Target branch<input name="branch" required defaultValue="main" /></label><button type="submit" className="button" disabled={pending}>Register repository</button></form></details></section>
  </section>;
}
