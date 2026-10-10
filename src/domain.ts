export const ISSUE_STATUSES = ['open', 'in_progress', 'done'] as const;
export const ISSUE_PRIORITIES = ['low', 'medium', 'high'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export interface Issue {
  id: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  createdAt: string;
  updatedAt: string;
}
export type NewIssue = Omit<Issue, 'id' | 'createdAt' | 'updatedAt'>;
export type IssuePatch = Partial<NewIssue>;

export class ValidationError extends Error {}

function body(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Request body must be an object.');
  }
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!['title', 'description', 'status', 'priority'].includes(key)) {
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
  if (!ISSUE_STATUSES.includes(input as IssueStatus)) {
    throw new ValidationError('Status must be open, in_progress, or done.');
  }
  return input as IssueStatus;
}

function priority(input: unknown): IssuePriority {
  if (!ISSUE_PRIORITIES.includes(input as IssuePriority)) {
    throw new ValidationError('Priority must be low, medium, or high.');
  }
  return input as IssuePriority;
}

export function parseCreateIssue(input: unknown): NewIssue {
  const value = body(input);
  return {
    title: title(value.title),
    description: 'description' in value ? description(value.description) : '',
    status: 'status' in value ? status(value.status) : 'open',
    priority: 'priority' in value ? priority(value.priority) : 'medium',
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
  return patch;
}
