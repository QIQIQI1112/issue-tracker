import { copyFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IssueStore } from '../src/storage.ts';
import { digest } from './checkpoint.ts';
import { maintenanceIdentity } from './maintenance.ts';
import { readJson, snapshot, writeJson } from './evidence.ts';
import { git } from './workspace.ts';

export type OwnerAuthorization = { schemaVersion: 1; requestId: string; issueId: number; issueHash: string; profile: 'harness' | 'acceptance_contract'; scope: string[]; authorization: string; engineSourceHash: string; contractHash: string; baseCommit: string };
export const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadedEngineHash = snapshot(engineRoot).hash;

export function safeScope(path: unknown): path is string {
  return typeof path === 'string' && !isAbsolute(path) && !path.includes('\\') && !path.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..' || part === '.git' || part === 'node_modules' || part === '.data' || part === '.runs') && /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\/?$/.test(path);
}

export function ownerAuthorization(store: IssueStore, path: string): OwnerAuthorization {
  if (!isAbsolute(path)) throw new Error('Owner authorization requires an absolute coordinator-owned request path.');
  const request = readJson(path) as OwnerAuthorization;
  if (!request || request.schemaVersion !== 1 || Object.keys(request).some(key => !['schemaVersion', 'requestId', 'issueId', 'issueHash', 'profile', 'scope', 'authorization', 'engineSourceHash', 'contractHash', 'baseCommit'].includes(key)) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(request.requestId) || !Number.isSafeInteger(request.issueId) || request.issueId < 1 || !['harness', 'acceptance_contract'].includes(request.profile) || !Array.isArray(request.scope) || !request.scope.length || request.scope.length > 100 || request.scope.some(path => !safeScope(path)) || new Set(request.scope).size !== request.scope.length || typeof request.authorization !== 'string' || !request.authorization.trim() || request.authorization.length > 10000) throw new Error('Invalid bounded owner authorization.');
  const issue = store.get(request.issueId);
  if (!issue?.work || issue.work.changeKind !== request.profile || maintenanceIdentity(issue) !== request.issueHash) throw new Error('Owner authorization does not match the classified issue and acceptance contract.');
  const repo = store.work.repo(issue.work.repoId)!;
  const branch = issue.work.requirementId ? store.work.requirement(issue.work.requirementId)?.publication?.branch ?? repo.targetBranch : repo.targetBranch;
  if (request.baseCommit !== git(repo.path, ['rev-parse', `refs/heads/${branch}`]).trim()) throw new Error('Owner authorization target base changed.');
  if (request.engineSourceHash !== loadedEngineHash || snapshot(engineRoot).hash !== loadedEngineHash || request.contractHash !== digest(readFileSync(join(engineRoot, 'factory/verification-contract.json')))) throw new Error('Owner authorization supervising engine or contract identity changed.');
  if (request.profile === 'acceptance_contract' && request.scope.some(path => !/^(tests|acceptance|docs)\//.test(path) && !['factory/verification-contract.json', 'factory/ci-verification-contract.json'].includes(path))) throw new Error('Acceptance-contract authority is limited to explicit test, documentation and contract scope.');
  return request;
}

export async function supervisedRunner(directory: string, request: OwnerAuthorization) {
  const source = snapshot(engineRoot);
  if (source.hash !== request.engineSourceHash) throw new Error('Supervising engine changed before pinning.');
  const target = join(directory, 'supervisor');
  for (const file of source.files) {
    const from = join(engineRoot, file.path); const to = join(target, file.path);
    mkdirSync(dirname(to), { recursive: true });
    if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
  }
  symlinkSync(join(engineRoot, 'node_modules'), join(target, 'node_modules'), 'dir');
  if (snapshot(target).hash !== request.engineSourceHash || digest(readFileSync(join(target, 'factory/verification-contract.json'))) !== request.contractHash || snapshot(engineRoot).hash !== request.engineSourceHash) throw new Error('Pinned supervisor does not match the admitted engine and contract.');
  writeJson(join(directory, 'owner-authorization.json'), request);
  writeJson(join(directory, 'supervisor.json'), { schemaVersion: 1, directory: target, sourceHash: request.engineSourceHash, contractHash: request.contractHash, pinnedAt: new Date().toISOString() });
  return (await import(join(target, 'factory/controller.ts')) as typeof import('./controller.ts')).runController;
}
