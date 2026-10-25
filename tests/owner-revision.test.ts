import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { ownerResume } from '../factory/owner-recovery.ts';
import { digest, taskIdentity } from '../factory/checkpoint.ts';
import { inspectNamedNodeReport, inspectNodeReport, snapshot } from '../factory/evidence.ts';
import { maintenanceIdentity } from '../factory/maintenance.ts';
import type { Agent, AgentInput, ControllerState } from '../factory/controller.ts';
import type { OwnerAuthorization } from '../factory/profiles.ts';
import { runProcess } from '../factory/process.ts';
import { git, processEnvironment } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';


const revisionCheck = { file: 'tests/revision.test.ts', title: 'retained value is ready' };
const currentCheck = { file: 'tests/current.test.ts', title: 'current target control is retained' };
const originalTest = "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../factory/value.ts';\ntest('retained value is ready',()=>assert.equal(value,'ready'));\n";
const replacementTest = originalTest.replace("assert.equal(value,'ready')", "assert.deepEqual({value},{value:'ready'})");
const retainedDraft = "export const value = 'draft';\n";
const targetControl = "export const control = 'current';\n";
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const bind = (path: string) => ({ path, hash: digest(readFileSync(path)) });
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
const commit = (repository: string, message: string) => {
  git(repository, ['add', '.']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', message]);
};
const report = (input: AgentInput) => ({ schemaVersion: 1, taskId: input.task.id, summary: 'Prepared the bounded revision fixture.', blockers: [] });
const plan = (input: AgentInput, checks: { file: string; title: string }[]) => ({ schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'extend', reason: 'Prove the retained value using actual named assertions.' }, assumptions: [], slices: [{ id: 'ready', goal: input.task.goal, acceptanceIds: input.task.acceptance.map(item => item.id), checks }], browserChecks: [] });

