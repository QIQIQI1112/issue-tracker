import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { integrate } from '../factory/integration.ts';
import { runProcess } from '../factory/process.ts';
import { git, processEnvironment } from '../factory/workspace.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('initial named red refuses unresolved owned-process probes before coverage approval or implementation', { timeout: 30000 }, async context => {
  const root = evidenceDirectory('initial-proof-ownership');
  const script = join(root, 'probe.mjs');
  writeFileSync(script, String.raw`
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runController} from ${JSON.stringify(resolve('factory/controller.ts'))};
import {assertOwnedGroupsQuiescent} from ${JSON.stringify(resolve('factory/ownership.ts'))};
import {git} from ${JSON.stringify(resolve('factory/workspace.ts'))};
import {fixtureAgent,fixtureRepository} from ${JSON.stringify(resolve('tests/helpers/factory-fixture.ts'))};
const root=${JSON.stringify(root)};
const evidence=join(root,'evidence');mkdirSync(evidence);
const repository=fixtureRepository(join(root,'repo'));
const before=git(repository,['rev-parse','main']).trim();
const original=process.kill;
let injections=0;
function ownerPath(){return readdirSync(evidence).map(name=>join(evidence,name,'red-1-0.log.owner.json')).find(path=>existsSync(path));}
process.kill=function(pid,signal){
  const path=ownerPath();
  const owner=path?JSON.parse(readFileSync(path,'utf8')):null;
  if(signal===0&&pid===-owner?.pid){injections++;const error=new Error('Injected EIO for the exact red group probe');error.code='EIO';throw error;}
  return original.call(process,pid,signal);
};
const phases=[];
const delegate=fixtureAgent();
let state;
try{
 state=await runController({repository,evidenceRoot:evidence,mergeTarget:'main',task:{schemaVersion:1,id:'initial-owner',title:'Ready value',goal:'Return ready.',acceptance:[{id:'ready',description:'The value is ready.'}],scope:['src/','tests/'],verificationCommand:'npm run verify',budget:{maxAttempts:1,workerTimeoutMs:1000,totalTimeoutMs:20000}},agent:{run:async input=>{phases.push(input.phase);return await delegate.run(input);}}});
 const owner=JSON.parse(readFileSync(ownerPath(),'utf8'));
 const events=readFileSync(join(state.runDirectory,'red-1-0.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
 const assertion=error=>Boolean(error&&(error.code==='ERR_ASSERTION'||error.name==='AssertionError'||assertion(error.cause)));
 const observation={phases,injections,owner,hasNamedAssertion:events.some(event=>event.type==='test:fail'&&event.data.name==='value is ready'&&assertion(event.data.details?.error)),status:state.status,reason:state.reason,before,after:git(repository,['rev-parse','main']).trim()};
 writeFileSync(join(root,'observation.json'),JSON.stringify(observation,null,2));
 console.log(JSON.stringify(observation));
}finally{
 process.kill=original;
 assertOwnedGroupsQuiescent(evidence);
 if(state)for(const path of [state.workspace,join(state.runDirectory,'integration-workspace')])if(existsSync(join(path,'.git')))git(repository,['worktree','remove','--force',path]);
}
`);
  const result = await runProcess({ command: process.execPath, args: ['--import', 'tsx', script], cwd: process.cwd(), env: processEnvironment({}), logPath: join(root, 'probe.log'), timeoutMs: 25000 });
  assert.equal(result.status, 'passed', result.output);
  assert.equal(result.settled, true, 'The actual fault-injection driver and descendants must settle.');
  const observed = JSON.parse(readFileSync(join(root, 'observation.json'), 'utf8')) as { phases: string[]; injections: number; owner: { settled: boolean; probeErrors: string[] }; hasNamedAssertion: boolean; status: string; reason: string; before: string; after: string };
  assert.ok(observed.injections > 0 && observed.owner.probeErrors.some(error => error.includes('EIO')), 'The real initial-red ownership probe must encounter the injected OS observation error.');
  assert.equal(observed.owner.settled, false, 'The actual receipt must retain unknown settlement rather than forge cleanup success.');
  assert.equal(observed.hasNamedAssertion, true, 'The frozen ready-value check must fail on its real named behavior assertion.');
  context.diagnostic(JSON.stringify({ root, ...observed }));
  assert.deepEqual(observed.phases.filter(phase => ['acceptance-review', 'implement', 'repair', 'review'].includes(phase)), [], 'An unresolved initial proof must stop before approval or product implementation.');
  assert.equal(observed.status, 'blocked');
  assert.equal(observed.after, observed.before, 'An unresolved initial proof cannot advance the target.');
});

test('integration refuses target advancement when the existing cleanup-safety gate rejects the candidate', async () => {
  const root = evidenceDirectory('integration-before-advance');
  const repository = fixtureRepository(join(root, 'repo'));
  const before = git(repository, ['rev-parse', 'main']).trim();
  const original = readFileSync(join(repository, 'src/value.ts'));
  writeFileSync(join(repository, 'src/value.ts'), "export const value = 'ready';\n");
  const patchPath = join(root, 'candidate.patch');
  writeFileSync(patchPath, git(repository, ['diff', '--binary']));
  writeFileSync(join(repository, 'src/value.ts'), original);
  const directory = join(root, 'integration');
  mkdirSync(directory);
  let validated = false;
  let ownershipChecked = false;
  try {
    await assert.rejects(integrate({ repository, branch: 'main', patchPath, runDirectory: directory, runId: 'ownership-before-advance', assertCleanupSafe: () => { ownershipChecked = true; if (validated) throw new Error('Candidate owner has not settled.'); }, validate: async workspace => {
      assert.equal(readFileSync(join(workspace, 'src/value.ts'), 'utf8'), "export const value = 'ready';\n", 'The actual patched candidate reaches validation before the owner-safety boundary.');
      validated = true;
    } }));
    assert.equal(validated, true);
    assert.equal(ownershipChecked, true, 'The existing ownership callback must actually reject.');
    assert.equal(git(repository, ['rev-parse', 'main']).trim(), before, 'Ownership refusal must precede the checked-out target merge or ref advancement.');
    assert.deepEqual(readFileSync(join(repository, 'src/value.ts')), original);
    assert.equal(existsSync(join(directory, 'integration.json')), false, 'Unsafe ownership cannot leave a successful integration receipt.');
  } finally {
    const workspace = join(directory, 'integration-workspace');
    if (existsSync(join(workspace, '.git'))) git(repository, ['worktree', 'remove', '--force', workspace]);
  }
});
