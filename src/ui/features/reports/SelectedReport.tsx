import { Button } from '../../components/Button.tsx';
import { useEffect, useState } from 'react';
import type { Delivery, RunProgress, WorkRun } from '../../../workflow.ts';
import { apiRequest, errorMessage } from '../../shared/client.ts';
import { DeliveryView } from './DeliveryView.tsx';

export function SelectedReport({ runId }: { runId: string }) {
  const [result, setResult] = useState<{ run: WorkRun; delivery: Delivery | null; progress?: RunProgress | null } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const response = await apiRequest<{ run: WorkRun; delivery: Delivery | null; progress?: RunProgress | null }>(`/api/runs/${encodeURIComponent(runId)}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setResult(response); setError(''); }
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error));
      } finally { fetching = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [runId, retry]);
  return <section aria-label="Selected report" className="selected-report" aria-busy={!result && !error}>
    {result && <p className="selected-run-meta">Run <code>{result.run.id}</code> · {result.run.status}<br />Started <time dateTime={result.run.startedAt}>{result.run.startedAt}</time>{result.run.completedAt && <><br />Completed <time dateTime={result.run.completedAt}>{result.run.completedAt}</time></>}</p>}
    {result?.run.reason && <p className="execution-warning">{result.run.reason}</p>}
    {result?.progress && result.run.status === 'running' && <section aria-label="Current execution progress"><p>Current stage: <strong>{result.progress.stage.replaceAll('_', ' ')}</strong> · {result.progress.profile}</p><ul>{result.progress.transitions.map((stage, index) => <li key={index}>{stage.stage.replaceAll('_', ' ')} · {((stage.completedAt ? stage.durationMs : Math.max(stage.durationMs, Date.now() - Date.parse(stage.startedAt))) / 1000).toFixed(1)} s{stage.completedAt ? ' · completed' : ' · in progress'}</li>)}</ul></section>}
    {error ? <><p className="form-error" role="alert">{error}</p><Button className="button" type="button" onClick={() => { setError(''); setResult(null); setRetry(value => value + 1); }}>Retry report</Button></>
      : result?.delivery ? <DeliveryView delivery={result.delivery} runId={runId} />
        : <p role="status">{!result ? 'Loading delivery report…' : result.run.status === 'running' ? 'Execution is in progress. The delivery report will appear here.' : 'Delivery report unavailable for this execution.'}</p>}
  </section>;
}
