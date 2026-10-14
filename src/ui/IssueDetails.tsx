import { useEffect, useState } from 'react';
import type { Issue } from '../domain.ts';
import type { Delivery, Workbench, WorkRun } from '../workflow.ts';
import { apiRequest, errorMessage } from './client.ts';
import { DeliveryView } from './DeliveryView.tsx';

export function IssueDetails({ id, workbench, onStarted }: { id: number; workbench: Workbench; onStarted: () => void }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [runs, setRuns] = useState<WorkRun[]>([]);
  const [selected, setSelected] = useState('');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void apiRequest<{ issue: Issue; runs: WorkRun[] }>(`/api/issues/${id}`, { signal: controller.signal }).then(result => { setIssue(result.issue); setRuns(result.runs); }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }); };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [id]);
  const runId = selected || runs[0]?.id;
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    const refresh = () => { void apiRequest<{ delivery: Delivery | null }>(`/api/runs/${runId}`, { signal: controller.signal }).then(result => setDelivery(result.delivery)).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }); };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [runId]);
  async function start() {
    setPending(true); setError('');
    try { await apiRequest(`/api/issues/${id}/start`, { method: 'POST', body: '{}' }); onStarted(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  const active = workbench.jobs.some(job => job.issueId === id && ['queued', 'running'].includes(job.status));
  const merged = runs.some(run => run.status === 'merged');
  return <div className="detail-body">
    {error && <p role="alert" className="form-error">{error}</p>}
    {issue ? <><h3>{issue.title}</h3><p>{issue.description}</p><dl><dt>Repository</dt><dd>{workbench.repos.find(repo => repo.id === issue.work?.repoId)?.name ?? 'Unassigned'}</dd><dt>Requirement</dt><dd>{workbench.requirements.find(item => item.id === issue.work?.requirementId)?.title ?? 'Standalone issue'}</dd><dt>Dependencies</dt><dd>{issue.work?.dependsOn.map(id => `#${id}`).join(', ') || 'None'}</dd></dl>{issue.work && <><h4>Acceptance conditions</h4><ul>{issue.work.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul><button className="button primary" type="button" disabled={pending || active || merged} onClick={() => { void start(); }}>{merged ? 'Automatically merged' : active ? 'Queued or running' : 'Start issue'}</button></>}{!issue.work && <p>Edit this issue to assign a repository before execution.</p>}</> : <p role="status">Loading issue…</p>}
    <h3>Execution history</h3>{runs.length ? <><label>Run<select aria-label="Select execution run" value={runId} onChange={event => { setSelected(event.target.value); setDelivery(null); }}>{runs.map(run => <option key={run.id} value={run.id}>{run.startedAt} · {run.status}</option>)}</select></label>{delivery && runId ? <DeliveryView delivery={delivery} runId={runId} /> : <p>Execution is in progress. The delivery report will appear here.</p>}</> : <p>No executions yet.</p>}
  </div>;
}
