import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { githubEnrollment } from '../src/workflow.ts';
import { githubHost } from '../factory/github.ts';
import { writeJson } from '../factory/evidence.ts';

const args = process.argv.slice(2);
const argument = (name: string, fallback?: string) => {
  const index = args.indexOf(name);
  const value = index < 0 ? fallback : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Required argument: ${name}`);
  return value;
};
let store: IssueStore | undefined;
try {
  store = new IssueStore(resolve(argument('--database', '.data/issues.sqlite')));
  const id = Number(argument('--repo'));
  const repo = store.work.repo(id);
  if (!repo) throw new Error('Enrolled local repository not found.');
  const enrollment = githubEnrollment({ repository: argument('--github'), remote: argument('--remote', 'origin'), workflow: argument('--workflow', 'verify.yml') });
  const directory = join(resolve('.data/evidence'), `github-enrollment-${Date.now()}`); mkdirSync(directory, { recursive: true });
  const publication = { ...enrollment, branch: 'codex/enrollment', baseBranch: repo.targetBranch, state: 'pending' as const };
  const host = githubHost(repo, publication, directory);
  const remote = await host.request('GET', `/repos/${enrollment.repository}`) as { full_name: string; allow_merge_commit: boolean; permissions: { push: boolean } };
  if (!remote.permissions.push || !remote.allow_merge_commit) throw new Error('GitHub publishing requires push permission and merge commits enabled.');
  enrollment.repository = remote.full_name; publication.repository = remote.full_name;
  await host.fetch(repo, publication);
  await host.request('GET', `/repos/${enrollment.repository}/contents/.github/workflows/${enrollment.workflow}?ref=${encodeURIComponent(repo.targetBranch)}`);
  const endpoint = `/repos/${enrollment.repository}/branches/${encodeURIComponent(repo.targetBranch)}/protection`;
  let protection: { required_status_checks?: { strict: boolean; contexts: string[]; checks: { context: string; app_id: number | null }[] }; enforce_admins?: { enabled: boolean } } | undefined;
  try { protection = await host.request('GET', endpoint) as typeof protection; }
  catch (error) { if (!String(error).includes('HTTP 404')) throw error; }
  if (args.includes('--configure-protection')) {
    if (!protection) await host.request('PUT', endpoint, { required_status_checks: { strict: true, contexts: ['verify'] }, enforce_admins: true, required_pull_request_reviews: null, restrictions: null, allow_force_pushes: false, allow_deletions: false });
    else {
      const checks = protection.required_status_checks?.checks ?? (protection.required_status_checks?.contexts ?? []).map(context => ({ context, app_id: null }));
      if (!checks.some(check => check.context === 'verify')) checks.push({ context: 'verify', app_id: null });
      await host.request('PATCH', endpoint + '/required_status_checks', { strict: true, checks: checks.map(check => check.app_id === null ? { context: check.context } : check) });
      if (!protection.enforce_admins?.enabled) await host.request('POST', endpoint + '/enforce_admins');
    }
    protection = await host.request('GET', endpoint) as typeof protection;
  }
  if (!protection?.required_status_checks?.strict || ![...(protection.required_status_checks.contexts ?? []), ...(protection.required_status_checks.checks ?? []).map(check => check.context)].includes('verify') || !protection.enforce_admins?.enabled) throw new Error('Configure strict required verify CI and enforce_admins, or rerun with --configure-protection. Existing review and other rules remain enforced.');
  const enrolled = store.work.configureGitHub(id, enrollment);
  writeJson(join(directory, 'enrollment.json'), { repoId: id, github: enrollment, targetBranch: repo.targetBranch, configuredAt: new Date().toISOString(), appliesTo: 'New requirements only.' });
  console.log(JSON.stringify({ repo: enrolled, evidence: directory }));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally { store?.close(); }
