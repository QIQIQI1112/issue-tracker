import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/Button.tsx';
import { UserMenu } from '../components/UserMenu.tsx';
import type { ReactNode } from 'react';
import type { Repo } from '../../workflow.ts';
import { Icon } from '../components/Icon.tsx';

export type Subview = 'issues' | 'requirements' | 'harness';
export function WorkspaceLayout({ repos, repoFilter, selectedRepo, subview, registryLoading, workbenchError, chooseRepository, setSubview, refreshRepositories, children, overlay }: { repos: Repo[]; repoFilter: string; selectedRepo: Repo | undefined; subview: Subview; registryLoading: boolean; workbenchError: string; chooseRepository: (id: string) => void; setSubview: (view: Subview) => void; refreshRepositories: () => void; children: ReactNode; overlay?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState<{ text: string; top: number } | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const tooltipId = useId();
  useLayoutEffect(() => {
    if (expanded) navigationRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [expanded]);
  function reveal(element: HTMLElement, text: string) {
    if (expanded && window.innerWidth > 860) return;
    const rect = element.getBoundingClientRect();
    setLabel({ text, top: Math.max(8, Math.min(rect.top, window.innerHeight - 160)) });
  }
  function navigationButton(name: string, icon: 'issues' | 'database' | 'check' | 'arrow', props: { onClick: () => void; active?: boolean; current?: boolean }) {
    return <Button type="button" className={`nav-button ${props.active ? 'active' : ''}`} aria-label={name} aria-pressed={props.current === undefined ? props.active : undefined} aria-current={props.current ? 'page' : undefined} aria-describedby={label?.text === name ? tooltipId : undefined} onClick={props.onClick} onFocus={event => reveal(event.currentTarget, name)} onBlur={() => setLabel(null)} onMouseEnter={event => reveal(event.currentTarget, name)} onMouseLeave={event => { if (event.currentTarget !== document.activeElement) setLabel(current => current?.text === name ? null : current); }} onKeyDown={event => { if (event.key === 'Escape') setLabel(null); }}><Icon name={icon} /><span className="nav-text">{name}</span></Button>;
  }
  return <div className="workspace" data-sidebar={expanded ? 'expanded' : 'collapsed'}>
    <a className="skip-link" href="#main-content">Skip to issues</a>
    <header className="global-topbar"><div className="brand"><span className="brand-mark" aria-hidden="true">l</span><strong>Loop</strong><span className="brand-description">Local issue tracker</span></div><UserMenu /></header>
    <aside className="sidebar">
      <nav ref={navigationRef} aria-label="Workspace views"><div role="group" aria-label="Repositories" aria-busy={registryLoading}>
        <span className="nav-label sr-only">REPOSITORIES</span>
        {navigationButton('All repositories', 'issues', { active: !repoFilter, onClick: () => chooseRepository('') })}
        {registryLoading && <p className="registry-message" role="status"><Icon name="database" /><span className="registry-description">Loading repositories…</span></p>}
        {workbenchError && <p className="registry-message" role="alert"><Icon name="database" /><span className="registry-description">Repository metadata unavailable: {workbenchError}</span></p>}
        {navigationButton(workbenchError ? 'Retry repositories' : 'Refresh repositories', 'arrow', { onClick: refreshRepositories })}
        {!registryLoading && !workbenchError && repos.length === 0 && <p className="registry-message">No enrolled repositories.</p>}
        {repos.map(repo => <div key={repo.id} className="repository-entry">{navigationButton(repo.name, 'database', { active: repoFilter === String(repo.id), onClick: () => chooseRepository(String(repo.id)) })}{repoFilter === String(repo.id) && <div className="repository-subviews">{(['issues', 'requirements', 'harness'] as const).map(view => <div key={view}>{navigationButton(view === 'issues' ? 'Issues' : view === 'requirements' ? 'Requirements' : 'Repo harness', view === 'issues' ? 'issues' : view === 'requirements' ? 'check' : 'database', { active: subview === view, current: subview === view, onClick: () => setSubview(view) })}</div>)}</div>}</div>)}
      </div></nav>
      <Button className="rail-toggle" aria-label={expanded ? 'Collapse navigation rail' : 'Expand navigation rail'} aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setLabel(null); }}><Icon name="chevron" /><span className="nav-text">Collapse navigation</span></Button>
    </aside>
    <main id="main-content" className="main" tabIndex={-1}><div className="workspace-content">
      <div className="breadcrumb"><span className="breadcrumb-workspace">Local workspace</span><Icon name="chevron" /><span className="breadcrumb-repository">{selectedRepo?.name ?? (repoFilter ? `Repository #${repoFilter} unavailable` : 'All repositories')}</span><Icon name="chevron" /><span>{subview === 'issues' ? 'Issues' : subview === 'requirements' ? 'Requirements' : 'Repo harness'}</span><span className="local-badge" title="Stored on this machine">SQLite persistence</span></div>
      {children}
    </div></main>
    {label && createPortal(<div className="rail-tooltip" id={tooltipId} role="tooltip" style={{ top: label.top }}>{label.text}</div>, document.body)}
    {overlay}
  </div>;
}
