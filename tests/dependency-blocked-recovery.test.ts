import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IssueStore } from '../src/storage.ts';
import { parseCreateIssue } from '../src/domain.ts';
import type { Assignment } from '../src/workflow.ts';
import { SerialQueue, issueTask } from '../factory/queue.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

function create(store: IssueStore, repoId: number, title: string, dependsOn: number[] = [], requirementId: number | null = null, changeKind?: Assignment['changeKind']) {
  return store.create({ ...parseCreateIssue({ title, description: `Deliver ${title}.` }), work: { repoId, requirementId, dependsOn, acceptance: [`${title} is ready.`], ...(changeKind ? { changeKind } : {}) } });
}

function runIssue(store: IssueStore, issueId: number, status: 'blocked' | 'merged') {
  const job = store.work.startIssue(issueId);
  const claimed = store.work.claim('/disposable/recovery-evidence', job.id);
  assert.equal(claimed?.job.issueId, issueId, 'Fixture setup must claim the actual prerequisite through normal admission.');
  store.work.finish(claimed!.run.id, status, status === 'blocked' ? 'Prerequisite implementation failed.' : null);
}

const snapshot = (store: IssueStore) => ({ issues: store.list(), jobs: store.work.jobs(), runs: store.work.runs(), requirements: store.work.requirements() });
const jobsFor = (store: IssueStore, id: number) => store.work.jobs().filter(job => job.issueId === id);

test('recovered prerequisites release a never-run cascade-blocked feature exactly once without restarting its requirement', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Recovery', path: '/disposable/recovery', targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Recovery goal', goal: 'Deliver both original behaviors.' });
    const first = create(store, repo.id, 'Prerequisite', [], requirement.id);
    const dependent = create(store, repo.id, 'Dependent', [first.id], requirement.id);
    store.work.startIssue(dependent.id);
    runIssue(store, first.id, 'blocked');
    const historical = jobsFor(store, dependent.id)[0];
    assert.equal(historical.reason, 'A dependency failed.');
    assert.equal(historical.runId, null);
    assert.equal(store.work.runs().some(run => run.issueId === dependent.id), false);
    const before = snapshot(store);
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined);
    assert.deepEqual(snapshot(store), before, 'Unrecovered dependencies must leave all state unchanged.');
    runIssue(store, first.id, 'merged');
    const recovered = store.work.claim('/disposable/recovery-evidence');
    assert.equal(recovered?.job.issueId, dependent.id, 'A genuine prerequisite merge must automatically claim the never-run dependent without Requirement start.');
    assert.equal(recovered!.job.kind, 'issue');
    assert.notEqual(recovered!.job.id, historical.id);
    assert.deepEqual(JSON.parse(recovered!.job.payload).work, dependent.work);
    assert.equal(store.get(dependent.id)?.status, 'in_progress');
    assert.equal(store.work.requirement(requirement.id)?.status, 'running');
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined, 'The existing serial owner excludes another claim.');
    assert.equal(jobsFor(store, dependent.id).length, 2, 'Recovery appends exactly one successor.');
    assert.deepEqual(jobsFor(store, dependent.id)[0], historical, 'Blocked history and its reason remain byte-for-byte equivalent.');
    store.work.finish(recovered!.run.id, 'merged');
    const whole = store.work.claim('/disposable/recovery-evidence');
    assert.equal(whole?.job.kind, 'requirement_verify', 'Child recovery must retain whole-goal acceptance.');
    store.work.finish(whole!.run.id, 'passed');
    assert.equal(store.work.requirement(requirement.id)?.status, 'done');
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined);
    assert.equal(jobsFor(store, dependent.id).length, 2);
  } finally { store.close(); }
});

