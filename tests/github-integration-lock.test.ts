import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prepareRequirementBranch } from '../factory/github.ts';
import { acquireDatabaseLock } from '../src/instance.ts';
import { git } from '../factory/workspace.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('GitHub local target synchronization respects the existing integration lock', async () => {
  const root = evidenceDirectory('github-integration-lock');
  const repository = fixtureRepository(join(root, 'repo'));
  const remote = join(root, 'remote.git'); mkdirSync(remote);
  git(repository, ['clone', '--bare', repository, remote]); git(repository, ['remote', 'add', 'origin', remote]);
  const before = git(repository, ['rev-parse', 'main']).trim();
  const tree = git(repository, ['rev-parse', `${before}^{tree}`]).trim();
  const advanced = git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit-tree', tree, '-p', before, '-m', 'Remote target advance']).trim();
  git(repository, ['push', 'origin', `${advanced}:refs/heads/main`]);
  const common = resolve(repository, git(repository, ['rev-parse', '--git-common-dir']).trim());
  const release = acquireDatabaseLock(join(common, 'loop-integration'), 'independent-existing-integration');
  const repo = { id: 1, name: 'Fixture', path: repository, targetBranch: 'main', createdAt: new Date().toISOString() };
  const publication = { repository: 'fixture/project', remote: 'origin', workflow: 'verify.yml', branch: 'codex/requirement-lock', baseBranch: 'main', state: 'pending' as const };
  const host = { fetch: async () => { git(repository, ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']); }, push: async () => { throw new Error('No push authorized in this check.'); }, request: async () => { throw new Error('No API mutation authorized in this check.'); } };
  try {
    await assert.rejects(() => prepareRequirementBranch(repo, publication, host), /owned|lock|already/i);
    assert.equal(git(repository, ['rev-parse', 'main']).trim(), before);
    assert.equal(git(repository, ['for-each-ref', '--format=%(objectname)', `refs/heads/${publication.branch}`]).trim(), '');
  } finally { release(); }
  assert.equal(await prepareRequirementBranch(repo, publication, host), advanced);
  assert.equal(git(repository, ['rev-parse', 'main']).trim(), advanced);
  assert.equal(git(repository, ['rev-parse', publication.branch]).trim(), advanced);
});
