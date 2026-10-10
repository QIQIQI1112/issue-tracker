import type { Issue } from '../domain.ts';
import { Icon } from './Icon.tsx';

export const statusLabels = { open: 'Open', in_progress: 'In progress', done: 'Done' } as const;
const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High' } as const;
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function IssueRow({ issue, onEdit, onDelete }: { issue: Issue; onEdit: (issue: Issue) => void; onDelete: (issue: Issue) => void }) {
  const created = new Date(issue.createdAt);
  return <li className="issue-row" data-testid={`issue-${issue.id}`}>
    <span className="issue-id">LOC-{String(issue.id).padStart(3, '0')}</span>
    <div className="issue-summary"><button type="button" className="issue-title" aria-label={`Edit ${issue.title}`} onClick={() => onEdit(issue)}>{issue.title}</button>{issue.description && <span className="issue-description">{issue.description}</span>}</div>
    <span className={`status-pill ${issue.status}`}><span className={`status-dot ${issue.status}`} aria-hidden="true" />{statusLabels[issue.status]}</span>
    <span className={`priority ${issue.priority}`}><span className="priority-mark" aria-hidden="true"><i /><i /><i /></span>{priorityLabels[issue.priority]}</span>
    <time className="issue-date" dateTime={issue.createdAt} title={`Created ${fullDateFormatter.format(created)}`}>{dateFormatter.format(created)}</time>
    <button type="button" className="icon-button delete-button" aria-label={`Delete ${issue.title}`} onClick={() => onDelete(issue)}><Icon name="trash" /></button>
  </li>;
}
