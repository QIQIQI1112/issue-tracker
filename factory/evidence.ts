import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function writeJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path);
}

export function readJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')); }

export function snapshot(cwd: string): { hash: string; files: { path: string; hash: string }[] } {
  const ignored = new Set(['.git', '.runs', '.data', 'node_modules', 'dist', 'playwright-report', 'test-results', '.env', '.DS_Store']);
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
  let paths = result.status === 0 ? result.stdout.split('\0').filter(Boolean) : [];
  const walk = (directory: string, prefix = ''): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(join(directory, entry.name), path) : [path];
  });
  if (!paths.length) paths = walk(cwd);
  const files = [...new Set(paths)].filter(path => !path.split('/').some(part => ignored.has(part))).sort().map(path => {
    const absolute = resolve(cwd, path);
    let content: Buffer | string;
    try { content = lstatSync(absolute).isSymbolicLink() ? `symlink:${readlinkSync(absolute)}` : readFileSync(absolute); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') content = 'missing'; else throw error; }
    return { path, hash: createHash('sha256').update(content).digest('hex') };
  });
  return { hash: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

type RequiredCase = { file: string; title: string };
export type VerificationContract = { schemaVersion: 2; profile: 'code-only'; requiredBrowserTests: RequiredCase[]; requiredNodeTests: RequiredCase[] };
export type VerificationSummary = { diagnostics?: { phase: string; code?: string; origin: 'spawn' | 'node-report' | 'report-validation'; kind?: 'product' | 'test-contract'; settled: true }; profile?: 'code-only'; status: string; snapshot: { hash: string }; runDirectory: string; checks: { name: string; status: string; durationMs?: number }[]; node?: { passed: number }; browser?: { passed: number }; error?: string };

export function parseVerification(input: unknown): VerificationSummary {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Verification summary must be an object.');
  const value = input as VerificationSummary;
  if (typeof value.status !== 'string' || !value.snapshot || typeof value.snapshot.hash !== 'string' || !Array.isArray(value.checks) || value.checks.some(check => !check || typeof check.name !== 'string' || typeof check.status !== 'string')) throw new Error('Verification summary is malformed.');
  return value;
}

export function completeVerification(input: unknown, options: { sourceHash: string; contract: VerificationContract; nodePath: string; message: string }): { verification: VerificationSummary; node: { passed: number; required: number } } {
  const verification = parseVerification(input);
  const gates = ['lint', 'typecheck', 'test', 'build'];
  if (verification.status !== 'passed' || verification.profile !== 'code-only' || verification.snapshot.hash !== options.sourceHash || verification.checks.length !== gates.length || !gates.every(name => verification.checks.filter(check => check.name === name && check.status === 'passed').length === 1)) throw new Error(options.message);
  const node = inspectNodeReport(options.nodePath, options.contract.requiredNodeTests);
  if (node.passed !== verification.node?.passed) throw new Error('Verification counts do not match the executed reports.');
  return { verification, node };
}

export function parseVerificationContract(input: unknown): VerificationContract {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Verification contract must be an object.');
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 2 || value.profile !== 'code-only') throw new Error('Verification contract requires version 2 and the code-only profile.');
  if (!Array.isArray(value.requiredBrowserTests) || value.requiredBrowserTests.length) throw new Error('Browser verification is retired; requiredBrowserTests must be empty.');
  if (!Array.isArray(value.requiredNodeTests) || !value.requiredNodeTests.length) throw new Error('Code-only verification requires named Node cases.');
  const seen = new Set<string>();
  const requiredNodeTests = value.requiredNodeTests.map(input => {
    const item = input as RequiredCase;
    if (!item || typeof item.file !== 'string' || !/^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.test\.ts$/.test(item.file) || typeof item.title !== 'string' || !item.title.trim() || item.title !== item.title.trim()) throw new Error('Required Node cases need a safe test path and a nonempty trimmed title.');
    const key = `${item.file}#${item.title}`;
    if (seen.has(key)) throw new Error('Duplicate required Node case.');
    seen.add(key);
    return { file: item.file, title: item.title };
  });
  return { schemaVersion: 2, profile: 'code-only', requiredBrowserTests: [], requiredNodeTests };
}

type NodeCase = { type: 'test:pass' | 'test:fail'; data: { name: string; file: string; details: { type: 'test'; error?: Record<string, unknown> } } };

function readNodeReport(path: string): { cases: NodeCase[]; passed: number; failed: number } {
  const records = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const summary = records.filter(item => item.type === 'test:summary' && !item.data?.file).at(-1)?.data;
  const counts = summary?.counts ?? summary;
  if (!counts || !['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'].every(name => Number.isSafeInteger(counts[name]) && counts[name] >= 0) || counts.tests < 1) throw new Error('Node report has no complete summary.');
  for (const name of ['cancelled', 'skipped', 'todo']) if (counts[name] !== 0) throw new Error(`Node report contains ${name} tests.`);
  const outcomes = records.filter(item => item.type === 'test:pass' || item.type === 'test:fail');
  if (outcomes.some(item => !item.data || !['test', 'suite'].includes(item.data.details?.type) || item.data.skip || item.data.todo)) throw new Error('Node report contains invalid, skipped or todo outcomes.');
  const cases: NodeCase[] = outcomes.filter(item => item.data.details.type === 'test');
  if (cases.some(item => typeof item.data.name !== 'string' || typeof item.data.file !== 'string')) throw new Error('Node report contains an invalid case identity.');
  const passed = cases.filter(item => item.type === 'test:pass').length;
  const failed = cases.length - passed;
  if (counts.tests !== cases.length || counts.passed !== passed || counts.failed !== failed || counts.tests !== passed + failed || (summary.success !== undefined && summary.success !== (failed === 0)) || (failed === 0 && outcomes.some(item => item.type === 'test:fail'))) throw new Error('Node report summary does not match case outcomes.');
  return { cases, passed, failed };
}

export function inspectNamedNodeReport(path: string, check: RequiredCase, cwd: string, status: 'passed' | 'failed'): 'already_passed' | 'expected_failure' {
  try {
    const report = readNodeReport(path);
    const item = report.cases[0];
    if (report.cases.length !== 1 || item.data.name !== check.title || item.data.file !== realpathSync(resolve(cwd, check.file))) throw new Error('Expected one unambiguous exact file/title case.');
    if (status === 'passed' && item.type === 'test:pass') return 'already_passed';
    const isAssertion = (error: Record<string, unknown> | undefined): boolean => Boolean(error && (error.name === 'AssertionError' || error.code === 'ERR_ASSERTION' || isAssertion(error.cause as Record<string, unknown> | undefined)));
    if (status === 'failed' && item.type === 'test:fail' && isAssertion(item.data.details.error)) return 'expected_failure';
    throw new Error('Process outcome and named behavior assertion do not agree.');
  } catch (error) {
    throw new Error(`Named Node proof verification failed to establish a named behavior assertion for ${check.file}#${check.title}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export function inspectNodeReport(path: string, required: RequiredCase[] = []): { passed: number; required: number } {
  const report = readNodeReport(path);
  if (report.failed !== 0) throw new Error('Node report contains failed tests.');
  for (const item of required) {
    const matches = report.cases.filter(event => event.data.name === item.title && event.data.file.replaceAll('\\', '/').endsWith(`/${item.file}`));
    if (matches.length !== 1) throw new Error(`Missing required Node case or ambiguous identity: ${item.file}#${item.title}`);
  }
  return { passed: report.passed, required: required.length };
}
