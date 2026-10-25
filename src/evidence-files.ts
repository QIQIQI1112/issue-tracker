import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Delivery, RunProgress } from './workflow.ts';
import { ConflictError } from './workflow.ts';
import { ValidationError } from './domain.ts';

export function readDelivery(root: string): Delivery | null {
  try { return JSON.parse(readFileSync(resolve(root, 'delivery.json'), 'utf8')) as Delivery; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export function readProgress(root: string, runId: string): RunProgress | null {
  try {
    const value = JSON.parse(readFileSync(resolve(root, 'run-state.json'), 'utf8')) as RunProgress;
    if (value.schemaVersion !== 2 || value.runId !== runId || !['feature', 'acceptance_contract', 'harness'].includes(value.profile) || !['running', 'ready', 'merged', 'blocked'].includes(value.status) || typeof value.stage !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) || !Array.isArray(value.transitions) || value.transitions.some(item => !item || typeof item.stage !== 'string' || !Number.isFinite(Date.parse(item.startedAt)) || !Number.isFinite(item.durationMs) || item.durationMs < 0)) return null;
    return { schemaVersion: 2, runId, profile: value.profile, status: value.status, stage: value.stage, sourceHash: value.sourceHash, transitions: value.transitions, ...(value.failure ? { failure: value.failure } : {}) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export function evidenceFile(root: string, name: string): string {
  const delivery = readDelivery(root);
  const item = delivery?.evidence.find(item => item.path === name);
  if (!item || name.split('/').some(part => !part || part === '.' || part === '..') || name.includes('\\')) throw new ValidationError('Evidence file is not in the delivery manifest.');
  const directory = realpathSync(root);
  const path = realpathSync(resolve(root, name));
  if (!path.startsWith(directory + sep)) throw new ValidationError('Evidence must stay inside its run directory.');
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== item.sha256) throw new ConflictError('Evidence changed after delivery.');
  return path;
}
