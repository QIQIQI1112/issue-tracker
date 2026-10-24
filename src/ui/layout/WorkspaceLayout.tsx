import { Button } from '../components/Button.tsx';
import type { ReactNode } from 'react';
import type { Repo } from '../../workflow.ts';
import { Icon } from '../components/Icon.tsx';

export type Subview = 'issues' | 'requirements' | 'harness';
export function WorkspaceLayout({ repos, repoFilter, selectedRepo, subview, registryLoading, workbenchError, chooseRepository, setSubview, refreshRepositories, children, overlay }: { repos: Repo[]; repoFilter: string; selectedRepo: Repo | undefined; subview: Subview; registryLoading: boolean; workbenchError: string; chooseRepository: (id: string) => void; setSubview: (view: Subview) => void; refreshRepositories: () => void; children: ReactNode; overlay?: ReactNode }) {
  return <div className="workspace">
    <a className="skip-link" href="#main-content">Skip to issues</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">l</span><div><strong>Loop</strong><span>Local issue tracker</span></div></div>
      <div className="workspace-label"><span className="workspace-dot" />Local workspace</div>
      <nav aria-label="Workspace views"><div role="group" aria-label="Repositories" aria-busy={registryLoading}>
        <span className="nav-label">REPOSITORIES</span>
        <Button type="button" className={`nav-button ${!repoFilter ? 'active' : ''}`} aria-pressed={!repoFilter} onClick={() => chooseRepository('')}><Icon name="issues" /><span>All repositories</span></Button>
        {registryLoading && <p className="registry-message" role="status">Loading repositories…</p>}
        <div className="registry-message">{workbenchError && <p role="alert">Repository metadata unavailable: {workbenchError}</p>}<Button className="button" type="button" onClick={refreshRepositories}>{workbenchError ? 'Retry repositories' : 'Refresh repositories'}</Button></div>
        {!registryLoading && !workbenchError && repos.length === 0 && <p className="registry-message">No enrolled repositories.</p>}
        {repos.map(repo => <div key={repo.id} className="repository-entry"><Button type="button" className={`nav-button ${repoFilter === String(repo.id) ? 'active' : ''}`} aria-pressed={repoFilter === String(repo.id)} onClick={() => chooseRepository(String(repo.id))}><Icon name="database" /><span>{repo.name}</span></Button>{repoFilter === String(repo.id) && <div className="repository-subviews">{(['issues', 'requirements', 'harness'] as const).map(view => <Button key={view} type="button" className={`nav-button ${subview === view ? 'active' : ''}`} aria-current={subview === view ? 'page' : undefined} onClick={() => setSubview(view)}>{view === 'issues' ? 'Issues' : view === 'requirements' ? 'Requirements' : 'Repo harness'}</Button>)}</div>}</div>)}
      </div></nav>
      <div className="persistence"><Icon name="database" /><div><strong>SQLite persistence</strong><span>Stored on this machine</span></div></div>
    </aside>
    <main id="main-content" className="main" tabIndex={-1}>
      <div className="breadcrumb"><span className="breadcrumb-workspace">Local workspace</span><Icon name="chevron" /><span className="breadcrumb-repository">{selectedRepo?.name ?? (repoFilter ? `Repository #${repoFilter} unavailable` : 'All repositories')}</span><Icon name="chevron" /><span>{subview === 'issues' ? 'Issues' : subview === 'requirements' ? 'Requirements' : 'Repo harness'}</span><span className="local-badge">LOCAL</span></div>
      {children}
    </main>
    {overlay}
  </div>;
}
