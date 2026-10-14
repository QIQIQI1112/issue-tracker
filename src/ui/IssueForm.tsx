import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Issue, IssuePriority, IssueStatus, NewIssue } from '../domain.ts';
import { parseLabels } from '../domain.ts';
import type { Workbench } from '../workflow.ts';
import { assignment } from '../workflow.ts';
import { statusLabels } from './IssueRow.tsx';

export function IssueForm({ issue, pending, serverError, onSave, onCancel, workbench }: { issue?: Issue; workbench: Workbench; pending: boolean; serverError: string | null; onSave: (values: NewIssue) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const labelsRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<NewIssue>({ title: issue?.title ?? '', description: issue?.description ?? '', status: issue?.status ?? 'open', priority: issue?.priority ?? 'medium', labels: issue?.labels ?? [] });
  const [repoId, setRepoId] = useState(String(issue?.work?.repoId ?? workbench.repos[0]?.id ?? ''));
  const [requirementId, setRequirementId] = useState(String(issue?.work?.requirementId ?? ''));
  const [dependencies, setDependencies] = useState(issue?.work?.dependsOn.join(', ') ?? '');
  const [acceptance, setAcceptance] = useState(issue?.work?.acceptance.join('\n') ?? '');
  const [labelsText, setLabelsText] = useState((issue?.labels ?? []).join(', '));
  const [fieldError, setFieldError] = useState<{ field: 'title' | 'description' | 'labels' | 'work'; text: string } | null>(null);
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
    let labels: string[];
    try { labels = parseLabels(labelsText.trim() ? labelsText.split(',') : []); }
    catch (error) {
      setFieldError({ field: 'labels', text: error instanceof Error ? error.message : 'Labels are invalid.' });
      labelsRef.current?.focus();
      return;
    }
    setFieldError(null);
    try {
      const work = repoId ? assignment({ repoId: Number(repoId), requirementId: requirementId ? Number(requirementId) : null, dependsOn: dependencies.trim() ? dependencies.split(',').map(value => Number(value.trim())) : [], acceptance: acceptance.trim() ? acceptance.split('\n').filter(value => value.trim()) : [title] }) : undefined;
      await onSave({ ...values, title, labels, ...(work ? { work } : {}) });
    } catch (error) { setFieldError({ field: 'work', text: error instanceof Error ? error.message : 'Execution settings are invalid.' }); }
  }
  return <form className="issue-form" noValidate aria-busy={pending} onSubmit={(event) => { void submit(event); }}>
    <div className="form-label-row"><label htmlFor={`${id}-title`}>Title</label><span className="required-note">Required</span></div>
    <input ref={titleRef} id={`${id}-title`} name="title" required maxLength={120} data-autofocus placeholder="What needs to be done?" value={values.title} disabled={pending} aria-invalid={fieldError?.field === 'title'} aria-describedby={fieldError?.field === 'title' ? `${id}-field-error` : undefined} onChange={(event) => change('title', event.target.value)} />
    <div className="form-label-row"><label htmlFor={`${id}-description`}>Description</label><span className="optional-note">Optional</span></div>
    <textarea ref={descriptionRef} id={`${id}-description`} name="description" rows={5} maxLength={2000} placeholder="Add context, details, or a few next steps…" value={values.description} disabled={pending} aria-invalid={fieldError?.field === 'description'} aria-describedby={fieldError?.field === 'description' ? `${id}-field-error` : undefined} onChange={(event) => change('description', event.target.value)} />
    <div className="label-field"><div className="form-label-row"><label htmlFor={`${id}-labels`}>Labels</label><span className="optional-note">Optional</span></div><input ref={labelsRef} id={`${id}-labels`} name="labels" placeholder="bug, frontend" value={labelsText} disabled={pending} aria-invalid={fieldError?.field === 'labels'} aria-describedby={`${id}-labels-help${fieldError?.field === 'labels' ? ` ${id}-field-error` : ''}`} onChange={event => { setLabelsText(event.target.value); setFieldError(null); }} /><p id={`${id}-labels-help`} className="form-hint">Separate with commas. Up to 10 labels, 20 characters each.</p></div>
    <div className="form-grid"><div><label htmlFor={`${id}-status`}>Status</label><select id={`${id}-status`} name="status" value={values.status} disabled={pending} onChange={(event) => change('status', event.target.value as IssueStatus)}>{(['open', 'in_progress', 'done'] as const).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div><div><label htmlFor={`${id}-priority`}>Priority</label><select id={`${id}-priority`} name="priority" value={values.priority} disabled={pending} onChange={(event) => change('priority', event.target.value as IssuePriority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div></div>
    <div className="form-grid work-fields"><label>Repository<select aria-label="Issue repository" value={repoId} disabled={pending} onChange={event => { setRepoId(event.target.value); setRequirementId(''); }}>{!workbench.repos.length && <option value="">No repositories registered</option>}{workbench.repos.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><label>Requirement<select aria-label="Issue requirement" value={requirementId} disabled={pending || !repoId} onChange={event => setRequirementId(event.target.value)}><option value="">Standalone issue</option>{workbench.requirements.filter(item => String(item.repoId) === repoId && (item.status === 'draft' || item.id === issue?.work?.requirementId)).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>
    {repoId && <details className="execution-fields"><summary>Execution criteria and dependencies</summary><label>Acceptance conditions<textarea aria-label="Acceptance conditions" rows={3} placeholder="One observable condition per line. Defaults to the issue title." value={acceptance} disabled={pending} onChange={event => setAcceptance(event.target.value)} /></label><label>Dependency issue IDs<input aria-label="Dependency issue IDs" placeholder="1, 2" value={dependencies} disabled={pending} onChange={event => setDependencies(event.target.value)} /></label></details>}
    {fieldError && <p id={`${id}-field-error`} className="form-error" role="alert">{fieldError.text}</p>}
    {serverError && <p className="form-error" role="alert">{serverError}</p>}
    <div className="form-footer"><button className="button" type="button" disabled={pending} onClick={onCancel}>Cancel</button><button className="button primary" type="submit" disabled={pending} aria-label={submitLabel}>{pending ? (issue ? 'Saving…' : 'Creating…') : submitLabel}</button></div>
  </form>;
}
