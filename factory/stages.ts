import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { digest, assertTestInventory } from './checkpoint.ts';
import { completeVerification, parseVerificationContract, readJson, snapshot, writeJson } from './evidence.ts';
import { parseReview } from './contracts.ts';
import type { Task } from './contracts.ts';

export type Profile = 'feature' | 'acceptance_contract' | 'harness';
export type Stage = 'admission' | 'planning' | 'checks' | 'coverage_review' | 'implementation' | 'diagnostics' | 'verification' | 'source_review' | 'integration' | 'completed' | 'blocked';
export type Operation = 'prepare' | 'plan' | 'tests' | 'regression-tests' | 'red-checks' | 'regression-red-checks' | 'acceptance-review' | 'implement' | 'repair' | 'focused-checks' | 'verify' | 'integration-verify' | 'review' | 'integrate';
type Proof = { path: string; sha256: string; sourceHash: string };
type Failure = { kind: string; message: string; stage: Stage };
export type RunState = { schemaVersion: 2; runId: string; taskId: string; profile: Profile; engine: { sourceHash: string; contractHash: string }; sourceHash: string; proofs: { acceptedChecks?: Proof; verification?: Proof; review?: Proof }; transitions: { stage: Stage; startedAt: string; completedAt?: string; durationMs: number }[] } & ({ status: 'running'; stage: Exclude<Stage, 'completed' | 'blocked'>; failure?: never } | { status: 'ready' | 'merged'; stage: 'completed'; failure?: never } | { status: 'blocked'; stage: 'blocked'; failure: Failure });
const stages: Record<Operation, Exclude<Stage, 'completed' | 'blocked'>> = { prepare: 'admission', plan: 'planning', tests: 'checks', 'regression-tests': 'checks', 'red-checks': 'checks', 'regression-red-checks': 'checks', 'acceptance-review': 'coverage_review', implement: 'implementation', repair: 'implementation', 'focused-checks': 'diagnostics', verify: 'verification', 'integration-verify': 'verification', review: 'source_review', integrate: 'integration' };
const next: Record<Exclude<Stage, 'completed' | 'blocked'>, Stage[]> = { admission: ['planning', 'checks', 'coverage_review', 'implementation'], planning: ['checks'], checks: ['checks', 'coverage_review', 'implementation', 'verification'], coverage_review: ['checks', 'implementation', 'diagnostics', 'verification'], implementation: ['checks', 'diagnostics', 'verification', 'integration'], diagnostics: ['coverage_review', 'implementation', 'integration'], verification: ['verification', 'source_review', 'implementation', 'integration'], source_review: ['source_review', 'integration', 'implementation', 'checks'], integration: ['verification', 'implementation', 'integration'] };

export function parseRunState(input: unknown): RunState {
  const value = input as RunState;
  if (!value || value.schemaVersion !== 2 || !['feature', 'acceptance_contract', 'harness'].includes(value.profile) || typeof value.runId !== 'string' || typeof value.taskId !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) || !value.engine || ![value.engine.sourceHash, value.engine.contractHash].every(hash => /^[a-f0-9]{64}$/.test(hash)) || !value.proofs || !Array.isArray(value.transitions)) throw new Error('Invalid typed run state.');
  if (value.status === 'running' ? !(value.stage in next) : value.status === 'blocked' ? value.stage !== 'blocked' || !value.failure?.message || !value.failure.kind : !['ready', 'merged'].includes(value.status) || value.stage !== 'completed') throw new Error('Run status and stage are inconsistent.');
  for (const proof of Object.values(value.proofs)) if (!proof || isAbsolute(proof.path) || proof.path.split('/').some(part => part === '..' || part === '.') || !/^[a-f0-9]{64}$/.test(proof.sha256) || !/^[a-f0-9]{64}$/.test(proof.sourceHash)) throw new Error('Invalid run proof reference.');
  return value;
}

