import { useEffect, useState } from 'react';
import { RepositoryHarness } from './features/harness/RepositoryHarness.tsx';
import { Requirements } from './features/requirements/Requirements.tsx';
import { Issues } from './features/issues/Issues.tsx';
import { IssueDetails } from './features/issues/IssueDetails.tsx';
import { Modal } from './components/Modal.tsx';
import { WorkspaceLayout } from './layout/WorkspaceLayout.tsx';
import type { Subview } from './layout/WorkspaceLayout.tsx';
import type { Issue } from '../domain.ts';
import { useFocusIntent } from './shared/useFocusIntent.ts';
import { useWorkbenchData } from './shared/useWorkbenchData.ts';
import { useIssueCollection } from './shared/useIssueCollection.ts';

function Unassigned({ issues, loading, loadError, retryIssues, onIssue }: { issues: Issue[]; loading: boolean; loadError: string | null; retryIssues: () => void; onIssue: (id: number) => void }) {
  const collection = useIssueCollection(issues, '');
  return <Issues title="Unassigned" collection={collection} issues={issues} loading={loading} loadError={loadError} retryIssues={retryIssues} resetFilters={collection.resetFilters} onIssue={onIssue} />;
}

export function App() {
  useFocusIntent();
  const { workbench, workbenchError, registryLoading, issues, loading, loadError, retryIssues, refreshRepositories } = useWorkbenchData();
  const [detail, setDetail] = useState<Issue | null>(null);
  const [repoFilter, setRepoFilter] = useState('');
  const [subview, setSubview] = useState<Subview>('requirements');
  const selectedRepo = workbench.repos.find(repo => String(repo.id) === repoFilter);
  useEffect(() => {
    if (repoFilter && !selectedRepo) { setRepoFilter(''); setSubview('requirements'); setDetail(null); }
  }, [repoFilter, selectedRepo]);
  const selectedIssue = detail && issues.find(issue => issue.id === detail.id && issue.work?.repoId === selectedRepo?.id && issue.work?.repoId === detail.work?.repoId && issue.work?.requirementId === detail.work?.requirementId && (issue.work?.requirementId === null ? subview === 'unassigned' : subview === 'requirements' && workbench.requirements.some(requirement => requirement.id === issue.work?.requirementId && requirement.repoId === issue.work?.repoId)));
  useEffect(() => { if (detail && !selectedIssue) setDetail(null); }, [detail, selectedIssue]);
  function inspectIssue(id: number | null) { setDetail(issues.find(issue => issue.id === id) ?? null); }
  function chooseRepository(id: string) {
    if (id === String(selectedRepo?.id)) return;
    setRepoFilter(id); setSubview('requirements'); setDetail(null);
  }
  function chooseSubview(view: Subview) { setSubview(view); setDetail(null); }
  return <WorkspaceLayout repos={workbench.repos} repoFilter={repoFilter} selectedRepo={selectedRepo} subview={subview} registryLoading={registryLoading} workbenchError={workbenchError} chooseRepository={chooseRepository} setSubview={chooseSubview} refreshRepositories={refreshRepositories} overlay={selectedIssue && <Modal wide title={`Issue #${selectedIssue.id}`} onDismiss={() => setDetail(null)}><IssueDetails key={selectedIssue.id} id={selectedIssue.id} issues={issues} metadataError={workbenchError} workbench={workbench} /></Modal>}>
    {selectedRepo && (subview === 'requirements' ? <Requirements key={selectedRepo.id} repo={selectedRepo} data={workbench} issues={issues} loading={loading} error={loadError} retryIssues={retryIssues} onIssue={inspectIssue} /> : subview === 'harness' ? <><section className="page-header"><div><h1>Repo harness</h1><p>{selectedRepo.name}</p></div></section><RepositoryHarness key={selectedRepo.id} repoId={selectedRepo.id} /></> : <Unassigned key={selectedRepo.id} issues={issues.filter(issue => issue.work?.repoId === selectedRepo.id && issue.work.requirementId === null)} loading={loading} loadError={loadError} retryIssues={retryIssues} onIssue={inspectIssue} />)}
  </WorkspaceLayout>;
}
