import type { Issue } from '../domain.ts';
import type { Job, Requirement, Workbench } from '../workflow.ts';

export const activeJob = (job: Job) => job.status === 'queued' || job.status === 'running';

export function mergedIssue(data: Workbench, issue: Issue): boolean {
  return data.runs.some(run => run.status === 'merged' && run.issueId === issue.id && run.repoId === issue.work?.repoId && run.requirementId === issue.work?.requirementId);
}

export function requirementProgress(data: Workbench, issues: Issue[], requirement: Requirement) {
  const children = issues.filter(issue => issue.work?.requirementId === requirement.id && issue.work.repoId === requirement.repoId);
  const merged = children.filter(issue => mergedIssue(data, issue)).length;
  const final = data.jobs.filter(job => job.repoId === requirement.repoId && job.requirementId === requirement.id && job.kind === 'requirement_verify' && job.issueId === null).sort((a, b) => b.id - a.id)[0];
  const verified = children.length > 0 && merged === children.length && final?.status === 'completed' && data.runs.some(run => run.jobId === final.id && run.id === final.runId && run.repoId === requirement.repoId && run.requirementId === requirement.id && run.issueId === null && run.status === 'passed' && run.completedAt !== null);
  const outcome = final && final.status !== 'completed'
    ? `Whole-goal verification ${final.status}`
    : verified ? 'Whole goal verified' : 'Whole goal not yet verified';
  return { children, merged, verified, outcome };
}

export function currentBlockers(data: Workbench, issues: Issue[]): Job[] {
  const latest = new Map<string, Job>();
  for (const job of data.jobs) {
    const key = `${job.repoId}:${job.requirementId}:${job.kind}:${job.issueId}`;
    if (!latest.has(key) || latest.get(key)!.id < job.id) latest.set(key, job);
  }
  return [...latest.values()].filter(job => {
    if (job.status !== 'blocked') return false;
    const issue = issues.find(issue => issue.id === job.issueId && issue.work?.repoId === job.repoId && issue.work.requirementId === job.requirementId);
    if ((job.kind === 'issue' || job.kind === 'maintenance') && issue && mergedIssue(data, issue)) return false;
    if (job.kind === 'decompose' && issues.some(issue => issue.work?.requirementId === job.requirementId && issue.work.repoId === job.repoId)) return false;
    return true;
  }).sort((a, b) => b.id - a.id);
}

export function waitingDependencies(data: Workbench, issues: Issue[], job: Job): number[] {
  if (!['issue', 'maintenance'].includes(job.kind) || job.status !== 'queued') return [];
  return (issues.find(issue => issue.id === job.issueId)?.work?.dependsOn ?? []).filter(id => {
    const dependency = issues.find(issue => issue.id === id && issue.work?.repoId === job.repoId);
    return !dependency || !mergedIssue(data, dependency);
  });
}

export function executionContext(data: Workbench, issues: Issue[], item: { repoId: number; requirementId: number | null; issueId: number | null }): string {
  const repo = data.repos.find(repo => repo.id === item.repoId)?.name ?? `Repository #${item.repoId}`;
  const requirement = item.requirementId === null ? 'Standalone issue' : data.requirements.find(requirement => requirement.id === item.requirementId && requirement.repoId === item.repoId)?.title ?? `Requirement #${item.requirementId}`;
  const issue = item.issueId === null ? '' : ` · #${item.issueId} ${issues.find(issue => issue.id === item.issueId)?.title ?? 'Issue'}`;
  return `${repo} · ${requirement}${issue}`;
}
