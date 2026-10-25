import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Issue } from '../src/domain.ts';
import type { IssueStore } from '../src/storage.ts';
import { acquireDatabaseLock } from '../src/instance.ts';
import { completeVerification, parseVerification, parseVerificationContract, readJson, writeJson } from './evidence.ts';
import { git } from './workspace.ts';
import { saveDelivery } from './delivery.ts';
import { controlPlanePath } from './policy.ts';
import type { Delivery } from '../src/workflow.ts';

export function maintenanceIdentity(issue: Issue): string {
  return createHash('sha256').update(JSON.stringify({ id: issue.id, title: issue.title, description: issue.description, work: issue.work })).digest('hex');
}

export function commitSnapshot(repository: string, commit: string) {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Maintenance requires an exact commit hash.');
  const ignored = new Set(['.git', '.runs', '.data', 'node_modules', 'dist', 'playwright-report', 'test-results', '.env', '.DS_Store']);
  const entries = git(repository, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean);
  const files = entries.map(entry => {
    const [header, path] = entry.split('\t');
    const [mode] = header.split(' ');
    if (path.split('/').some(part => ignored.has(part))) return null;
    if (mode !== '100644' && mode !== '100755' && mode !== '120000') throw new Error('Unsupported maintenance source entry.');
    const content = execFileSync('git', ['show', `${commit}:${path}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
    return { path, hash: createHash('sha256').update(mode === '120000' ? Buffer.concat([Buffer.from('symlink:'), content]) : content).digest('hex') };
  }).filter((file): file is { path: string; hash: string } => file !== null);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { hash: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

export function recordMaintenance(store: IssueStore, input: { issueId: number; commit: string; verificationPath: string; reviewPath: string; evidenceRoot?: string }): Delivery {
  const issue = store.get(input.issueId);
  if (!issue?.work?.changeKind || issue.work.changeKind === 'feature') throw new Error('Only separately classified maintenance issues can use owner attestation.');
  store.work.maintenanceAdmission(input.issueId);
  const repo = store.work.repo(issue.work.repoId)!;
  const targetBranch = issue.work.requirementId ? store.work.requirement(issue.work.requirementId)?.publication?.branch ?? repo.targetBranch : repo.targetBranch;
  const common = resolve(repo.path, git(repo.path, ['rev-parse', '--git-common-dir']).trim());
  const release = acquireDatabaseLock(join(common, 'loop-integration'), `maintenance-${input.issueId}`);
  let claim: ReturnType<IssueStore['work']['claimMaintenance']> | undefined;
  try {
    git(repo.path, ['merge-base', '--is-ancestor', input.commit, `refs/heads/${targetBranch}`]);
    const source = commitSnapshot(repo.path, input.commit);
    const verification = parseVerification(readJson(input.verificationPath));
    const review = readJson(input.reviewPath) as { approved: boolean; sourceHash?: string; reviewedSourceHash?: string; findings: unknown[]; summary: string; coveredIssues?: { issueId: number; contractHash: string }[] };
    if (review.approved !== true || !Array.isArray(review.findings) || review.findings.length || (review.sourceHash ?? review.reviewedSourceHash) !== source.hash) throw new Error('Maintenance requires independent approval of the exact source.');
    if (!review.coveredIssues?.some(item => item.issueId === issue.id && item.contractHash === maintenanceIdentity(issue))) throw new Error('Maintenance approval does not cover the exact issue and acceptance contract.');
    const contract = parseVerificationContract(JSON.parse(git(repo.path, ['show', `${input.commit}:factory/verification-contract.json`])));
    const directory = dirname(input.verificationPath);
    const { node } = completeVerification(verification, { sourceHash: source.hash, contract, nodePath: join(directory, 'node-results.jsonl'), message: 'Maintenance requires complete verification of the exact committed source.' });
    claim = store.work.claimMaintenance(input.issueId, resolve(input.evidenceRoot ?? join(dirname(store.path), 'evidence')));
    mkdirSync(claim.run.evidencePath, { recursive: true });
    for (const [name, path] of [['verification.json', input.verificationPath], ['review.json', input.reviewPath], ['node-results.jsonl', join(directory, 'node-results.jsonl')]]) writeFileSync(join(claim.run.evidencePath, name), readFileSync(path));
    writeJson(join(claim.run.evidencePath, 'maintenance.json'), { schemaVersion: 1, changeKind: issue.work.changeKind, issueId: issue.id, commit: input.commit, sourceHash: source.hash, verificationPath: resolve(input.verificationPath), reviewPath: resolve(input.reviewPath) });
    const baseline = git(repo.path, ['rev-parse', `${input.commit}^`]).trim();
    const paths = git(repo.path, ['diff', '--name-status', baseline, input.commit]).trim().split('\n').filter(Boolean).map(line => {
      const [status, ...names] = line.split('\t'); const path = names.at(-1)!;
      const category = /^(tests|acceptance)\//.test(path) ? 'tests' : /^(factory|scripts|tickets|\.agents)\//.test(path) || controlPlanePath(path) || path === 'AGENTS.md' ? 'harness' : /^docs\//.test(path) ? 'documentation' : 'application';
      return { path, status, category } as Delivery['changes'][number];
    });
    const delivery = saveDelivery(claim.run.evidencePath, { schemaVersion: 1, runId: claim.run.id, taskId: `maintenance-issue-${issue.id}`, title: issue.title, goal: issue.description, summary: review.summary, status: 'merged', startedAt: claim.run.startedAt, completedAt: new Date().toISOString(), baseline, sourceHash: source.hash, defaults: [{ decision: 'Use the separate owner maintenance workflow.', reason: 'Change classification does not grant the feature executor permission to modify its controls.' }], changes: paths, checks: verification.checks, nodePassed: node.passed, browserPassed: 0, attempts: 1, review: { approved: true, summary: review.summary }, integration: { branch: targetBranch, before: baseline, commit: input.commit }, limitations: [] });
    store.work.finish(claim.run.id, 'merged');
    return delivery;
  } catch (error) {
    if (claim) store.work.finish(claim.run.id, 'blocked', error instanceof Error ? error.message : String(error));
    throw error;
  } finally { release(); }
}
