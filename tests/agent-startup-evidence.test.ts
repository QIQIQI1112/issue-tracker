import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runProcess } from '../factory/process.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('the actual adapter timeout case proves owned cleanup when child startup PID evidence is unavailable', { timeout: 15000 }, async () => {
  const directory = evidenceDirectory('agent-startup-evidence');
  const preload = join(directory, 'unavailable-startup-pid.mjs');
  const contextPath = join(directory, 'adapter-context.json');
  const activationPath = join(directory, 'injection-active.json');
  const title = 'Codex adapter terminates a hung owned worker and retains its receipt';
  writeFileSync(preload, `import fs from 'node:fs';\nimport {dirname} from 'node:path';\nimport {syncBuiltinESMExports} from 'node:module';\nconst original=fs.readFileSync;\nfs.writeFileSync(${JSON.stringify(activationPath)},JSON.stringify({pid:process.pid,unavailable:'worker.pid'}));\nfs.readFileSync=function(path,...args){\nconst value=String(path);\nif(value.endsWith('/worker.pid')||value.endsWith('/process.json'))fs.writeFileSync(${JSON.stringify(contextPath)},JSON.stringify({directory:dirname(value)}));\nif(value.endsWith('/worker.pid')){const error=new Error('ENOENT: child startup PID marker unavailable: '+value);error.code='ENOENT';throw error;}\nreturn Reflect.apply(original,this,[path,...args]);\n};\nsyncBuiltinESMExports();\n`);
  const reportPath = join(directory, 'node-results.jsonl');
  const execution = await runProcess({ command: process.execPath, args: ['--import', preload, '--import', 'tsx', '--test', `--test-name-pattern=^${title}$`, `--test-reporter=${resolve('factory/node-reporter.mjs')}`, `--test-reporter-destination=${reportPath}`, 'tests/agent.test.ts'], cwd: process.cwd(), env: { PATH: process.env.PATH }, logPath: join(directory, 'test.log'), timeoutMs: 10000 });
  assert.equal(JSON.parse(readFileSync(activationPath, 'utf8')).unavailable, 'worker.pid');
  const context = JSON.parse(readFileSync(contextPath, 'utf8')) as { directory: string };
  const receipt = JSON.parse(readFileSync(join(context.directory, 'process.json'), 'utf8')) as { pid: number; status: string; durationMs: number };
  const owner = JSON.parse(readFileSync(join(context.directory, 'events.log.owner.json'), 'utf8')) as { pid: number; identity: string; groups: number[]; settled: boolean };
  assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 0);
  assert.equal(receipt.status, 'timeout');
  assert.ok(receipt.durationMs >= 1500 && receipt.durationMs < 10000);
  assert.equal(owner.pid, receipt.pid);
  assert.ok(owner.identity.length > 0);
  assert.ok(owner.groups.includes(receipt.pid));
  assert.equal(owner.settled, true);
  assert.throws(() => process.kill(receipt.pid, 0), { code: 'ESRCH' });
  for (const group of owner.groups) {
    assert.ok(Number.isSafeInteger(group) && group > 0);
    assert.throws(() => process.kill(-group, 0), { code: 'ESRCH' });
  }
  const outerOwner = JSON.parse(readFileSync(join(directory, 'test.log.owner.json'), 'utf8')) as { pid: number; groups: number[]; settled: boolean };
  assert.equal(outerOwner.pid, execution.pid);
  assert.equal(outerOwner.settled, true);
  for (const group of outerOwner.groups) assert.throws(() => process.kill(-group, 0), { code: 'ESRCH' });
  const records = readFileSync(reportPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const failure = records.find(event => event.type === 'test:fail' && event.data.name === title);
  assert.equal(execution.status, 'passed', `The original named timeout case must use controller receipts when startup evidence is unavailable. ${JSON.stringify(failure?.data.details?.error ?? execution.output)}`);
  assert.equal(records.filter(event => event.type === 'test:pass' && event.data.name === title && !event.data.skip && !event.data.todo).length, 1);
});
