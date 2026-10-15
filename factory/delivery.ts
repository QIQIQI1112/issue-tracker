import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ControllerState } from './controller.ts';
import type { Task } from './contracts.ts';
import type { Delivery } from '../src/workflow.ts';
import { writeJson } from './evidence.ts';

export function evidenceManifest(root: string): Delivery['evidence'] {
  const walk = (prefix = ''): Delivery['evidence'] => readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || ['workspace', 'trusted', 'integration-workspace', 'delivery.json', 'delivery.md'].includes(entry.name) || entry.name.endsWith('.tmp')) return [];
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walk(path);
    const absolute = join(root, path);
    return [{ path, bytes: statSync(absolute).size, sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex') }];
  });
  return walk().sort((left, right) => left.path.localeCompare(right.path));
}

export function saveDelivery(root: string, delivery: Omit<Delivery, 'evidence'>): Delivery {
  const result = { ...delivery, evidence: evidenceManifest(root) };
  writeJson(join(root, 'delivery.json'), result);
  const markdown = `# ${result.title}\n\nStatus: ${result.status}\nRun: ${result.runId}\n\n## Business goal\n\n${result.goal}\n\n## Result\n\n${result.summary ?? result.goal}\n\n## Changes\n\n${result.changes.map(file => `- ${file.status} ${file.path} (${file.category})`).join('\n') || 'No source changes.'}\n\n## Decisions\n\n${result.defaults.map(item => `- ${item.decision}: ${item.reason}`).join('\n') || 'No additional defaults.'}\n\n## Verification\n\n${result.checks.map(check => `- ${check.name}: ${check.status}`).join('\n')}\n\nNode cases passed: ${result.nodePassed}\nBrowser cases passed: ${result.browserPassed}\nImplementation attempts: ${result.attempts}\n\n## Execution timeline\n\n${(result.phases ?? []).map(phase => `- ${phase.name}: ${phase.durationMs} ms (${phase.status})`).join('\n') || 'No phase timing recorded.'}\n\n## Recovery\n\n${result.resume ? `Previous run: ${result.resume.fromRunId ?? 'Not reused'}\n\n${result.resume.reason}` : 'Fresh execution.'}\n\n${result.budget ? `Cumulative implementation attempts: ${result.budget.implementationAttempts}/${result.budget.maxAttempts}. Active execution: ${result.budget.usedMs}/${result.budget.totalTimeoutMs} ms.` : 'No cumulative budget recorded.'}\n\n## Review receipts\n\n${(result.reviewReceipts ?? []).map(receipt => `- ${receipt.purpose}: ${receipt.approved ? 'approved' : 'rejected'}; source ${receipt.sourceHash}; plan ${receipt.planHash}; criteria ${receipt.criteriaHash}; contract ${receipt.contractHash}; evidence ${receipt.evidencePath}`).join('\n') || 'No source-bound receipts recorded.'}\n\n## Planned behavior checks\n\n${(result.behaviorChecks ?? []).map(check => `- ${check.title} (${check.file})`).join('\n') || 'No named behavior plan.'}\n\n## Independent review\n\n${result.review?.summary ?? 'No approved review.'}\n\n## Integration\n\n${result.integration ? `${result.integration.branch}: ${result.integration.before} → ${result.integration.commit}` : 'No target branch was advanced.'}\n\nBaseline: ${result.baseline ?? 'Unavailable'}\nVerified source hash: ${result.sourceHash ?? 'Unavailable'}\n\n## Limitations and blockers\n\n${result.limitations.join('\n\n') || 'No recorded blockers.'}\n\n## Evidence\n\n${result.evidence.map(item => `- ${item.path} (${item.bytes} bytes, SHA-256 ${item.sha256})`).join('\n')}\n`;
  writeFileSync(join(root, 'delivery.md'), markdown);
  return result;
}

export function controllerDelivery(state: ControllerState, task: Task): Delivery {
  const verification = state.integration?.verification ?? state.verification;
  const review = state.integration?.review ?? state.review;
  const changes = state.changes ?? [];
  const summaries = state.attempts.map(attempt => join(state.runDirectory, `worker-${attempt.number}.json`)).filter(existsSync).map(path => (JSON.parse(readFileSync(path, 'utf8')) as { summary: string }).summary);
  return saveDelivery(state.runDirectory, {
    schemaVersion: 1, phases: state.phases, reviewReceipts: state.reviewReceipts, resume: state.resume, budget: state.budget, failedPhase: state.failedPhase, failureKind: state.failureKind, runId: state.runId, taskId: task.id, title: task.title, goal: task.goal, summary: summaries.at(-1) ?? state.reason ?? 'The requested behavior already satisfied the recorded checks.', status: state.status, startedAt: state.startedAt, completedAt: state.completedAt!, baseline: state.baseCommit ?? null, sourceHash: verification?.snapshot.hash ?? null,
    behaviorChecks: state.plan ? [...state.plan.slices.flatMap(slice => slice.checks), ...state.plan.browserChecks.map(check => ({ ...check, file: `acceptance/${check.file}` }))] : [],
    defaults: state.plan?.assumptions ?? [], changes: changes.map(file => ({ ...file, category: /^(tests|acceptance)\//.test(file.path) ? 'tests' : /^(factory|scripts)\//.test(file.path) ? 'harness' : /^docs\//.test(file.path) ? 'documentation' : 'application' })),
    checks: verification?.checks ?? [], nodePassed: verification?.node?.passed ?? 0, browserPassed: verification?.browser?.passed ?? 0, attempts: state.attempts.length,
    review: review ? { approved: review.approved, summary: review.summary } : null,
    integration: state.integration?.commit ? { branch: state.integration.branch, before: state.integration.before, commit: state.integration.commit } : null,
    limitations: [...(state.reason ? [state.reason] : []), ...summaries.filter(text => /limit|EPERM|sandbox/i.test(text))],
  });
}
