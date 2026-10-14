import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Issue } from '../domain.ts';
import type { Delivery, Workbench as WorkbenchData } from '../workflow.ts';
import { apiRequest, errorMessage } from './client.ts';
import { DeliveryView } from './DeliveryView.tsx';

export function Workbench({ data, issues, refresh, openIssue }: { data: WorkbenchData; issues: Issue[]; refresh: () => void; openIssue: (id: number) => void }) {
  const [repoId, setRepoId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [selectedRun, setSelectedRun] = useState('');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  useEffect(() => {
    if (!selectedRun) return;
    const abort = new AbortController();
    void apiRequest<{ delivery: Delivery | null }>(`/api/runs/${selectedRun}`, { signal: abort.signal }).then(result => setDelivery(result.delivery)).catch(error => { if (!abort.signal.aborted) setError(errorMessage(error)); });
    return () => abort.abort();
  }, [selectedRun, data.runs]);
  async function mutate(path: string, body: unknown, message: string) {
    if (pending) return;
    setPending(true); setError('');
    try { await apiRequest(path, { method: 'POST', body: JSON.stringify(body) }); setNotice(message); refresh(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  function requirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void mutate('/api/requirements', { repoId: Number(repoId || data.repos[0]?.id), title: values.get('title'), goal: values.get('goal') }, 'Requirement created.');
  }
  return <section className="workbench">
    <div className="page-header"><div><h1>Development</h1><p>Follow requirements submitted from Codex or created here. Agents develop, verify, review, and merge their issues.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}<p role="status">{notice}</p>
    <section className="work-card"><h2>Repositories</h2><ul>{data.repos.map(repo => <li key={repo.id}><strong>{repo.name}</strong><span> · {repo.targetBranch}</span><p><code>{repo.path}</code></p></li>)}</ul><details><summary>Register a repository</summary><form className="work-form" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void mutate('/api/repos', { name: values.get('name'), path: values.get('path'), targetBranch: values.get('branch') }, 'Repository registered.'); }}><label>Repository name<input name="name" required maxLength={120} /></label><label>Local repository path<input name="path" required placeholder="/Users/you/project" /></label><label>Target branch<input name="branch" required defaultValue="main" /></label><button type="submit" className="button" disabled={pending}>Register repository</button></form></details></section>
    <section className="work-card"><h2>New requirement</h2><form className="work-form" onSubmit={requirement}><label>Requirement repository<select aria-label="Requirement repository" value={repoId || data.repos[0]?.id || ''} onChange={event => setRepoId(event.target.value)} required>{data.repos.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><label>Requirement title<input name="title" required maxLength={120} /></label><label>Business goal<textarea name="goal" required maxLength={10000} rows={4} placeholder="Describe the behavior you want and why it matters." /></label><button type="submit" className="button primary" disabled={pending || !data.repos.length}>Create requirement</button></form></section>
    <section className="work-card"><h2>Requirements</h2>{data.requirements.length ? data.requirements.map(item => <article className="requirement-card" key={item.id}><div className="report-heading"><h3>{item.title}</h3><span className="status-pill">{item.status}</span></div><p>{item.goal}</p>{item.submission && <details><summary>Conversation plan</summary><p>Submitted from Codex</p><p>{item.submission.source.summary}</p><p>Source: <code>{item.submission.source.reference}</code></p><p>Submission: <code>{item.submission.id}</code></p></details>}<p>{data.repos.find(repo => repo.id === item.repoId)?.name}</p><button className="button" type="button" disabled={pending || item.status === 'done' || data.jobs.some(job => job.requirementId === item.id && ['queued', 'running'].includes(job.status))} aria-label={`Start requirement ${item.title}`} onClick={() => { void mutate(`/api/requirements/${item.id}/start`, {}, 'Requirement queued.'); }}>Start requirement</button><ul>{issues.filter(issue => issue.work?.requirementId === item.id).map(issue => <li key={issue.id}><button type="button" className="text-button" onClick={() => openIssue(issue.id)}>#{issue.id} {issue.title}</button> · {issue.status}</li>)}</ul></article>) : <p>No requirements yet.</p>}</section>
    <section className="work-card"><h2>Execution queue</h2><p>One execution at a time. Dependencies run after their prerequisites are merged.</p>{data.jobs.length ? <ul>{data.jobs.slice(-20).reverse().map(job => <li key={job.id}>#{job.id} · {job.kind} · <strong>{job.status}</strong>{job.reason && <p>{job.reason}</p>}</li>)}</ul> : <p>The queue is empty.</p>}</section>
    <section className="work-card"><h2>Delivery history</h2>{data.runs.length ? <><label>Delivery run<select aria-label="Select delivery run" value={selectedRun} onChange={event => { setSelectedRun(event.target.value); setDelivery(null); }}><option value="">Select a run</option>{data.runs.map(run => <option key={run.id} value={run.id}>{run.issueId ? `Issue #${run.issueId}` : `Requirement #${run.requirementId}`} · {run.status} · {run.startedAt}</option>)}</select></label>{delivery && <DeliveryView delivery={delivery} runId={selectedRun} />}</> : <p>Reports will appear after execution.</p>}</section>
  </section>;
}
