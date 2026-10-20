import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runController } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { environmentIdentity, loadCheckpoint } from '../factory/checkpoint.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

type BrowserProof = { file: string; title: string; status: string; logPath: string; reportPath: string };
const title = 'new suffix is externally observable';
const task = () => parseTask({ schemaVersion: 1, id: 'initial-browser-proof', title: 'Ready suffix', goal: 'Return ready with a suffix.', acceptance: [{ id: 'ready', description: 'The externally observed suffix is !.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1000, totalTimeoutMs: 30000 }, notes: '' });

function repositoryFixture(label: string, ready = false) {
  const root = evidenceDirectory(label);
  const repository = fixtureRepository(join(root, 'repo'));
  writeFileSync(join(repository, 'src/suffix.ts'), "export const suffix = '';\n");
  if (ready) writeFileSync(join(repository, 'src/value.ts'), "export const value = 'ready';\n");
  git(repository, ['add', 'src/']);
  git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Prepare suffix baseline']);
  return { root, repository };
}

const browserSource = (body: string) => `import {test,expect} from ${JSON.stringify(resolve('node_modules/@playwright/test/index.mjs'))};\nimport {suffix} from '../src/suffix.ts';\n${body}\n`;

for (const mode of ['new', 'appended'] as const) test(`initial ${mode} browser checks have named owner proofs before approval and frozen checkpoint reuse`, { timeout: 30000 }, async () => {
  const { root, repository } = repositoryFixture(`initial-browser-${mode}`);
  const delegate = fixtureAgent();
  const browserFile = mode === 'new' ? 'suffix.spec.ts' : 'value.spec.ts';
  let reviewProofs: BrowserProof[] = [];
  let reviewSawReport = false;
  const state = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') {
      const plan = await delegate.run(input) as { browserChecks: { file: string; title: string }[] };
      plan.browserChecks.push({ file: browserFile, title });
      return plan;
    }
    if (input.phase === 'tests') {
      const source = `test(${JSON.stringify(title)},()=>expect(suffix).toBe('!'));`;
      if (mode === 'new') writeFileSync(join(input.cwd, 'acceptance', browserFile), browserSource(source));
      else appendFileSync(join(input.cwd, 'acceptance', browserFile), `import {suffix} from '../src/suffix.ts';\n${source}\n`);
    }
    if (input.phase === 'acceptance-review') {
      reviewProofs = JSON.parse(input.feedback).browserRedChecks ?? [];
      reviewSawReport = reviewProofs.some(proof => {
        const report = JSON.parse(readFileSync(proof.reportPath, 'utf8'));
        readFileSync(proof.logPath, 'utf8');
        return proof.file === browserFile && proof.title === title && proof.status === 'expected_failure' && report.stats.unexpected === 1;
      });
    }
    if (input.phase === 'implement') throw new Error('Stop after accepted browser checks for checkpoint inspection.');
    return delegate.run(input);
  } } });
  try {
    assert.equal(reviewSawReport, true, 'Independent acceptance review must receive actual named Playwright results from the unchanged implementation.');
    assert.ok(reviewProofs.some(proof => proof.file === browserFile && proof.title === title));
    assert.ok(reviewProofs.every(proof => proof.file === browserFile), 'Unchanged browser files do not require a new baseline execution.');
    if (mode === 'new') assert.equal(reviewProofs.length, 1);
    assert.match(state.reason ?? '', /Stop after accepted browser checks/);
    const checkpointPath = join(state.runDirectory, 'checkpoint.json');
    const original = readFileSync(checkpointPath, 'utf8');
    const checkpoint = JSON.parse(original);
    assert.equal(checkpoint.accepted, true);
    assert.equal(checkpoint.browserRedChecks.length, reviewProofs.length);
    const environment = environmentIdentity(repository, process.cwd());
    assert.doesNotThrow(() => loadCheckpoint(state.runDirectory, root, task(), environment));
    if (mode === 'new') {
      delete checkpoint.browserRedChecks;
      writeFileSync(checkpointPath, JSON.stringify(checkpoint));
      assert.throws(() => loadCheckpoint(state.runDirectory, root, task(), environment), /browser|proof|metadata|receipt/i);
      writeFileSync(checkpointPath, original);
      const emptied = JSON.parse(original);
      emptied.browserRedChecks = [];
      writeFileSync(checkpointPath, JSON.stringify(emptied));
      assert.throws(() => loadCheckpoint(state.runDirectory, root, task(), environment), /browser|proof|metadata|receipt/i);
      writeFileSync(checkpointPath, original);
      const renamed = JSON.parse(original);
      renamed.browserRedChecks[0].title = 'unapproved browser behavior';
      writeFileSync(checkpointPath, JSON.stringify(renamed));
      assert.throws(() => loadCheckpoint(state.runDirectory, root, task(), environment), /browser|proof|metadata|receipt/i);
      writeFileSync(checkpointPath, original);
      const reclassified = JSON.parse(original);
      reclassified.browserRedChecks[0].status = 'already_passed';
      writeFileSync(checkpointPath, JSON.stringify(reclassified));
      assert.throws(() => loadCheckpoint(state.runDirectory, root, task(), environment), /browser|proof|metadata|receipt/i);
      writeFileSync(checkpointPath, original);
      appendFileSync(reviewProofs[0].reportPath, '\n');
      assert.throws(() => loadCheckpoint(state.runDirectory, root, task(), environment), /proof hash/i);
    }
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

for (const ready of [false, true]) test(`new browser ${ready ? 'passing' : 'missing'} behavior is included in the implementation decision`, { timeout: 30000 }, async () => {
  const { root, repository } = repositoryFixture(`initial-browser-decision-${ready}`, true);
  if (ready) {
    writeFileSync(join(repository, 'src/suffix.ts'), "export const suffix = '!';\n");
    git(repository, ['add', 'src/suffix.ts']);
    git(repository, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Prepare existing suffix behavior']);
  }
  const delegate = fixtureAgent();
  let implementations = 0;
  let proofStatus = '';
  const state = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') {
      const plan = await delegate.run(input) as { browserChecks: { file: string; title: string }[] };
      plan.browserChecks.push({ file: 'suffix.spec.ts', title });
      return plan;
    }
    if (input.phase === 'tests') writeFileSync(join(input.cwd, 'acceptance/suffix.spec.ts'), browserSource(`test(${JSON.stringify(title)},()=>expect(suffix).toBe('!'));`));
    if (input.phase === 'acceptance-review') proofStatus = JSON.parse(input.feedback).browserRedChecks?.[0]?.status ?? '';
    if (input.phase === 'implement') { implementations++; writeFileSync(join(input.cwd, 'src/suffix.ts'), "export const suffix = '!';\n"); }
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'ready', state.reason ?? 'No failure reason');
    assert.equal(proofStatus, ready ? 'already_passed' : 'expected_failure');
    assert.equal(implementations, Number(!ready), 'A passing Node baseline must not hide missing browser behavior.');
    assert.equal(state.budget?.acceptanceAttempts, 1);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});

for (const mode of ['import', 'setup', 'missing', 'skipped', 'timeout'] as const) test(`initial browser ${mode} failure cannot freeze tests or authorize implementation`, { timeout: 15000 }, async () => {
  const { root, repository } = repositoryFixture(`initial-browser-invalid-${mode}`);
  const delegate = fixtureAgent();
  let reviews = 0;
  let implementations = 0;
  const state = await runController({ repository, task: task(), evidenceRoot: root, agent: { run: async input => {
    if (input.phase === 'plan') {
      const plan = await delegate.run(input) as { browserChecks: { file: string; title: string }[] };
      plan.browserChecks.push({ file: 'suffix.spec.ts', title });
      return plan;
    }
    if (input.phase === 'tests') {
      const source = mode === 'import' ? "import './missing-fixture.ts';" : mode === 'setup' ? `test.beforeEach(()=>{throw new Error('Fixture setup failed.');});test(${JSON.stringify(title)},()=>expect(suffix).toBe('!'));` : mode === 'missing' ? "test('another behavior',()=>expect(suffix).toBe('!'));" : mode === 'skipped' ? `test.skip(${JSON.stringify(title)},()=>expect(suffix).toBe('!'));` : `test(${JSON.stringify(title)},async()=>{test.setTimeout(100);await new Promise(()=>{});});`;
      writeFileSync(join(input.cwd, 'acceptance/suffix.spec.ts'), browserSource(source));
    }
    if (input.phase === 'acceptance-review') reviews++;
    if (input.phase === 'implement' || input.phase === 'repair') implementations++;
    return delegate.run(input);
  } } });
  try {
    assert.equal(state.status, 'blocked');
    assert.equal(reviews, 0, 'Invalid browser evidence must be resolved before independent acceptance approval.');
    assert.equal(implementations, 0, 'Environment and protocol failures are not behavior red proofs.');
    assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'checkpoint.json'), 'utf8')).accepted, false);
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});