test('multiple and transitive recovery dependencies require actual merge evidence before continuation', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Multiple', path: '/disposable/multiple', targetBranch: 'main' });
    const first = create(store, repo.id, 'First');
    const second = create(store, repo.id, 'Second');
    const middle = create(store, repo.id, 'Middle', [first.id, second.id]);
    const last = create(store, repo.id, 'Last', [middle.id]);
    store.work.startIssue(middle.id); store.work.startIssue(last.id);
    runIssue(store, first.id, 'blocked');
    const histories = [jobsFor(store, middle.id)[0], jobsFor(store, last.id)[0]];
    store.update(second.id, { status: 'done' });
    runIssue(store, first.id, 'merged');
    const before = snapshot(store);
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined, 'A manually done prerequisite is not merge evidence.');
    assert.deepEqual(snapshot(store), before, 'An unmet second dependency cannot partially enqueue recovery.');
    runIssue(store, second.id, 'merged');
    const recovered = store.work.claim('/disposable/recovery-evidence');
    assert.equal(recovered?.job.issueId, middle.id, 'All actual prerequisite merges must release the middle issue.');
    assert.deepEqual(jobsFor(store, last.id), [histories[1]], 'A transitive dependent waits for the middle merge.');
    store.work.finish(recovered!.run.id, 'merged');
    const tail = store.work.claim('/disposable/recovery-evidence');
    assert.equal(tail?.job.issueId, last.id, 'The next actual merge must release the transitive dependent.');
    store.work.finish(tail!.run.id, 'merged');
    assert.deepEqual(jobsFor(store, middle.id)[0], histories[0]);
    assert.deepEqual(jobsFor(store, last.id)[0], histories[1]);
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined);
  } finally { store.close(); }
});

test('cross-requirement recovery waits for confirmed GitHub publication while internal dependencies use child merges', () => {
  const store = new IssueStore(':memory:');
  try {
    const repo = store.work.addRepo({ name: 'Publication', path: '/disposable/publication', targetBranch: 'main', github: { repository: 'Fixture/Project', remote: 'origin', workflow: 'verify.yml' } });
    const upstream = store.work.addRequirement({ repoId: repo.id, title: 'Upstream', goal: 'Publish upstream.' });
    const downstream = store.work.addRequirement({ repoId: repo.id, title: 'Downstream', goal: 'Use published upstream.' });
    const first = create(store, repo.id, 'Prerequisite', [], upstream.id);
    const internal = create(store, repo.id, 'Internal', [first.id], upstream.id);
    const external = create(store, repo.id, 'External', [first.id], downstream.id);
    store.work.startIssue(internal.id); store.work.startIssue(external.id);
    runIssue(store, first.id, 'blocked'); runIssue(store, first.id, 'merged');
    const oldExternal = jobsFor(store, external.id)[0];
    const same = store.work.claim('/disposable/recovery-evidence');
    assert.equal(same?.job.issueId, internal.id, 'Internal recovery uses actual child merge evidence before publication.');
    assert.deepEqual(jobsFor(store, external.id), [oldExternal]);
    store.work.finish(same!.run.id, 'merged');
    const verify = store.work.claim('/disposable/recovery-evidence');
    assert.equal(verify?.job.kind, 'requirement_verify');
    store.work.finishRequirementVerification(verify!.run.id, 'a'.repeat(40));
    const publish = store.work.claim('/disposable/recovery-evidence');
    assert.equal(publish?.job.kind, 'requirement_publish');
    store.work.deferPublication(publish!.run.id, Date.now() + 60000);
    const before = snapshot(store);
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined, 'Whole-goal approval and awaiting CI do not establish publication readiness.');
    assert.deepEqual(snapshot(store), before);
    store.work.updatePublication(upstream.id, { state: 'merged', mergeCommit: 'b'.repeat(40) });
    const recovered = store.work.claim('/disposable/recovery-evidence');
    assert.equal(recovered?.job.issueId, external.id, 'Confirmed cross-requirement publication releases the original blocked dependent.');
    assert.deepEqual(jobsFor(store, external.id)[0], oldExternal);
    store.work.finish(recovered!.run.id, 'merged');
  } finally { store.close(); }
});

