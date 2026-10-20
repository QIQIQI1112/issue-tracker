import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IssueStore } from '../src/storage.ts';
import type { Delivery, Job, Requirement, WorkRun } from '../src/workflow.ts';
import type { Issue } from '../src/domain.ts';
import type { Agent, ControllerState } from './controller.ts';
import { runController } from './controller.ts';
import { parseTask } from './contracts.ts';
import { codexAgent } from './agent.ts';
import { codexPlanner, parseDecomposition } from './planner.ts';
import type { Planner } from './planner.ts';
import { allocatePorts, git, prepareWorkspace, processEnvironment } from './workspace.ts';
import { parseVerificationContract, readJson, snapshot, writeJson } from './evidence.ts';
import { controllerDelivery, saveDelivery } from './delivery.ts';
import { runProcess } from './process.ts';
import type { Verification } from './controller.ts';
import { trustedVerifier } from './verifier.ts';
import { captureInterruptedDraft } from './checkpoint.ts';
import { assertRunQuiescent } from './ownership.ts';
import { githubHost, prepareRequirementBranch, publishRequirement } from './github.ts';
import type { GitHubHost } from './github.ts';
import { recoverMerge } from './recovery.ts';

export class SerialQueue {
  readonly evidenceRoot: string;
  private busy = false;
  constructor(private store: IssueStore, private options: { evidenceRoot?: string; agent?: Agent; planner?: Planner; signal?: AbortSignal; github?: GitHubHost; publicationPollMs?: number } = {}) {
    this.evidenceRoot = resolve(options.evidenceRoot ?? join(dirname(store.path), 'evidence'));
    mkdirSync(this.evidenceRoot, { recursive: true });
  }

