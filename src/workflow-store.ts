import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { IssueStore } from './storage.ts';
import type { Assignment, Decomposition, Job, PlanSubmission, Repo, Requirement, SubmissionReceipt, WorkRun } from './workflow.ts';
import { ConflictError } from './workflow.ts';
import { ValidationError } from './domain.ts';
import { parseSubmission } from './submission.ts';

const repoColumns = 'id, name, path, target_branch AS targetBranch, created_at AS createdAt';
const requirementColumns = 'id, repo_id AS repoId, title, goal, status, created_at AS createdAt, updated_at AS updatedAt';
const jobColumns = 'id, repo_id AS repoId, requirement_id AS requirementId, issue_id AS issueId, kind, status, payload, run_id AS runId, reason, created_at AS createdAt, updated_at AS updatedAt';
const runColumns = 'id, job_id AS jobId, repo_id AS repoId, requirement_id AS requirementId, issue_id AS issueId, status, evidence_path AS evidencePath, reason, started_at AS startedAt, completed_at AS completedAt';

export class WorkflowStore {
  private decomposing = false;
  constructor(private database: DatabaseSync, private issues: IssueStore) {}

  private transaction<T>(action: () => T): T {
    if (this.database.isTransaction) return action();
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  repos(): Repo[] { return this.database.prepare(`SELECT ${repoColumns} FROM repos ORDER BY id`).all() as Repo[]; }
  repo(id: number): Repo | undefined { return this.database.prepare(`SELECT ${repoColumns} FROM repos WHERE id = ?`).get(id) as Repo | undefined; }
  addRepo(input: Omit<Repo, 'id' | 'createdAt'>): Repo {
    if (this.repos().some(repo => repo.path === input.path)) throw new ConflictError('Repository is already registered.');
    const result = this.database.prepare('INSERT INTO repos (name, path, target_branch, created_at) VALUES (?, ?, ?, ?)').run(input.name, input.path, input.targetBranch, new Date().toISOString());
    return this.repo(Number(result.lastInsertRowid))!;
  }
  private enrichedRequirement(requirement: Requirement): Requirement {
    const submission = this.submissionForRequirement(requirement.id);
    return submission ? { ...requirement, submission: { id: submission.id, planHash: submission.planHash, source: submission.plan.source } } : requirement;
  }
  requirements(): Requirement[] { return (this.database.prepare(`SELECT ${requirementColumns} FROM requirements ORDER BY id DESC`).all() as Omit<Requirement, 'submission'>[]).map(item => this.enrichedRequirement(item)); }
  requirement(id: number): Requirement | undefined {
    const requirement = this.database.prepare(`SELECT ${requirementColumns} FROM requirements WHERE id = ?`).get(id) as Requirement | undefined;
    return requirement ? this.enrichedRequirement(requirement) : undefined;
  }
  private submissionRow(row: unknown): PlanSubmission | undefined {
    if (!row) return undefined;
    const value = row as Omit<PlanSubmission, 'plan' | 'issueIds'> & { plan: string; issueIds: string };
    return { ...value, plan: JSON.parse(value.plan), issueIds: JSON.parse(value.issueIds) };
  }
  submission(id: string): PlanSubmission | undefined {
    return this.submissionRow(this.database.prepare('SELECT id, requirement_id AS requirementId, plan_hash AS planHash, plan, issue_ids AS issueIds, created_at AS createdAt FROM plan_submissions WHERE id=?').get(id));
  }
  private submissionForRequirement(id: number): PlanSubmission | undefined {
    return this.submissionRow(this.database.prepare('SELECT id, requirement_id AS requirementId, plan_hash AS planHash, plan, issue_ids AS issueIds, created_at AS createdAt FROM plan_submissions WHERE requirement_id=?').get(id));
  }
  submissionReceipt(id: string): SubmissionReceipt | undefined {
    return this.transaction(() => {
      const submission = this.submission(id);
      return submission ? { submission, requirement: this.requirement(submission.requirementId)!, issues: submission.plan.issues.map(item => ({ key: item.key, issue: this.issues.get(submission.issueIds[item.key])! })), jobs: this.jobs().filter(job => job.requirementId === submission.requirementId), runs: this.runs().filter(run => run.requirementId === submission.requirementId) } : undefined;
    });
  }
  submitPlan(input: unknown): SubmissionReceipt & { replayed: boolean } {
    const plan = parseSubmission(input);
    const serialized = JSON.stringify(plan);
    const planHash = createHash('sha256').update(serialized).digest('hex');
    return this.transaction(() => {
      const existing = this.submission(plan.submissionId);
      if (existing) {
        if (existing.planHash !== planHash) throw new ConflictError('Submission ID already belongs to a different immutable plan.');
        return { ...this.submissionReceipt(existing.id)!, replayed: true };
      }
      const requirement = this.addRequirement({ repoId: plan.repoId, ...plan.requirement });
      const created = this.createSlices(requirement, plan.issues);
      const issueIds = Object.fromEntries([...created].map(([key, issue]) => [key, issue.id]));
      this.database.prepare('INSERT INTO plan_submissions (id, requirement_id, plan_hash, plan, issue_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(plan.submissionId, requirement.id, planHash, serialized, JSON.stringify(issueIds), new Date().toISOString());
      this.startRequirement(requirement.id);
      return { ...this.submissionReceipt(plan.submissionId)!, replayed: false };
    });
  }
  private approvedSubmission(id: number): boolean {
    const review = this.jobs().filter(job => job.requirementId === id && job.kind === 'plan_review').at(-1);
    return review?.status === 'completed' && this.runs().some(run => run.jobId === review.id && run.status === 'passed');
  }
  addRequirement(input: Pick<Requirement, 'repoId' | 'title' | 'goal'>): Requirement {
    if (!this.repo(input.repoId)) throw new ValidationError('Repository not found.');
    const now = new Date().toISOString();
    const result = this.database.prepare("INSERT INTO requirements (repo_id, title, goal, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)").run(input.repoId, input.title, input.goal, now, now);
    return this.requirement(Number(result.lastInsertRowid))!;
  }
  context(issueId: number): Assignment | undefined {
    const row = this.database.prepare('SELECT repo_id AS repoId, requirement_id AS requirementId, depends_on AS dependsOn, acceptance FROM issue_context WHERE issue_id = ?').get(issueId) as { repoId: number; requirementId: number | null; dependsOn: string; acceptance: string } | undefined;
    return row ? { ...row, dependsOn: JSON.parse(row.dependsOn), acceptance: JSON.parse(row.acceptance) } : undefined;
  }
  validateContext(issueId: number | null, work: Assignment): void {
    if (!this.repo(work.repoId)) throw new ValidationError('Repository not found.');
    if (work.requirementId !== null && this.requirement(work.requirementId)?.repoId !== work.repoId) throw new ValidationError('Requirement must belong to the same repository.');
    const previous = issueId === null ? undefined : this.context(issueId);
    if (previous?.requirementId !== work.requirementId) {
      if (previous?.requirementId !== null && previous?.requirementId !== undefined && this.requirement(previous.requirementId)?.status !== 'draft') throw new ConflictError('Requirement membership is frozen after execution starts.');
      if (work.requirementId !== null && this.requirement(work.requirementId)?.status !== 'draft' && !this.decomposing) throw new ConflictError('Requirement membership is frozen after execution starts.');
    }
    if (issueId !== null && this.issues.list().some(issue => issue.work?.dependsOn.includes(issueId) && issue.work.repoId !== work.repoId)) throw new ValidationError('Cannot move an issue away from its dependents repository.');
    const visit = (id: number, seen = new Set<number>()) => {
      if (id === issueId) throw new ValidationError('Issue dependencies must not contain a cycle.');
      if (seen.has(id)) return;
      seen.add(id);
      const dependency = this.context(id);
      if (!this.issues.get(id) || dependency?.repoId !== work.repoId) throw new ValidationError('Dependencies must be existing issues in the same repository.');
      for (const nested of dependency.dependsOn) visit(nested, seen);
    };
    for (const id of work.dependsOn) visit(id);
  }
  assign(issueId: number, work: Assignment): void {
    this.transaction(() => {
      this.assertEditable(issueId);
      this.validateContext(issueId, work);
      this.database.prepare('INSERT INTO issue_context (issue_id, repo_id, requirement_id, depends_on, acceptance) VALUES (?, ?, ?, ?, ?) ON CONFLICT(issue_id) DO UPDATE SET repo_id=excluded.repo_id, requirement_id=excluded.requirement_id, depends_on=excluded.depends_on, acceptance=excluded.acceptance').run(issueId, work.repoId, work.requirementId, JSON.stringify(work.dependsOn), JSON.stringify(work.acceptance));
    });
  }
  assertEditable(issueId: number): void {
    const requirementId = this.context(issueId)?.requirementId;
    if (requirementId && this.submissionForRequirement(requirementId)) throw new ConflictError('Submitted plan issues are immutable. Submit a new plan for revised work.');
    if (this.jobs().some(job => job.issueId === issueId && ['queued', 'running'].includes(job.status))) throw new ConflictError('Queued or running issues cannot be edited or deleted.');
    if (this.runs().some(run => run.issueId === issueId && run.status === 'merged')) throw new ConflictError('Merged issues are immutable. Create a follow-up issue.');
  }
  assertDeletable(issueId: number): void {
    this.assertEditable(issueId);
    const requirementId = this.context(issueId)?.requirementId;
    if (requirementId && this.requirement(requirementId)?.status !== 'draft') throw new ConflictError('Requirement membership is frozen after execution starts.');
    if (this.issues.list().some(issue => issue.work?.dependsOn.includes(issueId)) || this.runs().some(run => run.issueId === issueId)) throw new ConflictError('Issues with dependents or execution history must be retained.');
  }
  jobs(): Job[] { return this.database.prepare(`SELECT ${jobColumns} FROM jobs ORDER BY id`).all() as Job[]; }
  runs(): WorkRun[] { return this.database.prepare(`SELECT ${runColumns} FROM work_runs ORDER BY started_at DESC`).all() as WorkRun[]; }
  run(id: string): WorkRun | undefined { return this.database.prepare(`SELECT ${runColumns} FROM work_runs WHERE id = ?`).get(id) as WorkRun | undefined; }
  private enqueue(kind: Job['kind'], repoId: number, requirementId: number | null, issueId: number | null, payload: unknown): Job {
    if (this.jobs().some(job => job.kind === kind && job.issueId === issueId && job.requirementId === requirementId && ['queued', 'running'].includes(job.status))) throw new ConflictError('This task is already queued or running.');
    const now = new Date().toISOString();
    const result = this.database.prepare("INSERT INTO jobs (repo_id, requirement_id, issue_id, kind, status, payload, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)").run(repoId, requirementId, issueId, kind, JSON.stringify(payload), now, now);
    return this.jobs().find(job => job.id === Number(result.lastInsertRowid))!;
  }
  startIssue(id: number): Job {
    return this.transaction(() => {
      const issue = this.issues.get(id);
      if (!issue?.work) throw new ValidationError('Assign a repository and acceptance conditions before starting the issue.');
      if (issue.work.requirementId && this.submissionForRequirement(issue.work.requirementId) && !this.approvedSubmission(issue.work.requirementId)) throw new ConflictError('Submitted issues require independent plan approval before execution.');
      if (this.runs().some(run => run.issueId === id && run.status === 'merged')) throw new ConflictError('This issue has already been merged. Create a follow-up issue.');
      return this.enqueue('issue', issue.work.repoId, issue.work.requirementId, id, issue);
    });
  }
  startRequirement(id: number): Job[] {
    return this.transaction(() => {
      const requirement = this.requirement(id);
      if (!requirement) throw new ValidationError('Requirement not found.');
      if (requirement.status === 'done' || this.jobs().some(job => job.requirementId === id && ['queued', 'running'].includes(job.status))) throw new ConflictError('Requirement is completed or already active.');
      const issues = this.issues.list().filter(issue => issue.work?.requirementId === id);
      const needsReview = this.submissionForRequirement(id) && !this.approvedSubmission(id);
      const jobs = needsReview ? [this.enqueue('plan_review', requirement.repoId, id, null, requirement)] : issues.length ? issues.filter(issue => !this.runs().some(run => run.issueId === issue.id && run.status === 'merged')).map(issue => this.startIssue(issue.id)) : [this.enqueue('decompose', requirement.repoId, id, null, requirement)];
      if (issues.length && !jobs.length) jobs.push(this.enqueue('requirement_verify', requirement.repoId, id, null, requirement));
      this.database.prepare("UPDATE requirements SET status='queued', updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      return jobs;
    });
  }
  private createSlices(requirement: Requirement, slices: Decomposition['issues']) {
    const created = new Map(slices.map(slice => [slice.key, this.issues.create({ title: slice.title, description: slice.description, labels: [], status: 'open', priority: 'medium', work: { repoId: requirement.repoId, requirementId: requirement.id, dependsOn: [], acceptance: slice.acceptance } })]));
    for (const slice of slices) {
      const issue = created.get(slice.key)!;
      const dependsOn = slice.dependsOn.map(key => { const dependency = created.get(key); if (!dependency) throw new ValidationError('Unknown dependency key.'); return dependency.id; });
      this.assign(issue.id, { ...issue.work!, dependsOn });
    }
    return created;
  }
  applyDecomposition(id: number, slices: Decomposition['issues']): void {
    this.transaction(() => {
      this.decomposing = true;
      try {
        const requirement = this.requirement(id)!;
        if (this.issues.list().some(issue => issue.work?.requirementId === id)) throw new ConflictError('Requirement has already been decomposed.');
        const created = this.createSlices(requirement, slices);
        for (const issue of created.values()) this.startIssue(issue.id);
      } finally { this.decomposing = false; }
    });
  }
  claim(evidenceRoot: string): { job: Job; run: WorkRun } | undefined {
    return this.transaction(() => {
      if (this.jobs().some(job => job.status === 'running')) return undefined;
      const job = this.jobs().find(job => job.status === 'queued' && (job.kind !== 'issue' || this.context(job.issueId!)!.dependsOn.every(id => this.runs().some(run => run.issueId === id && run.status === 'merged'))));
      if (!job) return undefined;
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database.prepare("UPDATE jobs SET status='running', run_id=?, updated_at=? WHERE id=?").run(id, now, job.id);
      this.database.prepare("INSERT INTO work_runs (id, job_id, repo_id, requirement_id, issue_id, status, evidence_path, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)").run(id, job.id, job.repoId, job.requirementId, job.issueId, `${evidenceRoot}/${id}`, now);
      if (job.issueId !== null) this.database.prepare("UPDATE issues SET status='in_progress', updated_at=? WHERE id=?").run(now, job.issueId);
      if (job.requirementId !== null) this.database.prepare("UPDATE requirements SET status='running', updated_at=? WHERE id=?").run(now, job.requirementId);
      this.refreshRequirements();
      return { job: { ...job, status: 'running', runId: id }, run: this.run(id)! };
    });
  }
  finish(id: string, status: Exclude<WorkRun['status'], 'running'>, reason: string | null = null): void {
    this.transaction(() => {
      const run = this.run(id)!;
      if (run.status !== 'running') {
        if (run.status === status) return;
        throw new ConflictError('Execution outcome has already been recorded.');
      }
      const job = this.jobs().find(job => job.id === run.jobId)!;
      if (job.kind === 'requirement_verify' && status === 'passed') {
        const children = this.issues.list().filter(issue => issue.work?.requirementId === job.requirementId);
        if (!children.length || !children.every(issue => this.runs().some(item => item.issueId === issue.id && item.status === 'merged'))) throw new ConflictError('Whole-requirement admission requires merge evidence for every current child.');
      }
      const now = new Date().toISOString();
      this.database.prepare('UPDATE work_runs SET status=?, reason=?, completed_at=? WHERE id=?').run(status, reason, now, id);
      this.database.prepare('UPDATE jobs SET status=?, reason=?, updated_at=? WHERE id=?').run(status === 'blocked' ? 'blocked' : 'completed', reason, now, job.id);
      if (job.kind === 'plan_review' && status === 'passed') for (const issue of this.issues.list().filter(issue => issue.work?.requirementId === job.requirementId)) this.startIssue(issue.id);
      if (job.issueId !== null) this.database.prepare('UPDATE issues SET status=?, updated_at=? WHERE id=?').run(status === 'merged' ? 'done' : 'open', now, job.issueId);
      if (status === 'blocked') {
        let changed = true;
        const blocked = new Set(this.jobs().filter(item => item.status === 'blocked' && item.issueId !== null).map(item => item.issueId!));
        while (changed) {
          changed = false;
          for (const waiting of this.jobs().filter(item => item.status === 'queued' && item.issueId !== null)) if (this.context(waiting.issueId!)!.dependsOn.some(dependency => blocked.has(dependency) && !this.runs().some(item => item.issueId === dependency && item.status === 'merged'))) {
            this.database.prepare("UPDATE jobs SET status='blocked', reason='A dependency failed.', updated_at=? WHERE id=?").run(now, waiting.id);
            blocked.add(waiting.issueId!); changed = true;
          }
        }
      }
      if (job.requirementId !== null) {
        if (status === 'blocked' || job.kind === 'requirement_verify') this.database.prepare('UPDATE requirements SET status=?, updated_at=? WHERE id=?').run(status === 'passed' ? 'done' : 'blocked', now, job.requirementId);
        else if (job.kind === 'issue') {
          const children = this.issues.list().filter(issue => issue.work?.requirementId === job.requirementId);
          if (children.every(issue => this.runs().some(item => item.issueId === issue.id && item.status === 'merged'))) this.enqueue('requirement_verify', job.repoId, job.requirementId, null, this.requirement(job.requirementId));
        }
      }
      this.refreshRequirements();
    });
  }
  recoverInterrupted(): void {
    for (const run of this.runs().filter(run => run.status === 'running')) this.finish(run.id, 'blocked', 'Queue worker was interrupted. Inspect retained evidence before retrying.');
  }

  private refreshRequirements(): void {
    const jobs = this.jobs();
    const runs = this.runs();
    const issues = this.issues.list();
    for (const requirement of this.requirements()) {
      const related = jobs.filter(job => job.requirementId === requirement.id);
      if (!related.length && requirement.status === 'draft') continue;
      const children = issues.filter(issue => issue.work?.requirementId === requirement.id);
      const merged = (id: number) => runs.some(run => run.issueId === id && run.status === 'merged');
      const latest = (kind: Job['kind'], issueId: number | null = null) => related.filter(job => job.kind === kind && job.issueId === issueId).at(-1);
      const final = latest('requirement_verify');
      const failed = children.some(issue => !merged(issue.id) && latest('issue', issue.id)?.status === 'blocked') || !children.length && latest('decompose')?.status === 'blocked' || latest('plan_review')?.status === 'blocked' || final?.status === 'blocked';
      const completed = children.length > 0 && children.every(issue => merged(issue.id)) && final?.status === 'completed' && runs.some(run => run.jobId === final.id && run.status === 'passed');
      const active = related.filter(job => ['queued', 'running'].includes(job.status));
      const status: Requirement['status'] = failed ? 'blocked' : completed ? 'done' : active.some(job => job.status === 'running') ? 'running' : active.length ? 'queued' : 'blocked';
      if (status !== requirement.status) this.database.prepare('UPDATE requirements SET status=?, updated_at=? WHERE id=?').run(status, new Date().toISOString(), requirement.id);
    }
  }
}
