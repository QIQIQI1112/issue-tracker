import { resolve } from 'node:path';
import { readJson } from './evidence.ts';
import { parseTask } from './contracts.ts';
import { codexAgent } from './agent.ts';
import { runController } from './controller.ts';
import { ownerResume } from './owner-recovery.ts';
import { verifyMaintenance } from './owner-verification.ts';

const args = process.argv.slice(2);
const taskPath = args[0];
if (!taskPath || taskPath.startsWith('--')) {
  console.error('Usage: npm run factory -- <task.json> [--validate] [--base <ref>] [--merge <branch>]');
  process.exitCode = 1;
} else {
  try {
    if (taskPath === 'owner-resume' || taskPath === 'verify-maintenance') {
      if (!args[1] || args.slice(2).some(arg => arg !== '--validate') || taskPath === 'verify-maintenance' && args.length !== 2) throw new Error(`${taskPath} requires one request JSON path${taskPath === 'owner-resume' ? ' and optional --validate' : ''}.`);
      const request = readJson(resolve(args[1]));
      const result = taskPath === 'owner-resume' ? await ownerResume(request, { validateOnly: args.includes('--validate') }) : await verifyMaintenance(request);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = ['valid', 'passed', 'merged'].includes(result.status) ? 0 : 1;
    } else {
      const task = parseTask(readJson(resolve(taskPath)));
      if (args.includes('--validate')) console.log(JSON.stringify({ valid: true, task }, null, 2));
      else {
        const baseIndex = args.indexOf('--base');
        if (baseIndex !== -1 && !args[baseIndex + 1]) throw new Error('--base requires a Git ref.');
        const mergeIndex = args.indexOf('--merge');
        if (mergeIndex !== -1 && !args[mergeIndex + 1]) throw new Error('--merge requires a target branch.');
        const mergeTarget = mergeIndex === -1 ? undefined : args[mergeIndex + 1];
        const state = await runController({ repository: process.cwd(), task, agent: codexAgent(process.env.FACTORY_CODEX_BIN ?? 'codex'), baseRef: baseIndex === -1 ? mergeTarget : args[baseIndex + 1], mergeTarget });
        console.log(JSON.stringify({ status: state.status, runDirectory: state.runDirectory, workspace: state.workspace, reason: state.reason }, null, 2));
        process.exitCode = ['ready', 'merged'].includes(state.status) ? 0 : 1;
      }
    }
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
