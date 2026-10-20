import { useEffect, useRef, useState } from 'react';
import type { RepositoryHarness as HarnessData } from '../harness.ts';
import { apiRequest, errorMessage } from './client.ts';

export function RepositoryHarness({ repoId }: { repoId: number }) {
  const [data, setData] = useState<HarnessData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++sequence.current;
    setLoading(true); setData(null); setError('');
    void apiRequest<HarnessData>(`/api/repos/${repoId}/harness`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted && request === sequence.current) setData(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && request === sequence.current) setError(errorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted && request === sequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [repoId, version]);

  return <section className="repository-harness" aria-label="Repository harness" aria-busy={loading}>
    <div className="harness-actions"><button className="button" type="button" onClick={() => setVersion(value => value + 1)}>{error || data?.status === 'unavailable' ? 'Retry harness read' : 'Refresh harness'}</button></div>
    {loading && <p role="status">Reading committed harness configuration…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && <>
      <section className="work-card"><h2>Committed configuration</h2><p>{data.message}</p><dl className="harness-provenance"><dt>Repository</dt><dd>{data.repository.name} (#{data.repository.id})</dd><dt>Target branch</dt><dd>{data.repository.targetBranch}</dd><dt>Commit</dt><dd>{data.commit ?? 'Unavailable'}</dd></dl></section>
      {data.sources.map(source => <section className="work-card harness-source" key={source.path}>
        <h2>{source.path}</h2><p><strong>{source.status}</strong> — {source.message}</p><p className="source-provenance">Source: {source.path} · Commit: {source.commit}{source.blob && <> · Blob: {source.blob}</>}{source.bytes !== undefined && <> · {source.bytes} bytes</>}</p>
        {source.commands && <><h3>Configured commands and check categories</h3>{source.commands.length ? <ul>{source.commands.map(command => <li key={command.name}><strong>{command.category}</strong> · {command.name}<pre>{command.command}</pre></li>)}</ul> : <p>No package scripts are configured in this source.</p>}</>}
        {source.profile && <><h3>{source.profile.name} requirements</h3><p>{source.profile.explanation}</p>{source.profile.nodeFiles && <><h4>Configured Node files</h4><ul>{source.profile.nodeFiles.map(file => <li key={file}>{file}</li>)}</ul></>}{(['requiredNodeTests', 'requiredBrowserTests'] as const).map(kind => <div key={kind}><h4>{kind === 'requiredNodeTests' ? 'Named required Node cases' : 'Named required browser cases'}</h4>{source.profile![kind].length ? <ul>{source.profile![kind].map(item => <li key={JSON.stringify([item.file, item.title])}>{item.title}<br /><code>{item.file}</code></li>)}</ul> : <p>No explicit names declared in this section.</p>}</div>)}</>}
        {source.content !== undefined && <div><h3>Committed source text</h3><pre tabIndex={0} aria-label={`${source.path} committed source`}>{source.content || '(Empty committed file)'}</pre></div>}
      </section>)}
    </>}
  </section>;
}
