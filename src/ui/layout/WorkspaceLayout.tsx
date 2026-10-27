import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/Button.tsx';
import { UserMenu } from '../components/UserMenu.tsx';
import type { ReactNode } from 'react';
import type { Repo } from '../../workflow.ts';
import { ToolbarIcon } from '../components/ToolbarIcon.tsx';
import { EmptyState } from '../components/EmptyState.tsx';

export type Subview = 'unassigned' | 'requirements' | 'harness';
export function WorkspaceLayout({ repos, repoFilter, selectedRepo, subview, registryLoading, workbenchError, chooseRepository, setSubview, refreshRepositories, children, overlay }: { repos: Repo[]; repoFilter: string; selectedRepo: Repo | undefined; subview: Subview; registryLoading: boolean; workbenchError: string; chooseRepository: (id: string) => void; setSubview: (view: Subview) => void; refreshRepositories: () => void; children: ReactNode; overlay?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState<{ text: string; top: number } | null>(null);
  const tooltipId = useId();
  function reveal(element: HTMLElement, text: string) {
    if (expanded && window.innerWidth > 860) return;
    const rect = element.getBoundingClientRect();
    setLabel({ text, top: Math.max(8, Math.min(rect.top, window.innerHeight - 160)) });
  }
  return <div className="workspace" data-sidebar={expanded ? 'expanded' : 'collapsed'}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="global-topbar"><UserMenu /></header>
    <aside className="sidebar">
      <nav aria-label="Workspace views"><Button className="nav-button active" aria-label="Repositories" aria-pressed={true} aria-describedby={label ? tooltipId : undefined} onClick={() => chooseRepository('')} onFocus={event => reveal(event.currentTarget, 'Repositories')} onBlur={() => setLabel(null)} onMouseEnter={event => reveal(event.currentTarget, 'Repositories')} onMouseLeave={event => { if (event.currentTarget !== document.activeElement) setLabel(null); }} onKeyDown={event => { if (event.key === 'Escape') setLabel(null); }}><ToolbarIcon name="database" /><span className="nav-text">Repositories</span></Button></nav>
      <Button className="rail-toggle" aria-label={expanded ? 'Collapse navigation rail' : 'Expand navigation rail'} aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setLabel(null); }}><ToolbarIcon name="chevrons" /></Button>
    </aside>
    <main id="main-content" className="main" tabIndex={-1}><div className="workspace-content">
      {repoFilter && selectedRepo ? <>
        <nav className="repository-toolbar" aria-label="Repository views"><div className="repository-context"><strong>{selectedRepo.name}</strong><span>Repository #{selectedRepo.id} · {selectedRepo.path}</span></div>{(['requirements', 'harness', 'unassigned'] as const).map(view => <Button key={view} type="button" className="button" aria-current={subview === view ? 'page' : undefined} onClick={() => setSubview(view)}>{view === 'requirements' ? 'Requirements' : view === 'harness' ? 'Repo harness' : 'Unassigned'}</Button>)}</nav>
        {workbenchError && <p className="form-error" role="alert">Repository metadata unavailable: {workbenchError}. Showing previously loaded metadata. Retrying automatically.</p>}
        {children}
      </> : <>
        <header className="page-header"><div><h1>Repositories</h1></div><Button loading={registryLoading} onClick={refreshRepositories}><ToolbarIcon name="arrow" />{workbenchError ? 'Retry repositories' : 'Refresh repositories'}</Button></header>
        <section className="issue-panel" aria-label="Repository directory" aria-busy={registryLoading}>
          {registryLoading ? <EmptyState title="Loading repositories…" loading role="status" /> : workbenchError ? <div role="alert"><EmptyState title="Repository metadata unavailable"><p>{workbenchError}</p></EmptyState></div> : repos.length ? <ul className="repository-directory">{repos.map(repo => <li key={repo.id}><div className="repository-context"><Button className="text-button" onClick={() => chooseRepository(String(repo.id))}>{repo.name}</Button><span>Repository #{repo.id} · {repo.path}</span></div></li>)}</ul> : <EmptyState title="No enrolled repositories" icon="database" />}
        </section>
      </>}
    </div></main>
    {label && createPortal(<div className="rail-tooltip" id={tooltipId} role="tooltip" style={{ top: label.top }}>{label.text}</div>, document.body)}
    {overlay}
  </div>;
}