test('eligible recovery proceeds while attempted terminal maintenance changed unapproved and superseded work stays excluded', () => {
  const root = evidenceDirectory('recovery-exclusions');
  const path = join(root, 'state.sqlite');
  const store = new IssueStore(path);
  const database = new DatabaseSync(path);
  try {
    const repo = store.work.addRepo({ name: 'Exclusions', path: '/disposable/exclusions', targetBranch: 'main' });
    const other = store.work.addRepo({ name: 'Other', path: '/disposable/other', targetBranch: 'main' });
    const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Other assignment', goal: 'Keep assignment immutable.' });
    const reassignment = store.work.addRequirement({ repoId: repo.id, title: 'Draft assignment', goal: 'Do not resume changed assignment.' });
    const source = create(store, repo.id, 'Source');
    const attempted = create(store, repo.id, 'Attempted');
    runIssue(store, attempted.id, 'blocked');
    store.update(attempted.id, { work: { ...attempted.work!, dependsOn: [source.id] } });
    store.work.startIssue(attempted.id);
    const cases = ['closed', 'done', 'harness', 'acceptance_contract', 'title', 'description', 'acceptance', 'dependencies', 'repository', 'requirement', 'newer', 'newer maintenance', 'active', 'other reason', 'run id', 'completed requirement'] as const;
    const candidates = cases.map(name => create(store, repo.id, name, [source.id], name === 'completed requirement' ? requirement.id : null, name === 'harness' || name === 'acceptance_contract' ? name : undefined));
    for (const issue of candidates) store.work.startIssue(issue.id);
    const eligible = create(store, repo.id, 'Eligible', [source.id]);
    store.work.startIssue(eligible.id);
    runIssue(store, source.id, 'blocked');
    for (const issue of candidates) {
      switch (issue.title) {
        case 'closed': store.closeIssue(issue.id, { reason: 'Cancelled by owner.' }); break;
        case 'done': store.update(issue.id, { status: 'done' }); break;
        case 'title': store.update(issue.id, { title: 'Changed title' }); break;
        case 'description': store.update(issue.id, { description: 'Changed goal.' }); break;
        case 'acceptance': store.update(issue.id, { work: { ...issue.work!, acceptance: ['Changed criteria.'] } }); break;
        case 'dependencies': store.update(issue.id, { work: { ...issue.work!, dependsOn: [] } }); break;
        case 'repository': store.update(issue.id, { work: { ...issue.work!, repoId: other.id, dependsOn: [] } }); break;
        case 'requirement': store.update(issue.id, { work: { ...issue.work!, requirementId: reassignment.id } }); break;
        case 'newer': {
          const next = store.work.startIssue(issue.id);
          database.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(next.id);
          break;
        }
        case 'newer maintenance': {
          store.update(issue.id, { work: { ...issue.work!, changeKind: 'harness' } });
          const next = store.work.startIssue(issue.id);
          database.prepare("UPDATE jobs SET status='blocked', reason='Owner review rejected.' WHERE id=?").run(next.id);
          store.update(issue.id, { work: issue.work! });
          break;
        }
        case 'active': store.work.startIssue(issue.id); break;
        case 'other reason': database.prepare("UPDATE jobs SET reason='Independent rejection.' WHERE issue_id=?").run(issue.id); break;
        case 'run id': database.prepare("UPDATE jobs SET run_id='retained-ambiguous-run' WHERE issue_id=?").run(issue.id); break;
      }
    }
    const submitted = store.work.submitPlan({ schemaVersion: 1, submissionId: 'unapproved-recovery', repoId: repo.id, requirement: { title: 'Unapproved', goal: 'Do not bypass coverage approval.' }, source: { kind: 'codex', reference: 'recovery-test', summary: 'Admission exclusion.' }, assumptions: [], issues: [{ key: 'source', title: 'Submitted source', description: 'Deliver prerequisite.', acceptance: ['Source is ready.'], dependsOn: [] }, { key: 'held', title: 'Unapproved child', description: 'Keep held.', acceptance: ['Approved first.'], dependsOn: ['source'] }] });
    const review = store.work.claim('/disposable/recovery-evidence', submitted.jobs[0].id)!;
    store.work.finish(review.run.id, 'passed');
    const held = store.get(submitted.submission.issueIds.held)!;
    const submittedSource = submitted.submission.issueIds.source;
    const submittedRun = store.work.claim('/disposable/recovery-evidence', jobsFor(store, submittedSource)[0].id)!;
    store.work.finish(submittedRun.run.id, 'blocked', 'Submitted prerequisite failed.');
    runIssue(store, submittedSource, 'merged');
    database.prepare("UPDATE jobs SET status='blocked' WHERE id=?").run(review.job.id);
    runIssue(store, source.id, 'merged');
    const active = candidates.find(issue => issue.title === 'active')!;
    const activeJob = store.work.startIssue(active.id);
    const activeRun = store.work.claim('/disposable/recovery-evidence', activeJob.id)!;
    assert.equal(activeRun.job.id, activeJob.id, 'Fixture setup must establish the explicit newer serial owner.');
    const beforeOwner = snapshot(store);
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined);
    assert.deepEqual(snapshot(store), beforeOwner, 'A running serial owner prevents even recovery writes.');
    store.work.finish(activeRun.run.id, 'passed');
    database.prepare("UPDATE requirements SET status='done' WHERE id=?").run(requirement.id);
    const excluded = [...candidates, attempted, held];
    const before = excluded.map(issue => ({ issue: store.get(issue.id), jobs: jobsFor(store, issue.id), runs: store.work.runs().filter(run => run.issueId === issue.id) }));
    const recovered = store.work.claim('/disposable/recovery-evidence');
    assert.deepEqual(excluded.map(issue => ({ issue: store.get(issue.id), jobs: jobsFor(store, issue.id), runs: store.work.runs().filter(run => run.issueId === issue.id) })), before, 'Ineligible records must retain state and history while eligible work is considered.');
    assert.equal(recovered?.job.issueId, eligible.id, 'The exclusions must coexist with effective eligible recovery, not a green no-op.');
    store.work.finish(recovered!.run.id, 'merged');
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined);
  } finally { database.close(); store.close(); }
});