async function revisionFixture(rejections?: (artifact: unknown, coveragePath: string) => { name: string; artifact: unknown }[]) {
  const root = evidenceDirectory('owner-revision');
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'src/value.ts'), "export const value = 'ready';\n");
  writeFileSync(join(repository, 'factory/value.ts'), "export const value = 'broken';\n");
  writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode: 'adaptive-v2' }));
  mkdirSync(join(repository, 'docs'));
  commit(repository, 'Prepare a green main and a separate missing maintenance behavior');
  const baselineReport = join(root, 'main-baseline.jsonl');
  const baseline = await runProcess({ command: process.execPath, args: ['--test', `--test-reporter=${resolve('factory/node-reporter.mjs')}`, `--test-reporter-destination=${baselineReport}`, 'tests/value.test.ts'], cwd: repository, env: processEnvironment({}), logPath: join(root, 'main-baseline.log'), timeoutMs: 15000 });
  assert.equal(baseline.settled, true, 'Fixture baseline process must settle before native maintenance.');
  assert.equal(baseline.status, 'passed', `Fixture main must genuinely pass its named baseline before contract maintenance: ${baseline.output}`);
  assert.equal(inspectNamedNodeReport(baselineReport, { file: 'tests/value.test.ts', title: 'value is ready' }, repository, 'passed'), 'already_passed');
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Original enrollment', path: repository, targetBranch: 'main' });
    const create = (repoId: number, changeKind: 'harness' | 'acceptance_contract', title: string) => store.create({ title, description: title, status: 'open', priority: 'medium', labels: [], work: { repoId, requirementId: null, dependsOn: [], acceptance: ['The retained value is ready and all controls remain enforced.'], changeKind } });
    const issue = create(repo.id, 'harness', 'Return the retained value through native maintenance');
    const authorization = (issueId: number, profile: OwnerAuthorization['profile'], scope: string[]): OwnerAuthorization => ({ schemaVersion: 1, requestId: randomUUID(), issueId, issueHash: maintenanceIdentity(store.get(issueId)!), profile, scope, authorization: 'The owner authorizes this bounded disposable maintenance with all existing gates.', engineSourceHash: snapshot(resolve('.')).hash, contractHash: digest(readFileSync(resolve('factory/verification-contract.json'))), baseCommit: git(repository, ['rev-parse', 'main']).trim() });
    const historicalEngine = join(root, 'historical-engine');
    for (const file of snapshot(resolve('.')).files) {
      const target = join(historicalEngine, file.path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve(file.path), target);
    }
    const historicalRunner = join(historicalEngine, 'factory/runner.ts');
    writeFileSync(historicalRunner, `${readFileSync(historicalRunner, 'utf8')}\n`);
    symlinkSync(resolve('node_modules'), join(historicalEngine, 'node_modules'), 'dir');
    const { SerialQueue: HistoricalQueue } = await import(join(historicalEngine, 'factory/queue.ts')) as typeof import('../factory/queue.ts');
    const historicalAuthority = { ...authorization(issue.id, 'harness', ['factory/value.ts']), engineSourceHash: snapshot(historicalEngine).hash };
    const historicalAuthorityPath = join(root, 'historical-authorization.json');
    save(historicalAuthorityPath, historicalAuthority);
    const job = store.work.startIssue(issue.id);
    const delegate = fixtureAgent();
    let retainedSource: ReturnType<typeof snapshot> | undefined;
    const initial: Agent = { run: async input => {
      if (input.phase === 'plan') return plan(input, [revisionCheck]);
      if (input.phase === 'tests') { writeFileSync(join(input.cwd, revisionCheck.file), originalTest); return report(input); }
      if (input.phase === 'implement' || input.phase === 'repair') { writeFileSync(join(input.cwd, 'factory/value.ts'), retainedDraft); retainedSource = snapshot(input.cwd); throw new Error('Intentional settled interruption after accepted coverage.'); }
      return delegate.run(input);
    } };
    const evidenceRoot = join(root, 'evidence');
    assert.equal(await new HistoricalQueue(store, { evidenceRoot, agent: initial, ownerAuthorizationPath: historicalAuthorityPath }).processNext(job.id), true);
    const originalRun = store.work.runs().find(run => run.jobId === job.id)!;
    assert.equal(originalRun.status, 'blocked');
    assert.equal(existsSync(join(originalRun.evidencePath, 'checkpoint.json')), true, `Fixture must reach accepted coverage, rather than fail setup: ${originalRun.reason}`);
    const checkpoint = read(join(originalRun.evidencePath, 'checkpoint.json'));
    assert.equal(checkpoint.accepted, true);
    const originalTask = read(join(originalRun.evidencePath, 'task.json'));
    assert.ok(retainedSource, 'Capture the native candidate before owned-worktree cleanup.');
    const source = retainedSource;
    assert.equal(source.hash, checkpoint.sourceHash);
    const files = source.files.map(file => file.path === revisionCheck.file ? { path: file.path, hash: digest(replacementTest) } : file);
    const proposed = { hash: digest(JSON.stringify(files)), files };
    const inventory = (files: { path: string; hash: string }[]) => files.filter(file => /^(tests|acceptance)\//.test(file.path));
    const coveragePath = join(root, 'equivalence-coverage.json');
    save(coveragePath, { approved: true, findings: [], sourceHash: proposed.hash, snapshot: proposed, acceptedChecks: inventory(files), checks: [revisionCheck], browserChecks: [], summary: 'Independent fixture reviewer approves the equivalent assertion and complete proposed inventory.', original: { issueId: issue.id, runId: originalRun.id, sourceHash: source.hash, taskHash: taskIdentity(originalTask), criteriaHash: digest(JSON.stringify(originalTask.acceptance)), planHash: digest(JSON.stringify(checkpoint.plan)) }, equivalence: { changedPaths: [revisionCheck.file], nonTestChanges: [], reason: 'The same current exported value must equal ready in both assertions.' } });
    const proof = (name: string) => bind(join(originalRun.evidencePath, name));
    const patch = `diff --git a/${revisionCheck.file} b/${revisionCheck.file}\n--- a/${revisionCheck.file}\n+++ b/${revisionCheck.file}\n@@ -4 +4 @@\n-${originalTest.trim().split('\n').at(-1)}\n+${replacementTest.trim().split('\n').at(-1)}\n`;
    const patchPath = join(root, 'revision.patch');
    writeFileSync(patchPath, patch);
    const artifact = { schemaVersion: 1, taskId: '', status: 'inactive', purpose: 'Stage an independently reviewed equivalent replacement without altering retained evidence.', original: { issueId: issue.id, requirementId: null, runId: originalRun.id, taskHash: taskIdentity(originalTask), taskFile: proof('task.json'), task: originalTask, plan: proof('plan.json'), checkpoint: proof('checkpoint.json'), checkpointPatch: proof('checkpoint.patch'), baseCommit: checkpoint.baseCommit, baselineTree: checkpoint.baselineTree, environment: checkpoint.environment, sourceHash: checkpoint.sourceHash, ownerAuthorization: proof('owner-authorization.json'), state: proof('state.json'), acceptedChecksFile: proof('accepted-checks.json'), acceptanceReceipt: proof(checkpoint.acceptanceReceipt.evidencePath), checkpointProofs: checkpoint.proofs.map((item: { path: string }) => proof(item.path)) }, revision: { patch: { path: 'docs/revision.patch', hash: digest(patch) }, approvedPatch: bind(patchPath), sourceHash: proposed.hash, originalInventory: inventory(source.files), proposedInventory: inventory(files), files: [{ path: revisionCheck.file, originalHash: digest(originalTest), replacementHash: digest(replacementTest), content: replacementTest }], equivalence: 'Equivalent equality assertion on the same exported field.' }, independentApproval: { ...bind(coveragePath), sourceHash: proposed.hash }, delivery: { target: 'main', status: 'Inactive until native owner adoption.' } };
    writeFileSync(join(repository, 'factory/current-control.ts'), targetControl);
    writeFileSync(join(repository, currentCheck.file), "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {control} from '../factory/current-control.ts';\ntest('current target control is retained',()=>assert.equal(control,'current'));\n");
    commit(repository, 'Current target includes a new control and its meaningful named check');
    const checkout = join(root, 'checkout2');
    git(repository, ['worktree', 'add', '--detach', checkout, 'main']);
    symlinkSync(resolve('node_modules'), join(checkout, 'node_modules'), 'dir');
    const contractRepo = store.work.addRepo({ name: 'Separate contract enrollment', path: checkout, targetBranch: 'main' });
    const contractIssue = create(contractRepo.id, 'acceptance_contract', 'Stage the equivalent accepted-test revision');
    artifact.taskId = `issue-${contractIssue.id}`;
    const rejectedArtifacts = (rejections?.(artifact, coveragePath) ?? []).map((item, index) => ({ ...item, path: `docs/rejected-${index}.json` }));
    const contractAuthority = authorization(contractIssue.id, 'acceptance_contract', ['docs/revision.json', 'docs/revision.patch', ...rejectedArtifacts.map(item => item.path)]);
    const contractAuthorityPath = join(root, 'contract-authorization.json');
    save(contractAuthorityPath, contractAuthority);
    const contractJob = store.work.startIssue(contractIssue.id);
    const contractAgent: Agent = { run: async input => {
      if (input.phase === 'plan') return plan(input, [{ file: 'tests/value.test.ts', title: 'value is ready' }, currentCheck]);
      if (input.phase === 'implement' || input.phase === 'repair') { mkdirSync(join(input.cwd, 'docs'), { recursive: true }); save(join(input.cwd, 'docs/revision.json'), artifact); for (const item of rejectedArtifacts) save(join(input.cwd, item.path), item.artifact); writeFileSync(join(input.cwd, 'docs/revision.patch'), patch); return report(input); }
      return delegate.run(input);
    } };
    assert.equal(await new SerialQueue(store, { evidenceRoot, agent: contractAgent, ownerAuthorizationPath: contractAuthorityPath }).processNext(contractJob.id), true);
    const contractRun = store.work.runs().find(run => run.jobId === contractJob.id)!;
    assert.equal(contractRun.status, 'merged', `Contract fixture must produce real verified native merge evidence: ${contractRun.reason}`);
    const contractState = read(join(contractRun.evidencePath, 'state.json')) as ControllerState;
    assert.equal(contractState.integration?.verification?.status, 'passed');
    assert.equal(contractState.integration?.review?.approved, true);
    git(repository, ['reset', '--hard', 'main']);
    const currentAuthority = authorization(issue.id, 'harness', historicalAuthority.scope);
    assert.notEqual(historicalAuthority.engineSourceHash, currentAuthority.engineSourceHash, 'The historical native run genuinely executes a distinct supervising engine.');
    const supervisor = read(join(originalRun.evidencePath, 'supervisor.json'));
    assert.equal(snapshot(supervisor.directory).hash, historicalAuthority.engineSourceHash, 'Historical engine identity comes from its actual immutable pinned supervisor.');
    assert.equal(read(join(originalRun.evidencePath, 'run-state.json')).engine.sourceHash, historicalAuthority.engineSourceHash);
    assert.equal(digest(readFileSync(join(supervisor.directory, 'factory/runner.ts'))), digest(readFileSync(historicalRunner)), 'The distinct historical runner is really pinned and executed.');
    const currentAuthorityPath = join(root, 'current-authorization.json');
    save(currentAuthorityPath, currentAuthority);
    const artifactPath = join(repository, 'docs/revision.json');
    const redemption = { schemaVersion: 1, artifact: bind(artifactPath), contractRunId: contractRun.id, transition: { originalAuthorization: proof('owner-authorization.json'), currentAuthorization: bind(currentAuthorityPath), runtime: { node: process.version, platform: process.platform, arch: process.arch } } };
    const acceptedRevisionPath = join(root, 'accepted-revision.json');
    save(acceptedRevisionPath, redemption);
    const request = { schemaVersion: 1, requestId: randomUUID(), databasePath: store.path, issueId: issue.id, additionalAttempts: 1, additionalTimeMs: 60000, reason: 'Adopt only this approved revision using native cumulative continuation.', ownerAuthorizationPath: currentAuthorityPath, acceptedRevisionPath };
    const ledgerPath = join(evidenceRoot, 'budgets', `${digest(`repo-${repo.id}:issue-${issue.id}`)}.json`);
    const historical = [proof('checkpoint.json'), proof('checkpoint.patch'), proof('task.json'), proof('plan.json'), proof('state.json'), proof('accepted-checks.json'), proof('owner-authorization.json'), proof('supervisor.json'), ...snapshot(supervisor.directory).files.map(file => ({ path: join(supervisor.directory, file.path), hash: file.hash })), ...artifact.original.checkpointProofs];
    return { root, repository, store, repo, issue, originalRun, originalTask, checkpoint, artifact, coveragePath, redemption, request, ledgerPath, evidenceRoot, currentAuthority, currentAuthorityPath, contractRepo, contractRun, historicalAuthority, historical, rejectedArtifacts, save };
  } catch (error) { store.close(); throw error; }
}

