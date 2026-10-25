import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from './contracts.ts';
import type { ControllerState } from './execution-types.ts';
import type { Delivery } from '../src/workflow.ts';
import { controllerDelivery } from './delivery.ts';
import { readJson, writeJson } from './evidence.ts';
import { blockRunState, parseRunState, recoverRunState } from './stages.ts';
import type { StageRunner } from './stages.ts';

type Outcome = { status: 'blocked'; reason: string } | { status: 'ready' | 'merged'; sourceHash: string };

export function finishRunRecord(state: ControllerState, task: Task, outcome: Outcome, stages?: StageRunner): ControllerState {
  const path = join(state.runDirectory, 'run-state.json');
  const progress = existsSync(path) ? parseRunState(readJson(path)) : undefined;
  const deliveryPath = join(state.runDirectory, 'delivery.json');
  const delivery = existsSync(deliveryPath) ? readJson(deliveryPath) as Delivery : undefined;
  if (state.taskId !== task.id || [progress, delivery].some(record => record && (record.runId !== state.runId || record.taskId !== task.id))) throw new Error('Terminal records must identify the same run and task.');
  const blockedDelivery = delivery?.status === 'blocked' ? delivery : undefined;
  const completedAt = (state.status === outcome.status ? state.completedAt : undefined) ?? (progress?.status === outcome.status ? progress.transitions.at(-1)?.completedAt : undefined) ?? (outcome.status === 'blocked' ? blockedDelivery?.completedAt : undefined) ?? new Date().toISOString();
  if (outcome.status === 'blocked') {
    const reason = progress?.failure?.message ?? state.reason ?? blockedDelivery?.limitations[0] ?? outcome.reason;
    state.failedPhase ??= blockedDelivery?.failedPhase ?? state.phase;
    const kind = state.failureKind ?? blockedDelivery?.failureKind ?? 'worker';
    const blocked = stages ? stages.block(kind, reason, completedAt) : progress ? blockRunState(state.runDirectory, kind, reason, completedAt) : undefined;
    state.reason = blocked?.failure?.message ?? reason;
    state.failureKind = (blocked?.failure?.kind ?? kind) as ControllerState['failureKind'];
  } else {
    if (stages) stages.complete(outcome.status, outcome.sourceHash, completedAt);
    else if (progress) {
      if (outcome.status !== 'merged') throw new Error('External completion requires verified merge recovery.');
      recoverRunState(state.runDirectory, outcome.sourceHash, completedAt);
    }
    state.phase = outcome.status;
    delete state.reason;
  }
  state.status = outcome.status;
  state.completedAt = completedAt;
  for (const phase of state.phases ?? []) {
    if (!phase.completedAt) {
      phase.completedAt = completedAt;
      phase.durationMs = Date.parse(completedAt) - Date.parse(phase.startedAt);
    }
    if (phase.status === 'running') phase.status = outcome.status === 'blocked' ? 'failed' : 'passed';
  }
  if (state.efficiency) {
    state.efficiency.elapsedMs = Date.parse(completedAt) - Date.parse(state.startedAt);
    const sum = (...names: string[]) => (state.phases ?? []).filter(phase => names.includes(phase.name)).reduce((total, phase) => total + phase.durationMs, 0);
    state.efficiency.durations = { planningMs: sum('plan'), testAuthoringMs: sum('tests', 'regression-tests'), acceptanceReviewMs: sum('acceptance-review'), implementationMs: sum('implement', 'repair'), verificationMs: sum('verify', 'integration-verify', 'focused-checks'), codeReviewMs: sum('review') };
  }
  writeJson(join(state.runDirectory, 'state.json'), state);
  controllerDelivery(state, task);
  return state;
}
