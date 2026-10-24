import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import type { Repo } from './workflow.ts';
import type { HarnessSource, RepositoryHarness } from './harness.ts';
import { describeHarnessSource } from './harness.ts';

const sourceLimit = 256 * 1024;
const aggregateLimit = 2 * 1024 * 1024;
const knownSources = ['package.json', 'AGENTS.md', 'README.md', 'scripts/verify.mjs', 'scripts/verify-ci.mjs', 'scripts/test.mjs', 'factory/verification-contract.json', 'factory/ci-verification-contract.json', 'docs/architecture.md', 'docs/verification.md', 'docs/ci-critical.md', 'docs/workbench.md', 'docs/harness-reliability.md', 'docs/github-delivery.md'];

export async function readRepositoryHarness(repo: Repo): Promise<RepositoryHarness> {
  const result: RepositoryHarness = { repository: { id: repo.id, name: repo.name, targetBranch: repo.targetBranch }, status: 'unavailable', message: 'Repository or enrolled target branch unavailable. Retry after repository metadata is restored.', sources: [] };
  const deadline = Date.now() + 10000;
  const git = (args: string[], maximum = 4096): Promise<Buffer> => new Promise((resolve, reject) => {
    if (Date.now() >= deadline) { reject(new Error('Read budget exhausted')); return; }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    execFile('git', ['--no-replace-objects', '--no-optional-locks', ...args], { cwd: repo.path, env: { ...env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }, encoding: 'buffer', timeout: Math.min(1500, deadline - Date.now()), maxBuffer: maximum, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  let commit: string;
  try {
    const root = await realpath(repo.path);
    if (await realpath((await git(['rev-parse', '--show-toplevel'])).toString('utf8').trim()) !== root) return result;
    if (!repo.targetBranch || repo.targetBranch.startsWith('-') || repo.targetBranch.length > 200 || (await git(['check-ref-format', '--branch', repo.targetBranch])).length === 0) return result;
    commit = (await git(['rev-parse', '--verify', `refs/heads/${repo.targetBranch}^{commit}`])).toString('ascii').trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return result;
  } catch { return result; }
  result.status = 'available'; result.commit = commit;
  result.message = 'Committed harness configuration only. Inspection does not run checks or establish execution success. Script commands and categories describe configured entry points; verifier expansion and test discovery cannot be established without interpreting code. Read the supplied runner and CI sources for details. Recorded execution evidence is available separately in issue diagnostics.';
  const workflow = repo.github?.workflow ?? 'verify.yml';
  const paths = [...knownSources];
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.ya?ml$/.test(workflow)) paths.push(`.github/workflows/${workflow}`);
  else result.sources.push({ path: '.github/workflows', commit, status: 'unsupported', message: 'Unsupported enrolled workflow basename.' });
  let total = 0;
  for (const path of paths) {
    const source: HarnessSource = { path, commit, status: 'unreadable', message: 'Source read failed or unavailable at the enrolled commit.' };
    try {
      const tree = (await git(['ls-tree', '-z', '-l', commit, '--', path])).toString('utf8');
      if (!tree) { source.status = 'missing'; source.message = 'Source missing at the enrolled commit.'; }
      else {
        const entry = /^(\d{6}) (\w+) ([a-f0-9]+)\s+(\S+)\t([^\0]+)\0$/.exec(tree);
        if (!entry || entry[5] !== path || !['100644', '100755'].includes(entry[1]) || entry[2] !== 'blob') {
          source.status = 'unsupported'; source.message = 'Unsupported non-regular source: symlinks, submodules and directories are not read.';
        } else {
          const size = Number(entry[4]); source.blob = entry[3];
          if (!Number.isSafeInteger(size) || size < 0) throw new Error('Unavailable blob size');
          source.bytes = size;
          if (size > sourceLimit) { source.status = 'oversized'; source.message = 'Source exceeds the 256 KiB byte limit; content withheld.'; }
          else if (total + size > aggregateLimit) { source.status = 'oversized'; source.message = 'Aggregate source byte limit of 2 MiB exhausted; content withheld.'; }
          else {
            total += size;
            const bytes = await git(['cat-file', 'blob', entry[3]], sourceLimit + 1);
            if (bytes.length !== size) throw new Error('Size changed');
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if ([...content].some(character => { const code = character.charCodeAt(0); return code === 127 || code < 32 && ![9, 10, 13].includes(code); })) throw new Error('Invalid text');
            source.content = content; source.status = 'available'; source.message = 'Committed configuration source; not executed.';
          }
        }
      }
    } catch { source.status = 'unreadable'; source.message = 'Source read failed: unavailable blob or invalid UTF-8 text. Content withheld.'; }
    result.sources.push(describeHarnessSource(source));
  }
  return result;
}