type RevisionFixture = Awaited<ReturnType<typeof revisionFixture>>;
type RevisionArtifact = RevisionFixture['artifact'];
function durable(fixture: RevisionFixture) {
  return { ledger: readFileSync(fixture.ledgerPath, 'utf8'), jobs: fixture.store.work.jobs(), runs: fixture.store.work.runs(), issue: fixture.store.get(fixture.issue.id), journal: existsSync(join(fixture.evidenceRoot, 'owner-resumes', fixture.request.requestId)) };
}
function assertHistorical(fixture: RevisionFixture) {
  for (const file of fixture.historical) assert.equal(digest(readFileSync(file.path)), file.hash, `Historical evidence remains immutable: ${file.path}`);
}
function writeRedemption(fixture: RevisionFixture, redemption = fixture.redemption) {
  fixture.save(fixture.request.acceptedRevisionPath, redemption);
}
function assertPrepared(input: AgentInput, fixture: RevisionFixture) {
  assert.equal(readFileSync(join(input.cwd, revisionCheck.file), 'utf8'), replacementTest, 'Only the independently approved replacement is reconstructed.');
  assert.equal(readFileSync(join(input.cwd, 'factory/value.ts'), 'utf8'), retainedDraft, 'The original scoped implementation draft survives current-target preparation.');
  assert.equal(readFileSync(join(input.cwd, 'factory/current-control.ts'), 'utf8'), targetControl, 'Current target controls outside original implementation authority survive historical reconstruction.');
  assert.equal(digest(readFileSync(join(input.cwd, currentCheck.file))), digest(readFileSync(join(fixture.repository, currentCheck.file))), 'New current-target checks survive in the actual candidate.');
  assert.equal(existsSync(join(input.cwd, 'docs/revision.json')), true, 'The separately integrated contract artifact survives reconstruction.');
}
function assertNoJournal(fixture: RevisionFixture) {
  assert.equal(existsSync(join(dirname(fixture.ledgerPath), '..', 'owner-resumes', fixture.request.requestId)), false, 'Invalid admission creates no owner decision journal.');
}

