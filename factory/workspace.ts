import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { snapshot } from './evidence.ts';

export function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Git command failed: ${result.stderr || result.error?.message}`);
  return result.stdout;
}

export function protectedPath(path: string, baselinePaths: Set<string>): boolean {
  return /^(factory|scripts|tickets|\.agents)\//.test(path) || /^(AGENTS\.md|package(-lock)?\.json|.*config\.(js|ts|mjs)|\.gitignore)$/.test(path) || baselinePaths.has(path) && /^(tests|acceptance)\//.test(path);
}

export function prepareWorkspace(repository: string, runDirectory: string, baseRef?: string, useCurrentHarness = true): { path: string; baseCommit: string; baselineTree: string; sourceHash: string } {
  const source = snapshot(repository);
  const sourcePaths = new Set(source.files.map(file => file.path));
  const baseCommit = git(repository, ['rev-parse', '--verify', `${baseRef ?? 'HEAD'}^{commit}`]).trim();
  const path = join(runDirectory, 'workspace');
  git(repository, ['worktree', 'add', '--detach', path, baseCommit]);
  for (const file of source.files) {
    if (baseRef && (!useCurrentHarness || !protectedPath(file.path, sourcePaths))) continue;
    const from = resolve(repository, file.path);
    const to = resolve(path, file.path);
    if (!existsSync(from)) { rmSync(to, { force: true }); continue; }
    mkdirSync(dirname(to), { recursive: true });
    if (lstatSync(from).isSymbolicLink()) { rmSync(to, { force: true }); symlinkSync(readlinkSync(from), to); }
    else copyFileSync(from, to);
  }
  if (!existsSync(join(repository, 'node_modules'))) throw new Error('Run npm run setup before starting the controller.');
  rmSync(join(path, 'node_modules'), { recursive: true, force: true });
  git(path, ['add', '-A']);
  const baselineTree = git(path, ['write-tree']).trim();
  symlinkSync(resolve(repository, 'node_modules'), join(path, 'node_modules'), 'dir');
  return { path, baseCommit, baselineTree, sourceHash: source.hash };
}

export async function allocatePorts(): Promise<[string, string]> {
  const servers = [createServer(), createServer()];
  try {
    for (const server of servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
    return servers.map(server => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Cannot allocate owned ports.');
      return String(address.port);
    }) as [string, string];
  } finally { await Promise.all(servers.map(server => new Promise<void>(done => server.close(() => done())))); }
}

export function processEnvironment(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'CODEX_HOME']) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...extra };
}
