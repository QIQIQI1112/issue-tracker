import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
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