test('recovery and claim roll back atomically and serialized connections preserve one successor and blocked history', () => {
  const root = evidenceDirectory('recovery-atomic');
  const path = join(root, 'state.sqlite');
  const store = new IssueStore(path);
  const other = new IssueStore(path);
  const database = new DatabaseSync(path);
  try {
    const repo = store.work.addRepo({ name: 'Atomic', path: '/disposable/atomic', targetBranch: 'main' });
    const source = create(store, repo.id, 'Source');
    const dependent = create(store, repo.id, 'Dependent', [source.id]);
    store.work.startIssue(dependent.id);
    runIssue(store, source.id, 'blocked'); runIssue(store, source.id, 'merged');
    const historical = jobsFor(store, dependent.id)[0];
    database.exec(`CREATE TRIGGER reject_recovered_run BEFORE INSERT ON work_runs WHEN NEW.issue_id=${dependent.id} BEGIN SELECT RAISE(ABORT, 'Forced recovered claim failure'); END;`);
    const before = snapshot(store);
    assert.throws(() => store.work.claim('/disposable/recovery-evidence'), /Forced recovered claim failure/, 'Recovery must reach the owned run insertion so its transaction can be tested.');
    assert.deepEqual(snapshot(store), before, 'Failed claim must roll back the successor job and all issue/requirement state.');
    assert.deepEqual(snapshot(other), before, 'Another connection observes no partial recovery.');
    database.exec('DROP TRIGGER reject_recovered_run;');
    const recovered = other.work.claim('/disposable/recovery-evidence');
    assert.equal(recovered?.job.issueId, dependent.id, 'A settled rollback leaves the original work eligible.');
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined);
    assert.equal(jobsFor(store, dependent.id).length, 2);
    other.work.finish(recovered!.run.id, 'merged');
    assert.equal(store.work.claim('/disposable/recovery-evidence'), undefined);
    assert.equal(other.work.claim('/disposable/recovery-evidence'), undefined);
    assert.deepEqual(jobsFor(store, dependent.id)[0], historical);
    assert.equal(jobsFor(store, dependent.id).length, 2);
  } finally { database.close(); other.close(); store.close(); }
});

