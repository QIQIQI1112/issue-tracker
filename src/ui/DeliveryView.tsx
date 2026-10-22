import type { Delivery } from '../workflow.ts';
import { EvidencePreview } from './EvidencePreview.tsx';

function duration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds % 3600000 / 60000);
  const seconds = milliseconds % 60000 / 1000;
  return [hours ? `${hours} h` : '', minutes ? `${minutes} m` : '', seconds ? `${seconds} s` : ''].filter(Boolean).join(' ');
}

function ExecutionEfficiency({ delivery: { efficiency, execution } }: { delivery: Delivery }) {
  return <div className="delivery-group delivery-efficiency">
    {(efficiency || execution) && <h4>Execution efficiency</h4>}
    {efficiency ? <>
      <p>Recorded cost of the selected run, separate from cumulative budget usage and whole requirement delivery.</p>
      <dl className="efficiency-metrics">
        {([
          ['Elapsed time', duration(efficiency.elapsedMs)],
          ['Agent invocations', efficiency.agentInvocations],
          ['Test-authoring invocations', efficiency.testAuthoringInvocations],
          ['Full verification executions', efficiency.verificationExecutions],
          ['Verification retries', efficiency.verificationRetries],
          ['Verification proof reuses', efficiency.verificationReuses],
        ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd> {value}</dd></div>)}
      </dl>
      <p className="efficiency-note">Agent invocations include test-authoring invocations. Full verification executions count actual full verifier runs, including retries; proof reuses use existing verification evidence.</p>
      <h4>Recorded stage durations</h4>
      <dl className="efficiency-metrics efficiency-stages">
        {([
          ['Planning', efficiency.durations.planningMs],
          ['Test authoring', efficiency.durations.testAuthoringMs],
          ['Acceptance review', efficiency.durations.acceptanceReviewMs],
          ['Implementation', efficiency.durations.implementationMs],
          ['Verification', efficiency.durations.verificationMs],
          ['Code review', efficiency.durations.codeReviewMs],
        ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd> {duration(value)}</dd></div>)}
      </dl>
      <p className="efficiency-note">Verification duration includes focused checks. Stage durations need not sum to elapsed time.</p>
    </> : <p>Efficiency metrics were not recorded for this run and are unavailable.</p>}
    {execution && <>
      <h4>Execution context</h4>
      <dl className="efficiency-context">
        <div><dt>Execution profile</dt><dd> {execution.profile}</dd></div>
        <div><dt>Execution route</dt><dd> {execution.route}</dd></div>
        <div><dt>Coverage mode</dt><dd> {execution.coverageMode}</dd></div>
      </dl>
      <p className="efficiency-note">Coverage mode describes the recorded test coverage decision.</p>
      <p className="efficiency-reason">{execution.reason}</p>
    </>}
  </div>;
}

export function DeliveryView({ delivery, runId }: { delivery: Delivery; runId: string }) {
  return <article className="delivery" aria-label="Delivery report">
    <div className="report-heading"><h3>Delivery report</h3><span className="status-pill">{delivery.status}</span></div>
    <div className="delivery-group delivery-overview">
      <h4>Business goal</h4><p>{delivery.goal}</p>
      <div className="delivery-result">
        <h4>Result</h4><p>{delivery.summary ?? delivery.goal}</p>
      </div>
      {delivery.workerObservations && delivery.workerObservations.length > 0 && <details><summary>Historical worker observations</summary><p>These observations precede the controller's final verification and decision.</p><ul>{delivery.workerObservations.map(item => <li key={item.attempt}><strong>Attempt {item.attempt}</strong><p>{item.summary}</p></li>)}</ul></details>}
    </div>
    <ExecutionEfficiency delivery={delivery} />
    <div className="delivery-group">
      <h4>What changed</h4>{delivery.changes.length ? <ul>{delivery.changes.map(file => <li key={file.path}><code>{file.path}</code> · {file.category} · {file.status}</li>)}</ul> : <p>No source changes were needed.</p>}
      <h4>Decisions</h4>{delivery.defaults.length ? <ul>{delivery.defaults.map((item, index) => <li key={index}><strong>{item.decision}</strong><p>{item.reason}</p></li>)}</ul> : <p>No additional defaults recorded.</p>}
    </div>
    <div className="delivery-group">
      <h4>Verification</h4><p>{delivery.nodePassed} Node cases · {delivery.browserPassed} browser cases · {delivery.attempts} implementation attempts</p><ul>{delivery.checks.map((check, index) => <li key={index}>{check.name}: <strong>{check.status}</strong></li>)}</ul>
      {delivery.behaviorChecks && delivery.behaviorChecks.length > 0 && <><h4>Planned behavior checks</h4><ul>{delivery.behaviorChecks.map((check, index) => <li key={index}>{check.title}<br /><code>{check.file}</code></li>)}</ul></>}
      {delivery.phases && delivery.phases.length > 0 && <><h4>Execution timeline</h4><ul>{delivery.phases.map((phase, index) => <li key={index}><strong>{phase.name}</strong> · {(phase.durationMs / 1000).toFixed(1)} s · {phase.status}<br /><time dateTime={phase.startedAt}>{phase.startedAt}</time>{phase.completedAt && <> → <time dateTime={phase.completedAt}>{phase.completedAt}</time></>}</li>)}</ul></>}
      {delivery.resume && <><h4>Recovery</h4><p>{delivery.resume.fromRunId && <>Previous run: <code>{delivery.resume.fromRunId}</code><br /></>}{delivery.resume.reason}<br />Accepted checkpoint reuse: {delivery.resume.reused ? 'yes' : 'no'}</p></>}
      {delivery.budget && <p>Cumulative implementation attempts: {delivery.budget.implementationAttempts}/{delivery.budget.maxAttempts} · Active execution: {(delivery.budget.usedMs / 1000).toFixed(1)} s</p>}
      {delivery.failedPhase && <p>Failed phase: <strong>{delivery.failedPhase}</strong>{delivery.failureKind ? ` · ${delivery.failureKind}` : ''}</p>}
    </div>
    <div className="delivery-group">
      {delivery.reviewReceipts && delivery.reviewReceipts.length > 0 && <><h4>Review receipts</h4><ul>{delivery.reviewReceipts.map((receipt, index) => <li key={index}><strong>{receipt.purpose}</strong> · {receipt.approved ? 'approved' : 'rejected'}{receipt.reusedFromRunId && <> · reused accepted checks from {receipt.reusedFromRunId === delivery.resume?.fromRunId ? 'the previous run shown in Recovery' : <code>{receipt.reusedFromRunId}</code>}</>}<p>{receipt.summary}</p></li>)}</ul></>}
      <h4>Independent agent review</h4>{delivery.review ? <p><strong>{delivery.review.approved ? 'approved' : 'rejected'}</strong> · {delivery.review.summary}</p> : <p>No completed review.</p>}
    </div>
    <div className="delivery-group">
      {delivery.publication && <><h4>GitHub publication</h4><p>{delivery.publication.state} · <code>{delivery.publication.branch}</code></p>{delivery.publication.url && <p><a href={delivery.publication.url} target="_blank" rel="noreferrer">GitHub PR #{delivery.publication.number}</a></p>}{delivery.publication.ciUrl && <p><a href={delivery.publication.ciUrl} target="_blank" rel="noreferrer">GitHub CI run</a></p>}{delivery.publication.mergeCommit && <p>Merge <code>{delivery.publication.mergeCommit}</code></p>}</>}
      <h4>Automatic integration</h4>{delivery.integration ? <p>Merged into <strong>{delivery.integration.branch}</strong><br /><code>{delivery.integration.commit}</code></p> : delivery.publication?.state === 'merged' ? <p>GitHub target merged; the local target was synchronized.</p> : <p>No target branch was advanced.</p>}
      {delivery.limitations.length > 0 && <div className="delivery-limitations"><h4>Limitations and blockers</h4>{delivery.limitations.map((text, index) => <p key={index}>{text}</p>)}</div>}
    </div>
    <details className="delivery-evidence"><summary>Evidence ({delivery.evidence.length} files)</summary><p>Baseline: <code>{delivery.baseline ?? 'Unavailable'}</code><br />Verified source: <code>{delivery.sourceHash ?? 'Unavailable'}</code></p><ul className="evidence-list">{delivery.evidence.map(item => <li key={item.path}><a href={`/api/runs/${runId}/evidence?file=${encodeURIComponent(item.path)}`} download>{item.path}</a><span>{Math.ceil(item.bytes / 1024)} KB</span></li>)}</ul><EvidencePreview runId={runId} evidence={delivery.evidence} /></details>
  </article>;
}
