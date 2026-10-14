import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git } from './workspace.ts';
import { snapshot, writeJson } from './evidence.ts';
import { acquireDatabaseLock } from '../src/instance.ts';

export type IntegrationReceipt = { branch: string; before: string; commit: string; tree: string };

export async function integrate(options: { repository: string; branch: string; patchPath: string; runDirectory: string; runId: string; validate: (workspace: string, before: string, attempt: number) => Promise<void> }): Promise<IntegrationReceipt> {
  const { repository, branch, runDirectory } = options;
  if (branch.startsWith('-')) throw new Error('Invalid target branch.');
  const common = resolve(repository, git(repository, ['rev-parse', '--git-common-dir']).trim());
  const lock = join(common, 'loop-integration.lock');
  const release = acquireDatabaseLock(join(common, 'loop-integration'), options.runId);
  const workspace = join(runDirectory, 'integration-workspace');
  try {
    writeJson(join(runDirectory, 'integration-owner.json'), JSON.parse(readFileSync(lock, 'utf8')));
    if (git(repository, ['status', '--porcelain']).trim()) throw new Error('Repository has uncommitted changes. Integration will not overwrite them.');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = git(repository, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]).trim();
      git(repository, ['worktree', 'add', '--detach', workspace, before]);
      try {
        symlinkSync(resolve(repository, 'node_modules'), join(workspace, 'node_modules'), 'dir');
        const patch = readFileSync(options.patchPath);
        if (patch.length) git(workspace, ['apply', '--index', '--3way', options.patchPath]);
        const verifiedHash = snapshot(workspace).hash;
        await options.validate(workspace, before, attempt);
        if (snapshot(workspace).hash !== verifiedHash) throw new Error('Integration source changed during verification or review.');
        git(workspace, ['add', '-A']);
        const tree = git(workspace, ['write-tree']).trim();
        const commit = tree === git(repository, ['rev-parse', `${before}^{tree}`]).trim() ? before : git(workspace, ['-c', 'user.name=Loop controller', '-c', 'user.email=loop@localhost', 'commit-tree', tree, '-p', before, '-m', `Complete task ${options.runId}\n\nLoop-Run: ${options.runId}`]).trim();
        const receipt = { branch, before, commit, tree };
        writeJson(join(runDirectory, `integration-${attempt}-candidate.json`), receipt);
        if (git(repository, ['rev-parse', `refs/heads/${branch}`]).trim() !== before) continue;
        if (git(repository, ['status', '--porcelain']).trim()) throw new Error('Repository changed during integration.');
        const checkedOut = git(repository, ['worktree', 'list', '--porcelain']).split('\n\n').find(block => block.includes(`branch refs/heads/${branch}\n`) || block.endsWith(`branch refs/heads/${branch}`));
        if (checkedOut) {
          const checkout = checkedOut.split('\n')[0].slice('worktree '.length);
          if (git(checkout, ['status', '--porcelain']).trim()) throw new Error('Target checkout has uncommitted changes.');
          if (commit !== before) git(checkout, ['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', '--no-edit', commit]);
        } else git(repository, ['update-ref', `refs/heads/${branch}`, commit, before]);
        if (git(repository, ['rev-parse', `refs/heads/${branch}`]).trim() !== commit) throw new Error('Target branch does not match the verified integration commit.');
        writeJson(join(runDirectory, 'integration.json'), receipt);
        return receipt;
      } finally { git(repository, ['worktree', 'remove', '--force', workspace]); }
    }
    throw new Error('Target branch kept moving; integration retry budget exhausted.');
  } finally {
    try { if (existsSync(workspace)) git(repository, ['worktree', 'remove', '--force', workspace]); }
    finally { release(); }
  }
}
