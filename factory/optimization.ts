import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { writeJson } from './evidence.ts';

export type ExecutionPolicy = { schemaVersion: 1; mode: 'legacy-v1' | 'adaptive-v2' };
export function executionPolicy(repository: string): ExecutionPolicy {
  const path = join(repository, 'factory/execution-policy.json');
  if (!existsSync(path)) return { schemaVersion: 1, mode: 'legacy-v1' };
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || !['legacy-v1', 'adaptive-v2'].includes(value.mode) || Object.keys(value).some(key => !['schemaVersion', 'mode'].includes(key))) throw new Error('Invalid controller-owned execution policy.');
  return { schemaVersion: 1, mode: value.mode };
}

export type VerificationDiagnosis = { kind: 'product' | 'test-contract' | 'infrastructure' | 'unknown'; retryable: boolean; reason: string };
export function classifyVerificationFailure(input: unknown): VerificationDiagnosis {
  if (!input || typeof input !== 'object') return { kind: 'unknown', retryable: false, reason: 'No structured verification failure evidence.' };
  const value = input as { status?: unknown; diagnostics?: unknown; checks?: { name: string; status: string }[] };
  const diagnostic = value.diagnostics && typeof value.diagnostics === 'object' && !Array.isArray(value.diagnostics) ? value.diagnostics as { phase?: unknown; origin?: unknown; settled?: unknown; code?: unknown; kind?: unknown } : undefined;
  const phases = new Set(['lint', 'typecheck', 'test', 'build', 'test:e2e', 'node', 'browser']);
  const failed = value.checks?.filter(check => check.status !== 'passed') ?? [];
  if (value.status === 'failed' && diagnostic?.origin === 'spawn' && diagnostic.settled === true && typeof diagnostic.code === 'string' && ['EAGAIN', 'ENFILE'].includes(diagnostic.code) && typeof diagnostic.phase === 'string' && phases.has(diagnostic.phase) && failed.length === 1 && failed[0].name === diagnostic.phase && failed[0].status === 'failed') return { kind: 'infrastructure', retryable: true, reason: `Confirmed settled ${diagnostic.phase} spawn failure: ${diagnostic.code}.` };
  if (value.status === 'failed' && diagnostic?.kind === 'test-contract' && diagnostic.origin === 'report-validation' && diagnostic.settled === true && typeof diagnostic.phase === 'string' && phases.has(diagnostic.phase)) return { kind: 'test-contract', retryable: false, reason: 'Structured test-contract failure requires reviewed test maintenance.' };
  if (value.status === 'failed' && diagnostic?.kind === 'product' && diagnostic.origin === 'node-report' && diagnostic.settled === true && diagnostic.phase === 'test') return { kind: 'product', retryable: false, reason: 'Structured product assertion failure requires implementation repair.' };
  return { kind: 'unknown', retryable: false, reason: 'Failure cause is not independently established; no infrastructure retry is authorized.' };
}

export function writeRoleContext(input: {
  directory: string;
  role: string;
  goal: string;
  sourceHash: string;
  feedback: string;
  relevantPaths?: string[];
  decisions?: unknown[];
  evidence?: { path: string; purpose?: string }[];
}) {
  mkdirSync(input.directory, { recursive: true });
  const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  const path = resolve(input.directory, 'context-feedback.txt');
  const bytes = Buffer.byteLength(input.feedback, 'utf8');
  const sha256 = digest(input.feedback);
  const evidence = (input.evidence ?? []).map(item => {
    const path = resolve(input.directory, item.path);
    const within = relative(resolve(input.directory), path);
    if (!isAbsolute(item.path) && (within.startsWith('..') || isAbsolute(within))) throw new Error('Relative context evidence escaped its role directory.');
    if (!lstatSync(path).isFile()) throw new Error('Context evidence must be a regular owner file.');
    const data = readFileSync(path);
    return { path, bytes: data.byteLength, sha256: digest(data), purpose: item.purpose ?? 'Retained owner evidence.' };
  });
  const index = { schemaVersion: 1, role: input.role, goal: input.goal, sourceHash: input.sourceHash, relevantPaths: input.relevantPaths ?? [], decisions: input.decisions ?? [], feedback: { path, bytes, sha256 }, evidence };
  const indexPath = resolve(input.directory, 'context-index.json');
  writeJson(indexPath, index);
  writeJson(resolve(input.directory, 'context-identity.json'), { indexPath, sha256: digest(readFileSync(indexPath)) });
  writeFileSync(path, input.feedback);
  return { path, bytes, sha256, indexPath, index };
}
