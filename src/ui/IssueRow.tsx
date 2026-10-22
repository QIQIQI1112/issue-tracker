import type { Issue } from '../domain.ts';

export const statusLabels = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', closed: 'Closed', done: 'Done' } as const;
const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High' } as const;
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function IssueRow({ issue, onDetails }: { issue: Issue; onDetails: (issue: Issue) => void }) {
  const created = new Date(issue.createdAt);
  return <li className="issue-row" data-testid={`issue-${issue.id}`}>
    <button type="button" className="issue-id text-button" aria-label={`View issue ${issue.title}`} onClick={() => onDetails(issue)}>LOC-{String(issue.id).padStart(3, '0')}</button>
    <div className="issue-summary"><button type="button" className="issue-title" aria-label={`Inspect issue ${issue.title}`} title={issue.title} onClick={() => onDetails(issue)}>{issue.title}</button>{issue.labels.length > 0 && <ul className="issue-labels" aria-label="Issue labels">{issue.labels.slice(0, 2).map(label => <li key={label} title={label}>{label}</li>)}{issue.labels.length > 2 && <li className="label-overflow" aria-label={`${issue.labels.length - 2} more labels`}>+{issue.labels.length - 2}</li>}</ul>}</div>
    <span className={`status-pill ${issue.status}`}><span className={`status-dot ${issue.status}`} aria-hidden="true" />{statusLabels[issue.status]}</span>
    <span className={`priority ${issue.priority}`}><span className="priority-mark" aria-hidden="true"><i /><i /><i /></span>{priorityLabels[issue.priority]}</span>
    <time className="issue-date" dateTime={issue.createdAt} title={`Created ${fullDateFormatter.format(created)}`}>{dateFormatter.format(created)}</time>
  </li>;
}
