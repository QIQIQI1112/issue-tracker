import type { Delivery } from '../workflow.ts';

export function DeliveryView({ delivery, runId }: { delivery: Delivery; runId: string }) {
  return <article className="delivery" aria-label="Delivery report">
    <div className="report-heading"><h3>Delivery report</h3><span className="status-pill">{delivery.status}</span></div>
    <h4>Business goal</h4><p>{delivery.goal}</p>
    <h4>Result</h4><p>{delivery.summary ?? delivery.goal}</p>
    <h4>What changed</h4>{delivery.changes.length ? <ul>{delivery.changes.map(file => <li key={file.path}><code>{file.path}</code> · {file.category} · {file.status}</li>)}</ul> : <p>No source changes were needed.</p>}
    <h4>Decisions</h4>{delivery.defaults.length ? <ul>{delivery.defaults.map((item, index) => <li key={index}><strong>{item.decision}</strong><p>{item.reason}</p></li>)}</ul> : <p>No additional defaults recorded.</p>}
    <h4>Verification</h4><p>{delivery.nodePassed} Node cases · {delivery.browserPassed} browser cases · {delivery.attempts} implementation attempts</p><ul>{delivery.checks.map((check, index) => <li key={index}>{check.name}: <strong>{check.status}</strong></li>)}</ul>
    {delivery.behaviorChecks && delivery.behaviorChecks.length > 0 && <><h4>Planned behavior checks</h4><ul>{delivery.behaviorChecks.map((check, index) => <li key={index}>{check.title}<br /><code>{check.file}</code></li>)}</ul></>}
    {delivery.phases && delivery.phases.length > 0 && <><h4>Execution timeline</h4><ul>{delivery.phases.map((phase, index) => <li key={index}><strong>{phase.name}</strong> · {(phase.durationMs / 1000).toFixed(1)} s · {phase.status}</li>)}</ul></>}
    {delivery.resume && <><h4>Recovery</h4><p>{delivery.resume.fromRunId && <>Previous run: <code>{delivery.resume.fromRunId}</code><br /></>}{delivery.resume.reason}</p></>}
    {delivery.budget && <p>Cumulative implementation attempts: {delivery.budget.implementationAttempts}/{delivery.budget.maxAttempts} · Active execution: {(delivery.budget.usedMs / 1000).toFixed(1)} s</p>}
    {delivery.failedPhase && <p>Failed phase: <strong>{delivery.failedPhase}</strong>{delivery.failureKind ? ` · ${delivery.failureKind}` : ''}</p>}
    {delivery.reviewReceipts && delivery.reviewReceipts.length > 0 && <><h4>Review receipts</h4><ul>{delivery.reviewReceipts.map((receipt, index) => <li key={index}><strong>{receipt.purpose}</strong> · {receipt.approved ? 'approved' : 'rejected'}{receipt.reusedFromRunId ? ' · reused accepted checks' : ''}<p>{receipt.summary}</p></li>)}</ul></>}
    <h4>Independent agent review</h4><p>{delivery.review?.summary ?? 'No completed review.'}</p>
    <h4>Automatic integration</h4>{delivery.integration ? <p>Merged into <strong>{delivery.integration.branch}</strong><br /><code>{delivery.integration.commit}</code></p> : <p>No target branch was advanced.</p>}
    {delivery.limitations.length > 0 && <><h4>Limitations and blockers</h4>{delivery.limitations.map((text, index) => <p key={index}>{text}</p>)}</>}
    <details><summary>Evidence ({delivery.evidence.length} files)</summary><p>Baseline: <code>{delivery.baseline ?? 'Unavailable'}</code><br />Verified source: <code>{delivery.sourceHash ?? 'Unavailable'}</code></p><ul className="evidence-list">{delivery.evidence.map(item => <li key={item.path}><a href={`/api/runs/${runId}/evidence?file=${encodeURIComponent(item.path)}`} download>{item.path}</a><span>{Math.ceil(item.bytes / 1024)} KB</span></li>)}</ul></details>
  </article>;
}
