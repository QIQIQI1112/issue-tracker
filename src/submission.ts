import { ValidationError } from './domain.ts';
import { boundedText, changeKind, criteria, positiveId, record } from './workflow.ts';
import type { Decomposition, SubmissionPlan } from './workflow.ts';

function fields(input: unknown, allowed: string[]): Record<string, unknown> {
  const value = record(input);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new ValidationError(`Unknown plan field: ${key}.`);
  return value;
}

export function parseDecomposition(input: unknown, version = 1): Decomposition {
  const value = fields(input, ['assumptions', 'issues']);
  if (!Array.isArray(value.issues) || !value.issues.length || value.issues.length > 20 || !Array.isArray(value.assumptions) || value.assumptions.length > 30) throw new ValidationError('Decomposition needs 1–20 issues and bounded assumptions.');
  const issues = value.issues.map(input => {
    const item = fields(input, ['key', 'title', 'description', 'acceptance', 'dependsOn', ...(version === 2 ? ['changeKind'] : [])]);
    const key = boundedText(item.key, 'Issue key', 64);
    if (!/^[a-z0-9-]+$/.test(key) || !Array.isArray(item.dependsOn) || item.dependsOn.length > 20) throw new ValidationError('Invalid issue key or dependencies.');
    return { key, title: boundedText(item.title, 'Title', 120), description: boundedText(item.description, 'Description', 2000), acceptance: criteria(item.acceptance), dependsOn: item.dependsOn.map(value => boundedText(value, 'Dependency', 64)), ...(version === 2 ? { changeKind: changeKind(item.changeKind ?? 'feature') } : {}) };
  });
  const indexed = new Map(issues.map(issue => [issue.key, issue]));
  if (indexed.size !== issues.length) throw new ValidationError('Duplicate issue keys.');
  const visited = new Set<string>();
  const visit = (key: string, stack: Set<string>) => {
    if (stack.has(key)) throw new ValidationError('Cyclic issue dependencies.');
    if (visited.has(key)) return;
    const issue = indexed.get(key);
    if (!issue) throw new ValidationError('Unknown dependency key.');
    if (new Set(issue.dependsOn).size !== issue.dependsOn.length) throw new ValidationError('Duplicate dependencies.');
    for (const dependency of issue.dependsOn) visit(dependency, new Set([...stack, key]));
    visited.add(key);
  };
  for (const issue of issues) visit(issue.key, new Set());
  return { assumptions: value.assumptions.map(input => { const item = fields(input, ['decision', 'reason']); return { decision: boundedText(item.decision, 'Decision', 2000), reason: boundedText(item.reason, 'Reason', 2000) }; }), issues };
}

export function parseSubmission(input: unknown): SubmissionPlan {
  const value = fields(input, ['schemaVersion', 'submissionId', 'repoId', 'requirement', 'source', 'assumptions', 'issues']);
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new ValidationError('Unsupported submission schema version.');
  const submissionId = boundedText(value.submissionId, 'Submission ID', 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(submissionId)) throw new ValidationError('Submission ID must contain letters, digits, underscores, or hyphens.');
  const requirement = fields(value.requirement, ['title', 'goal']);
  const source = fields(value.source, ['kind', 'reference', 'summary']);
  if (source.kind !== 'codex') throw new ValidationError('Submission source must be codex.');
  const decomposition = parseDecomposition({ assumptions: value.assumptions, issues: value.issues }, value.schemaVersion);
  return { schemaVersion: value.schemaVersion, submissionId, repoId: positiveId(value.repoId), requirement: { title: boundedText(requirement.title, 'Title', 120), goal: boundedText(requirement.goal, 'Business goal') }, source: { kind: 'codex', reference: boundedText(source.reference, 'Source reference', 1000), summary: boundedText(source.summary, 'Source summary', 2000) }, ...decomposition };
}
