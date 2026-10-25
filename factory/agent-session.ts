import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { snapshot } from './evidence.ts';
import { scoped } from './contracts.ts';
import type { Task } from './contracts.ts';
import type { Agent, ControllerState, Phase } from './execution-types.ts';
import { writeRoleContext } from './optimization.ts';
import type { executionBudget } from './budget.ts';

type Options = { state: ControllerState; task: Task; agent: Agent; resumeFrom?: string; signal: AbortSignal; budget: () => ReturnType<typeof executionBudget>; remaining: () => number; environment: () => NodeJS.ProcessEnv; enter: (phase: Phase, cwd: string) => void; unsafe: () => void };

export class AgentSession {
  private counter = 0;
  private options: Options;
  constructor(options: Options) { this.options = options; }
  get count(): number { return this.counter; }
  async invoke(phase: Phase, attempt: number, feedback = '', cwd = this.options.state.workspace, deadline = Infinity): Promise<unknown> {
    this.options.enter(phase, cwd);
    if (this.options.state.efficiency) { this.options.state.efficiency.agentInvocations += 1; if (phase === 'tests' || phase === 'regression-tests') this.options.state.efficiency.testAuthoringInvocations += 1; }
    const directory = join(this.options.state.runDirectory, `phase-${++this.counter}-${phase}`);
    mkdirSync(directory);
    const timeoutMs = Math.min(this.options.task.budget.workerTimeoutMs, this.options.remaining(), deadline - Date.now());
    if (timeoutMs <= 0) throw new Error(`Agent ${phase} timed out.`);
    this.options.budget().phase(timeoutMs);
    const abort = new AbortController();
    const onCancel = () => abort.abort();
    this.options.signal.addEventListener('abort', onCancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const verification = this.options.state.integration?.verification ?? this.options.state.verification;
    const evidenceFiles = [...(this.options.resumeFrom ? ['state.json', 'delivery.json'].map(file => join(this.options.resumeFrom!, file)) : []), join(this.options.state.runDirectory, 'task.json'), join(this.options.state.runDirectory, 'plan.json'), ...this.options.state.redChecks.flatMap(check => [check.logPath, ...(check.reportPath ? [check.reportPath] : [])]), ...(this.options.state.browserRedChecks ?? []).flatMap(check => [check.logPath, ...(check.reportPath ? [check.reportPath] : [])]), ...(this.options.state.pendingFailureTriage ? [this.options.state.pendingFailureTriage.check.logPath, this.options.state.pendingFailureTriage.check.reportPath!] : []), ...(verification ? ['summary.json', 'node-results.jsonl', 'test.log'].map(file => join(verification.runDirectory, file)) : [])].filter(existsSync);
    const context = this.options.task.schemaVersion === 2 ? writeRoleContext({ directory, role: phase, goal: this.options.task.wholeGoal?.goal ?? this.options.task.goal, sourceHash: snapshot(cwd).hash, feedback, relevantPaths: [...new Set([...(this.options.state.plan?.slices.flatMap(slice => slice.checks.map(check => check.file)) ?? []), ...snapshot(cwd).files.filter(file => file.path.startsWith('src/') && scoped(file.path, this.options.task)).map(file => file.path)])], decisions: this.options.state.plan?.assumptions ?? [], evidence: [...new Set(evidenceFiles)].map(path => ({ path, purpose: 'Retained controller task, plan or actual machine proof; inspect the file before making a delivery judgment.' })) }) : undefined;
    const work = this.options.agent.run({ phase, task: this.options.task, plan: this.options.state.plan, cwd, attempt, feedback, context, directory, timeoutMs, signal: abort.signal, env: { ...this.options.environment(), RUN_DIR: join(cwd, '.runs', 'worker-checks', `phase-${this.counter}`) } }).finally(() => { finished = true; });
    work.catch(() => {});
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error(`Agent ${phase} timed out.`)); }, timeoutMs); abort.signal.addEventListener('abort', () => reject(new Error(`Agent ${phase} cancelled or timed out.`)), { once: true }); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.options.signal.removeEventListener('abort', onCancel);
      if (!finished) {
        abort.abort();
        await Promise.race([work.catch(() => {}), new Promise(done => setTimeout(done, 2500))]);
        if (!finished) { this.options.unsafe(); this.options.state.cleanupSafe = false; }
      }
      this.options.budget().phase(0);
    }
  }
}
