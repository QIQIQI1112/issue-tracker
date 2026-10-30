import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexAgent } from '../factory/agent.ts';
import { parseTask } from '../factory/contracts.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import type { AgentInput } from '../factory/controller.ts';

function input(phase: AgentInput['phase']): AgentInput {
  const directory = evidenceDirectory('codex-adapter');
  const task = parseTask(JSON.parse(readFileSync('tickets/001-labels.json', 'utf8')));
  return { phase, task, cwd: process.cwd(), attempt: 1, feedback: 'Independent evidence', directory, timeoutMs: 10000, signal: new AbortController().signal, env: { PATH: process.env.PATH } };
}

for (const phase of ['plan', 'implement'] as const) {
  test(`Codex adapter supplies structured ${phase} context and the correct sandbox`, async () => {
    const context = input(phase);
    const binary = join(context.directory, 'fake-codex.mjs');
    writeFileSync(binary, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nlet prompt='';\nfor await(const chunk of process.stdin) prompt+=chunk;\n${phase === 'implement' ? 'await new Promise(resolve=>setTimeout(resolve,3500));\n' : ''}writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({args,prompt,cwd:process.cwd()}));\nprocess.stdout.write(JSON.stringify({type:'fixture.completed'})+'\\n');\n`);
    chmodSync(binary, 0o700);
    const started = performance.now();
    const result = await codexAgent(binary).run(context) as { args: string[]; prompt: string; cwd: string };
    if (phase === 'implement') assert.ok(performance.now() - started > 3000, 'The normal result completes beyond the former 3s fixture ceiling.');
    assert.equal(result.args[result.args.indexOf('--sandbox') + 1], phase === 'plan' ? 'read-only' : 'workspace-write');
    assert.equal(result.args[result.args.indexOf('--cd') + 1], context.cwd);
    assert.ok(result.args.includes('--ephemeral'));
    assert.match(result.prompt, /Only the controller determines completion/);
    assert.match(result.prompt, /exercise-001/);
    assert.match(readFileSync(join(context.directory, 'events.log'), 'utf8'), /fixture.completed/);
    assert.equal(JSON.parse(readFileSync(join(context.directory, 'output-schema.json'), 'utf8')).additionalProperties, false);
  });
}

test('Codex adapter terminates a hung owned worker and retains its receipt', async () => {
  const context = input('plan');
  context.timeoutMs = 1500;
  const binary = join(context.directory, 'fake-codex.mjs');
  const pidPath = join(context.directory, 'worker.pid');
  writeFileSync(binary, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(pidPath)},String(process.pid));\nprocess.on('SIGTERM',()=>{});\nsetInterval(()=>{},1000);\n`);
  chmodSync(binary, 0o700);
  await assert.rejects(codexAgent(binary).run(context), /timeout/);
  const receipt = JSON.parse(readFileSync(join(context.directory, 'process.json'), 'utf8')) as { pid: number };
  const owner = JSON.parse(readFileSync(join(context.directory, 'events.log.owner.json'), 'utf8')) as { pid: number; identity: string; cwd: string; command: string; groups: number[]; settled: boolean };
  const pid = receipt.pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.equal(owner.pid, pid);
  assert.equal(owner.command, binary);
  assert.equal(owner.cwd, context.cwd);
  assert.ok(owner.identity.includes(binary));
  assert.ok(owner.groups.includes(pid));
  assert.equal(owner.settled, true);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(JSON.parse(readFileSync(join(context.directory, 'process.json'), 'utf8')).status, 'timeout');
});
