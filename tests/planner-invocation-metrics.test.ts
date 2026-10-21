import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IssueStore } from '../src/storage.ts';
import type { SerialQueue } from '../factory/queue.ts';

test('queue invocation metrics count both actual planner processes when one review response needs protocol repair', { timeout: 15000 }, async () => {
  const queues = await import('../factory/queue.ts').catch(() => null);
  const storage = await import('../src/storage.ts').catch(() => null);
  const planners = await import('../factory/planner.ts').catch(() => null);
  const fixtures = await import('./helpers/factory-fixture.ts').catch(() => null);
  const subprocess = await import('./helpers/subprocess.ts').catch(() => null);
  const workspace = await import('../factory/workspace.ts').catch(() => null);
  assert.ok(queues && storage && planners && fixtures && subprocess && workspace, 'Invocation metrics must observe the real queue and real planner process adapter.');
  const root = subprocess.evidenceDirectory('planner-invocation-metrics');
  const repository: string = fixtures.fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode: 'adaptive-v2' }));
  workspace.git(repository, ['add', 'factory/execution-policy.json']);
  workspace.git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Owner adaptive metrics policy']);
  const store: IssueStore = new storage.IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Planner metrics fixture', path: repository, targetBranch: 'main' });
    const submitted = store.work.submitPlan({ schemaVersion: 2, submissionId: 'planner-metrics', repoId: repo.id, requirement: { title: 'Ready value', goal: 'Return ready.' }, source: { kind: 'codex', reference: 'metrics-regression', summary: 'One authorized ready-value requirement.' }, assumptions: [], issues: [{ key: 'ready', title: 'Ready value', description: 'Return ready.', acceptance: ['The value is ready.'], dependsOn: [], changeKind: 'feature' }] });
    const binary = join(root, 'fake-owned-codex.mjs');
    writeFileSync(binary, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);let prompt='';for await(const chunk of process.stdin)prompt+=chunk;\nconst repair=prompt.includes('Previous response failed the runtime contract');\nconst response={schemaVersion:1,taskId:${JSON.stringify(`requirement-${submitted.requirement.id}`)},approved:true,summary:'Reviewed the original requirement and retained evidence.',findings:repair?[]:['Contradictory blocking finding requires a structured response repair.']};\nwriteFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(response));\nconsole.log(JSON.stringify({type:'fixture.completed',repair}));\n`);
    chmodSync(binary, 0o700);
    const queue: SerialQueue = new queues.SerialQueue(store, { evidenceRoot: join(root, 'evidence'), planner: planners.codexPlanner(binary), agent: { run: async () => { assert.fail('Only independent submitted-plan review is executed in this fixture.'); } } });
    assert.equal(await queue.processNext(), true);
    const run = store.work.runs()[0];
    assert.equal(run.status, 'passed', run.reason ?? 'The bounded protocol repair should yield a valid approved plan review.');
    const reviewDirectory = join(run.evidencePath, 'independent-review');
    const receipts = [join(reviewDirectory, 'process.json'), join(reviewDirectory, 'protocol-repair-2/process.json')].map(path => JSON.parse(readFileSync(path, 'utf8')));
    assert.equal(receipts.length, 2);
    assert.ok(receipts.every(receipt => receipt.status === 'passed'));
    assert.equal(existsSync(join(reviewDirectory, 'contract-error.json')), true);
    assert.equal(JSON.parse(readFileSync(join(reviewDirectory, 'response.json'), 'utf8')).findings.length, 1);
    assert.equal(JSON.parse(readFileSync(join(reviewDirectory, 'protocol-repair-2/response.json'), 'utf8')).findings.length, 0);
    const delivery = JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8'));
    assert.ok(delivery.efficiency, 'Queue delivery must publish measured actual invocation metrics.');
    assert.equal(delivery.efficiency.agentInvocations, receipts.length, 'Planner protocol repair must count each actual model process rather than just its outer review call.');
    assert.equal(delivery.efficiency.agentInvocations, 2);
    assert.equal(delivery.efficiency.verificationExecutions, 0);
    assert.equal(store.work.runs().length, 1);
    assert.equal(store.work.jobs().find(job => job.kind === 'plan_review')?.status, 'completed');
    assert.equal(store.work.jobs().find(job => job.kind === 'issue')?.status, 'queued');
  } finally { store.close(); }
});