async function validPreview(fixture: RevisionFixture) {
  const before = durable(fixture);
  let status: string | undefined;
  let failure: unknown;
  try { status = (await ownerResume(fixture.request, { validateOnly: true })).status; } catch (error) { failure = error; }
  assert.deepEqual(durable(fixture), before, 'Source-bound revision preview must be read-only.');
  assert.equal(status, 'valid', `A real merged same-repository contract revision must be admitted by owner-resume: ${String(failure)}`);
  assertNoJournal(fixture);
}

async function rejectsWithoutWrites(fixture: RevisionFixture, name: string) {
  const before = durable(fixture);
  let calls = 0;
  for (const validateOnly of [true, false]) {
    await assert.rejects(ownerResume(fixture.request, { validateOnly, agent: { run: async () => { calls += 1; throw new Error('Unexpected role invocation.'); } } }), `${name}: invalid revision must be rejected.`);
    assert.equal(calls, 0, `${name}: rejected admission invokes no role.`);
    assert.deepEqual(durable(fixture), before, `${name}: rejection cannot write a grant, job, run, issue or journal.`);
    assertNoJournal(fixture);
  }
}

test('approved test revision admission rejects unmerged mismatched and unsupported evidence before durable writes', { timeout: 120000 }, async () => {
  const cases: [string, (artifact: RevisionArtifact, coveragePath: string) => void][] = [
    ['stale original task', artifact => { artifact.original.taskHash = '0'.repeat(64); }],
    ['wrong retained source', artifact => { artifact.original.sourceHash = '0'.repeat(64); }],
    ['wrong accepted old hash', artifact => { artifact.revision.files[0].originalHash = '0'.repeat(64); }],
    ['unapproved replacement bytes', artifact => {
      const replacement = artifact.revision.files[0];
      replacement.content += '\n';
      replacement.replacementHash = digest(replacement.content);
    }],
    ['explicitly rejected equivalence', (artifact, coveragePath) => {
      const rejected = join(dirname(coveragePath), 'rejected-equivalence.json');
      save(rejected, { ...read(coveragePath), approved: false, findings: ['Equivalence rejected.'] });
      artifact.independentApproval = { ...bind(rejected), sourceHash: artifact.revision.sourceHash };
    }],
    ['production replacement', artifact => { artifact.revision.files[0].path = 'factory/value.ts'; }],
  ];
  const fixture = await revisionFixture((artifact, coveragePath) => cases.map(([name, revise]) => {
    const invalid = structuredClone(artifact) as RevisionArtifact;
    revise(invalid, coveragePath);
    return { name, artifact: invalid };
  }));
  try {
    await validPreview(fixture);
    const artifact = fixture.artifact;
    for (const path of [artifact.original.checkpoint.path, artifact.original.acceptedChecksFile.path, fixture.coveragePath]) {
      const retained = readFileSync(path, 'utf8');
      try {
        writeFileSync(path, `${retained}\n`);
        await rejectsWithoutWrites(fixture, `changed bound evidence ${path}`);
      } finally { writeFileSync(path, retained); }
    }
    writeRedemption(fixture, { ...fixture.redemption, contractRunId: fixture.originalRun.id });
    await rejectsWithoutWrites(fixture, 'a blocked harness run is not merged contract authority');
    writeRedemption(fixture);
    assertHistorical(fixture);
    for (const item of fixture.rejectedArtifacts) {
      const path = join(fixture.repository, item.path);
      const integration = read(join(fixture.contractRun.evidencePath, 'state.json')).integration;
      assert.equal(git(fixture.repository, ['show', `${integration.commit}:${item.path}`]), readFileSync(path, 'utf8'), `${item.name}: invalid content must have actual native merged provenance.`);
      writeRedemption(fixture, { ...fixture.redemption, artifact: bind(path) });
      await rejectsWithoutWrites(fixture, item.name);
      assertHistorical(fixture);
    }
  } finally { fixture.store.close(); }
});

