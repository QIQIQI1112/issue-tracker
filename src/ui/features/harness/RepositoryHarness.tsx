import { Badge } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { useEffect, useRef, useState } from 'react';
import type { HarnessSource, RepositoryHarness as HarnessData } from '../../../harness.ts';
import { apiRequest, errorMessage } from '../../shared/client.ts';

const configurationPaths = new Set(['package.json', 'factory/verification-contract.json', 'factory/ci-verification-contract.json']);

function sourceLabel(source: HarnessSource) {
  if (source.path === 'package.json') return 'Package scripts';
  if (source.path === 'factory/verification-contract.json') return 'Full verification profile';
  if (source.path === 'factory/ci-verification-contract.json') return 'CI profile · ci-critical';
  if (source.path.startsWith('.github/workflows/')) return 'CI workflow';
  if (source.path.startsWith('scripts/') || source.path === 'playwright.config.ts') return 'Runner configuration and source';
  return 'Repository documentation';
}

function SourceDisclosure({ source }: { source: HarnessSource }) {
  const categories = [...new Set(source.commands?.map(command => command.category))];
  const profile = source.profile;
  return <details className="harness-source">
    <summary>
      <span className="harness-source-summary">
        <span className="harness-source-heading"><strong>{sourceLabel(source)}</strong><Badge className="harness-source-status" data-status={source.status}>{source.status}</Badge></span>
        <span className="harness-source-path">{source.path}</span>
        {source.commands && <span className="harness-source-counts">{source.commands.length} configured commands{categories.length > 0 && <> · {categories.join(' · ')}</>}</span>}
        {profile && <>
          <span className="harness-source-counts">{profile.requiredNodeTests.length} named Node requirements · {profile.requiredBrowserTests.length} named browser requirements{profile.nodeFiles && <> · {profile.nodeFiles.length} configured Node files</>}</span>
          {profile.requiredNodeTests.length === 0 && <span className="harness-source-note">No explicit named Node requirements; runner discovery remains unknown.</span>}
        </>}
        {source.status !== 'available' && <span className="harness-source-problem">{source.message}</span>}
      </span>
    </summary>
    <div className="harness-source-body">
      <p>{source.message}</p>
      <dl className="harness-provenance source-provenance"><dt>Source</dt><dd>{source.path}</dd><dt>Commit</dt><dd>{source.commit}</dd>{source.blob && <><dt>Blob</dt><dd>{source.blob}</dd></>}{source.bytes !== undefined && <><dt>Size</dt><dd>{source.bytes} bytes</dd></>}</dl>
      {source.commands && <><h3>Configured commands and check categories</h3>{source.commands.length ? <ul className="harness-commands">{source.commands.map(command => <li key={command.name}><div className="harness-command-heading"><strong>{command.name}</strong><span>{command.category}</span></div><pre>{command.command}</pre></li>)}</ul> : <p>No package scripts are configured in this source.</p>}</>}
      {profile && <>
        <h3>{profile.name} requirements</h3><p>{profile.explanation}</p>
        {profile.nodeFiles && <><h4>Configured Node files</h4>{profile.nodeFiles.length ? <ul>{profile.nodeFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul> : <p>No Node files configured in this profile.</p>}</>}
        <div className="harness-case-columns">{(['requiredNodeTests', 'requiredBrowserTests'] as const).map(kind => <section key={kind}><h4>{kind === 'requiredNodeTests' ? 'Named required Node cases' : 'Named required browser cases'}</h4>{profile[kind].length ? <ul className="harness-cases">{profile[kind].map(item => <li key={JSON.stringify([item.file, item.title])}><span>{item.title}</span><code>{item.file}</code></li>)}</ul> : <p>No explicit names declared in this section.</p>}</section>)}</div>
      </>}
      {source.content !== undefined && <details className="harness-raw-source"><summary>Committed source text · {source.path}</summary><pre tabIndex={0} aria-label={`${source.path} committed source`}>{source.content || '(Empty committed file)'}</pre></details>}
    </div>
  </details>;
}

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
    <div className="harness-actions"><Button className="button" type="button" onClick={() => setVersion(value => value + 1)}>{error || data?.status === 'unavailable' ? 'Retry harness read' : 'Refresh harness'}</Button></div>
    {loading && <p role="status">Reading committed harness configuration…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && <>
      <section className="work-card harness-overview">
        <h2>Committed configuration</h2>
        <dl className="harness-provenance"><dt>Repository</dt><dd>{data.repository.name} (#{data.repository.id})</dd><dt>Target branch</dt><dd>{data.repository.targetBranch}</dd><dt>Commit</dt><dd>{data.commit ?? 'Unavailable'}</dd></dl>
        <p className="harness-read-message" data-status={data.status}>{data.message}</p>
        <p className="harness-explanation">Configured checks are not execution or pass evidence. Reading these sources does not run commands.</p>
        <p className="harness-inventory"><strong>{data.sources.length} sources</strong><span>{data.sources.filter(source => source.status === 'available').length} available</span><span>{data.sources.filter(source => source.status !== 'available').length} source availability problems</span></p>
      </section>
      {[
        { title: 'Configuration and check manifests', sources: data.sources.filter(source => configurationPaths.has(source.path)) },
        { title: 'Workflow and documentation', sources: data.sources.filter(source => !configurationPaths.has(source.path)) },
      ].filter(group => group.sources.length > 0).map(group => <section className="harness-source-group" key={group.title}>
        <h2>{group.title}</h2>
        <div className="harness-source-list">{group.sources.map(source => <SourceDisclosure key={`${repoId}:${version}:${source.path}`} source={source} />)}</div>
      </section>)}
    </>}
  </section>;
}
