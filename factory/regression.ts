import type { Check, RegressionReport, Review } from './contracts.ts';
import type { Delivery } from '../src/workflow.ts';
import { inspectNamedNodeReport, snapshot } from './evidence.ts';
import { runProcess } from './process.ts';

export type ReviewReceipt = NonNullable<Delivery['reviewReceipts']>[number];
export type RedCheck = Check & { status: string; logPath: string; reportPath?: string };
export type PendingRegression = { review: Review; receipt: ReviewReceipt };
export type AcceptedRegression = { checks: Check[]; browserChecks: Check[]; redChecks: RedCheck[]; receipt: ReviewReceipt };
export class BehaviorProofError extends Error {}

export function enforceRegressionDraft(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>, report: RegressionReport): void {
  const files = new Set([...report.checks.map(check => check.file), ...report.browserChecks.map(check => `acceptance/${check.file}`)]);
  const original = new Map(before.files.map(file => [file.path, file.hash]));
  const current = new Map(after.files.map(file => [file.path, file.hash]));
  for (const [path, hash] of original) if (current.get(path) !== hash) throw new Error(`Regression tests changed an existing file: ${path}`);
  for (const path of files) if (original.has(path) || !current.has(path)) throw new Error(`Regression checks require a new file: ${path}`);
  for (const path of current.keys()) if (!original.has(path) && !files.has(path)) throw new Error(`Unreported regression file: ${path}`);
}

export async function proveRegression(options: { check: Check; browser: boolean; cwd: string; prefix: string; env: NodeJS.ProcessEnv; reporter: string; timeoutMs: number; signal: AbortSignal; allowAlreadyPassed?: boolean }): Promise<RedCheck> {
  if (options.browser) throw new Error('Browser proofs are retired; use named Node checks.');
  const { check, cwd, prefix } = options;
  const logPath = `${prefix}.log`;
  const reportPath = `${prefix}.jsonl`;
  const escaped = check.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = await runProcess({ command: process.execPath, args: ['--import', 'tsx', '--test', `--test-name-pattern=^${escaped}$`, `--test-reporter=${options.reporter}`, `--test-reporter-destination=${reportPath}`, check.file], cwd, env: options.env, logPath, timeoutMs: options.timeoutMs, signal: options.signal });
  if ((result.status !== 'passed' && result.status !== 'failed') || result.error || result.settled !== true || result.signal !== null || result.exitCode === null) throw new Error(`Behavior proof verification process ${result.status}: ${result.error ?? `${check.file}#${check.title}`}`);
  const status = inspectNamedNodeReport(reportPath, check, cwd, result.status);
  if (status === 'already_passed' && !options.allowAlreadyPassed) throw new BehaviorProofError(`Regression red proof did not establish a named behavior assertion: ${check.file}#${check.title}`);
  return { ...check, status, logPath, reportPath };
}
