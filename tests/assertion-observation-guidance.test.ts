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

for (const { phase, title } of cases) test(title, { timeout: 10000 }, async () => {
  const directory = evidenceDirectory(`assertion-observation-${phase}`);
  const binary = join(directory, 'fake-codex.mjs');
  const task = parseTask({ schemaVersion: 1, id: 'assertion-observation-guidance', title: 'Read delivery progress', goal: 'Display each requirement identifier, title and delivery state correctly.', acceptance: [{ id: 'progress', description: 'The correct requirement and its delivery state are visible.' }], scope: ['tests/delivery-progress.test.ts', 'acceptance/delivery-progress.spec.ts'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 3000, totalTimeoutMs: 10000 }, notes: 'Disposable adapter observation fixture.' });
  const report = phase === 'acceptance-review'
    ? { schemaVersion: 1, taskId: task.id, approved: true, summary: 'The observations distinguish incorrect states and equivalent presentation.', findings: [] }
    : { schemaVersion: 1, taskId: task.id, summary: 'Prepared scoped delivery observations.', blockers: [], ...(phase === 'regression-tests' ? { checks: [{ file: 'tests/delivery-progress.test.ts', title: 'delivery state belongs to the selected requirement' }], browserChecks: [] } : {}) };
  writeFileSync(binary, `#!/usr/bin/env node\nimport {readFileSync,writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);let prompt='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin)prompt+=chunk;\nconst schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));\nwriteFileSync(${JSON.stringify(join(directory, 'observed.json'))},JSON.stringify({args,prompt,schema}));\nwriteFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(${JSON.stringify(report)}));\nconsole.log(JSON.stringify({type:'fixture.completed'}));\n`);
  chmodSync(binary, 0o700);
  const input: AgentInput = { phase, task, cwd: process.cwd(), attempt: 1, feedback: 'A whole-row text assertion confused the displayed identifier with the adjacent title.', directory, timeoutMs: 3000, signal: new AbortController().signal, env: { PATH: process.env.PATH }, plan: { schemaVersion: 1, taskId: task.id, assumptions: [], slices: [{ id: 'progress', goal: task.goal, acceptanceIds: ['progress'], checks: [{ file: 'tests/delivery-progress.test.ts', title: 'delivery state belongs to the selected requirement' }] }], browserChecks: [{ file: 'delivery-progress.spec.ts', title: 'delivery state belongs to the selected requirement' }] } };
  assert.deepEqual(await codexAgent(binary).run(input), report);
  const observed = JSON.parse(readFileSync(join(directory, 'observed.json'), 'utf8')) as { args: string[]; prompt: string; schema: unknown };
  assert.equal(observed.args[observed.args.indexOf('--sandbox') + 1], phase === 'acceptance-review' ? 'read-only' : 'workspace-write');
  assert.equal(observed.args[observed.args.indexOf('--cd') + 1], input.cwd);
  assert.ok(observed.args.includes('--ephemeral'));
  assert.deepEqual(observed.schema, phase === 'tests' ? workerSchema : phase === 'regression-tests' ? regressionSchema : reviewSchema);
  assert.match(observed.prompt, /Only the controller determines completion/);
  assert.match(observed.prompt, /controller[^.\n]*(?:runs|owns)[^.\n]*(?:red proofs|HTTP and browser checks)/i);
  assert.match(observed.prompt, phase === 'tests' ? /Do not implement the feature/ : phase === 'regression-tests' ? /NEW scoped[^\n]*files only/ : /Do not edit files/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'process.json'), 'utf8')).status, 'passed');
  const guidance = observed.prompt;
  assert.match(guidance, /(?:specific|dedicated|individual|field)[^.\n]*(?:visible|semantic)[^.\n]*element|(?:visible|semantic)[^.\n]*(?:specific|dedicated|individual|field)[^.\n]*element/i, 'Field assertions must observe a specific visible semantic element.');
  assert.ok(/(?:select|locat|field)[^.\n]*(?:independent[^.\n]*(?:expected|value)|without[^.\n]*expected)/i.test(guidance)
    && /(?:dedicated|stable)[^.\n]*(?:label|role|test[- ]?id)/i.test(guidance)
    && /(?:assert|check)[^.\n]*(?:value[^.\n]*separat|separat[^.\n]*value)/i.test(guidance), 'Select identity and state fields independently of their expected values through a dedicated label, role or stable test ID, then assert their values separately.');
  assert.match(guidance, /(?:rather than|instead of|avoid|not)[^.\n]*(?:aggregate|whole[- ](?:row|container)|concatenat)[^.\n]*(?:text|textContent)|(?:rather than|instead of|avoid|not)[^.\n]*textContent/i, 'Aggregate container text must not stand in for a specific field observation.');
  assert.match(guidance, /(?:exact|accurate)[^.\n]*(?:identifier|ID)[^.\n]*(?:state|status)|(?:identifier|ID)[^.\n]*(?:state|status)[^.\n]*(?:exact|accurate)/i, 'Identifiers and business states need precise observations.');
  assert.match(guidance, /Verified[^.\n]*Unverified/i, 'Opposite verification states must remain distinguishable.');
  assert.match(guidance, /Merged[^.\n]*Not merged/i, 'Opposite merge states must remain distinguishable.');
  assert.match(guidance, /(?:equivalent|ordinary|harmless)[^.\n]*(?:layout|markup|spacing)[^.\n]*(?:pass|valid|fail)|(?:pass|valid|fail)[^.\n]*(?:equivalent|ordinary|harmless)[^.\n]*(?:layout|markup|spacing)/i, 'Equivalent presentation changes must preserve correct behavior checks.');
  assert.match(guidance, /(?:prose|description|report)[^.\n]*(?:contain|partial)|(?:contain|partial)[^.\n]*(?:prose|description|report)/i, 'Meaningful prose containment must remain available rather than requiring exact equality everywhere.');
  assert.doesNotMatch(guidance, /(?:never|do not|ban)[^.\n]*\btoContainText\b/i);
  assert.doesNotMatch(guidance, /(?:always|every|all)[^.\n]*(?:prose|description|report)[^.\n]*(?:exact|equal)/i);
  if (phase === 'acceptance-review') {
    assert.match(guidance, /(?:wrong|incorrect|opposite|contradictory)[^.\n]*(?:behavior|result|state)[^.\n]*(?:pass|satisf)|(?:false[- ]pass)[^.\n]*(?:wrong|incorrect|opposite|contradictory)/i, 'Acceptance review must consider incorrect behavior that could falsely satisfy a check.');
    assert.match(guidance, /(?:correct|equivalent)[^.\n]*(?:behavior|result|presentation)[^.\n]*(?:fail|reject)|(?:false[- ]fail)[^.\n]*(?:correct|equivalent)/i, 'Acceptance review must consider correct behavior that a presentation-coupled check could falsely reject.');
    assert.match(guidance, /(?:existing|same)[^.\n]*(?:phase|review)/i);
    assert.match(guidance, /approved review must have an empty findings array/);
  }
});
