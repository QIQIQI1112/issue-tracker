import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ControllerState } from './controller.ts';
import { readJson, writeJson } from './evidence.ts';
import { git } from './workspace.ts';
import { controllerDelivery } from './delivery.ts';
import { parseTask } from './contracts.ts';
import type { IntegrationReceipt } from './integration.ts';

export function recoverMerge(repository: string, root: string): boolean {
  if (!existsSync(join(root, 'state.json'))) return false;
  const state = readJson(join(root, 'state.json')) as ControllerState;
  if (!state.integration?.review?.approved || state.integration.verification?.status !== 'passed') return false;
  const receiptPaths = existsSync(join(root, 'integration.json')) ? ['integration.json'] : readdirSync(root).filter(name => /^integration-\d+-candidate\.json$/.test(name)).reverse();
  for (const path of receiptPaths) {
    const receipt = readJson(join(root, path)) as IntegrationReceipt;
    if (receipt.before !== state.integration.before || receipt.branch !== state.integration.branch || !/^[a-f0-9]{40,64}$/.test(receipt.commit) || git(repository, ['rev-parse', `${receipt.commit}^{tree}`]).trim() !== receipt.tree) continue;
    try { git(repository, ['merge-base', '--is-ancestor', receipt.commit, `refs/heads/${receipt.branch}`]); }
    catch { continue; }
    state.status = 'merged'; state.phase = 'merged'; state.integration.commit = receipt.commit; state.completedAt ??= new Date().toISOString(); delete state.reason;
    writeJson(join(root, 'state.json'), state);
    writeJson(join(root, 'integration.json'), receipt);
    controllerDelivery(state, parseTask(readJson(join(root, 'task.json'))));
    return true;
  }
  return false;
}
