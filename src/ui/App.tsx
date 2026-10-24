import { useState } from 'react';
import { RepositoryHarness } from './features/harness/RepositoryHarness.tsx';
import { Requirements } from './features/requirements/Requirements.tsx';
import { Issues } from './features/issues/Issues.tsx';
import { IssueDetails } from './features/issues/IssueDetails.tsx';
import { Modal } from './components/Modal.tsx';
import { WorkspaceLayout } from './layout/WorkspaceLayout.tsx';
import type { Subview } from './layout/WorkspaceLayout.tsx';
import { useFocusIntent } from './shared/useFocusIntent.ts';
import { useWorkbenchData } from './shared/useWorkbenchData.ts';
import { useIssueCollection } from './shared/useIssueCollection.ts';

export function App() {
  useFocusIntent();
  const data = useWorkbenchData();
  const { workbench, workbenchError, registryLoading, issues, loading, loadError, retryIssues, refreshRepositories } = data;
  const [detailId, setDetailId] = useState<number | null>(null);
  const [repoFilter, setRepoFilter] = useState('');
  const [subview, setSubview] = useState<Subview>('issues');
  const collection = useIssueCollection(issues, repoFilter);
  const selectedRepo = workbench.repos.find(repo => String(repo.id) === repoFilter);
  function chooseRepository(id: string) {
    if (!id) setSubview('issues');
    if (id === repoFilter) return;
    setRepoFilter(id); collection.resetFilters(); setDetailId(null);
  }
  function resetFilters() { chooseRepository(''); collection.resetFilters(); }
  return <WorkspaceLayout repos={workbench.repos} repoFilter={repoFilter} selectedRepo={selectedRepo} subview={subview} registryLoading={registryLoading} workbenchError={workbenchError} chooseRepository={chooseRepository} setSubview={setSubview} refreshRepositories={refreshRepositories} overlay={detailId !== null && <Modal wide title={`Issue #${detailId}`} onDismiss={() => setDetailId(null)}><IssueDetails key={detailId} id={detailId} issues={issues} metadataError={workbenchError} workbench={workbench} /></Modal>}>
    {subview === 'requirements' && selectedRepo ? <Requirements key={selectedRepo.id} repo={selectedRepo} data={workbench} issues={issues} loading={loading} error={loadError} onIssue={setDetailId} /> : subview === 'harness' && selectedRepo ? <><section className="page-header"><div><h1>Repo harness</h1><p>{selectedRepo.name}</p></div></section><RepositoryHarness key={selectedRepo.id} repoId={selectedRepo.id} /></> : <Issues collection={collection} issues={issues} loading={loading} loadError={loadError} retryIssues={retryIssues} resetFilters={resetFilters} onIssue={setDetailId} />}
  </WorkspaceLayout>;
}
