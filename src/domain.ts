export const ISSUE_STATUSES = ['open', 'in_progress', 'blocked', 'closed', 'done'] as const;
export const ISSUE_PRIORITIES = ['low', 'medium', 'high'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export type IssueClosure = { reason: string; closedAt: string; supersededBy?: number };
export type CloseIssueInput = Omit<IssueClosure, 'closedAt'>;
export interface Issue {
  id: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  closure?: IssueClosure;
  work?: Assignment;
}
export type NewIssue = Omit<Issue, 'id' | 'createdAt' | 'updatedAt' | 'closure'>;
export type IssuePatch = Partial<NewIssue>;

export class ValidationError extends Error { }

function body(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Request body must be an object.');
  }
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!['title', 'description', 'status', 'priority', 'labels', 'work'].includes(key)) {
      throw new ValidationError(`Unknown field: ${key}.`);
    }
  }
  return value;
}

function title(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 120) {
    throw new ValidationError('Title must contain 1–120 characters.');
  }
  return input.trim();
}

function description(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2000) {
    throw new ValidationError('Description must be a string of at most 2,000 characters.');
  }
  return input.trim();
}

function status(input: unknown): IssueStatus {
  if (input === 'closed') throw new ValidationError('Use the explicit close lifecycle operation to close an issue.');
  if (!ISSUE_STATUSES.includes(input as IssueStatus)) {
    throw new ValidationError('Status must be open, in_progress, blocked, or done.');
  }
  return input as IssueStatus;
}

function priority(input: unknown): IssuePriority {
  if (!ISSUE_PRIORITIES.includes(input as IssuePriority)) {
    throw new ValidationError('Priority must be low, medium, or high.');
  }
  return input as IssuePriority;
}

export function parseLabels(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 10) throw new ValidationError('Labels must be an array of at most 10 strings.');
  const labels = input.map(value => {
    if (typeof value !== 'string') throw new ValidationError('Label must be a string.');
    const label = value.trim().toLowerCase();
    if (!label || Array.from(label).length > 20) throw new ValidationError('Label must contain 1–20 characters.');
    if (/[,\p{Cc}]/u.test(label)) throw new ValidationError('Label cannot contain commas or control characters.');
    return label;
  });
  return [...new Set(labels)];
}

export function parseCreateIssue(input: unknown): NewIssue {
  const value = body(input);
  return {
    title: title(value.title),
    description: 'description' in value ? description(value.description) : '',
    status: 'status' in value ? status(value.status) : 'open',
    priority: 'priority' in value ? priority(value.priority) : 'medium',
    labels: 'labels' in value ? parseLabels(value.labels) : [],
    ...('work' in value ? { work: assignment(value.work) } : {}),
  };
}

export function parsePatchIssue(input: unknown): IssuePatch {
  const value = body(input);
  if (!Object.keys(value).length) throw new ValidationError('Provide at least one field to update.');
  const patch: IssuePatch = {};
  if ('title' in value) patch.title = title(value.title);
  if ('description' in value) patch.description = description(value.description);
  if ('status' in value) patch.status = status(value.status);
  if ('priority' in value) patch.priority = priority(value.priority);
  if ('labels' in value) patch.labels = parseLabels(value.labels);
  if ('work' in value) patch.work = assignment(value.work);
  return patch;
}

export function parseCloseIssue(input: unknown): CloseIssueInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Issue closure must be an object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['reason', 'supersededBy'].includes(key))) throw new ValidationError('Unknown issue closure field.');
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length > 2000) throw new ValidationError('Closure reason must contain 1–2000 characters.');
  if ('supersededBy' in value && (typeof value.supersededBy !== 'number' || !Number.isSafeInteger(value.supersededBy) || value.supersededBy < 1)) throw new ValidationError('Replacement issue ID must be a positive safe integer.');
  return { reason: value.reason.trim(), ...('supersededBy' in value ? { supersededBy: value.supersededBy as number } : {}) };
}
import { assignment } from './workflow.ts';
import type { Assignment } from './workflow.ts';
