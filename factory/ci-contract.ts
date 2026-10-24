import { parseVerificationContract } from './evidence.ts';
import type { VerificationContract } from './evidence.ts';

export type CiContract = Omit<VerificationContract, 'profile'> & { profile: 'ci-critical'; nodeFiles: string[] };

export function parseCiContract(input: unknown): CiContract {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CI contract must be an object.');
  const value = input as Record<string, unknown>;
  const keys = ['schemaVersion', 'profile', 'nodeFiles', 'requiredNodeTests', 'requiredBrowserTests'];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unknown CI contract field.');
  if (value.profile !== 'ci-critical') throw new Error('CI contract requires the ci-critical profile.');
  if (!Array.isArray(value.nodeFiles) || !value.nodeFiles.length) throw new Error('CI contract requires explicit Node files.');
  const nodeFiles = value.nodeFiles.map(file => {
    if (typeof file !== 'string' || !/^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.test\.ts$/.test(file)) throw new Error('Invalid CI Node path.');
    return file;
  });
  if (new Set(nodeFiles).size !== nodeFiles.length) throw new Error('Duplicate CI Node file.');
  const contract = parseVerificationContract({ ...value, profile: 'code-only' });
  if (!contract.requiredNodeTests.length) throw new Error('CI contract requires named Node cases.');
  for (const item of contract.requiredNodeTests) {
    if (!item.title.trim() || item.title !== item.title.trim()) throw new Error('CI case titles must be nonempty and trimmed.');
  }
  for (const item of contract.requiredNodeTests) if (!nodeFiles.includes(item.file)) throw new Error('Required CI Node case has no selected file.');
  for (const file of nodeFiles) if (!contract.requiredNodeTests.some(item => item.file === file)) throw new Error('Selected CI Node file has no required cases.');
  return { ...contract, profile: 'ci-critical', nodeFiles };
}
