import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationError } from './domain.ts';
import { boundedText, record } from './workflow.ts';

export function parseRepository(input: unknown): { name: string; path: string; targetBranch: string } {
  const value = record(input);
  const name = boundedText(value.name, 'Repository name', 120);
  const targetBranch = boundedText(value.targetBranch, 'Target branch', 200);
  let path: string;
  try { path = realpathSync(resolve(boundedText(value.path, 'Repository path', 2000))); }
  catch { throw new ValidationError('Repository path does not exist.'); }
  const git = (args: string[]) => spawnSync('git', args, { cwd: path, encoding: 'utf8', timeout: 5000 });
  const root = git(['rev-parse', '--show-toplevel']);
  if (root.status !== 0 || realpathSync(root.stdout.trim()) !== path) throw new ValidationError('Select the root of a local Git repository.');
  if (git(['check-ref-format', '--branch', targetBranch]).status !== 0 || targetBranch.startsWith('-') || git(['rev-parse', '--verify', `refs/heads/${targetBranch}^{commit}`]).status !== 0) throw new ValidationError('Target branch must be an existing local branch.');
  return { name, path, targetBranch };
}
