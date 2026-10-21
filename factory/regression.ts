import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { basename, join, resolve } from 'node:path';
import type { Check, RegressionReport, Review } from './contracts.ts';
import type { Delivery } from '../src/workflow.ts';
import { snapshot, readJson } from './evidence.ts';
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
  const { check, cwd, prefix, browser } = options;
  const logPath = `${prefix}.log`;
  const reportPath = `${prefix}.${browser ? 'json' : 'jsonl'}`;
  const escaped = check.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const runDirectory = `${prefix}-browser`;
  if (browser) mkdirSync(runDirectory, { recursive: true });
  const result = await runProcess({ command: process.execPath, args: browser
    ? [join(cwd, 'node_modules/@playwright/test/cli.js'), 'test', `acceptance/${check.file}`, '--grep', `(?:^|\\s)${escaped}$`, '--retries=0', '--workers=1', '--reporter=json']
    : ['--import', 'tsx', '--test', `--test-name-pattern=^${escaped}$`, `--test-reporter=${options.reporter}`, `--test-reporter-destination=${reportPath}`, check.file], cwd, env: { ...options.env, RUN_DIR: runDirectory, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }, logPath, timeoutMs: options.timeoutMs, signal: options.signal });
  if (result.status === 'timeout' || result.status === 'cancelled' || result.status === 'output_limit' || result.error) throw new Error(`Behavior proof process ${result.status}: ${result.error ?? `${check.file}#${check.title}`}`);
  let assertion: boolean;
  let passed: boolean;
  if (browser) {
    try {
      const report = readJson(reportPath) as { errors: unknown[]; suites: BrowserSuite[]; stats: { unexpected: number; expected: number; skipped: number; flaky: number } };
      const cases: BrowserSpec[] = [];
      const visit = (suites: BrowserSuite[]) => { for (const suite of suites) { cases.push(...suite.specs ?? []); visit(suite.suites ?? []); } };
      visit(report.suites);
      const results = cases.flatMap(spec => spec.tests.flatMap(test => test.results));
      const named = !report.errors.length && report.stats.skipped === 0 && report.stats.flaky === 0 && cases.length === 1 && basename(cases[0].file) === check.file && cases[0].title === check.title && cases[0].tests.length === 1 && cases[0].tests[0].expectedStatus === 'passed' && results.length === 1;
      assertion = named && report.stats.unexpected === 1 && report.stats.expected === 0 && results[0].status === 'failed' && results[0].errors.length > 0 && results[0].errors.every(error => {
        const diagnostic = stripVTControlCharacters(error.message).split(/\n\s*>?\s*\d+\s*\|/)[0];
        return error.location?.file === realpathSync(resolve(cwd, 'acceptance', check.file)) && /^[ \t]*(?:Error:[ \t]*)?expect\(/m.test(diagnostic);
      });
      passed = named && report.stats.unexpected === 0 && report.stats.expected === 1 && results[0].status === 'passed' && results[0].errors.length === 0;
    } catch (error) { throw new BehaviorProofError(`Browser proof report is invalid for ${check.file}#${check.title}: ${String(error)}`); }
  } else {
    const records = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const isAssertion = (error: Record<string, unknown> | undefined): boolean => Boolean(error && (error.name === 'AssertionError' || error.code === 'ERR_ASSERTION' || isAssertion(error.cause as Record<string, unknown> | undefined)));
    const failures = records.filter(event => event.type === 'test:fail');
    const successes = records.filter(event => event.type === 'test:pass');
    passed = failures.length === 0 && successes.length === 1 && successes[0].data.name === check.title && successes[0].data.file === realpathSync(resolve(cwd, check.file)) && !successes[0].data.skip && !successes[0].data.todo;
    assertion = failures.length === 1 && failures[0].data.name === check.title && failures[0].data.file === realpathSync(resolve(cwd, check.file)) && isAssertion(failures[0].data.details?.error);
  }
  if (options.allowAlreadyPassed && result.status === 'passed' && passed) return { ...check, status: 'already_passed', logPath, reportPath };
  if (result.status !== 'failed' || !assertion) throw new BehaviorProofError(`Regression red proof did not establish a named behavior assertion: ${check.file}#${check.title}`);
  return { ...check, status: 'expected_failure', logPath, reportPath };
}

type BrowserSpec = { file: string; title: string; tests: { expectedStatus: string; results: { status: string; errors: { message: string; location?: { file: string } }[] }[] }[] };
type BrowserSuite = { suites?: BrowserSuite[]; specs?: BrowserSpec[] };
