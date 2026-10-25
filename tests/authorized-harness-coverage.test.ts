import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { maintenanceIdentity } from '../factory/maintenance.ts';
import { digest } from '../factory/checkpoint.ts';
import { inspectNodeReport, snapshot } from '../factory/evidence.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('authorized harness extension freezes a newly approved behavior check through implementation verification and integration', { timeout: 60000 }, async () => {
  const root = evidenceDirectory('authorized-harness-coverage');
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'factory/value.ts'), "export const value = 'broken';\n");
  writeFileSync(join(repository, 'src/value.ts'), "export {value} from '../factory/value.ts';\n");
  writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode: 'adaptive-v2' }));
  git(repository, ['add', '.']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Prepare harness extension fixture']);
  const store = new IssueStore(join(root, 'state.sqlite'));
  const repo = store.work.addRepo({ name: 'Harness coverage fixture', path: repository, targetBranch: 'main' });
  const issue = store.create({ title: 'Ready harness value', description: 'Return ready from the authorized harness module.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['The harness value is ready.'], changeKind: 'harness' } });
  const job = store.work.startIssue(issue.id);
  const engine = fileURLToPath(new URL('../', import.meta.url));
  const ownerAuthorizationPath = join(root, 'owner-authorization.json');
  writeFileSync(ownerAuthorizationPath, JSON.stringify({ schemaVersion: 1, requestId: randomUUID(), issueId: issue.id, issueHash: maintenanceIdentity(issue), profile: 'harness', scope: ['factory/value.ts'], authorization: 'The owner authorizes this bounded harness fix and independently approved new behavior coverage.', engineSourceHash: snapshot(engine).hash, contractHash: digest(readFileSync(join(engine, 'factory/verification-contract.json'))), baseCommit: git(repository, ['rev-parse', 'main']).trim() }));
  const check = { file: 'tests/authorized-value.test.ts', title: 'authorized harness value becomes ready' };
  const authored = `import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../factory/value.ts';\ntest(${JSON.stringify(check.title)},()=>assert.equal(value,'ready'));\n`;
  const original = readFileSync(join(repository, 'tests/value.test.ts'));
  const delegate = fixtureAgent();
  let accepted = false;
  let implemented = false;
  let reviewed = false;
  try {
    const options: NonNullable<ConstructorParameters<typeof SerialQueue>[1]> & { ownerAuthorizationPath: string } = { evidenceRoot: join(root, 'evidence'), ownerAuthorizationPath, agent: { run: async input => {
      if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'extend', reason: 'A new named check directly observes the authorized harness module.' }, assumptions: [], slices: [{ id: 'ready', goal: input.task.goal, acceptanceIds: input.task.acceptance.map(item => item.id), checks: [check] }], browserChecks: [] };
      if (input.phase === 'tests') writeFileSync(join(input.cwd, check.file), authored);
      if (input.phase === 'acceptance-review') {
        const proof = JSON.parse(input.feedback).redChecks.find((value: { file: string; title: string }) => value.file === check.file && value.title === check.title);
        assert.ok(proof, 'Independent review receives the newly authored named behavior proof.');
        assert.equal(proof.status, 'expected_failure');
        assert.match(readFileSync(proof.reportPath, 'utf8'), /ERR_ASSERTION/);
        assert.equal(readFileSync(join(input.cwd, check.file), 'utf8'), authored);
        accepted = true;
      }
      if (input.phase === 'implement' || input.phase === 'repair') {
        assert.equal(accepted, true, 'The owner red and independent coverage approval precede implementation.');
        assert.equal(readFileSync(join(input.cwd, check.file), 'utf8'), authored, 'The approved new file stays frozen at implementation admission.');
        writeFileSync(join(input.cwd, 'factory/value.ts'), "export const value = 'ready';\n");
        implemented = true;
        return { schemaVersion: 1, taskId: input.task.id, summary: 'Fixed only the authorized harness module.', blockers: [] };
      }
      if (input.phase === 'review') reviewed = true;
      return await delegate.run(input);
    } } };
    assert.equal(await new SerialQueue(store, options).processNext(job.id), true, 'Trusted admission must process the queued harness extension.');
    const run = store.work.runs().find(run => run.issueId === issue.id)!;
    assert.equal(run.status, 'merged', run.reason ?? 'An independently accepted new check must remain admissible after its inventory is frozen.');
    assert.ok(accepted && implemented && reviewed);
    assert.equal(readFileSync(join(repository, check.file), 'utf8'), authored);
    assert.deepEqual(readFileSync(join(repository, 'tests/value.test.ts')), original);
    assert.equal(readFileSync(join(repository, 'factory/value.ts'), 'utf8'), "export const value = 'ready';\n");
    const inventory = JSON.parse(readFileSync(join(run.evidencePath, 'accepted-checks.json'), 'utf8')) as { path: string; hash: string }[];
    assert.ok(inventory.some(value => value.path === check.file && value.hash === digest(authored)), 'The final inventory retains the exact independently approved new test bytes.');
    const state = JSON.parse(readFileSync(join(run.evidencePath, 'run-state.json'), 'utf8'));
    const summaryPath = resolve(run.evidencePath, state.proofs.verification.path);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert.equal(summary.status, 'passed');
    inspectNodeReport(join(dirname(summaryPath), 'node-results.jsonl'), [check]);
    const delivery = JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8'));
    assert.equal(delivery.review.approved, true);
    assert.equal(delivery.integration.commit, git(repository, ['rev-parse', 'main']).trim());
  } finally { store.close(); }
});
