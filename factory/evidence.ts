import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

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
export type VerificationContract = { schemaVersion: 1; requiredBrowserTests: RequiredCase[]; requiredNodeTests: RequiredCase[] };

export function parseVerificationContract(input: unknown): VerificationContract {
  if (!input || typeof input !== 'object') throw new Error('Verification contract must be an object.');
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || !Array.isArray(value.requiredBrowserTests) || !value.requiredBrowserTests.length) throw new Error('Verification contract requires version 1 and browser cases.');
  const keys = new Set<string>();
  const requiredBrowserTests = value.requiredBrowserTests.map(item => {
    if (!item || typeof item !== 'object' || typeof item.file !== 'string' || typeof item.title !== 'string' || !item.file || !item.title) throw new Error('Required browser cases need file and title.');
    const key = `${item.file}#${item.title}`;
    if (keys.has(key)) throw new Error('Duplicate required browser case.');
    keys.add(key);
    return { file: item.file, title: item.title };
  });
  const requiredNodeTests = (value.requiredNodeTests ?? []) as unknown[];
  if (!Array.isArray(requiredNodeTests)) throw new Error('Required Node cases must be an array.');
  const nodeKeys = new Set<string>();
  const nodeCases = requiredNodeTests.map(input => {
    const item = input as RequiredCase;
    if (!item || typeof item.file !== 'string' || typeof item.title !== 'string' || !item.file || !item.title) throw new Error('Required Node cases need file and title.');
    const key = `${item.file}#${item.title}`;
    if (nodeKeys.has(key)) throw new Error('Duplicate required Node case.');
    nodeKeys.add(key);
    return { file: item.file, title: item.title };
  });
  return { schemaVersion: 1, requiredBrowserTests, requiredNodeTests: nodeCases };
}

export function inspectBrowserReport(path: string, contract: VerificationContract): { passed: number; required: number } {
  const report = readJson(path) as { stats?: Record<string, unknown>; suites?: unknown[]; errors?: unknown[] };
  if (!report || !report.stats || !Array.isArray(report.suites) || !Array.isArray(report.errors)) throw new Error('Browser report is malformed.');
  for (const name of ['skipped', 'unexpected', 'flaky']) if (report.stats[name] !== 0) throw new Error(`Browser report contains ${name} tests.`);
  if (report.errors.length || !Number.isInteger(report.stats.expected) || Number(report.stats.expected) < 1) throw new Error('Browser report has errors or no passed tests.');
  const cases = new Set<string>();
  let passed = 0;
  const visit = (suites: unknown[]) => {
    for (const input of suites) {
      const suite = input as { suites?: unknown[]; specs?: { file: string; title: string; ok: boolean; tests: { expectedStatus: string; results: { status: string }[] }[] }[] };
      if (suite.suites) visit(suite.suites);
      for (const spec of suite.specs ?? []) {
        if (!spec.ok || !spec.tests.length) throw new Error('Browser report contains incomplete cases.');
        for (const test of spec.tests) {
          if (test.expectedStatus !== 'passed' || !test.results.length || test.results.some(result => result.status !== 'passed')) throw new Error('Browser case did not pass without retries or skips.');
          passed += 1;
        }
        cases.add(`${basename(spec.file)}#${spec.title}`);
      }
    }
  };
  visit(report.suites);
  if (passed !== report.stats.expected) throw new Error('Browser report count does not match its executed cases.');
  for (const item of contract.requiredBrowserTests) if (!cases.has(`${basename(item.file)}#${item.title}`)) throw new Error(`Missing required browser case: ${item.file}#${item.title}`);
  return { passed, required: contract.requiredBrowserTests.length };
}

export function inspectNodeReport(path: string, required: RequiredCase[] = []): { passed: number; required: number } {
  const records = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const summary = records.filter(item => item.type === 'test:summary').at(-1)?.data;
  const counts = summary?.counts ?? summary;
  if (!counts || !Number.isInteger(counts.tests) || counts.tests < 1 || counts.passed !== counts.tests) throw new Error('Node report has no complete passing summary.');
  for (const name of ['failed', 'cancelled', 'skipped', 'todo']) if (counts[name] !== 0) throw new Error(`Node report contains ${name} tests.`);
  for (const item of required) {
    const passed = records.some(event => event.type === 'test:pass' && event.data.name === item.title && !event.data.skip && !event.data.todo && typeof event.data.file === 'string' && event.data.file.replaceAll('\\', '/').endsWith(`/${item.file}`));
    if (!passed) throw new Error(`Missing required Node case: ${item.file}#${item.title}`);
  }
  return { passed: counts.passed, required: required.length };
}
