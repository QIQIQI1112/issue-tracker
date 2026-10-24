import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexAgent } from '../factory/agent.ts';
import { parseTask, regressionSchema, reviewSchema, workerSchema } from '../factory/contracts.ts';
import type { AgentInput } from '../factory/controller.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const cases = [
  { phase: 'tests', title: 'actual tests adapter delivers semantic assertion observations without expanding author permissions' },
  { phase: 'regression-tests', title: 'actual regression-tests adapter delivers semantic assertion observations while preserving new-file-only coverage' },
  { phase: 'acceptance-review', title: 'actual acceptance-review adapter checks false passes and false failures inside its existing read-only phase' },
] as const;

for (const { phase, title } of cases) test(title, { timeout: 30000 }, async () => {
  const directory = evidenceDirectory(`assertion-observation-${phase}`);
  const binary = join(directory, 'fake-codex.mjs');
  const task = parseTask({ schemaVersion: 1, id: 'assertion-observation-guidance', title: 'Read delivery progress', goal: 'Display each requirement identifier, title and delivery state correctly.', acceptance: [{ id: 'progress', description: 'The correct requirement and its delivery state are visible.' }], scope: ['tests/delivery-progress.test.ts', 'acceptance/delivery-progress.spec.ts'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 10000, totalTimeoutMs: 30000 }, notes: 'Disposable adapter observation fixture.' });
  const report = phase === 'acceptance-review'
    ? { schemaVersion: 1, taskId: task.id, approved: true, summary: 'The observations distinguish incorrect states and equivalent presentation.', findings: [] }
    : { schemaVersion: 1, taskId: task.id, summary: 'Prepared scoped delivery observations.', blockers: [], ...(phase === 'regression-tests' ? { checks: [{ file: 'tests/delivery-progress.test.ts', title: 'delivery state belongs to the selected requirement' }], browserChecks: [] } : {}) };
  writeFileSync(binary, `#!/usr/bin/env node\nimport {readFileSync,writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);let prompt='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin)prompt+=chunk;\nconst schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));\nwriteFileSync(${JSON.stringify(join(directory, 'observed.json'))},JSON.stringify({args,prompt,schema}));\nwriteFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(${JSON.stringify(report)}));\nconsole.log(JSON.stringify({type:'fixture.completed'}));\n`);
  chmodSync(binary, 0o700);
  const input: AgentInput = { phase, task, cwd: process.cwd(), attempt: 1, feedback: 'A whole-row text assertion confused the displayed identifier with the adjacent title.', directory, timeoutMs: 10000, signal: new AbortController().signal, env: { PATH: process.env.PATH }, plan: { schemaVersion: 1, taskId: task.id, assumptions: [], slices: [{ id: 'progress', goal: task.goal, acceptanceIds: ['progress'], checks: [{ file: 'tests/delivery-progress.test.ts', title: 'delivery state belongs to the selected requirement' }] }], browserChecks: [] } };
  assert.deepEqual(await codexAgent(binary).run(input), report);
  const observed = JSON.parse(readFileSync(join(directory, 'observed.json'), 'utf8')) as { args: string[]; prompt: string; schema: unknown };
  assert.equal(observed.args[observed.args.indexOf('--sandbox') + 1], phase === 'acceptance-review' ? 'read-only' : 'workspace-write');
  assert.equal(observed.args[observed.args.indexOf('--cd') + 1], input.cwd);
  assert.ok(observed.args.includes('--ephemeral'));
  assert.deepEqual(observed.schema, phase === 'tests' ? workerSchema : phase === 'regression-tests' ? regressionSchema : reviewSchema);
  assert.match(observed.prompt, /Only the controller determines completion/);
  assert.match(observed.prompt, /controller[^.\n]*(?:runs|owns)[^.\n]*(?:red proofs|Node and HTTP checks)/i);
  assert.match(observed.prompt, phase === 'tests' ? /Do not implement the feature/ : phase === 'regression-tests' ? /NEW scoped[^\n]*files only/ : /Do not edit files/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'process.json'), 'utf8')).status, 'passed');
  const guidance = observed.prompt;
  assert.match(guidance, /code[- ]only/i, 'The adapter must identify the active verification profile.');
  assert.match(guidance, /(?:uniform|consistent|consistency|single)[^.\n]*(?:standard|pattern)|(?:standard|pattern)[^.\n]*(?:uniform|consistent|consistency|single)/i, 'Equivalent functionality must follow a selected uniform standard.');
  assert.match(guidance, /(?:repository|repo|established|existing)[^.\n]*(?:standard|pattern|convention)|(?:standard|pattern|convention)[^.\n]*(?:repository|repo|established|existing)/i, 'Select the standard from the actual repository before enforcing it.');
  assert.match(guidance, /(?:named|deterministic)[^.\n]*Node|Node[^.\n]*(?:named|deterministic)/i, 'Evidence must use actual deterministic named Node checks.');
  assert.match(guidance, /(?:preserve|protect)[^.\n]*(?:accepted|baseline|frozen)|(?:accepted|baseline|frozen)[^.\n]*(?:preserve|protect)/i);
  if (phase === 'acceptance-review') {
    assert.match(guidance, /Do not edit files/);
    assert.match(guidance, /approved review must have an empty findings array/);
  }
});
