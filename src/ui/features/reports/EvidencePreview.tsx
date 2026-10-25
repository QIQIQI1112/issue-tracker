import { Dropdown } from '../../components/Dropdown.tsx';
import { Button } from '../../components/Button.tsx';
import { useEffect, useState } from 'react';
import type { Delivery } from '../../../workflow.ts';
import { errorMessage } from '../../shared/client.ts';

const previewLimit = 1048576;
const textPath = /\.(?:txt|log|json|jsonl|ndjson|md|markdown|diff|patch|csv|tsv|yaml|yml|xml|html|css|js|mjs|cjs|ts|tsx|jsx|sh|sql|toml|ini|conf)$/i;
type Preview = { status: 'loading' } | { status: 'text'; text: string } | { status: 'error' | 'fallback'; message: string };

function ArtifactPreview({ runId, artifact }: { runId: string; artifact: Delivery['evidence'][number] }) {
  const [result, setResult] = useState<Preview>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const { path, bytes, sha256 } = artifact;
  const supported = textPath.test(path);
  const oversized = bytes > previewLimit;
  useEffect(() => {
    if (!supported || oversized) return;
    const controller = new AbortController();
    const load = async () => {
      setResult({ status: 'loading' });
      try {
        const response = await fetch('/api/runs/' + encodeURIComponent(runId) + '/evidence?file=' + encodeURIComponent(path), { signal: controller.signal });
        if (!response.body) throw new Error('The server returned no readable evidence body.');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > previewLimit) {
            await reader.cancel();
            if (!controller.signal.aborted) setResult({ status: 'fallback', message: 'Evidence exceeds the 1 MiB preview limit. Download the artifact to read it.' });
            return;
          }
          chunks.push(value);
        }
        if (controller.signal.aborted) return;
        const content = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
        if (!response.ok) {
          let message = 'Evidence request failed (' + response.status + '). Please retry.';
          try {
            const data = JSON.parse(decoded) as { error?: unknown };
            if (typeof data.error === 'string') message = data.error;
          } catch { message = 'Evidence request failed (' + response.status + '). Please retry.'; }
          throw new Error(message);
        }
        if (decoded.includes('\u0000')) {
          setResult({ status: 'fallback', message: 'Binary content cannot be previewed. Download the artifact instead.' });
          return;
        }
        setResult({ status: 'text', text: decoded });
      } catch (error) {
        if (!controller.signal.aborted) setResult(error instanceof TypeError && error.message.includes('encoded') ? { status: 'fallback', message: 'Unsupported text encoding or binary content. Download the artifact instead.' } : { status: 'error', message: errorMessage(error) });
      }
    };
    void load();
    return () => controller.abort();
  }, [runId, path, bytes, sha256, retry, supported, oversized]);
  return <section aria-label="Evidence preview" className="evidence-preview" aria-busy={supported && !oversized && result.status === 'loading'}>
    <h4>Evidence preview</h4>
    <p><code>{path}</code> · {bytes.toLocaleString('en-US')} bytes</p>
    {!supported ? <p>Binary or unsupported artifact. Download the artifact to inspect it.</p> : oversized ? <p>Evidence exceeds the 1 MiB preview limit. Download the artifact to read it.</p> : result.status === 'loading' ? <p role="status">Loading evidence…</p> : result.status === 'text' ? <>{result.text.length === 0 && <p>Empty file (0 bytes).</p>}<pre tabIndex={0}>{result.text}</pre></> : result.status === 'fallback' ? <p>{result.message}</p> : <><p role="alert" className="form-error">{result.message}</p><Button type="button" className="button" onClick={() => { setResult({ status: 'loading' }); setRetry(value => value + 1); }}>Retry evidence</Button></>}
  </section>;
}

export function EvidencePreview({ runId, evidence }: { runId: string; evidence: Delivery['evidence'] }) {
  const [selected, setSelected] = useState('');
  const artifact = evidence.find(item => item.path === selected);
  return <>
    <div className="diagnostic-selector">Artifact<Dropdown aria-label="Select evidence artifact" value={artifact?.path ?? ''} onChange={setSelected}><option value="">Select an artifact</option>{evidence.map(item => <option key={item.path} value={item.path}>{item.path} · {item.bytes.toLocaleString('en-US')} bytes</option>)}</Dropdown></div>
    {artifact ? <ArtifactPreview key={runId + ':' + artifact.path + ':' + artifact.sha256} runId={runId} artifact={artifact} /> : <section aria-label="Evidence preview" className="evidence-preview"><h4>Evidence preview</h4><p>No artifact selected.</p></section>}
  </>;
}
