import { resolve } from 'node:path';
import { readJson } from './evidence.ts';
import { parseTask } from './contracts.ts';
import { codexAgent } from './agent.ts';
import { runController } from './controller.ts';

const args = process.argv.slice(2);
const taskPath = args[0];
if (!taskPath || taskPath.startsWith('--')) {
  console.error('Usage: npm run factory -- <task.json> [--validate] [--base <ref>] [--merge <branch>]');
  process.exitCode = 1;
} else {
  try {
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
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