  async processNext(): Promise<boolean> {
    if (this.busy || this.options.signal?.aborted) return false;
    this.busy = true;
    let claimed: { job: Job; run: WorkRun } | undefined;
    try {
      claimed = this.store.work.claim(this.evidenceRoot);
      if (!claimed) return false;
      const { job, run } = claimed;
      const repo = this.store.work.repo(job.repoId)!;
      mkdirSync(run.evidencePath, { recursive: true });
      writeJson(join(run.evidencePath, 'job.json'), job);
      const publicationJobs = new Set(this.store.work.jobs().filter(prior => prior.kind === 'requirement_publish').map(prior => prior.id));
      for (const previous of this.store.work.runs().filter(item => item.id !== run.id && item.repoId === repo.id && publicationJobs.has(item.jobId))) assertRunQuiescent(previous.evidencePath);
      const requirement = job.requirementId ? this.store.work.requirement(job.requirementId) : undefined;
      if (requirement?.publication && job.kind !== 'requirement_publish') {
        const baseCommit = await prepareRequirementBranch(repo, requirement.publication, this.options.github ?? githubHost(repo, requirement.publication, run.evidencePath, this.options.signal));
        this.store.work.updatePublication(requirement.id, { baseCommit });
      }
      const targetBranch = requirement?.publication?.branch ?? repo.targetBranch;
      if (job.kind === 'issue') {
        const issue = JSON.parse(job.payload) as Issue;
        const issueHistory = this.store.work.runs().filter(item => item.id !== run.id && item.repoId === repo.id && item.issueId === issue.id);
        for (const prior of issueHistory) assertRunQuiescent(prior.evidencePath);
        const previous = this.store.work.runs().filter(item => item.id !== run.id && item.repoId === repo.id && item.issueId === issue.id && item.status === 'blocked').sort((a, b) => b.jobId - a.jobId)[0];
        const feedback = previous ? `\nPrevious blocked attempt, diagnostic context only: ${JSON.stringify({ runId: previous.id, reason: previous.reason?.slice(0, 12000) ?? null })}. Address the recorded failure without changing the original goal, criteria, or review gates.` : '';
        const task = parseTask({ schemaVersion: 1, id: `issue-${issue.id}`, title: issue.title, goal: issue.description || issue.title, acceptance: issue.work!.acceptance.map((description, index) => ({ id: `criterion-${index + 1}`, description })), scope: ['src/', 'tests/', 'acceptance/', 'docs/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 600000, totalTimeoutMs: 3600000 }, notes: `Repository ${repo.name}; target ${targetBranch}. Complete only after independent review and automatic integration.${feedback}` });
        const state = await runController({ repository: repo.path, task, agent: this.options.agent ?? codexAgent(process.env.FACTORY_CODEX_BIN ?? 'codex'), baseRef: targetBranch, mergeTarget: targetBranch, evidenceRoot: this.evidenceRoot, runId: run.id, signal: this.options.signal, resumeFrom: previous?.evidencePath, budgetKey: `repo-${repo.id}:issue-${issue.id}` });
        this.store.work.finish(run.id, state.status === 'merged' ? 'merged' : 'blocked', state.reason ?? null);
      } else if (job.kind === 'requirement_publish') await this.publicationJob(job, run);
      else await this.requirementJob(job, run);
      return true;
    } catch (error) {
      if (!claimed) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      const { run, job } = claimed;
      if (recoverMerge(this.store.work.repo(job.repoId)!.path, run.evidencePath)) { this.store.work.finish(run.id, 'merged'); return true; }
      this.blockedDelivery(job, run, reason);
      this.store.work.finish(run.id, 'blocked', reason);
      return true;
    } finally {
      if (claimed) {
        for (const name of ['workspace', 'integration-workspace']) {
          const path = join(claimed.run.evidencePath, name);
          if (existsSync(join(path, '.git'))) {
            let safe = true;
            try { assertRunQuiescent(claimed.run.evidencePath); }
            catch (error) { safe = false; writeJson(join(claimed.run.evidencePath, 'cleanup-error.json'), { reason: String(error), workspace: path }); }
            try { if (safe) git(this.store.work.repo(claimed.job.repoId)!.path, ['worktree', 'remove', '--force', path]); }
            catch (error) { writeJson(join(claimed.run.evidencePath, 'cleanup-error.json'), { reason: error instanceof Error ? error.message : String(error), workspace: path }); }
          }
        }
      }
      this.busy = false;
    }
  }

  private blockedDelivery(job: Job, run: WorkRun, reason: string): void {
    if (existsSync(join(run.evidencePath, 'delivery.json'))) {
      const delivery = readJson(join(run.evidencePath, 'delivery.json')) as Delivery;
      if (delivery.status !== 'blocked') {
        writeJson(join(run.evidencePath, 'admission-error.json'), { reason });
        saveDelivery(run.evidencePath, { ...delivery, summary: `Controller blocked delivery: ${reason}`, status: 'blocked', completedAt: new Date().toISOString(), limitations: [...delivery.limitations, reason] });
      }
      return;
    }
    mkdirSync(run.evidencePath, { recursive: true });
    writeJson(join(run.evidencePath, 'failure.json'), { reason });
    if (existsSync(join(run.evidencePath, 'state.json')) && existsSync(join(run.evidencePath, 'task.json'))) {
      const state = readJson(join(run.evidencePath, 'state.json')) as ControllerState;
      state.status = 'blocked'; state.failedPhase ??= state.phase; state.reason = reason; state.completedAt = new Date().toISOString();
      writeJson(join(run.evidencePath, 'state.json'), state);
      controllerDelivery(state, parseTask(readJson(join(run.evidencePath, 'task.json'))));
    } else {
      const payload = JSON.parse(job.payload) as { title: string; goal?: string; description?: string };
      const review = existsSync(join(run.evidencePath, 'review.json')) ? readJson(join(run.evidencePath, 'review.json')) as { approved: boolean; summary: string } : null;
      const defaults = existsSync(join(run.evidencePath, 'decomposition.json')) ? parseDecomposition(readJson(join(run.evidencePath, 'decomposition.json')), 2).assumptions : [];
      saveDelivery(run.evidencePath, { schemaVersion: 1, runId: run.id, taskId: job.issueId ? `issue-${job.issueId}` : `requirement-${job.requirementId}`, title: payload.title, goal: payload.goal ?? payload.description ?? payload.title, status: 'blocked', startedAt: run.startedAt, completedAt: new Date().toISOString(), baseline: null, sourceHash: null, defaults, changes: [], checks: [], nodePassed: 0, browserPassed: 0, attempts: 0, review, integration: null, limitations: [reason] });
    }
  }

  recover(): void {
    for (const run of this.store.work.runs().filter(run => run.status === 'running')) {
      assertRunQuiescent(run.evidencePath);
      const job = this.store.work.jobs().find(job => job.id === run.jobId)!;
      if (job.kind === 'requirement_publish') {
        mkdirSync(run.evidencePath, { recursive: true });
        this.publicationDelivery(job, run, 'Publication interrupted; reconciliation queued. No remote completion inferred.');
        this.store.work.deferPublication(run.id, Date.now());
        continue;
      }
      const merged = recoverMerge(this.store.work.repo(run.repoId)!.path, run.evidencePath);
      const reason = 'Queue worker was interrupted. Inspect retained evidence before retrying.';
      if (!merged) {
        try { captureInterruptedDraft(run.evidencePath); } catch (error) { writeJson(join(run.evidencePath, 'draft-recovery-error.json'), { reason: String(error) }); }
      }
      if (!merged) this.blockedDelivery(this.store.work.jobs().find(job => job.id === run.jobId)!, run, reason);
      this.store.work.finish(run.id, merged ? 'merged' : 'blocked', merged ? null : reason);
    }
  }

  private publicationDelivery(job: Job, run: WorkRun, summary: string): void {
    const requirement = this.store.work.requirement(job.requirementId!)!;
    const accepted = requirement.publication?.verifiedRunId ? this.store.work.run(requirement.publication.verifiedRunId) : undefined;
    const report = accepted ? readJson(join(accepted.evidencePath, 'delivery.json')) as Delivery : undefined;
    saveDelivery(run.evidencePath, { schemaVersion: 1, runId: run.id, taskId: `requirement-${requirement.id}`, title: requirement.title, goal: requirement.goal, summary, status: 'passed', startedAt: run.startedAt, completedAt: new Date().toISOString(), baseline: requirement.publication?.headCommit ?? null, sourceHash: report?.sourceHash ?? null, defaults: [], changes: report?.changes ?? [], checks: report?.checks ?? [], nodePassed: report?.nodePassed ?? 0, browserPassed: report?.browserPassed ?? 0, attempts: 1, review: report?.review ?? null, integration: null, publication: requirement.publication, limitations: [] });
  }
  private async publicationJob(job: Job, run: WorkRun): Promise<void> {
    const requirement = this.store.work.requirement(job.requirementId!)!;
    const repo = this.store.work.repo(job.repoId)!;
    if (!requirement.publication) throw new Error('Publication job has no enrolled requirement.');
    const publication = await publishRequirement(this.store, requirement, run.evidencePath, this.options.github ?? githubHost(repo, requirement.publication, run.evidencePath, this.options.signal));
    this.publicationDelivery(job, run, publication.state === 'merged' ? 'GitHub confirmed the exact verified requirement PR merge.' : 'Whole goal accepted locally; awaiting exact-head GitHub CI.');
    if (publication.state === 'merged') this.store.work.finish(run.id, 'passed');
    else this.store.work.deferPublication(run.id, Date.now() + (this.options.publicationPollMs ?? 30000));
  }

  private async requirementJob(job: Job, run: WorkRun): Promise<void> {
    const repo = this.store.work.repo(job.repoId)!;
    if (git(repo.path, ['status', '--porcelain']).trim()) throw new Error('Requirement execution requires a clean repository.');
    const requirement = this.store.work.requirement(job.requirementId!) ?? JSON.parse(job.payload) as Requirement;
    const targetBranch = requirement.publication?.branch ?? repo.targetBranch;
    const planner = this.options.planner ?? codexPlanner(process.env.FACTORY_CODEX_BIN ?? 'codex');
    const workspace = prepareWorkspace(repo.path, run.evidencePath, targetBranch, false);
    const before = snapshot(workspace.path).hash;
    const [apiPort, uiPort] = await allocatePorts();
    const env = processEnvironment({ API_PORT: apiPort, UI_PORT: uiPort, TEST_API_PORT: apiPort, TEST_UI_PORT: uiPort, DB_PATH: join(run.evidencePath, 'worker.sqlite'), INSTANCE_ID: run.id });
    const phase = (name: string) => { const directory = join(run.evidencePath, name); mkdirSync(directory); return directory; };
    let verification: Verification | undefined;
    let evidence: string;
    let assumptions: { decision: string; reason: string }[] = [];
    if (job.kind === 'decompose' || job.kind === 'plan_review') {
      const submitted = job.kind === 'plan_review' ? this.store.work.submission(requirement.submission!.id) : undefined;
      if (job.kind === 'plan_review' && (!submitted || submitted.planHash !== requirement.submission?.planHash || submitted.requirementId !== requirement.id)) throw new Error('Submitted plan identity mismatch.');
      if (submitted) writeJson(join(run.evidencePath, 'submission.json'), submitted);
      const decomposition = submitted ? parseDecomposition({ assumptions: submitted.plan.assumptions, issues: submitted.plan.issues }, submitted.plan.schemaVersion) : parseDecomposition(await planner.decompose({ cwd: workspace.path, directory: phase('decompose'), requirement, evidence: '', env, signal: this.options.signal }));
      if (snapshot(workspace.path).hash !== before) throw new Error('Decomposition changed source files.');
      writeJson(join(run.evidencePath, 'decomposition.json'), decomposition);
      evidence = JSON.stringify(decomposition); assumptions = decomposition.assumptions;
    } else {
      const children = this.store.list().filter(issue => issue.work?.requirementId === requirement.id);
      const deliveries = this.store.work.runs().filter(item => item.requirementId === requirement.id && item.status === 'merged').map(item => ({ issueId: item.issueId, report: readJson(join(item.evidencePath, 'delivery.json')) }));
      evidence = JSON.stringify({ children, deliveries });
      const directory = join(run.evidencePath, 'verification');
      const verifier = trustedVerifier(join(run.evidencePath, 'trusted'), parseVerificationContract(readJson(join(workspace.path, 'factory/verification-contract.json'))));
      const result = await runProcess({ command: process.execPath, args: [verifier.command], cwd: workspace.path, env: { ...env, VERIFY_RUN_DIR: directory, VERIFY_CONTRACT_PATH: verifier.contractPath }, logPath: join(run.evidencePath, 'verification.log'), timeoutMs: 610000, signal: this.options.signal });
      verification = readJson(join(directory, 'summary.json')) as Verification;
      if (result.status !== 'passed' || verification.status !== 'passed' || verification.snapshot.hash !== before) throw new Error('Whole-requirement verification failed.');
      evidence += `\nVerification:\n${JSON.stringify(verification)}`;
    }
    const review = await planner.review({ cwd: workspace.path, directory: phase('independent-review'), requirement, evidence, env, signal: this.options.signal });
    writeJson(join(run.evidencePath, 'review.json'), review);
    if (!review.approved || review.findings.length || snapshot(workspace.path).hash !== before) throw new Error(`Requirement review failed: ${review.findings.join('; ')}`);
    if (git(repo.path, ['rev-parse', `refs/heads/${targetBranch}`]).trim() !== workspace.baseCommit) throw new Error('Target branch changed during requirement verification. Retry against the latest target.');
    if (job.kind === 'decompose') this.store.work.applyDecomposition(requirement.id, parseDecomposition(readJson(join(run.evidencePath, 'decomposition.json'))).issues);
    saveDelivery(run.evidencePath, { schemaVersion: 1, runId: run.id, taskId: `requirement-${requirement.id}`, title: requirement.title, goal: requirement.goal, status: 'passed', startedAt: run.startedAt, completedAt: new Date().toISOString(), baseline: workspace.baseCommit, sourceHash: before, defaults: assumptions, changes: [], checks: verification?.checks ?? [{ name: job.kind === 'plan_review' ? 'submitted plan and dependency coverage' : 'decomposition and dependency coverage', status: 'passed' }], nodePassed: verification?.node?.passed ?? 0, browserPassed: verification?.browser?.passed ?? 0, attempts: 1, review, integration: null, limitations: [] });
    if (job.kind === 'requirement_verify' && requirement.publication) this.store.work.finishRequirementVerification(run.id, workspace.baseCommit);
    else this.store.work.finish(run.id, 'passed');
  }
}
