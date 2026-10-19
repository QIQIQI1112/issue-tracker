import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Repo, Publication, Requirement, Delivery } from '../src/workflow.ts';
import type { IssueStore } from '../src/storage.ts';
import { git } from './workspace.ts';
import { runProcess } from './process.ts';
import { readJson, writeJson } from './evidence.ts';
import { acquireDatabaseLock } from '../src/instance.ts';
import { commitSnapshot } from './maintenance.ts';

export type GitHubHost = { fetch(repo: Repo, publication: Publication): Promise<void>; push(repo: Repo, publication: Publication): Promise<void>; request(method: string, path: string, body?: unknown): Promise<unknown> };
type Pull = { number: number; html_url: string; state: string; merged: boolean; draft: boolean; merge_commit_sha?: string; head: { sha: string; ref: string; repo: { full_name: string } }; base: { sha: string; ref: string; repo: { full_name: string } } };
type WorkflowRun = { id: number; run_attempt: number; status: string; conclusion: string | null; head_sha: string; event: string; path: string; html_url: string; pull_requests: { number: number; head: { sha: string }; base: { sha: string } }[] };

export function githubHost(repo: Repo, publication: Publication, directory: string, signal?: AbortSignal): GitHubHost {
  let sequence = 0;
  const execute = async (command: string, args: string[], input?: string): Promise<string> => {
    const logPath = join(directory, `github-${++sequence}-${command}.log`);
    const result = await runProcess({ command, args, input, cwd: repo.path, env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' }, logPath, timeoutMs: 30000, signal });
    if (result.status !== 'passed') throw new Error(`${command} ${args[0]} failed: ${result.status}. ${result.error ?? result.output.slice(-2000)}`);
    return readFileSync(logPath, 'utf8');
  };
  const remoteIdentity = (push: boolean) => {
    const url = git(repo.path, ['remote', 'get-url', '--all', ...(push ? ['--push'] : []), publication.remote]).trim();
    if (url.includes('\n')) throw new Error('Enrolled Git remote has ambiguous destinations.');
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
    if (match?.[1].toLowerCase() !== publication.repository.toLowerCase()) throw new Error('Enrolled GitHub repository does not match the Git remote.');
  };
  return {
    fetch: async () => { remoteIdentity(false); await execute('git', ['fetch', '--no-tags', publication.remote, `refs/heads/${publication.baseBranch}:refs/remotes/${publication.remote}/${publication.baseBranch}`]); },
    push: async () => { remoteIdentity(true); await execute('git', ['push', publication.remote, `${publication.headCommit}:refs/heads/${publication.branch}`]); },
    request: async (method, path, body) => JSON.parse(await execute('gh', ['api', '--hostname', 'github.com', '--method', method, '-H', 'Accept: application/vnd.github+json', path, ...(body === undefined ? [] : ['--input', '-'])], body === undefined ? undefined : JSON.stringify(body))),
  };
}

function advanceLocalTarget(repo: Repo, publication: Publication, commit: string): void {
  const common = resolve(repo.path, git(repo.path, ['rev-parse', '--git-common-dir']).trim());
  const release = acquireDatabaseLock(join(common, 'loop-integration'), `github-${publication.branch}`);
  try {
    const before = git(repo.path, ['rev-parse', `refs/heads/${publication.baseBranch}`]).trim();
    if (before === commit) return;
    git(repo.path, ['merge-base', '--is-ancestor', before, commit]);
    const checkout = git(repo.path, ['worktree', 'list', '--porcelain']).split('\n\n').find(block => block.split('\n').includes(`branch refs/heads/${publication.baseBranch}`));
    if (checkout) {
      const path = checkout.split('\n')[0].slice('worktree '.length);
      if (git(path, ['status', '--porcelain']).trim()) throw new Error('Target checkout is dirty; retain the GitHub result and clean it before retrying.');
      git(path, ['merge', '--ff-only', '--no-edit', commit]);
    } else git(repo.path, ['update-ref', `refs/heads/${publication.baseBranch}`, commit, before]);
  } finally { release(); }
}

export async function prepareRequirementBranch(repo: Repo, publication: Publication, host: GitHubHost): Promise<string> {
  if (publication.baseCommit) {
    git(repo.path, ['merge-base', '--is-ancestor', publication.baseCommit, `refs/heads/${publication.branch}`]);
    return publication.baseCommit;
  }
  await host.fetch(repo, publication);
  const base = git(repo.path, ['rev-parse', `refs/remotes/${publication.remote}/${publication.baseBranch}`]).trim();
  advanceLocalTarget(repo, publication, base);
  const existing = git(repo.path, ['for-each-ref', '--format=%(objectname)', `refs/heads/${publication.branch}`]).trim();
  if (existing && existing !== base) throw new Error('Reserved requirement branch already contains unowned changes.');
  if (!existing) git(repo.path, ['branch', publication.branch, base]);
  return base;
}

function verifiedPublication(store: IssueStore, requirement: Requirement): { publication: Publication; repo: Repo; report: Delivery; children: { issueId: number | null; report: Delivery }[] } {
  const publication = requirement.publication;
  if (!publication?.headCommit || !publication.baseCommit || !publication.verifiedRunId) throw new Error('Publication requires complete whole-requirement verification.');
  const repo = store.work.repo(requirement.repoId)!;
  if (git(repo.path, ['rev-parse', `refs/heads/${publication.branch}`]).trim() !== publication.headCommit) throw new Error('Requirement head changed after whole-goal acceptance.');
  const run = store.work.run(publication.verifiedRunId);
  const final = store.work.jobs().filter(job => job.requirementId === requirement.id && job.kind === 'requirement_verify').at(-1);
  if (!run || run.status !== 'passed' || run.repoId !== repo.id || run.requirementId !== requirement.id || run.issueId !== null || run.jobId !== final?.id || final.status !== 'completed') throw new Error('Publication has no current owned whole-requirement approval.');
  const report = readJson(join(run.evidencePath, 'delivery.json')) as Delivery;
  const verification = readJson(join(run.evidencePath, 'verification/summary.json')) as { status: string; snapshot: { hash: string } };
  const review = readJson(join(run.evidencePath, 'review.json')) as { approved: boolean; findings: unknown[] };
  const source = commitSnapshot(repo.path, publication.headCommit);
  if (verification.status !== 'passed' || verification.snapshot.hash !== source.hash || report.sourceHash !== source.hash || !review.approved || review.findings.length || report.baseline !== publication.headCommit) throw new Error('Whole-requirement proof does not match the published source.');
  const children = store.list().filter(issue => issue.work?.requirementId === requirement.id).map(issue => {
    const child = store.work.runs().find(run => run.issueId === issue.id && run.requirementId === requirement.id && run.repoId === repo.id && run.status === 'merged');
    if (!child) throw new Error('Publication requires every child merge.');
    const report = readJson(join(child.evidencePath, 'delivery.json')) as Delivery;
    if (report.status !== 'merged' || report.integration?.branch !== publication.branch) throw new Error('Child was not integrated into its requirement branch.');
    git(repo.path, ['merge-base', '--is-ancestor', report.integration.commit, publication.headCommit!]);
    return { issueId: issue.id, report };
  });
  if (!children.length) throw new Error('An empty requirement cannot be published.');
  return { publication, repo, report, children };
}

function pullIdentity(pull: Pull, publication: Publication): void {
  if (!Number.isSafeInteger(pull.number) || pull.number < 1 || pull.html_url !== `https://github.com/${publication.repository}/pull/${pull.number}` || pull.head.sha !== publication.headCommit || pull.head.ref !== publication.branch || pull.base.ref !== publication.baseBranch || pull.head.repo.full_name.toLowerCase() !== publication.repository.toLowerCase() || pull.base.repo.full_name.toLowerCase() !== publication.repository.toLowerCase() || pull.draft) throw new Error('GitHub PR head, base, repository or identity changed.');
}

async function ciProof(host: GitHubHost, publication: Publication, pull: Pull, directory: string, observed: (run: WorkflowRun) => void): Promise<WorkflowRun | undefined> {
  const root = `/repos/${publication.repository}`;
  const response = await host.request('GET', `${root}/actions/workflows/${encodeURIComponent(publication.workflow)}/runs?event=pull_request&head_sha=${publication.headCommit}&per_page=100`) as { total_count: number; workflow_runs: WorkflowRun[] };
  writeJson(join(directory, 'github-workflow-runs.json'), response);
  if (!Array.isArray(response.workflow_runs) || response.total_count > 100) throw new Error('GitHub workflow report is incomplete.');
  const runs = response.workflow_runs.filter(run => run.head_sha === publication.headCommit && run.event === 'pull_request' && run.path.split('@')[0] === `.github/workflows/${publication.workflow}` && run.pull_requests.some(item => item.number === pull.number && item.head.sha === publication.headCommit && item.base.sha === publication.baseCommit));
  const run = runs.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
  if (run) observed(run);
  if (!run || run.status !== 'completed') return undefined;
  if (run.conclusion !== 'success') throw new Error(`Required GitHub CI failed: ${run.conclusion}.`);
  const jobs = await host.request('GET', `${root}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`) as { total_count: number; jobs: { name: string; status: string; conclusion: string }[] };
  const checks = await host.request('GET', `${root}/commits/${publication.headCommit}/check-runs?filter=latest&per_page=100`) as { total_count: number; check_runs: { name: string; status: string; conclusion: string; head_sha: string }[] };
  const statuses = await host.request('GET', `${root}/commits/${publication.headCommit}/status?per_page=100`) as { state: string; statuses: unknown[]; total_count?: number };
  writeJson(join(directory, 'github-ci.json'), { run, jobs, checks, statuses });
  if (!Array.isArray(jobs.jobs) || !Array.isArray(checks.check_runs) || !Array.isArray(statuses.statuses) || jobs.total_count > 100 || checks.total_count > 100 || (statuses.total_count ?? statuses.statuses.length) > 100) throw new Error('GitHub CI report is incomplete.');
  if (!jobs.jobs.some(job => job.name === 'verify') || !checks.check_runs.some(check => check.name === 'verify') || checks.check_runs.some(check => check.head_sha !== publication.headCommit) || [...jobs.jobs, ...checks.check_runs].some(check => check.status === 'completed' && check.conclusion !== 'success') || statuses.statuses.length && !['pending', 'success'].includes(statuses.state)) throw new Error('GitHub CI contains missing, skipped or failed checks.');
  if ([...jobs.jobs, ...checks.check_runs].some(check => check.status !== 'completed') || statuses.statuses.length && statuses.state === 'pending') return undefined;
  const protection = await host.request('GET', `${root}/branches/${encodeURIComponent(publication.baseBranch)}/protection`) as { required_status_checks?: { strict?: boolean; contexts?: string[]; checks?: { context: string }[] }; enforce_admins?: { enabled: boolean } };
  writeJson(join(directory, 'github-protection.json'), protection);
  if (!protection.required_status_checks?.strict || ![...(protection.required_status_checks.contexts ?? []), ...(protection.required_status_checks.checks ?? []).map(check => check.context)].includes('verify') || !protection.enforce_admins?.enabled) throw new Error('GitHub target must require strict verify CI and enforce branch protection for administrators.');
  return run;
}

export async function publishRequirement(store: IssueStore, requirement: Requirement, directory: string, host: GitHubHost): Promise<Publication> {
  const { publication, repo, report, children } = verifiedPublication(store, requirement);
  const root = `/repos/${publication.repository}`;
  await host.fetch(repo, publication);
  const listed = publication.number ? undefined : await host.request('GET', `${root}/pulls?state=all&head=${encodeURIComponent(publication.repository.split('/')[0] + ':' + publication.branch)}&base=${encodeURIComponent(publication.baseBranch)}&per_page=100`) as Pull[];
  if (listed && (!Array.isArray(listed) || listed.length > 1)) throw new Error('Requirement branch has ambiguous GitHub PR history.');
  let pull = publication.number ? await host.request('GET', `${root}/pulls/${publication.number}`) as Pull : listed?.[0];
  const reconcile = async (pull: Pull): Promise<Publication> => {
    const recorded = store.work.requirement(requirement.id)!.publication!;
    if (!recorded.ciRunId || recorded.ciHead !== publication.headCommit || !pull.merge_commit_sha || !/^[a-f0-9]{40,64}$/.test(pull.merge_commit_sha)) throw new Error('Merged GitHub PR has no recorded exact-head CI approval.');
    const next = store.work.updatePublication(requirement.id, { number: pull.number, url: pull.html_url, mergeCommit: pull.merge_commit_sha, reason: '' });
    await host.fetch(repo, next);
    git(repo.path, ['merge-base', '--is-ancestor', pull.merge_commit_sha, `refs/remotes/${next.remote}/${next.baseBranch}`]);
    advanceLocalTarget(repo, next, git(repo.path, ['rev-parse', `refs/remotes/${next.remote}/${next.baseBranch}`]).trim());
    return store.work.updatePublication(requirement.id, { state: 'merged' });
  };
  if (pull) { pullIdentity(pull, publication); if (pull.merged) return reconcile(pull); if (pull.state !== 'open') throw new Error('GitHub PR was closed without merging.'); }
  if (Date.now() > (publication.deadline ?? 0)) throw new Error('GitHub publication exceeded its 24-hour CI waiting budget.');
  const remoteBase = git(repo.path, ['rev-parse', `refs/remotes/${publication.remote}/${publication.baseBranch}`]).trim();
  if (remoteBase !== publication.baseCommit) throw new Error('GitHub target base changed after requirement acceptance. Owner rebase and fresh acceptance are required.');
  if (!pull) {
    await host.push(repo, publication);
    const paths = [...new Set(children.flatMap(child => child.report.changes.map(change => change.path)))];
    const body = `${requirement.goal}\n\n## Delivered issues\n\n${children.map(child => `- Local issue ${child.issueId}: ${child.report.title}\n  ${child.report.summary?.slice(0, 1000) ?? ''}`).join('\n')}\n\n## Changed files\n\n${paths.slice(0, 150).map(path => '- ' + path).join('\n')}\n\n## Validation\n\nWhole-goal verification: ${report.nodePassed} Node and ${report.browserPassed} browser cases. Independent requirement review approved.\n\nVerified head: ${publication.headCommit}\nWhole-goal run: ${publication.verifiedRunId}\n\nFull local evidence remains attached to the platform requirement and its child issues.\n`;
    writeJson(join(directory, 'github-pr-input.json'), { title: requirement.title, body, head: publication.branch, base: publication.baseBranch });
    pull = await host.request('POST', `${root}/pulls`, { title: requirement.title, body, head: publication.branch, base: publication.baseBranch }) as Pull;
  }
  pullIdentity(pull, publication);
  store.work.updatePublication(requirement.id, { state: 'awaiting_ci', number: pull.number, url: pull.html_url, reason: '' });
  pull = await host.request('GET', `${root}/pulls/${pull.number}`) as Pull;
  writeJson(join(directory, 'github-pr.json'), pull);
  pullIdentity(pull, publication);
  if (pull.state !== 'open' || pull.merged || pull.base.sha !== publication.baseCommit) throw new Error('GitHub PR state or base changed before CI admission.');
  const ci = await ciProof(host, publication, pull, directory, run => { store.work.updatePublication(requirement.id, { ciRunId: run.id, ciUrl: run.html_url }); });
  if (!ci) return store.work.requirement(requirement.id)!.publication!;
  const approved = store.work.updatePublication(requirement.id, { ciRunId: ci.id, ciUrl: ci.html_url, ciHead: publication.headCommit });
  const fresh = await host.request('GET', `${root}/pulls/${pull.number}`) as Pull;
  pullIdentity(fresh, approved);
  if (fresh.state !== 'open' || fresh.merged || fresh.base.sha !== publication.baseCommit) throw new Error('GitHub PR base or state changed before merge.');
  if (git(repo.path, ['rev-parse', `refs/heads/${publication.branch}`]).trim() !== publication.headCommit) throw new Error('Local requirement head changed before merge.');
  const merged = await host.request('PUT', `${root}/pulls/${pull.number}/merge`, { sha: publication.headCommit, merge_method: 'merge' }) as { merged: boolean; sha: string };
  writeJson(join(directory, 'github-merge-response.json'), merged);
  if (!merged.merged) throw new Error('GitHub did not confirm the pull request merge.');
  const confirmed = await host.request('GET', `${root}/pulls/${pull.number}`) as Pull;
  pullIdentity(confirmed, approved);
  if (!confirmed.merged || confirmed.merge_commit_sha !== merged.sha) throw new Error('GitHub merge receipt does not match the confirmed PR.');
  return reconcile(confirmed);
}
