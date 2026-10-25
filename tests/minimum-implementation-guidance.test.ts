import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prompt } from '../factory/agent.ts';
import { parseTask } from '../factory/contracts.ts';
import { codexPlanner } from '../factory/planner.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

function minimumPolicy(text: string, label: string) {
  const instructions = text.split(/\n\s*(?:Task|Requirement):\s*\n/)[0].replace(/\s+/g, ' ');
  const statements = instructions.split(/(?<=[.!?])\s+/);
  const rules: [string, RegExp[]][] = [
    ['justify added capabilities against a current goal, caller or documented contract', [/current|existing|documented|real/i, /requirement|goal|caller|contract/i, /justif|trace|tie|need|require/i, /capabilit|option|mode|state|abstract|dependenc|extension/i]],
    ['reject speculative or unused capabilities', [/do not|never|avoid|reject|omit|\bno\b/i, /unused|speculativ|hypothetical|future.proof/i, /capabilit|option|mode|state|abstract|extension/i]],
    ['reuse meaningful existing checks', [/reuse/i, /meaningful|equivalent|existing/i, /coverage|checks|tests/i]],
    ['keep fixtures and mocks minimal', [/fixture|mock/i, /minimal|minimum|smallest|necessary|needed/i]],
    ['prohibit new or expanded framework and browser reimplementations', [/do not|never|avoid|reject|\bno\b/i, /framework|browser/i, /reimplement|simulat|emulat|clone/i]],
    ['prohibit private framework API use', [/do not|never|avoid|reject|\bno\b/i, /private|internal/i, /framework/i, /API/i]],
    ['preserve accepted quality gates', [/preserve|retain|keep|maintain|protect|do not weaken/i, /accepted|required|existing/i, /gate|verification|quality|check/i]],
  ];
  for (const [meaning, concepts] of rules) {
    assert.ok(statements.some(statement => concepts.every(concept => concept.test(statement))), `${label}: instructions must ${meaning}.`);
  }
  assert.match(instructions, /product|application/i, `${label}: rules must cover product code.`);
  assert.match(instructions, /test/i, `${label}: rules must cover test code.`);
  assert.match(instructions, /correctness|validation|error.handling/i, `${label}: correctness remains necessary.`);
  assert.match(instructions, /accessibility/i, `${label}: accessibility remains necessary.`);
  assert.match(instructions, /security/i, `${label}: security remains necessary.`);
}

test('all task phases receive minimum necessary product and test implementation rules outside task payloads', () => {
  const task = parseTask({ schemaVersion: 1, id: 'minimum-guidance', title: 'Read value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 10000 } });
  const prompts = (['plan', 'tests', 'regression-tests', 'acceptance-review', 'implement', 'repair', 'review'] as const).map(phase => ({ phase, text: prompt({ phase, task, cwd: process.cwd(), attempt: 1, feedback: '', directory: process.cwd(), timeoutMs: 1000, signal: new AbortController().signal, env: {} }) }));
  for (const { phase, text } of prompts) minimumPolicy(text, phase);
});

test('requirement decomposition and review adapters deliver minimum implementation rules outside supplied evidence', { timeout: 15000 }, async () => {
  const root = evidenceDirectory('minimum-planner-guidance');
  const binary = join(root, 'fake-codex.mjs');
  writeFileSync(binary, `#!/usr/bin/env node\nimport {readFileSync,writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);let prompt='';for await(const chunk of process.stdin)prompt+=chunk;\nconst schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));\nconst response=schema.properties.issues?{assumptions:[],issues:[{key:'ready',title:'Read value',description:'Return ready.',acceptance:['The value is ready.'],dependsOn:[]}]}:{schemaVersion:1,taskId:'requirement-42',approved:true,needsRegression:false,summary:'Reviewed the value.',findings:[]};\nwriteFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(response));\nconsole.log(JSON.stringify({args,prompt}));\n`);
  chmodSync(binary, 0o700);
  const requirement = { id: 42, repoId: 1, title: 'Read value', goal: 'Return ready.', status: 'draft' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const planner = codexPlanner(binary);
  const observed: { mode: string; prompt: string }[] = [];
  for (const mode of ['decompose', 'review'] as const) {
    const directory = join(root, mode);
    mkdirSync(directory);
    const result = await planner[mode]({ cwd: process.cwd(), directory, requirement, evidence: 'The value is ready.', env: { PATH: process.env.PATH } });
    if (mode === 'decompose') assert.equal('issues' in result && result.issues[0].key, 'ready');
    else assert.equal('approved' in result && result.approved, true);
    const event = JSON.parse(readFileSync(join(directory, 'events.log'), 'utf8').trim()) as { args: string[]; prompt: string };
    assert.equal(event.args[event.args.indexOf('--sandbox') + 1], 'read-only');
    const processResult = JSON.parse(readFileSync(join(directory, 'process.json'), 'utf8'));
    assert.equal(processResult.status, 'passed');
    assert.equal(processResult.settled, true);
    observed.push({ mode, prompt: event.prompt });
  }
  for (const item of observed) minimumPolicy(item.prompt, `requirement ${item.mode}`);
});
