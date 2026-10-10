import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Issue, IssuePriority, IssueStatus, NewIssue } from '../domain.ts';
import { statusLabels } from './IssueRow.tsx';

export function IssueForm({ issue, pending, serverError, onSave, onCancel }: { issue?: Issue; pending: boolean; serverError: string | null; onSave: (values: NewIssue) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [values, setValues] = useState<NewIssue>({ title: issue?.title ?? '', description: issue?.description ?? '', status: issue?.status ?? 'open', priority: issue?.priority ?? 'medium' });
  const [fieldError, setFieldError] = useState<{ field: 'title' | 'description'; text: string } | null>(null);
  const submitLabel = issue ? 'Save changes' : 'Create issue';
  function change<K extends keyof NewIssue>(field: K, value: NewIssue[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const title = values.title.trim();
    if (!title || title.length > 120) {
      setFieldError({ field: 'title', text: !title ? 'Enter a title.' : 'Keep the title to 120 characters or fewer.' });
      titleRef.current?.focus();
      return;
    }
    if (values.description.length > 2000) {
      setFieldError({ field: 'description', text: 'Keep the description to 2,000 characters or fewer.' });
      descriptionRef.current?.focus();
      return;
    }
    setFieldError(null);
    await onSave({ ...values, title });
  }
  return <form className="issue-form" noValidate aria-busy={pending} onSubmit={(event) => { void submit(event); }}>
    <div className="form-label-row"><label htmlFor={`${id}-title`}>Title</label><span className="required-note">Required</span></div>
    <input ref={titleRef} id={`${id}-title`} name="title" required maxLength={120} data-autofocus placeholder="What needs to be done?" value={values.title} disabled={pending} aria-invalid={fieldError?.field === 'title'} aria-describedby={fieldError?.field === 'title' ? `${id}-field-error` : undefined} onChange={(event) => change('title', event.target.value)} />
    <div className="form-label-row"><label htmlFor={`${id}-description`}>Description</label><span className="optional-note">Optional</span></div>
    <textarea ref={descriptionRef} id={`${id}-description`} name="description" rows={5} maxLength={2000} placeholder="Add context, details, or a few next steps…" value={values.description} disabled={pending} aria-invalid={fieldError?.field === 'description'} aria-describedby={fieldError?.field === 'description' ? `${id}-field-error` : undefined} onChange={(event) => change('description', event.target.value)} />
    <div className="form-grid"><div><label htmlFor={`${id}-status`}>Status</label><select id={`${id}-status`} name="status" value={values.status} disabled={pending} onChange={(event) => change('status', event.target.value as IssueStatus)}>{(['open', 'in_progress', 'done'] as const).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div><div><label htmlFor={`${id}-priority`}>Priority</label><select id={`${id}-priority`} name="priority" value={values.priority} disabled={pending} onChange={(event) => change('priority', event.target.value as IssuePriority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div></div>
    {fieldError && <p id={`${id}-field-error`} className="form-error" role="alert">{fieldError.text}</p>}
    {serverError && <p className="form-error" role="alert">{serverError}</p>}
    <div className="form-footer"><button className="button" type="button" disabled={pending} onClick={onCancel}>Cancel</button><button className="button primary" type="submit" disabled={pending} aria-label={submitLabel}>{pending ? (issue ? 'Saving…' : 'Creating…') : submitLabel}</button></div>
  </form>;
}
