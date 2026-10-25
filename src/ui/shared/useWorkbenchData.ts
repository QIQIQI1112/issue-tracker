import { useEffect, useState } from 'react';
import type { Issue } from '../../domain.ts';
import type { Workbench } from '../../workflow.ts';
import { apiRequest, errorMessage } from './client.ts';

export function useWorkbenchData() {
  const [workbench, setWorkbench] = useState<Workbench>({ repos: [], requirements: [], jobs: [], runs: [] });
  const [workbenchError, setWorkbenchError] = useState('');
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryVersion, setRegistryVersion] = useState(0);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void apiRequest<{ issues: Issue[] }>('/api/issues', { signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted) { setIssues(result.issues); setLoadError(null); }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      }).finally(() => {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      });
    };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [reloadVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void apiRequest<Workbench>('/api/workbench', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setWorkbench(result); setWorkbenchError(''); setRegistryLoading(false);
    }).catch(error => { if (!controller.signal.aborted) { setWorkbenchError(errorMessage(error)); setRegistryLoading(false); } }); };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [reloadVersion, registryVersion]);


  const retryIssues = () => setReloadVersion(value => value + 1);
  function refreshRepositories() {
    setRegistryLoading(true);
    setRegistryVersion(value => value + 1);
    setReloadVersion(value => value + 1);
  }
  return { workbench, workbenchError, registryLoading, issues, loading, loadError, retryIssues, refreshRepositories };
}
