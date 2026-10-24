import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Check, RegressionReport, Review } from './contracts.ts';
import type { Delivery } from '../src/workflow.ts';
import { snapshot } from './evidence.ts';
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
  if (result.status === 'timeout' || result.status === 'cancelled' || result.status === 'output_limit' || result.error) throw new Error(`Behavior proof process ${result.status}: ${result.error ?? `${check.file}#${check.title}`}`);
  const records = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const isAssertion = (error: Record<string, unknown> | undefined): boolean => Boolean(error && (error.name === 'AssertionError' || error.code === 'ERR_ASSERTION' || isAssertion(error.cause as Record<string, unknown> | undefined)));
  const failures = records.filter(event => event.type === 'test:fail');
  const successes = records.filter(event => event.type === 'test:pass');
  const passed = failures.length === 0 && successes.length === 1 && successes[0].data.name === check.title && successes[0].data.file === realpathSync(resolve(cwd, check.file)) && !successes[0].data.skip && !successes[0].data.todo;
  const assertion = failures.length === 1 && failures[0].data.name === check.title && failures[0].data.file === realpathSync(resolve(cwd, check.file)) && isAssertion(failures[0].data.details?.error);
  if (options.allowAlreadyPassed && result.status === 'passed' && passed) return { ...check, status: 'already_passed', logPath, reportPath };
  if (result.status !== 'failed' || !assertion) throw new BehaviorProofError(`Regression red proof did not establish a named behavior assertion: ${check.file}#${check.title}`);
  return { ...check, status: 'expected_failure', logPath, reportPath };
}
