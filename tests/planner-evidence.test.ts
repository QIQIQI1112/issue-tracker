import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codexPlanner } from '../factory/planner.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const requirement = { id: 42, repoId: 1, title: 'Ready', goal: 'Return ready.', status: 'draft' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01' };

function fakePlanner(directory: string, mode: 'review' | 'decompose'): string {
  const binary = join(directory, 'fake-codex.mjs');
  writeFileSync(binary, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nimport {dirname,join} from 'node:path';\nconst args=process.argv.slice(2);let prompt='';for await(const chunk of process.stdin)prompt+=chunk;\nconst output=args[args.indexOf('--output-last-message')+1];\nwriteFileSync(join(dirname(output),'observed.json'),JSON.stringify({args,prompt}));\nif(prompt.length>1048576){console.error('input_too_large: exceeds 1048576 characters');process.exit(9);}\nconst repair=prompt.includes('Previous response failed the runtime contract');\nconst response=${mode === 'review' ? "{schemaVersion:1,taskId:'requirement-42',approved:true,summary:'Reviewed retained evidence and actual source.',findings:[]}" : "{assumptions:[],issues:[{key:repair?'ready':'INVALID',title:'Ready',description:'Return ready.',acceptance:['The value is ready.'],dependsOn:[]}]}"};\nwriteFileSync(output,JSON.stringify(response));\nconsole.log(JSON.stringify({type:'fixture.completed'}));\n`);
  chmodSync(binary, 0o700);
  return binary;
}

function retainedEvidence(directory: string): { prompt: string; content: Buffer } {
  const observation = JSON.parse(readFileSync(join(directory, 'observed.json'), 'utf8')) as { args: string[]; prompt: string };
  assert.equal(observation.args[observation.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(observation.args[observation.args.indexOf('--cd') + 1], process.cwd());
  assert.ok(observation.args.includes('--ephemeral'));
  const evidencePath = resolve(directory, 'evidence.txt');
  assert.ok(existsSync(evidencePath), 'Every planner attempt must retain complete controller-owned evidence.');
  const content = readFileSync(evidencePath);
  const marker = 'Evidence file:\n';
  const start = observation.prompt.indexOf(marker);
  assert.ok(start >= 0, 'The reviewer needs an explicit evidence reference with integrity provenance.');
  const metadata = JSON.parse(observation.prompt.slice(start + marker.length).split('\n')[0]);
  assert.equal(metadata.path, evidencePath);
  assert.equal(metadata.bytes, content.byteLength);
  assert.equal(metadata.sha256, createHash('sha256').update(content).digest('hex'));
  assert.match(observation.prompt, /(?:read|inspect)[^\n]*(?:full|complete|retained)[^\n]*evidence/i);
  assert.match(observation.prompt, /actual source/i);
  assert.match(observation.prompt, /(?:not|never|rather than)[^\n]*summar/i);
  return { prompt: observation.prompt, content };
}

test('requirement review externalizes oversized Unicode evidence without losing terminal proof bytes', { timeout: 15000 }, async () => {
  const directory = evidenceDirectory('planner-large-evidence');
  const evidence = `${'Original delivery evidence 中🔎\n'.repeat(80000)}TERMINAL_PROOF_SENTINEL_完整\n`;
  assert.ok(evidence.length > 1048576);
  await assert.doesNotReject(() => codexPlanner(fakePlanner(directory, 'review')).review({ cwd: process.cwd(), directory, requirement, evidence, env: { PATH: process.env.PATH } }), 'A large delivery manifest must remain reviewable through retained evidence instead of exceeding CLI input limits.');
  const retained = retainedEvidence(directory);
  assert.deepEqual(retained.content, Buffer.from(evidence, 'utf8'));
  assert.ok(retained.prompt.length < 131072, 'The review prompt must remain bounded independently of manifest size.');
  assert.ok(!retained.prompt.includes('TERMINAL_PROOF_SENTINEL_完整'));
  assert.match(retained.prompt, /Return ready\./);
  assert.equal(JSON.parse(readFileSync(join(directory, 'response.json'), 'utf8')).approved, true);
  assert.equal(JSON.parse(readFileSync(join(directory, 'process.json'), 'utf8')).status, 'passed');
});

test('small decomposition evidence and one structured repair preserve each attempt with matching provenance', { timeout: 15000 }, async () => {
  const directory = evidenceDirectory('planner-small-evidence');
  const evidence = 'Original requirement context 中🔎\nSMALL_TERMINAL_SENTINEL';
  const result = await codexPlanner(fakePlanner(directory, 'decompose')).decompose({ cwd: process.cwd(), directory, requirement, evidence, env: { PATH: process.env.PATH } });
  assert.equal(result.issues[0].key, 'ready');
  const first = retainedEvidence(directory);
  const second = retainedEvidence(join(directory, 'protocol-repair-2'));
  assert.deepEqual(first.content, Buffer.from(evidence, 'utf8'));
  assert.ok(second.content.toString('utf8').startsWith(evidence));
  assert.match(second.content.toString('utf8'), /Previous response failed the runtime contract/);
  assert.ok(first.prompt.includes(evidence));
  assert.ok(second.prompt.includes('Previous response failed the runtime contract'));
  assert.ok(existsSync(join(directory, 'contract-error.json')));
});