export class StageRunner {
  private value: RunState;
  private pendingFailure?: Failure;
  private directory: string;
  private task: Task;
  constructor(directory: string, task: Task, engineRoot: string, sourceHash: string, runId: string, profile: Profile = 'feature') {
    this.directory = directory; this.task = task;
    this.value = { schemaVersion: 2, runId, taskId: task.id, profile, status: 'running', stage: 'admission', sourceHash, engine: { sourceHash: snapshot(engineRoot).hash, contractHash: digest(readFileSync(join(engineRoot, 'factory/verification-contract.json'))) }, proofs: {}, transitions: [{ stage: 'admission', startedAt: new Date().toISOString(), durationMs: 0 }] };
    this.save();
  }
  private save() { writeJson(join(this.directory, 'run-state.json'), parseRunState(this.value)); }
  private proof(path: string, sourceHash: string): Proof {
    const name = relative(this.directory, resolve(this.directory, path));
    if (!name || name.startsWith('..') || isAbsolute(name)) throw new Error('Stage proof escaped its owned run.');
    return { path: name, sha256: digest(readFileSync(resolve(this.directory, name))), sourceHash };
  }
  private checkProof(proof: Proof | undefined, sourceHash?: string) {
    if (!proof || sourceHash && proof.sourceHash !== sourceHash || digest(readFileSync(join(this.directory, proof.path))) !== proof.sha256) throw new Error('Stage transition lacks an unchanged same-source proof.');
  }
  private move(stage: Stage) {
    if (this.value.stage !== stage) {
      const previous = this.value.transitions.at(-1)!;
      previous.completedAt = new Date().toISOString(); previous.durationMs = Date.parse(previous.completedAt) - Date.parse(previous.startedAt);
      this.value.transitions.push({ stage, startedAt: previous.completedAt, durationMs: 0 });
    }
  }
  enter(operation: Operation, cwd: string): void {
    if (this.value.status !== 'running') throw new Error('A terminal run cannot execute another stage.');
    const stage = stages[operation];
    if (stage !== this.value.stage && !next[this.value.stage].includes(stage)) throw new Error(`Illegal run transition: ${this.value.stage} to ${stage}.`);
    const source = snapshot(cwd);
    if (stage === 'implementation' || stage === 'diagnostics' || stage === 'verification' || stage === 'source_review' || stage === 'integration') {
      this.checkProof(this.value.proofs.acceptedChecks);
      assertTestInventory(source.files, readJson(join(this.directory, this.value.proofs.acceptedChecks!.path)) as { path: string; hash: string }[]);
    }
    if (stage === 'source_review') this.checkProof(this.value.proofs.verification, source.hash);
    if (operation === 'implement' || operation === 'repair') this.pendingFailure = undefined;
    this.move(stage);
    this.value = { ...this.value, stage, sourceHash: source.hash };
    this.save();
  }
  acceptChecks(cwd: string, receiptPath: string): void {
    const source = snapshot(cwd);
    const receipt = readJson(resolve(this.directory, receiptPath)) as { approved: boolean; purpose: string; criteriaHash: string };
    if (!receipt.approved || !['acceptance-coverage', 'baseline-coverage-reuse', 'regression-coverage'].includes(receipt.purpose) || receipt.criteriaHash !== digest(JSON.stringify(this.task.acceptance))) throw new Error('Checks have no matching independent or baseline owner approval.');
    const path = join(this.directory, 'accepted-checks.json');
    assertTestInventory(source.files, readJson(path) as { path: string; hash: string }[]);
    this.value.proofs.acceptedChecks = this.proof(path, source.hash);
    this.save();
  }
  verified(cwd: string, summaryPath: string, contractPath: string): void {
    const sourceHash = snapshot(cwd).hash;
    completeVerification(readJson(summaryPath), { sourceHash, contract: parseVerificationContract(readJson(contractPath)), nodePath: join(resolve(summaryPath, '..'), 'node-results.jsonl'), message: 'Stage verification lacks complete passing machine evidence.' });
    this.value.proofs.verification = this.proof(summaryPath, sourceHash);
    delete this.value.proofs.review;
    this.save();
  }
  reviewed(cwd: string, receiptPath: string): void {
    const sourceHash = snapshot(cwd).hash;
    this.checkProof(this.value.proofs.verification, sourceHash);
    const path = resolve(this.directory, receiptPath);
    const receipt = readJson(path) as { approved: boolean; sourceHash: string; criteriaHash: string; response: unknown };
    const response = parseReview(receipt.response, this.task);
    if (!receipt.approved || !response.approved || receipt.sourceHash !== sourceHash || receipt.criteriaHash !== digest(JSON.stringify(this.task.acceptance))) {
      this.pendingFailure = { kind: 'review', message: response.findings.join('; ') || response.summary, stage: 'source_review' };
      return;
    }
    this.value.proofs.review = this.proof(path, sourceHash);
    this.save();
  }
  complete(status: 'ready' | 'merged', sourceHash: string): void {
    if (this.value.status !== 'running') throw new Error('A terminal run cannot complete again.');
    this.checkProof(this.value.proofs.verification, sourceHash); this.checkProof(this.value.proofs.review, sourceHash);
    if (status === 'merged') {
      const receipt = readJson(join(this.directory, 'integration.json')) as { commit: string };
      if (!/^[a-f0-9]{40,64}$/.test(receipt.commit)) throw new Error('Merged completion requires actual integration evidence.');
    }
    this.move('completed');
    this.value = { ...this.value, stage: 'completed', status, sourceHash };
    this.save();
  }
  block(kind: string, message: string): void {
    if (this.value.status !== 'running') return;
    const failure = this.pendingFailure ?? { kind, message, stage: this.value.stage };
    this.move('blocked');
    this.value = { ...this.value, status: 'blocked', stage: 'blocked', failure };
    this.save();
  }
}
