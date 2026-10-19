import { describe, test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { processIdentity } from '../factory/ownership.ts';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { git, protectedPath } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import type { GitHubHost } from '../factory/github.ts';
import type { Publication, Repo } from '../src/workflow.ts';

const enrollment = { repository: 'fixture/project', remote: 'origin', workflow: 'verify.yml' };
const decomposition = { assumptions: [], issues: [{ key: 'ready', title: 'Ready value', description: 'Return ready.', acceptance: ['The value is ready.'], dependsOn: [] }, { key: 'confirm', title: 'Confirm readiness', description: 'Confirm ready.', acceptance: ['The integrated value is ready.'], dependsOn: ['ready'] }] };

class FixtureGitHub implements GitHubHost {
  calls: { method: string; path: string; body?: unknown }[] = [];
  pushes = 0;
  mode = 'pending';
  pull: Record<string, unknown> | undefined;
  head = '';
  base = '';
  branch = '';
  mergeCalls = 0;
  loseCreate = false;
  loseMerge = false;
  async fetch(repo: Repo): Promise<void> { git(repo.path, ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']); }
  async push(repo: Repo, publication: Publication): Promise<void> {
    this.pushes += 1; this.head = publication.headCommit!; this.base = publication.baseCommit!; this.branch = publication.branch;
    git(repo.path, ['push', 'origin', `${this.head}:refs/heads/${this.branch}`]);
  }
  constructor(readonly repository: string) {}
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    this.calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/pulls?')) return this.pull ? [this.pull] : [];
    if (method === 'POST' && path.endsWith('/pulls')) {
      this.pull = { number: 1, html_url: 'https://github.com/fixture/project/pull/1', state: 'open', merged: false, draft: false, mergeable: true, mergeable_state: 'clean', head: { sha: this.head, ref: this.branch, repo: { full_name: enrollment.repository } }, base: { sha: this.base, ref: 'main', repo: { full_name: enrollment.repository } } };
      if (this.loseCreate) { this.loseCreate = false; throw new Error('Connection lost after PR creation.'); }
      return this.pull;
    }
    if (method === 'GET' && /\/pulls\/1$/.test(path)) return this.mode === 'changed-head' ? { ...this.pull, head: { sha: 'f'.repeat(40), ref: this.branch, repo: { full_name: enrollment.repository } } } : this.mode === 'closed' ? { ...this.pull, state: 'closed' } : this.mode === 'wrong-base' ? { ...this.pull, base: { sha: this.base, ref: 'other', repo: { full_name: enrollment.repository } } } : this.pull;
    if (path.endsWith('/protection')) return { required_status_checks: { strict: this.mode !== 'unprotected', contexts: ['verify'] }, enforce_admins: { enabled: true } };
    if (path.includes('/actions/workflows/')) {
      const run = { id: 7, run_attempt: 1, status: this.mode === 'pending' ? 'in_progress' : 'completed', conclusion: this.mode === 'failure' ? 'failure' : 'success', head_sha: this.mode === 'stale' ? 'e'.repeat(40) : this.head, event: 'pull_request', path: '.github/workflows/verify.yml', html_url: 'https://github.com/fixture/project/actions/runs/7', pull_requests: [{ number: 1, head: { sha: this.head }, base: { sha: this.base } }] };
      const workflow_runs = this.mode === 'missing' ? [] : this.mode === 'newer-failed' ? [run, { ...run, id: 8, conclusion: 'failure' }] : [run];
      return { total_count: workflow_runs.length, workflow_runs };
    }
    if (path.includes('/actions/runs/')) return { total_count: 1, jobs: [{ name: 'verify', status: 'completed', conclusion: this.mode === 'skipped' ? 'skipped' : 'success', head_sha: this.head }] };
    if (path.includes('/check-runs')) {
      const check_runs = [{ name: 'verify', status: 'completed', conclusion: 'success', head_sha: this.head }];
      if (['other-check-failed', 'other-check-pending'].includes(this.mode)) check_runs.push({ name: 'security', status: this.mode === 'other-check-pending' ? 'in_progress' : 'completed', conclusion: this.mode === 'other-check-pending' ? '' : 'failure', head_sha: this.head });
      return { total_count: check_runs.length, check_runs };
    }
    if (path.includes('/status')) return this.mode === 'commit-status-pending' ? { state: 'pending', statuses: [{ context: 'external-status', state: 'pending' }] } : { state: 'success', statuses: [] };
    if (method === 'PUT' && path.endsWith('/merge')) {
      this.mergeCalls += 1;
      assert.equal((body as { sha: string }).sha, this.head, 'GitHub merge must condition on the exact verified head.');
      assert.equal((body as { merge_method: string }).merge_method, 'merge');
      const tree = git(this.repository, ['rev-parse', `${this.head}^{tree}`]).trim();
      const sha = git(this.repository, ['-c', 'user.name=Fixture GitHub', '-c', 'user.email=github@localhost', 'commit-tree', tree, '-p', this.base, '-p', this.head, '-m', 'Fixture pull request merge']).trim();
      git(this.repository, ['push', 'origin', `${sha}:refs/heads/main`]);
      this.pull = { ...this.pull, state: 'closed', merged: true, merge_commit_sha: sha };
      if (this.loseMerge) { this.loseMerge = false; throw new Error('Connection lost after GitHub merged.'); }
      return { merged: true, sha };
    }
    throw new Error(`Unexpected fixture GitHub operation: ${method} ${path}`);
  }
}

async function prepared(mode = 'pending', rejectWhole = false) {
  const root = evidenceDirectory('requirement-github');
  const repository = fixtureRepository(join(root, 'repo'));
  const remote = join(root, 'remote.git'); mkdirSync(remote);
  git(repository, ['clone', '--bare', repository, remote]);
  git(repository, ['remote', 'add', 'origin', remote]);
  const store = new IssueStore(join(root, 'state.sqlite'));
  const repo = store.work.addRepo({ name: 'GitHub fixture', path: repository, targetBranch: 'main', github: enrollment });
  const requirement = store.work.addRequirement({ repoId: repo.id, title: 'One reviewed PR', goal: 'Return ready, verify both children and publish one PR.' });
  store.work.startRequirement(requirement.id);
  const host = new FixtureGitHub(repository); host.mode = mode;
  const options = { agent: fixtureAgent(), planner: { decompose: async () => decomposition, review: async (input: { evidence: string }) => rejectWhole && input.evidence.includes('Verification:') ? ({ approved: false, summary: 'The original goal is not delivered.', findings: ['Whole-goal fixture rejection.'] }) : ({ approved: true, summary: 'The complete goal and evidence are covered.', findings: [] }) }, github: host, publicationPollMs: 1 };
  const queue = new SerialQueue(store, options);
  const initial = git(repository, ['rev-parse', 'main']).trim();
  for (let index = 0; index < 4; index += 1) assert.equal(await queue.processNext(), true);
  return { root, repository, store, repo, requirement, host, options, queue, initial };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('GitHub requirement publication', { concurrency: 4 }, () => {
  test('GitHub requirements isolate child merges and complete only after exact-source CI and remote merge', { timeout: 60000 }, async () => {
    const f = await prepared();
    try {
      const requirement = f.store.work.requirement(f.requirement.id)!;
      assert.notEqual(requirement.status, 'done', 'Local whole-goal acceptance must not claim GitHub delivery.');
      assert.ok(requirement.publication?.branch.startsWith('codex/requirement-'));
      assert.equal(git(f.repository, ['rev-parse', 'main']).trim(), f.initial);
      const childRuns = f.store.work.runs().filter(run => run.issueId !== null);
      for (const run of childRuns) assert.equal(JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8')).integration.branch, requirement.publication!.branch);
      assert.equal(f.host.calls.length, 0, 'Publishing must follow complete whole-goal acceptance.');
      assert.equal(f.host.pushes, 0, 'Remote push must follow complete whole-goal acceptance.');
      assert.equal(await f.queue.processNext(), true);
      assert.equal(f.store.work.requirement(f.requirement.id)?.publication?.state, 'awaiting_ci');
      assert.equal(f.host.mergeCalls, 0);
      const reopened = new IssueStore(f.store.path);
      assert.equal(reopened.work.requirement(f.requirement.id)?.publication?.url, 'https://github.com/fixture/project/pull/1'); reopened.close();
      f.host.mode = 'success'; await tick();
      assert.equal(await new SerialQueue(f.store, f.options).processNext(), true);
      const delivered = f.store.work.requirement(f.requirement.id)!;
      assert.equal(delivered.status, 'done'); assert.equal(delivered.publication?.state, 'merged');
      assert.equal(delivered.publication?.mergeCommit, git(f.repository, ['rev-parse', 'main']).trim());
      assert.equal(f.host.mergeCalls, 1); assert.equal(f.host.calls.filter(call => call.method === 'POST').length, 1);
      const report = JSON.parse(readFileSync(join(f.store.work.runs()[0].evidencePath, 'delivery.json'), 'utf8'));
      assert.equal(report.publication.mergeCommit, delivered.publication?.mergeCommit);
      assert.equal(await f.queue.processNext(), false);
    } finally { f.store.close(); }
  });

  for (const mode of ['missing', 'stale', 'failure', 'skipped', 'newer-failed', 'other-check-failed', 'changed-head', 'closed', 'unprotected', 'wrong-base']) test(`GitHub ${mode} evidence cannot authorize a requirement merge`, { timeout: 60000 }, async () => {
    const f = await prepared(mode);
    try {
      assert.equal(await f.queue.processNext(), true);
      assert.notEqual(f.store.work.requirement(f.requirement.id)?.status, 'done', 'Missing or rejected publication proof must keep the requirement unfinished.');
      assert.equal(f.host.mergeCalls, 0);
      assert.equal(git(f.repository, ['rev-parse', 'main']).trim(), f.initial);
      assert.ok(f.host.calls.some(call => call.method === 'POST'), 'The failure is checked against a real fixture PR.');
      assert.equal(f.store.work.requirement(f.requirement.id)?.publication?.state, ['missing', 'stale'].includes(mode) ? 'awaiting_ci' : 'blocked');
    } finally { f.store.close(); }
  });

  for (const phase of ['create', 'merge']) test(`publication retry reconciles a lost ${phase} response without duplicate PRs or development`, { timeout: 60000 }, async () => {
    const f = await prepared('success');
    try {
      f.host.loseCreate = phase === 'create'; f.host.loseMerge = phase === 'merge';
      assert.equal(await f.queue.processNext(), true);
      assert.equal(f.store.work.requirement(f.requirement.id)?.status, 'blocked', 'An uncertain external result needs reconciliation.');
      const childCount = f.store.work.runs().filter(run => run.issueId !== null).length;
      f.store.work.startRequirement(f.requirement.id);
      assert.equal(await new SerialQueue(f.store, f.options).processNext(), true);
      assert.equal(f.store.work.requirement(f.requirement.id)?.status, 'done');
      assert.equal(f.store.work.runs().filter(run => run.issueId !== null).length, childCount);
      assert.equal(f.host.calls.filter(call => call.method === 'POST').length, 1);
      assert.equal(f.host.mergeCalls, 1);
    } finally { f.store.close(); }
  });

  test('publication restart resumes an interrupted poll and rejects a moved target without another merge', { timeout: 60000 }, async () => {
    const f = await prepared();
    try {
      assert.equal(await f.queue.processNext(), true);
      await tick();
      const interrupted = f.store.work.claim(join(f.root, 'evidence'))!;
      assert.equal(interrupted.job.kind, 'requirement_publish');
      const queue = new SerialQueue(f.store, f.options); queue.recover();
      assert.ok(f.store.work.jobs().some(job => job.kind === 'requirement_publish' && job.status === 'queued'));
      assert.equal(f.store.work.runs().filter(run => run.issueId !== null).length, 2);
      f.host.mode = 'success';
      git(f.repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-qm', 'External base change']);
      git(f.repository, ['push', 'origin', 'main']);
      await tick(); assert.equal(await queue.processNext(), true);
      assert.equal(f.store.work.requirement(f.requirement.id)?.status, 'blocked');
      assert.equal(f.host.mergeCalls, 0);
      assert.match(f.store.work.runs()[0].reason ?? '', /base|target/i);
    } finally { f.store.close(); }
  });

  test('publication enrollment is snapshotted and cross-requirement dependencies wait for GitHub delivery', { timeout: 60000 }, async () => {
    const f = await prepared();
    try {
      const other = f.store.work.addRequirement({ repoId: f.repo.id, title: 'Next requirement', goal: 'Use the published prerequisite.' });
      assert.notEqual(other.publication?.branch, f.store.work.requirement(f.requirement.id)?.publication?.branch, 'Every requirement needs its own persistent branch.');
      const prerequisite = f.store.list().find(issue => issue.title === 'Confirm readiness')!;
      const dependent = f.store.create({ title: 'Dependent', description: 'Use the prerequisite.', labels: [], status: 'open', priority: 'medium', work: { repoId: f.repo.id, requirementId: other.id, dependsOn: [prerequisite.id], acceptance: ['Prerequisite is delivered.'] } });
      f.store.work.startRequirement(other.id);
      assert.equal(await f.queue.processNext(), true); await tick();
      assert.equal(f.store.work.claim(join(f.root, 'probe'))?.job.kind, 'requirement_publish', 'A local child merge cannot release work in another requirement.');
      assert.equal(f.store.work.jobs().find(job => job.issueId === dependent.id)?.status, 'queued');
      const resumed = new SerialQueue(f.store, f.options); resumed.recover();
      f.host.mode = 'success'; await tick();
      assert.equal(await resumed.processNext(), true);
      assert.equal(f.store.work.requirement(f.requirement.id)?.status, 'done');
      assert.equal(f.store.work.claim(join(f.root, 'released'))?.job.issueId, dependent.id, 'GitHub merge releases the waiting dependent.');
    } finally { f.store.close(); }
  });

  for (const mode of ['whole-review-reject', 'local-head-moved']) test(`publication rejects ${mode} before contacting GitHub`, { timeout: 60000 }, async () => {
    const f = await prepared('success', mode === 'whole-review-reject');
    try {
      if (mode === 'local-head-moved') {
        const publication = f.store.work.requirement(f.requirement.id)?.publication;
        assert.ok(publication, 'A GitHub requirement needs a frozen publication identity.');
        const before = git(f.repository, ['rev-parse', publication.branch]).trim();
        const tree = git(f.repository, ['rev-parse', `${before}^{tree}`]).trim();
        const changed = git(f.repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit-tree', tree, '-p', before, '-m', 'Unreviewed head']).trim();
        git(f.repository, ['update-ref', `refs/heads/${publication.branch}`, changed, before]);
        assert.equal(await f.queue.processNext(), true);
      }
      assert.equal(f.store.work.requirement(f.requirement.id)?.status, 'blocked');
      assert.equal(f.host.calls.length, 0);
      assert.equal(f.host.pushes, 0);
      assert.equal(f.host.mergeCalls, 0);
    } finally { f.store.close(); }
  });

  test('standalone issues in a GitHub-enrolled repository retain their local integration target', { timeout: 60000 }, async () => {
    const f = await prepared();
    try {
      f.options.publicationPollMs = 60000;
      assert.equal(await f.queue.processNext(), true);
      const standalone = f.store.create({ title: 'Standalone maintenance behavior', description: 'Return ready locally.', labels: [], status: 'open', priority: 'medium', work: { repoId: f.repo.id, requirementId: null, dependsOn: [], acceptance: ['The value is ready.'] } });
      f.store.work.startIssue(standalone.id);
      assert.equal(await f.queue.processNext(), true);
      const run = f.store.work.runs().find(run => run.issueId === standalone.id)!;
      assert.equal(run.status, 'merged');
      assert.equal(JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8')).integration.branch, 'main');
      assert.equal(f.store.work.requirement(f.requirement.id)?.publication?.state, 'awaiting_ci');
      assert.equal(f.host.mergeCalls, 0);
    } finally { f.store.close(); }
  });

  test('GitHub verification workflows remain protected even when a task declares that directory in scope', () => {
    assert.equal(protectedPath('.github/workflows/verify.yml', new Set()), true, 'Ordinary executors cannot edit their GitHub verifier.');
  });

  for (const mode of ['other-check-pending', 'commit-status-pending']) test(`publication keeps polling ${mode} and merges after it succeeds`, { timeout: 60000 }, async () => {
    const f = await prepared(mode);
    try {
      assert.equal(await f.queue.processNext(), true);
      assert.equal(f.store.work.requirement(f.requirement.id)?.status, 'queued', 'Unfinished CI must defer observation, not require manual retry.');
      assert.equal(f.store.work.requirement(f.requirement.id)?.publication?.state, 'awaiting_ci');
      assert.equal(f.host.mergeCalls, 0);
      f.host.mode = 'success'; await tick();
      assert.equal(await f.queue.processNext(), true);
      assert.equal(f.store.work.requirement(f.requirement.id)?.status, 'done');
      assert.equal(f.host.calls.filter(call => call.method === 'POST').length, 1);
      assert.equal(f.host.mergeCalls, 1);
    } finally { f.store.close(); }
  });

  test('an unsettled publication owner blocks another job in the shared repo until ownership is settled', { timeout: 60000 }, async () => {
    const f = await prepared();
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    await once(child, 'spawn');
    try {
      f.options.publicationPollMs = 60000;
      assert.equal(await f.queue.processNext(), true);
      const previous = f.store.work.runs()[0];
      const receipt = join(previous.evidencePath, 'unsettled-github.owner.json');
      const owner = { pid: child.pid!, identity: processIdentity(child.pid!), groups: [child.pid!], settled: false };
      writeFileSync(receipt, JSON.stringify(owner));
      const standalone = f.store.create({ title: 'Wait for publication ownership', description: 'Do not race an unresolved GitHub process.', labels: [], status: 'open', priority: 'medium', work: { repoId: f.repo.id, requirementId: null, dependsOn: [], acceptance: ['The value is ready.'] } });
      f.store.work.startIssue(standalone.id);
      let phases = 0;
      const delegate = fixtureAgent();
      const queue = new SerialQueue(f.store, { ...f.options, agent: { run: async input => { phases += 1; return delegate.run(input); } } });
      assert.equal(await queue.processNext(), true);
      assert.equal(f.store.work.runs().find(run => run.issueId === standalone.id)?.status, 'blocked', 'Shared repository operations must wait for the previous publisher.');
      assert.equal(phases, 0);
      assert.equal(git(f.repository, ['rev-parse', 'main']).trim(), f.initial);
      const exited = once(child, 'exit'); process.kill(-child.pid!, 'SIGTERM'); await exited;
      writeFileSync(receipt, JSON.stringify({ ...owner, settled: true }));
      f.store.work.startIssue(standalone.id);
      assert.equal(await queue.processNext(), true);
      assert.equal(f.store.work.runs().filter(run => run.issueId === standalone.id)[0].status, 'merged');
      assert.ok(phases > 0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); process.kill(-child.pid!, 'SIGTERM'); await exited; }
      f.store.close();
    }
  });
});