test('approved test revision authority preserves original scope and runtime and requires the same Git repository and integration branch', { timeout: 120000 }, async () => {
  const fixture = await revisionFixture();
  try {
    await validPreview(fixture);
    assert.notEqual(fixture.repo.id, fixture.contractRepo.id, 'The positive fixture exercises separately enrolled checkout2.');
    assert.equal(git(fixture.repository, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), git(fixture.contractRepo.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
    for (const patch of [
      { issueId: fixture.issue.id + 100 }, { profile: 'acceptance_contract' }, { scope: ['factory/value.ts', 'factory/current-control.ts'] },
      { engineSourceHash: '0'.repeat(64) }, { baseCommit: fixture.checkpoint.baseCommit },
    ]) {
      fixture.save(fixture.currentAuthorityPath, { ...fixture.currentAuthority, ...patch, requestId: randomUUID() });
      writeRedemption(fixture, { ...fixture.redemption, transition: { ...fixture.redemption.transition, currentAuthorization: bind(fixture.currentAuthorityPath) } });
      await rejectsWithoutWrites(fixture, `explicit current authority mismatch ${Object.keys(patch).join(',')}`);
    }
    fixture.save(fixture.currentAuthorityPath, fixture.currentAuthority);
    writeRedemption(fixture, { ...fixture.redemption, transition: { ...fixture.redemption.transition, runtime: { ...fixture.redemption.transition.runtime, node: 'v0.0.0' } } });
    await rejectsWithoutWrites(fixture, 'unreviewed runtime transition');
    writeRedemption(fixture, { ...fixture.redemption, transition: { ...fixture.redemption.transition, originalAuthorization: { ...fixture.redemption.transition.originalAuthorization, hash: '0'.repeat(64) } } });
    await rejectsWithoutWrites(fixture, 'historical authority substitution');
    writeRedemption(fixture);
    const database = new DatabaseSync(fixture.store.path);
    const other = join(fixture.root, 'unrelated');
    git(fixture.repository, ['clone', '--quiet', fixture.repository, other]);
    const row = database.prepare('SELECT * FROM repos WHERE id = ?').get(fixture.contractRepo.id);
    assert.ok(row, 'The actual contract enrollment must exist.');
    database.prepare('UPDATE repos SET path = ? WHERE id = ?').run(other, fixture.contractRepo.id);
    await rejectsWithoutWrites(fixture, 'same commit in another Git common directory');
    database.prepare('UPDATE repos SET path = ? WHERE id = ?').run(fixture.contractRepo.path, fixture.contractRepo.id);
    git(fixture.repository, ['branch', 'other-target', 'main']);
    database.prepare('UPDATE repos SET target_branch = ? WHERE id = ?').run('other-target', fixture.contractRepo.id);
    await rejectsWithoutWrites(fixture, 'another integration branch at the same commit');
    database.prepare('UPDATE repos SET target_branch = ? WHERE id = ?').run('main', fixture.contractRepo.id);
    database.close();
    assertHistorical(fixture);
  } finally { fixture.store.close(); }
});

test('approved test revision from a separately enrolled checkout preserves current target controls and reapproves retained work before native integration', { timeout: 120000 }, async () => {
  const fixture = await revisionFixture();
  try {
    await validPreview(fixture);
    const before = read(fixture.ledgerPath);
    assert.notEqual(fixture.historicalAuthority.engineSourceHash, fixture.currentAuthority.engineSourceHash);
    assert.notEqual(fixture.historicalAuthority.baseCommit, fixture.currentAuthority.baseCommit, 'The explicit transition binds the newly integrated target base.');
    assert.equal(fixture.redemption.transition.runtime.node, process.version);
    assert.equal(fixture.redemption.transition.runtime.platform, process.platform);
    assert.equal(fixture.redemption.transition.runtime.arch, process.arch);
    for (const field of ['issueId', 'issueHash', 'profile', 'scope', 'contractHash'] as const) assert.deepEqual(fixture.currentAuthority[field], fixture.historicalAuthority[field], `Reviewed engine/base transition preserves original ${field}.`);
    const sibling = fixture.store.create({ title: 'Untouched sibling', description: 'Do not execute this work.', status: 'open', priority: 'medium', labels: [], work: { repoId: fixture.repo.id, requirementId: null, dependsOn: [], acceptance: ['Remain queued.'] } });
    const siblingJob = fixture.store.work.startIssue(sibling.id);
    const phases: string[] = [];
    const delegate = fixtureAgent();
    let approvedSource: string | undefined;
    let approvedInventory: { path: string; hash: string }[] = [];
    const agent: Agent = { run: async input => {
      phases.push(input.phase);
      assert.equal(input.task.id, `issue-${fixture.issue.id}`, 'Only the selected original issue invokes roles.');
      assert.equal(taskIdentity(input.task), taskIdentity(fixture.originalTask), 'Original goal, criteria, scope and limits remain canonical.');
      assert.deepEqual(input.authority, fixture.currentAuthority, 'Explicit current authority preserves the original issue, profile and protected scope.');
      assert.ok(!['plan', 'tests'].includes(input.phase), 'Revision adoption preserves the old plan and does not reauthor accepted checks.');
      if (input.phase === 'acceptance-review') {
        assertPrepared(input, fixture);
        const feedback = JSON.parse(input.feedback);
        const proof = feedback.redChecks.find((check: { file: string; title: string }) => check.file === revisionCheck.file && check.title === revisionCheck.title);
        assert.ok(proof, 'Fresh coverage receives the exact retained named check identity.');
        assert.equal(inspectNamedNodeReport(proof.reportPath, revisionCheck, input.cwd, 'failed'), 'expected_failure', 'Revised checks have a fresh actual missing-behavior assertion before independent coverage.');
        const candidate = snapshot(input.cwd);
        approvedSource = candidate.hash;
        approvedInventory = candidate.files.filter(file => /^(tests|acceptance)\//.test(file.path));
        assert.deepEqual(feedback.acceptedChecks, approvedInventory, 'Coverage approves the actual complete current-plus-retained inventory.');
        assert.ok(approvedInventory.some(file => file.path === currentCheck.file), 'New current-target checks belong to the fresh inventory.');
      }
      if (input.phase === 'implement' || input.phase === 'repair') {
        assert.ok(approvedSource, 'Independent fresh approval must precede implementation or repair.');
        assertPrepared(input, fixture);
        writeFileSync(join(input.cwd, 'factory/value.ts'), "export const value = 'ready';\n");
        return report(input);
      }
      return delegate.run(input);
    } };
    const result = await ownerResume(fixture.request, { agent });
    assert.equal(result.status, 'merged', result.reason ?? 'Native revision continuation must integrate.');
    const run = fixture.store.work.run(result.runId!)!;
    const state = read(join(run.evidencePath, 'state.json')) as ControllerState;
    assert.equal(state.resume?.fromRunId, fixture.originalRun.id);
    assert.equal(state.resume?.reused, true);
    assert.deepEqual(state.plan, fixture.checkpoint.plan);
    assert.equal(phases.filter(phase => phase === 'acceptance-review').length, 1, 'One successful fresh approval consumes one acceptance attempt.');
    assert.ok(phases.some(phase => phase === 'implement' || phase === 'repair'));
    assert.ok(phases.includes('review'));
    const receipt = state.reviewReceipts?.find(receipt => receipt.purpose === 'acceptance-coverage' && !receipt.reusedFromRunId);
    assert.ok(receipt?.approved, 'The existing independent acceptance stage produces a new receipt.');
    assert.equal(receipt.sourceHash, approvedSource);
    assert.ok(receipt.evidencePath.startsWith('review-receipt-'));
    const accepted = read(join(run.evidencePath, 'accepted-checks.json')) as { path: string; hash: string }[];
    assert.deepEqual(accepted.filter(file => /^(tests|acceptance)\//.test(file.path)).sort((a, b) => a.path.localeCompare(b.path)), [...approvedInventory].sort((a, b) => a.path.localeCompare(b.path)), 'The actual reviewed complete inventory is frozen.');
    const progress = read(join(run.evidencePath, 'run-state.json'));
    assert.deepEqual(progress.engine, { sourceHash: fixture.currentAuthority.engineSourceHash, contractHash: fixture.currentAuthority.contractHash }, 'The continuation executes the explicitly authorized current engine while preserving historical authority.');
    const verification = read(resolve(run.evidencePath, progress.proofs.verification.path));
    assert.equal(verification.status, 'passed');
    inspectNodeReport(join(verification.runDirectory, 'node-results.jsonl'), [revisionCheck, currentCheck]);
    assert.ok(verification.runDirectory.startsWith(`${run.evidencePath}/`), 'Final integrated verification is fresh inside this run.');
    assert.deepEqual(verification.checks.map((gate: { name: string; status: string }) => [gate.name, gate.status]), [['lint', 'passed'], ['typecheck', 'passed'], ['test', 'passed'], ['build', 'passed']]);
    assert.equal(state.integration?.verification?.snapshot.hash, progress.sourceHash);
    assert.equal(state.integration?.review?.approved, true);
    assert.equal(state.integration?.commit, git(fixture.repository, ['rev-parse', 'main']).trim());
    assert.equal(readFileSync(join(fixture.repository, revisionCheck.file), 'utf8'), replacementTest);
    assert.equal(fixture.store.get(fixture.issue.id)?.status, 'done');
    assert.equal(fixture.store.work.run(fixture.originalRun.id)?.status, 'blocked');
    assert.equal(fixture.store.work.jobs().find(job => job.id === siblingJob.id)?.status, 'queued');
    const after = read(fixture.ledgerPath);
    assert.equal(after.implementationAttempts, before.implementationAttempts + 1);
    assert.equal(after.acceptanceAttempts, before.acceptanceAttempts + 1, 'Revision reapproval consumes the original cumulative acceptance counter.');
    assert.ok(after.usedMs >= before.usedMs);
    assert.equal(after.taskHash, before.taskHash);
    assert.equal(after.ownerGrants.filter((grant: { requestId: string }) => grant.requestId === fixture.request.requestId).length, 1);
    assertHistorical(fixture);
    const settled = { durable: durable(fixture), calls: [...phases] };
    assert.deepEqual(await ownerResume(fixture.request, { agent }), result);
    assert.deepEqual({ durable: durable(fixture), calls: phases }, settled, 'Exact replay neither grants, enqueues nor invokes roles.');
    const redemptionText = readFileSync(fixture.request.acceptedRevisionPath, 'utf8');
    writeFileSync(fixture.request.acceptedRevisionPath, `${redemptionText}\n`);
    await assert.rejects(ownerResume(fixture.request, { agent }), 'Even completed replay must reject changed bound revision evidence.');
    assert.deepEqual({ durable: durable(fixture), calls: phases }, settled);
  } finally { fixture.store.close(); }
});

test('interrupted test revision reapproval preserves original evidence and cumulative usage while exact replay executes no work', { timeout: 120000 }, async () => {
  const fixture = await revisionFixture();
  try {
    await validPreview(fixture);
    const before = read(fixture.ledgerPath);
    fixture.save(fixture.ledgerPath, { ...before, acceptanceAttempts: fixture.originalTask.budget.maxAttempts });
    const exhaustedRequest = { ...fixture.request, requestId: randomUUID(), additionalAttempts: 0, additionalTimeMs: 1000 };
    const exhausted = durable(fixture);
    for (const validateOnly of [true, false]) {
      await assert.rejects(ownerResume(exhaustedRequest, { validateOnly, agent: { run: async () => assert.fail('Exhausted acceptance must invoke no role.') } }), /acceptance|budget|exhaust/i, 'A valid approved revision still requires original cumulative acceptance capacity.');
      assert.deepEqual(durable(fixture), exhausted, 'A time-only request cannot grant, enqueue or reset exhausted acceptance.');
      assert.equal(existsSync(join(fixture.evidenceRoot, 'owner-resumes', exhaustedRequest.requestId)), false, 'Exhausted revision admission creates no decision journal.');
    }
    fixture.save(fixture.ledgerPath, before);
    const delegate = fixtureAgent();
    const phases: string[] = [];
    const interrupted: Agent = { run: async input => {
      phases.push(input.phase);
      if (input.phase === 'acceptance-review') { assertPrepared(input, fixture); throw new Error('Intentional settled interruption before independent revision approval.'); }
      assert.ok(!['implement', 'repair', 'review'].includes(input.phase), 'An unapproved revision cannot reach implementation or source review.');
      return delegate.run(input);
    } };
    const result = await ownerResume(fixture.request, { agent: interrupted });
    assert.equal(result.status, 'blocked');
    assert.deepEqual(phases, ['acceptance-review']);
    const after = read(fixture.ledgerPath);
    assert.equal(after.acceptanceAttempts, before.acceptanceAttempts + 1, 'Interrupted approval still spends the original acceptance attempt.');
    assert.equal(after.implementationAttempts, before.implementationAttempts);
    const run = fixture.store.work.run(result.runId!)!;
    const checkpoint = read(join(run.evidencePath, 'checkpoint.json'));
    assert.equal(checkpoint.accepted, false, 'An interrupted reviewer must not manufacture a frozen accepted replacement.');
    assertHistorical(fixture);
    const settled = durable(fixture);
    assert.deepEqual(await ownerResume(fixture.request, { agent: interrupted }), result);
    assert.deepEqual(durable(fixture), settled);
    assert.deepEqual(phases, ['acceptance-review'], 'Interrupted exact replay does not restart blocked work.');
    writeRedemption(fixture, { ...fixture.redemption, artifact: { ...fixture.redemption.artifact, hash: '0'.repeat(64) } });
    await assert.rejects(ownerResume(fixture.request, { agent: interrupted }), 'Interruption retains exact revision evidence bindings.');
    assert.deepEqual(durable(fixture), settled);
    writeRedemption(fixture);
  } finally { fixture.store.close(); }
});