test('the ordinary serial queue delivers recovered submitted work with its original goal criteria and task limits', { timeout: 60000 }, async () => {
  const root = evidenceDirectory('recovery-serial');
  const repository = fixtureRepository(join(root, 'repo'));
  const store = new IssueStore(join(root, 'state.sqlite'));
  try {
    const repo = store.work.addRepo({ name: 'Serial recovery', path: repository, targetBranch: 'main' });
    const input = { schemaVersion: 1, submissionId: 'serial-recovery', repoId: repo.id, requirement: { title: 'Ready recovery', goal: 'Return ready and confirm the integrated value.' }, source: { kind: 'codex', reference: 'recovery-conversation', summary: 'Original authorized recovery goal.' }, assumptions: [], issues: [{ key: 'source', title: 'Source', description: 'Return ready.', acceptance: ['The value is ready.'], dependsOn: [] }, { key: 'dependent', title: 'Dependent', description: 'Confirm the integrated ready value.', acceptance: ['The integrated value is ready.'], dependsOn: ['source'] }] };
    const receipt = store.work.submitPlan(input);
    const queue = new SerialQueue(store, { evidenceRoot: join(root, 'evidence'), agent: fixtureAgent(), planner: { decompose: async () => { throw new Error('Submitted work cannot be decomposed again.'); }, review: async () => ({ approved: true, summary: 'Original submitted goal and criteria are covered.', findings: [] }) } });
    const review = store.work.claim(queue.evidenceRoot, receipt.jobs[0].id)!;
    store.work.finish(review.run.id, 'passed');
    const source = receipt.submission.issueIds.source;
    const dependent = receipt.submission.issueIds.dependent;
    const sourceJob = jobsFor(store, source)[0];
    const failed = store.work.claim(queue.evidenceRoot, sourceJob.id)!;
    store.work.finish(failed.run.id, 'blocked', 'Prerequisite failed before delivery.');
    const historical = jobsFor(store, dependent)[0];
    const originalTask = issueTask(store, store.get(dependent)!);
    const retry = store.work.startIssue(source);
    assert.equal(await queue.processNext(retry.id), true);
    assert.equal(store.work.runs().find(run => run.jobId === retry.id)?.status, 'merged', 'The unchanged fixture must genuinely integrate the recovered prerequisite before testing continuation.');
    assert.equal(await queue.processNext(), true, 'The ordinary queue must execute the blocked dependent without a new Requirement start.');
    const delivered = store.work.runs().find(run => run.issueId === dependent && run.status === 'merged');
    assert.ok(delivered, 'Recovered submitted work must finish verified local integration.');
    const task = JSON.parse(readFileSync(join(delivered.evidencePath, 'task.json'), 'utf8'));
    assert.equal(task.goal, originalTask.goal);
    assert.deepEqual(task.acceptance, originalTask.acceptance);
    assert.deepEqual(task.budget, originalTask.budget, 'Recovery cannot grant attempts or reset canonical task limits.');
    assert.deepEqual(store.work.submission(input.submissionId), receipt.submission);
    assert.deepEqual(jobsFor(store, dependent)[0], historical);
    assert.equal(jobsFor(store, dependent).length, 2);
    assert.equal(await queue.processNext(), true, 'Whole-goal acceptance remains a separate ordinary queue job.');
    assert.equal(store.work.requirement(receipt.requirement.id)?.status, 'done');
    assert.equal(await queue.processNext(), false);
  } finally { store.close(); }
});
