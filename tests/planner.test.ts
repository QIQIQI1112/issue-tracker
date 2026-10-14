import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexPlanner } from '../factory/planner.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('requirement planning repairs a malformed proposal once and retains both read-only receipts', async () => {
  const directory = evidenceDirectory('planner-protocol');
  const binary = join(directory, 'fake-codex.mjs');
  writeFileSync(binary, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);let prompt='';for await(const chunk of process.stdin)prompt+=chunk;\nconst repair=prompt.includes('Previous response failed the runtime contract');\nconst response={assumptions:[],issues:[{key:repair?'ready':'INVALID',title:'Ready',description:'Return ready.',acceptance:['The value is ready.'],dependsOn:[]}]};\nwriteFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(response));\nconsole.log(JSON.stringify({args,prompt}));\n`);
  chmodSync(binary, 0o700);
  const requirement = { id: 42, repoId: 1, title: 'Ready', goal: 'Return ready.', status: 'draft' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const result = await codexPlanner(binary).decompose({ cwd: process.cwd(), directory, requirement, evidence: '', env: { PATH: process.env.PATH } });
  assert.equal(result.issues[0].key, 'ready');
  assert.ok(existsSync(join(directory, 'contract-error.json')));
  assert.ok(existsSync(join(directory, 'response.json')));
  assert.ok(existsSync(join(directory, 'protocol-repair-2/response.json')));
  const event = JSON.parse(readFileSync(join(directory, 'events.log'), 'utf8').trim());
  assert.equal(event.args[event.args.indexOf('--sandbox') + 1], 'read-only');
  assert.match(event.prompt, /1–64 lowercase/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'process.json'), 'utf8')).status, 'passed');
});
