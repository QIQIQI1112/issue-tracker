import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runController } from '../factory/controller.ts';
import { inspectNodeReport } from '../factory/evidence.ts';
import { proveRegression } from '../factory/regression.ts';
import { git } from '../factory/workspace.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const check = { file: 'tests/value.test.ts', title: 'value is ready' };
const reporter = resolve('factory/node-reporter.mjs');
const nested = "describe('suite container',()=>{it('value is ready',()=>assert.equal(value,'ready','the actual leaf value must be ready'));});\n";

function fixture(label: string, body: string, value: string) {
  const root = evidenceDirectory(`node-report-${label}`);
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'src/value.ts'), `export const value = ${JSON.stringify(value)};\n`);
  writeFileSync(join(repository, check.file), "import {describe,it} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.ts';\n" + body);
  return { root, repository };
}

function events(path: string) {
  return readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

async function observe(repository: string, prefix: string) {
  try {
    return await proveRegression({ check, browser: false, cwd: repository, prefix, env: { PATH: process.env.PATH }, reporter, timeoutMs: 10000, signal: new AbortController().signal, allowAlreadyPassed: true });
  } catch (error) {
    return { status: 'rejected', error: String(error) };
  }
}

function settled(prefix: string) {
  assert.equal(JSON.parse(readFileSync(`${prefix}.log.owner.json`, 'utf8')).settled, true, 'The real named Node process must settle before its report is interpreted.');
}

test('genuine nested Node green leaves pass full and focused verification', { timeout: 30000 }, async context => {
  const { root, repository } = fixture('green', nested, 'ready');
  context.diagnostic(`Genuine Node evidence: ${root}`);
  const prefix = join(root, 'green');
  const proof = await observe(repository, prefix);
  settled(prefix);
  const records = events(`${prefix}.jsonl`);
  assert.deepEqual(records.filter(event => event.type === 'test:pass' && event.data.details.type === 'test').map(event => event.data.name), [check.title], 'Fixture readiness requires the exact genuine passing leaf.');
  assert.ok(records.some(event => event.type === 'test:pass' && event.data.name === 'suite container' && event.data.details.type === 'suite'), 'The genuine suite wrapper must be present to reproduce the reader disagreement.');
  assert.deepEqual(inspectNodeReport(`${prefix}.jsonl`, [check]), { passed: 1, required: 1 });
  assert.equal(proof.status, 'already_passed', `A settled genuine green leaf must pass focused verification despite its suite wrapper: ${JSON.stringify(proof)}`);
  assert.throws(() => inspectNodeReport(`${prefix}.jsonl`, [{ ...check, title: 'suite container' }]), 'A suite container cannot satisfy a required leaf identity.');
});

test('genuine nested Node assertion reds identify the exact leaf through failing suite wrappers', { timeout: 30000 }, async context => {
  const { root, repository } = fixture('red', nested, 'broken');
  context.diagnostic(`Genuine Node evidence: ${root}`);
  const prefix = join(root, 'red');
  const proof = await observe(repository, prefix);
  settled(prefix);
  const records = events(`${prefix}.jsonl`);
  const leaf = records.find(event => event.type === 'test:fail' && event.data.name === check.title && event.data.details.type === 'test');
  assert.equal(leaf?.data.details.error.cause?.code, 'ERR_ASSERTION', 'Fixture readiness requires the named leaf assertion, carried by the genuine Node error cause.');
  assert.ok(records.some(event => event.type === 'test:fail' && event.data.name === 'suite container' && event.data.details.type === 'suite'), 'The failing suite wrapper must accompany the actual assertion-red leaf.');
  assert.equal(records.filter(event => event.type === 'test:summary').at(-1)?.data.counts.failed, 1, 'The actual Node summary counts the failed leaf once.');
  assert.throws(() => inspectNodeReport(`${prefix}.jsonl`, [check]), 'Full admission must still reject assertion-red execution.');
  assert.equal(proof.status, 'expected_failure', `Only the exact nested leaf assertion must establish red proof, without counting its failing wrapper as another case: ${JSON.stringify(proof)}`);
});

test('named Node proofs reject incomplete inconsistent and unrelated evidence', { timeout: 60000 }, async context => {
  const { root, repository } = fixture('invalid', "it('value is ready',()=>assert.equal(value,'ready'));\n", 'broken');
  context.diagnostic(`Invalid-report boundary evidence: ${root}`);
  const transform = join(root, 'boundary-reporter.mjs');
  writeFileSync(transform, `import reporter from ${JSON.stringify(reporter)};
export default async function* (source) {
  for await (const line of reporter(source)) {
    const event = JSON.parse(line);
    const mode = process.env.NODE_REPORT_BOUNDARY;
    if (mode === 'missing-summary' && event.type === 'test:summary') continue;
    if (mode === 'inconsistent-summary' && event.type === 'test:summary') event.data.counts.tests += 1;
    if (mode === 'wrong-file' && ['test:pass','test:fail'].includes(event.type)) event.data.file = event.data.file.replace('/tests/value.test.ts','/tests/unrelated.test.ts');
    if (mode === 'missing-leaf' && ['test:pass','test:fail'].includes(event.type)) continue;
    yield JSON.stringify(event) + '\\n';
    if (mode === 'duplicate-leaf' && ['test:pass','test:fail'].includes(event.type)) yield JSON.stringify(event) + '\\n';
  }
}
`);
  const observations: { value: string; mode: string; status: string }[] = [];
  for (const value of ['broken', 'ready']) {
    writeFileSync(join(repository, 'src/value.ts'), `export const value = ${JSON.stringify(value)};\n`);
    const baseline = join(root, `${value}-baseline`);
    const baselineProof = await observe(repository, baseline);
    settled(baseline);
    assert.equal(baselineProof.status, value === 'ready' ? 'already_passed' : 'expected_failure', 'The unchanged real reporter and flat named case must work before report-boundary corruption.');
    for (const mode of ['missing-summary', 'inconsistent-summary', 'wrong-file', 'missing-leaf', 'duplicate-leaf']) {
      const prefix = join(root, `${value}-${mode}`);
      let status: string;
      try {
        const proof = await proveRegression({ check, browser: false, cwd: repository, prefix, env: { PATH: process.env.PATH, NODE_REPORT_BOUNDARY: mode }, reporter: transform, timeoutMs: 10000, signal: new AbortController().signal, allowAlreadyPassed: true });
        status = proof.status;
      } catch {
        status = 'rejected';
      }
      settled(prefix);
      const records = events(`${prefix}.jsonl`);
      const leaves = records.filter(event => ['test:pass', 'test:fail'].includes(event.type) && event.data.details.type === 'test');
      assert.deepEqual(leaves.map(event => event.data.name), mode === 'missing-leaf' ? [] : mode === 'duplicate-leaf' ? [check.title, check.title] : [check.title], `The ${mode} fixture must transform genuine named leaf events rather than fail during setup.`);
      assert.equal(records.filter(event => event.type === 'test:summary').at(-1)?.data.counts.tests, mode === 'missing-summary' ? undefined : mode === 'inconsistent-summary' ? 2 : 1, `The ${mode} fixture must apply its intended summary boundary.`);
      for (const leaf of leaves) {
        assert.equal(leaf.type, value === 'ready' ? 'test:pass' : 'test:fail');
        assert.ok(leaf.data.file.endsWith(mode === 'wrong-file' ? '/tests/unrelated.test.ts' : '/tests/value.test.ts'));
        if (value === 'broken') assert.equal(leaf.data.details.error.cause?.code, 'ERR_ASSERTION', 'Rejected red evidence must originate in the genuine leaf assertion.');
      }
      observations.push({ value, mode, status });
    }
  }
  context.diagnostic(JSON.stringify(observations));
  assert.deepEqual(observations.filter(observation => observation.status !== 'rejected'), [], 'Missing or inconsistent summaries, wrong-file identities, absent leaves and ambiguous leaves must never become named green or assertion-red proof.');
  for (const mode of ['missing-summary', 'inconsistent-summary', 'wrong-file', 'missing-leaf', 'duplicate-leaf']) {
    assert.throws(() => inspectNodeReport(join(root, `ready-${mode}.jsonl`), [check]), `Full admission must reject the same invalid ${mode} report.`);
  }
  writeFileSync(join(repository, check.file), "import {describe,it} from 'node:test';\ndescribe('value is ready',()=>{it('unrelated passing leaf',()=>{});});\n");
  const suitePrefix = join(root, 'suite-only');
  assert.equal((await observe(repository, suitePrefix)).status, 'rejected', 'A matching suite wrapper cannot establish named leaf proof.');
  settled(suitePrefix);
  assert.throws(() => inspectNodeReport(`${suitePrefix}.jsonl`, [check]), 'A matching suite and unrelated green leaf cannot establish full required-case admission.');
  const phases: string[] = [];
  const before = git(repository, ['rev-parse', 'main']).trim();
  const state = await runController({ repository, evidenceRoot: join(root, 'initial-proof'), task: { schemaVersion: 2, id: 'suite-only-proof', title: 'Exact leaf proof', goal: 'Admit only the exact named leaf.', acceptance: [{ id: 'leaf', description: 'A suite wrapper is not a leaf proof.' }], scope: ['src/', 'tests/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 20000 } }, agent: { run: async input => {
    phases.push(input.phase);
    if (input.phase === 'plan') return { schemaVersion: 2, taskId: input.task.id, coverage: { mode: 'extend', reason: 'Observe a genuine suite-only identity mismatch.' }, assumptions: [], slices: [{ id: 'leaf', goal: input.task.goal, acceptanceIds: ['leaf'], checks: [check] }], browserChecks: [] };
    if (input.phase === 'tests') return { schemaVersion: 1, taskId: input.task.id, summary: 'Reuse the prepared genuine Node fixture.', blockers: [] };
    throw new Error('Invalid initial evidence reached an agent phase beyond proof admission.');
  } } });
  try {
    assert.ok(existsSync(join(state.runDirectory, 'red-1-0.jsonl')), `Initial proof must actually execute before assessing admission: ${state.reason}`);
    assert.deepEqual(phases, ['plan', 'tests'], 'Invalid initial proof must stop before coverage approval, implementation, product repair or review.');
    assert.equal(state.status, 'blocked');
    assert.equal(state.failureKind, 'verification', 'Invalid initial evidence is a verification/control failure.');
    assert.deepEqual(state.attempts, [], 'Invalid initial evidence cannot consume an ordinary product repair attempt.');
    assert.equal(git(repository, ['rev-parse', 'main']).trim(), before, 'Rejected proof cannot advance the target.');
  } finally {
    if (existsSync(join(state.workspace, '.git'))) git(repository, ['worktree', 'remove', '--force', state.workspace]);
  }
});
