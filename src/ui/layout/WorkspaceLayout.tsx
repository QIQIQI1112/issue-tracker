import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/Button.tsx';
import { UserMenu } from '../components/UserMenu.tsx';
import type { ReactNode } from 'react';
import type { Repo } from '../../workflow.ts';
import { ToolbarIcon } from '../components/ToolbarIcon.tsx';

export type Subview = 'unassigned' | 'requirements' | 'harness';
export function WorkspaceLayout({ repos, repoFilter, selectedRepo, subview, registryLoading, workbenchError, chooseRepository, setSubview, refreshRepositories, children, overlay }: { repos: Repo[]; repoFilter: string; selectedRepo: Repo | undefined; subview: Subview; registryLoading: boolean; workbenchError: string; chooseRepository: (id: string) => void; setSubview: (view: Subview) => void; refreshRepositories: () => void; children: ReactNode; overlay?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState<{ text: string; top: number } | null>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  useLayoutEffect(() => {
    if (!expanded) return;
    const navigation = navigationRef.current;
    const revealSelection = () => {
      const selection = navigation?.querySelector('[aria-pressed="true"]')?.closest('.repository-entry');
      if (!navigation || !selection) return;
      const viewport = navigation.getBoundingClientRect();
      const entry = selection.getBoundingClientRect();
      if (entry.top < viewport.top) navigation.scrollTop -= viewport.top - entry.top;
      else if (entry.bottom > viewport.bottom) navigation.scrollTop += Math.min(entry.bottom - viewport.bottom, entry.top - viewport.top);
    };
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    if (navigation) observer.observe(navigation);
    return () => observer.disconnect();
  }, [expanded]);
  function reveal(element: HTMLElement, text: string) {
    if (expanded && window.innerWidth > 860) return;
    const rect = element.getBoundingClientRect();
    setLabel({ text, top: Math.max(8, Math.min(rect.top, window.innerHeight - 160)) });
  }
  function navigationButton(name: string, icon: 'database' | 'arrow', props: { onClick: () => void; active?: boolean }) {
    return <Button type="button" className={`nav-button ${props.active ? 'active' : ''}`} aria-label={name} aria-pressed={props.active} aria-describedby={label?.text === name ? tooltipId : undefined} onClick={props.onClick} onFocus={event => reveal(event.currentTarget, name)} onBlur={() => setLabel(null)} onMouseEnter={event => reveal(event.currentTarget, name)} onMouseLeave={event => { if (event.currentTarget !== document.activeElement) setLabel(current => current?.text === name ? null : current); }} onKeyDown={event => { if (event.key === 'Escape') setLabel(null); }}><ToolbarIcon name={icon} /><span className="nav-text">{name}</span></Button>;
  }
  return <div className="workspace" data-sidebar={expanded ? 'expanded' : 'collapsed'}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="global-topbar"><div className="brand"><span className="brand-mark" aria-hidden="true">l</span><strong>Loop</strong></div><UserMenu /></header>
    <aside className="sidebar">
      <nav aria-label="Workspace views"><div role="group" aria-label="Repositories" aria-busy={registryLoading}>
        <span className="nav-label sr-only">REPOSITORIES</span>
        {registryLoading && <p className="registry-message" role="status"><ToolbarIcon name="database" /><span className="registry-description">Loading repositories…</span></p>}
        {workbenchError && <p className="registry-message" role="alert"><ToolbarIcon name="database" /><span className="registry-description">Repository metadata unavailable: {workbenchError}</span></p>}
        {navigationButton(workbenchError ? 'Retry repositories' : 'Refresh repositories', 'arrow', { onClick: refreshRepositories })}
        {!registryLoading && !workbenchError && repos.length === 0 && <p className="registry-message">No enrolled repositories.</p>}
        <div className="repository-list" ref={navigationRef}>{repos.map(repo => <div key={repo.id} className="repository-entry">{navigationButton(repo.name, 'database', { active: repoFilter === String(repo.id), onClick: () => chooseRepository(String(repo.id)) })}</div>)}</div>
      </div></nav>
      <Button className="rail-toggle" aria-label={expanded ? 'Collapse navigation rail' : 'Expand navigation rail'} aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setLabel(null); }}><ToolbarIcon name="chevrons" /></Button>
    </aside>
    <main id="main-content" className="main" tabIndex={-1}><div className="workspace-content">
      {selectedRepo && <nav className="repository-toolbar" aria-label="Repository views">{(['requirements', 'harness', 'unassigned'] as const).map(view => <Button key={view} type="button" className="button" aria-current={subview === view ? 'page' : undefined} onClick={() => setSubview(view)}>{view === 'requirements' ? 'Requirements' : view === 'harness' ? 'Repo harness' : 'Unassigned'}</Button>)}</nav>}
      {children}
    </div></main>
    {label && createPortal(<div className="rail-tooltip" id={tooltipId} role="tooltip" style={{ top: label.top }}>{label.text}</div>, document.body)}
    {overlay}
  </div>;
}
