import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { githubHost } from '../factory/github.ts';
import { git } from '../factory/workspace.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('GitHub publication rejects multiple push destinations before invoking push', async () => {
  const root = evidenceDirectory('github-remote');
  const repository = fixtureRepository(join(root, 'repo'));
  git(repository, ['remote', 'add', 'origin', 'https://github.com/fixture/project.git']);
  git(repository, ['remote', 'set-url', '--add', '--push', 'origin', 'https://github.com/fixture/project.git']);
  git(repository, ['remote', 'set-url', '--add', '--push', 'origin', 'https://github.com/other/unapproved.git']);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const bin = join(root, 'bin'); mkdirSync(bin);
  const marker = join(root, 'push-invoked');
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env node\nconst{execFileSync}=require('node:child_process');const{writeFileSync}=require('node:fs');const args=process.argv.slice(2);if(args[0]==='push'){writeFileSync(${JSON.stringify(marker)},JSON.stringify(args));process.exit(0);}execFileSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});\n`, { mode: 0o755 });
  const publication = { repository: 'fixture/project', remote: 'origin', workflow: 'verify.yml', branch: 'codex/requirement-test', baseBranch: 'main', headCommit: git(repository, ['rev-parse', 'HEAD']).trim(), state: 'awaiting_ci' as const };
  const repo = { id: 1, name: 'Fixture', path: repository, targetBranch: 'main', createdAt: new Date().toISOString() };
  const previous = process.env.PATH;
  process.env.PATH = bin + delimiter + previous;
  try {
    await assert.rejects(() => githubHost(repo, publication, root).push(repo, publication), /remote|destination|ambiguous/i);
    assert.equal(existsSync(marker), false, 'The fake transport must not even be asked to push. It cannot reach the network.');
  } finally { process.env.PATH = previous; }
});
