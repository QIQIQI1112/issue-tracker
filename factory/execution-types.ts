import type { Task, Plan, Review } from './contracts.ts';
import type { VerificationSummary } from './evidence.ts';
import type { Delivery } from '../src/workflow.ts';
import type { PendingRegression, AcceptedRegression, RedCheck, ReviewReceipt } from './regression.ts';

export type Phase = 'plan' | 'tests' | 'regression-tests' | 'acceptance-review' | 'implement' | 'repair' | 'review';
export type AgentInput = { phase: Phase; task: Task; plan?: Plan; cwd: string; attempt: number; feedback: string; directory: string; timeoutMs: number; signal: AbortSignal; env: NodeJS.ProcessEnv; context?: { indexPath: string; path: string; bytes: number; sha256: string } };
export type Agent = { run: (input: AgentInput) => Promise<unknown> };
export type Verification = VerificationSummary;
export type PendingFailureTriage = { sourceHash: string; check: RedCheck; reportHash: string; logHash: string; receipt?: ReviewReceipt };

export type ControllerState = { execution?: Delivery['execution']; efficiency?: Delivery['efficiency']; schemaVersion: 1; taskId: string; runId: string; phases?: Delivery['phases']; reviewReceipts?: Delivery['reviewReceipts']; failedPhase?: string; failureKind?: 'integrity' | 'timeout' | 'cancelled' | 'budget' | 'ownership' | 'infrastructure' | 'verification' | 'review' | 'worker'; cleanupSafe?: boolean; budget?: { usedMs: number; implementationAttempts: number; acceptanceAttempts: number; infrastructureRetries?: number; maxAttempts: number; totalTimeoutMs: number }; resume?: { fromRunId?: string; reused: boolean; reason: string }; runDirectory: string; workspace: string; status: 'running' | 'ready' | 'merged' | 'blocked'; phase: string; startedAt: string; completedAt?: string; reason?: string; sourceHash?: string; baseCommit?: string; baselineTree?: string; plan?: Plan; regressions?: AcceptedRegression[]; pendingRegression?: PendingRegression; pendingFailureTriage?: PendingFailureTriage; browserRedChecks?: RedCheck[]; redChecks: { file: string; title: string; status: string; logPath: string; reportPath?: string }[]; attempts: { id: string; number: number; verification?: Verification; focused?: RedCheck[]; review?: Review }[]; verification?: Verification; review?: Review; ports?: [string, string]; changes?: { path: string; status: string }[]; integration?: { branch: string; before: string; commit?: string; verification?: Verification; review?: Review } };

