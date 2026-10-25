import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { maintenanceIdentity } from '../factory/maintenance.ts';
import { assertTestInventory, digest, restoreCheckpoint } from '../factory/checkpoint.ts';
import { inspectNodeReport, snapshot } from '../factory/evidence.ts';
import { git } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('authorized acceptance retirement freezes equivalent replacement coverage without retaining a deleted optional check', { timeout: 60000 }, async () => {
  const root = evidenceDirectory('acceptance-retirement');
  const repository = fixtureRepository(join(root, 'repo'));
  const obsolete = { file: 'tests/obsolete-value.test.ts', title: 'obsolete value remains ready' };
  const replacement = { file: 'tests/replacement-value.test.ts', title: 'replacement value remains ready' };
  const checkSource = (title: string) => `import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.ts';\ntest(${JSON.stringify(title)},()=>assert.equal(value,'ready'));\n`;
  const authored = checkSource(replacement.title);
  writeFileSync(join(repository, 'src/value.ts'), "export const value = 'ready';\n");
  writeFileSync(join(repository, obsolete.file), checkSource(obsolete.title));
  writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode: 'adaptive-v2' }));
  git(repository, ['add', '.']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Prepare equivalent optional coverage retirement']);
  const original = readFileSync(join(repository, 'tests/value.test.ts'));
  const contract = readFileSync(join(repository, 'factory/verification-contract.json'));
  const store = new IssueStore(join(root, 'state.sqlite'));
  const repo = store.work.addRepo({ name: 'Acceptance retirement fixture', path: repository, targetBranch: 'main' });
  const issue = store.create({ title: 'Replace optional value coverage', description: 'Retire an optional obsolete value check while retaining its equivalent guarantee and all mandatory checks.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Equivalent replacement coverage and the mandatory ready-value check pass.'], changeKind: 'acceptance_contract' } });
  const job = store.work.startIssue(issue.id);
  const engine = fileURLToPath(new URL('../', import.meta.url));
  const ownerAuthorizationPath = join(root, 'owner-authorization.json');
  writeFileSync(ownerAuthorizationPath, JSON.stringify({ schemaVersion: 1, requestId: randomUUID(), issueId: issue.id, issueHash: maintenanceIdentity(issue), profile: 'acceptance_contract', scope: [obsolete.file, replacement.file], authorization: 'The owner authorizes replacing only the optional obsolete check with equivalent coverage while retaining every mandatory guarantee.', engineSourceHash: snapshot(engine).hash, contractHash: digest(readFileSync(join(engine, 'factory/verification-contract.json'))), baseCommit: git(repository, ['rev-parse', 'main']).trim() }));
  const delegate = fixtureAgent();
  let accepted = false;
  let implemented = false;
  let reviewed = false;
  try {
    const options: NonNullable<ConstructorParameters<typeof SerialQueue>[1]> & { ownerAuthorizationPath: string } = { evidenceRoot: join(root, 'evidence'), ownerAuthorizationPath, agent: { run: async input => {
      if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'extend', reason: 'The optional obsolete check is replaced by the same ready-value assertion; mandatory coverage stays unchanged.' }, assumptions: [], slices: [{ id: 'replacement', goal: input.task.goal, acceptanceIds: input.task.acceptance.map(item => item.id), checks: [replacement] }], browserChecks: [] };
      if (input.phase === 'tests') {
        unlinkSync(join(input.cwd, obsolete.file));
        writeFileSync(join(input.cwd, replacement.file), authored);
        git(input.cwd, ['add', '-u', '--', obsolete.file]);
      }
      if (input.phase === 'acceptance-review') {
        const proof = JSON.parse(input.feedback).redChecks.find((value: { file: string; title: string }) => value.file === replacement.file && value.title === replacement.title);
        assert.ok(proof, 'Independent coverage review receives the real named replacement proof.');
        assert.equal(proof.status, 'already_passed', 'Equivalent coverage preserves the already working ready-value guarantee.');
        assert.equal(existsSync(join(input.cwd, obsolete.file)), false);
        assert.equal(readFileSync(join(input.cwd, replacement.file), 'utf8'), authored);
        assert.deepEqual(readFileSync(join(input.cwd, 'tests/value.test.ts')), original);
        assert.deepEqual(readFileSync(join(input.cwd, 'factory/verification-contract.json')), contract);
        accepted = true;
      }
      if (input.phase === 'implement' || input.phase === 'repair') {
        assert.equal(accepted, true, 'Independent equivalence approval precedes the retained no-op implementation role.');
        assert.equal(readFileSync(join(input.cwd, replacement.file), 'utf8'), authored);
        assert.equal(existsSync(join(input.cwd, obsolete.file)), false);
        implemented = true;
        return { schemaVersion: 1, taskId: input.task.id, summary: 'Retained the working implementation and independently approved equivalent checks.', blockers: [] };
      }
      if (input.phase === 'review') reviewed = true;
      return await delegate.run(input);
    } } };
    assert.equal(await new SerialQueue(store, options).processNext(job.id), true, 'Trusted admission must process the authorized acceptance retirement.');
    const run = store.work.runs().find(run => run.issueId === issue.id)!;
    assert.equal(run.status, 'merged', run.reason ?? 'An approved optional retirement must not leave a deleted path in the frozen inventory.');
    assert.ok(accepted && implemented && reviewed);
    assert.equal(existsSync(join(repository, obsolete.file)), false);
    assert.equal(readFileSync(join(repository, replacement.file), 'utf8'), authored);
    assert.deepEqual(readFileSync(join(repository, 'tests/value.test.ts')), original);
    assert.deepEqual(readFileSync(join(repository, 'factory/verification-contract.json')), contract);
    assert.equal(readFileSync(join(repository, 'src/value.ts'), 'utf8'), "export const value = 'ready';\n");
    const inventory = JSON.parse(readFileSync(join(run.evidencePath, 'accepted-checks.json'), 'utf8')) as { path: string; hash: string }[];
    assert.equal(inventory.some(value => value.path === obsolete.file), false, 'The current frozen inventory cannot retain the authorized retired path.');
    assert.ok(inventory.some(value => value.path === replacement.file && value.hash === digest(authored)));
    assert.ok(inventory.some(value => value.path === 'tests/value.test.ts' && value.hash === digest(original)));
    const state = JSON.parse(readFileSync(join(run.evidencePath, 'run-state.json'), 'utf8'));
    const summaryPath = resolve(run.evidencePath, state.proofs.verification.path);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert.equal(summary.status, 'passed');
    inspectNodeReport(join(dirname(summaryPath), 'node-results.jsonl'), [replacement, { file: 'tests/value.test.ts', title: 'value is ready' }]);
    const delivery = JSON.parse(readFileSync(join(run.evidencePath, 'delivery.json'), 'utf8'));
    assert.equal(delivery.review.approved, true);
    assert.equal(delivery.integration.commit, git(repository, ['rev-parse', 'main']).trim());
    const checkpoint: Parameters<typeof restoreCheckpoint>[0] = JSON.parse(readFileSync(join(run.evidencePath, 'checkpoint.json'), 'utf8'));
    const restoredWorkspace = join(root, 'checkpoint-restoration');
    git(repository, ['worktree', 'add', '--detach', restoredWorkspace, checkpoint.baseCommit]);
    try {
      git(restoredWorkspace, ['read-tree', '--reset', '-u', checkpoint.baselineTree]);
      restoreCheckpoint(checkpoint, run.evidencePath, restoredWorkspace);
      const restored = snapshot(restoredWorkspace);
      assert.equal(restored.hash, checkpoint.sourceHash, 'Native continuation reconstructs the exact accepted retirement source.');
      assertTestInventory(restored.files, inventory);
      assert.equal(existsSync(join(restoredWorkspace, obsolete.file)), false);
    } finally { git(repository, ['worktree', 'remove', '--force', restoredWorkspace]); }
  } finally { store.close(); }
});
