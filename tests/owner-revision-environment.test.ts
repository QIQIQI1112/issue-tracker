import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { SerialQueue } from '../factory/queue.ts';
import { ownerResume } from '../factory/owner-recovery.ts';
import { digest, environmentIdentity, taskIdentity } from '../factory/checkpoint.ts';
import { inspectNamedNodeReport, snapshot } from '../factory/evidence.ts';
import { maintenanceIdentity } from '../factory/maintenance.ts';
import type { Agent, AgentInput, ControllerState } from '../factory/controller.ts';
import type { OwnerAuthorization } from '../factory/profiles.ts';
import { runProcess } from '../factory/process.ts';
import { git, processEnvironment } from '../factory/workspace.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('approved test revision preview accepts the original enrolled checkout behind its integration target and rejects unknown historical contexts before durable writes', { timeout: 120000 }, async () => {
  const root = evidenceDirectory('owner-revision-environment');
  const repository = fixtureRepository(join(root, 'repo'));
  const target = 'requirement-integration';
  const check = { file: 'tests/revision.test.ts', title: 'retained value is ready' };
  const originalTest = "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../factory/value.ts';\ntest('retained value is ready',()=>assert.equal(value,'ready'));\n";
  const replacementTest = originalTest.replace("assert.equal(value,'ready')", "assert.deepEqual({value},{value:'ready'})");
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const bind = (path: string) => ({ path, hash: digest(readFileSync(path)) });
  const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
  const commit = (directory: string, message: string) => {
    git(directory, ['add', '.']);
    git(directory, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', message]);
  };
  const report = (input: AgentInput) => ({ schemaVersion: 1, taskId: input.task.id, summary: 'Prepared the bounded historical-environment fixture.', blockers: [] });
  const plan = (input: AgentInput, checks: { file: string; title: string }[]) => ({ schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'extend', reason: 'Observe the actual exported value through a named Node assertion.' }, assumptions: [], slices: [{ id: 'ready', goal: input.task.goal, acceptanceIds: input.task.acceptance.map(item => item.id), checks }], browserChecks: [] });
  writeFileSync(join(repository, 'src/value.ts'), "export const value = 'ready';\n");
  writeFileSync(join(repository, 'factory/value.ts'), "export const value = 'broken';\n");
  writeFileSync(join(repository, 'factory/execution-policy.json'), JSON.stringify({ schemaVersion: 1, mode: 'adaptive-v2' }));
  mkdirSync(join(repository, 'docs'));
  commit(repository, 'Prepare genuinely green main with missing maintenance behavior');
  const baselineReport = join(root, 'main-baseline.jsonl');
  const baseline = await runProcess({ command: process.execPath, args: ['--test', `--test-reporter=${resolve('factory/node-reporter.mjs')}`, `--test-reporter-destination=${baselineReport}`, 'tests/value.test.ts'], cwd: repository, env: processEnvironment({}), logPath: join(root, 'main-baseline.log'), timeoutMs: 15000 });
  assert.equal(baseline.settled, true, 'Fixture main baseline must settle before native maintenance.');
  assert.equal(baseline.status, 'passed', `Fixture main must genuinely pass before native maintenance: ${baseline.output}`);
  assert.equal(inspectNamedNodeReport(baselineReport, { file: 'tests/value.test.ts', title: 'value is ready' }, repository, 'passed'), 'already_passed');
  const mainCommit = git(repository, ['rev-parse', 'HEAD']).trim();
  const mainInstructions = readFileSync(join(repository, 'AGENTS.md'), 'utf8');
  git(repository, ['checkout', '-qb', target]);
  writeFileSync(join(repository, 'AGENTS.md'), `${mainInstructions}Preserve the integration target controls.\n`);
  commit(repository, 'Advance integration controls before the original interrupted run');
  const originalBase = git(repository, ['rev-parse', 'HEAD']).trim();
  git(repository, ['checkout', '-q', 'main']);
  const checkout = join(root, 'contract-checkout');
  git(repository, ['worktree', 'add', '--detach', checkout, target]);
  symlinkSync(resolve('node_modules'), join(checkout, 'node_modules'), 'dir');
  assert.notEqual(mainCommit, originalBase, 'The integration target must already be ahead before original execution.');
  git(repository, ['merge-base', '--is-ancestor', mainCommit, originalBase]);
  assert.equal(git(repository, ['status', '--porcelain']).trim(), '', 'The original enrolled main checkout must be clean.');
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Enrolled main behind integration', path: repository, targetBranch: target });
    const create = (repoId: number, changeKind: 'harness' | 'acceptance_contract', title: string) => store.create({ title, description: title, status: 'open', priority: 'medium', labels: [], work: { repoId, requirementId: null, dependsOn: [], acceptance: ['The retained value is ready with unchanged native controls.'], changeKind } });
    const issue = create(repo.id, 'harness', 'Return the retained value');
    const authorization = (issueId: number, profile: OwnerAuthorization['profile'], scope: string[]): OwnerAuthorization => ({ schemaVersion: 1, requestId: randomUUID(), issueId, issueHash: maintenanceIdentity(store.get(issueId)!), profile, scope, authorization: 'The owner authorizes this bounded disposable maintenance under existing gates.', engineSourceHash: snapshot(resolve('.')).hash, contractHash: digest(readFileSync(resolve('factory/verification-contract.json'))), baseCommit: git(repository, ['rev-parse', target]).trim() });
    const originalAuthority = authorization(issue.id, 'harness', ['factory/value.ts']);
    const originalAuthorityPath = join(root, 'original-authorization.json');
    save(originalAuthorityPath, originalAuthority);
    const delegate = fixtureAgent();
    let retainedSource: ReturnType<typeof snapshot> | undefined;
    const initial: Agent = { run: async input => {
      if (input.phase === 'plan') return plan(input, [check]);
      if (input.phase === 'tests') { writeFileSync(join(input.cwd, check.file), originalTest); return report(input); }
      if (input.phase === 'implement' || input.phase === 'repair') {
        writeFileSync(join(input.cwd, 'factory/value.ts'), "export const value = 'draft';\n");
        retainedSource = snapshot(input.cwd);
        throw new Error('Intentional settled interruption after accepted coverage.');
      }
      return delegate.run(input);
    } };
    const evidenceRoot = join(root, 'evidence');
    const originalJob = store.work.startIssue(issue.id);
    assert.equal(await new SerialQueue(store, { evidenceRoot, agent: initial, ownerAuthorizationPath: originalAuthorityPath }).processNext(originalJob.id), true);
    const originalRun = store.work.runs().find(run => run.jobId === originalJob.id)!;
    assert.equal(originalRun.status, 'blocked');
    assert.equal(existsSync(join(originalRun.evidencePath, 'checkpoint.json')), true, `Fixture must reach accepted coverage rather than fail setup: ${originalRun.reason}`);
    const proof = (name: string) => bind(join(originalRun.evidencePath, name));
    const checkpoint = read(proof('checkpoint.json').path);
    const originalTask = read(proof('task.json').path);
    const supervisor = read(proof('supervisor.json').path);
    assert.equal(checkpoint.accepted, true, 'The original interruption must retain accepted coverage.');
    assert.ok(retainedSource, 'Capture the interrupted candidate before native worktree cleanup.');
    assert.equal(retainedSource.hash, checkpoint.sourceHash);
    assert.equal(checkpoint.baseCommit, originalBase, 'The original run must use the already advanced integration baseline.');
    assert.equal(git(repository, ['rev-parse', 'HEAD']).trim(), mainCommit, 'Enrolled main must remain behind during the original run.');
    assert.equal(snapshot(supervisor.directory).hash, originalAuthority.engineSourceHash, 'Use the actual pinned historical supervisor.');
    assert.equal(checkpoint.environment, environmentIdentity(repository, supervisor.directory), 'Original environment must match the actual enrolled checkout under the pinned supervisor.');
    assert.notEqual(checkpoint.environment, environmentIdentity(checkout, supervisor.directory), 'The original integration baseline must have a different exact control context.');
    const historical = snapshot(originalRun.evidencePath);
    const files = retainedSource.files.map(file => file.path === check.file ? { path: file.path, hash: digest(replacementTest) } : file);
    const proposed = { hash: digest(JSON.stringify(files)), files };
    const inventory = (entries: { path: string; hash: string }[]) => entries.filter(file => /^(tests|acceptance)\//.test(file.path));
    const coveragePath = join(root, 'equivalence-coverage.json');
    save(coveragePath, { approved: true, findings: [], sourceHash: proposed.hash, snapshot: proposed, acceptedChecks: inventory(files), checks: [check], browserChecks: [], summary: 'Independent fixture reviewer approves equivalent equality on the same exported field.', original: { issueId: issue.id, runId: originalRun.id, sourceHash: retainedSource.hash, taskHash: taskIdentity(originalTask), criteriaHash: digest(JSON.stringify(originalTask.acceptance)), planHash: digest(JSON.stringify(checkpoint.plan)) }, equivalence: { changedPaths: [check.file], nonTestChanges: [], reason: 'Both assertions require the same actual exported value to equal ready.' } });
    const patch = `diff --git a/${check.file} b/${check.file}\n--- a/${check.file}\n+++ b/${check.file}\n@@ -4 +4 @@\n-${originalTest.trim().split('\n').at(-1)}\n+${replacementTest.trim().split('\n').at(-1)}\n`;
    const patchPath = join(root, 'revision.patch');
    writeFileSync(patchPath, patch);
    const contractRepo = store.work.addRepo({ name: 'Same Git repository and integration target', path: checkout, targetBranch: target });
    const contractIssue = create(contractRepo.id, 'acceptance_contract', 'Stage the equivalent accepted-test revision');
    const artifact = { schemaVersion: 1, taskId: `issue-${contractIssue.id}`, status: 'inactive', purpose: 'Stage the independently reviewed equivalent assertion without changing historical evidence.', original: { issueId: issue.id, requirementId: null, runId: originalRun.id, taskHash: taskIdentity(originalTask), taskFile: proof('task.json'), task: originalTask, plan: proof('plan.json'), checkpoint: proof('checkpoint.json'), checkpointPatch: proof('checkpoint.patch'), baseCommit: checkpoint.baseCommit, baselineTree: checkpoint.baselineTree, environment: checkpoint.environment, sourceHash: checkpoint.sourceHash, ownerAuthorization: proof('owner-authorization.json'), state: proof('state.json'), acceptedChecksFile: proof('accepted-checks.json'), acceptanceReceipt: proof(checkpoint.acceptanceReceipt.evidencePath), checkpointProofs: checkpoint.proofs.map((item: { path: string }) => proof(item.path)) }, revision: { patch: { path: 'docs/revision.patch', hash: digest(patch) }, approvedPatch: bind(patchPath), sourceHash: proposed.hash, originalInventory: inventory(retainedSource.files), proposedInventory: inventory(files), files: [{ path: check.file, originalHash: digest(originalTest), replacementHash: digest(replacementTest), content: replacementTest }], equivalence: 'Equivalent equality on the same exported field.' }, independentApproval: { ...bind(coveragePath), sourceHash: proposed.hash }, delivery: { target, status: 'Inactive until native owner adoption.' } };
    const contractAuthorityPath = join(root, 'contract-authorization.json');
    save(contractAuthorityPath, authorization(contractIssue.id, 'acceptance_contract', ['docs/revision.json', 'docs/revision.patch']));
    const contractJob = store.work.startIssue(contractIssue.id);
    const contractAgent: Agent = { run: async input => {
      if (input.phase === 'plan') return plan(input, [{ file: 'tests/value.test.ts', title: 'value is ready' }]);
      if (input.phase === 'implement' || input.phase === 'repair') {
        mkdirSync(join(input.cwd, 'docs'), { recursive: true });
        save(join(input.cwd, 'docs/revision.json'), artifact);
        writeFileSync(join(input.cwd, 'docs/revision.patch'), patch);
        return report(input);
      }
      return delegate.run(input);
    } };
    assert.equal(await new SerialQueue(store, { evidenceRoot, agent: contractAgent, ownerAuthorizationPath: contractAuthorityPath }).processNext(contractJob.id), true);
    const contractRun = store.work.runs().find(run => run.jobId === contractJob.id)!;
    assert.equal(contractRun.status, 'merged', `Contract staging must produce a real native verified merge: ${contractRun.reason}`);
    const contractState = read(join(contractRun.evidencePath, 'state.json')) as ControllerState;
    assert.equal(contractState.integration?.branch, target);
    assert.equal(contractState.integration?.verification?.status, 'passed');
    assert.equal(contractState.integration?.review?.approved, true);
    git(checkout, ['reset', '--hard', target]);
    assert.equal(git(repository, ['rev-parse', 'HEAD']).trim(), mainCommit, 'Contract staging must leave the original enrolled context intact.');
    const currentAuthorityPath = join(root, 'current-authorization.json');
    save(currentAuthorityPath, authorization(issue.id, 'harness', originalAuthority.scope));
    const acceptedRevisionPath = join(root, 'accepted-revision.json');
    save(acceptedRevisionPath, { schemaVersion: 1, artifact: bind(join(checkout, 'docs/revision.json')), contractRunId: contractRun.id, transition: { originalAuthorization: proof('owner-authorization.json'), currentAuthorization: bind(currentAuthorityPath), runtime: { node: process.version, platform: process.platform, arch: process.arch } } });
    const request = { schemaVersion: 1, requestId: randomUUID(), databasePath: store.path, issueId: issue.id, additionalAttempts: 1, additionalTimeMs: 60000, reason: 'Preview the bounded approved revision without changing cumulative usage.', ownerAuthorizationPath: currentAuthorityPath, acceptedRevisionPath };
    const ledgerPath = join(evidenceRoot, 'budgets', `${digest(`repo-${repo.id}:issue-${issue.id}`)}.json`);
    const durable = () => ({ ledger: readFileSync(ledgerPath, 'utf8'), jobs: store.work.jobs(), runs: store.work.runs(), issue: store.get(issue.id), journal: existsSync(join(evidenceRoot, 'owner-resumes', request.requestId)) });
    const before = durable();
    assert.equal(before.journal, false, 'The preview decision must have no existing journal.');
    let status: string | undefined;
    let failure: unknown;
    try { status = (await ownerResume(request, { validateOnly: true })).status; } catch (error) { failure = error; }
    assert.deepEqual(durable(), before, 'Exact historical enrolled-context preview cannot write a journal, grant, job, run or issue.');
    writeFileSync(join(repository, 'AGENTS.md'), `${mainInstructions}Require exact historical environment identity.\n`);
    commit(repository, 'Create a clean enrolled context matching neither historical identity');
    assert.equal(git(repository, ['status', '--porcelain']).trim(), '', 'Unknown-context rejection must exercise clean checkout admission.');
    assert.notEqual(environmentIdentity(repository, supervisor.directory), checkpoint.environment, 'The changed clean enrolled context cannot explain the stored historical environment.');
    assert.equal(git(repository, ['rev-parse', target]).trim(), contractState.integration?.commit, 'Changing enrolled main must not change the integration target or current authority.');
    for (const validateOnly of [true, false]) {
      await assert.rejects(ownerResume(request, { validateOnly, agent: { run: async () => assert.fail('Unknown historical context must invoke no role.') } }), /historical environment mismatch/, 'An environment matching neither exact context must be rejected.');
      assert.deepEqual(durable(), before, 'Unknown historical context cannot write a journal, grant, job, run or issue.');
    }
    assert.deepEqual(snapshot(originalRun.evidencePath), historical, 'Preview and rejection must preserve every retained historical source and evidence byte.');
    assert.equal(status, 'valid', `Native preview must accept the exact original enrolled checkout behind its integration target: ${String(failure)}`);
  } finally { store.close(); }
});
