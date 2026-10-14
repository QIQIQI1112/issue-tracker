import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { runProcess } from '../factory/process.ts';

function stop(pid: number): void {
  try { process.kill(-pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

for (const { depth, delay, grace } of [{ depth: 1, delay: 0, grace: 500 }, { depth: 2, delay: 0, grace: 500 }, { depth: 2, delay: 30, grace: 500 }, { depth: 2, delay: 30, grace: 100 }]) {
test(`cancelling an owner stops ${depth} nested harness groups with ${delay}ms delay and ${grace}ms grace`, async () => {
  const directory = evidenceDirectory('nested-process');
  const pidPath = join(directory, 'child.pid');
  const child = join(directory, 'child.mjs');
  writeFileSync(child, `import {writeFileSync} from 'node:fs';\nprocess.on('SIGTERM',()=>{});\nwriteFileSync(${JSON.stringify(pidPath)},String(process.pid));\nprocess.stdout.write('child-ready\\n');\nsetInterval(()=>{},1000);\n`);
  let wrapper = child;
  for (let level = 0; level < depth; level += 1) {
    const path = join(directory, `wrapper-${level}.mjs`);
    writeFileSync(path, `import {runProcess} from ${JSON.stringify(resolve('factory/process.ts'))};\nprocess.on('SIGTERM',()=>{const until=Date.now()+${delay};while(Date.now()<until){}});\nawait runProcess({command:process.execPath,args:[${JSON.stringify(wrapper)}],cwd:${JSON.stringify(directory)},logPath:${JSON.stringify(join(directory, `nested-${level}.log`))},timeoutMs:10000,onOutput:text=>process.stdout.write(text)});\n`);
    wrapper = path;
  }
  const abort = new AbortController();
  let pid: number | undefined;
  try {
    const result = await runProcess({ command: process.execPath, args: [wrapper], cwd: directory, logPath: join(directory, 'owner.log'), timeoutMs: 10000, graceMs: grace, signal: abort.signal, onOutput: text => { if (text.includes('child-ready')) abort.abort(); } });
    assert.equal(result.status, 'cancelled');
    pid = Number(readFileSync(pidPath, 'utf8'));
    assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' });
  } finally {
    if (pid) stop(pid);
  }
});
}
