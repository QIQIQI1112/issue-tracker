import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { parseTask } from '../factory/contracts.ts';
import { runProcess } from '../factory/process.ts';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(maxAttempts = 2, omitNode = false) {
  const repository = evidenceDirectory('controller');
  for (const directory of ['src', 'tests', 'acceptance', 'factory']) mkdirSync(join(repository, directory));
  writeFileSync(join(repository, '.gitignore'), '.runs/\nnode_modules\ntest-results/\n');
  writeFileSync(join(repository, 'src/value.ts'), "export const value = 'broken';\n");
  writeFileSync(join(repository, 'tests/change.test.ts'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/value.ts';\ntest('approved value behavior', () => assert.equal(value, 'ready'));\n");
  if (omitNode) writeFileSync(join(repository, 'tests/unrelated.test.ts'), "import {test} from 'node:test'; test('unrelated passing case',()=>{});\n");
  const noop = 'node -e "process.exit(0)"';
  const reporter = quote(resolve('factory/node-reporter.mjs'));
  writeFileSync(join(repository, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { lint: noop, typecheck: noop, build: noop, test: `node --test --test-reporter=spec --test-reporter=${reporter} --test-reporter-destination=stdout --test-reporter-destination="$RUN_DIR/node-results.jsonl" tests/${omitNode ? 'unrelated' : 'change'}.test.ts` } }));
  writeFileSync(join(repository, 'factory/verification-contract.json'), JSON.stringify({ schemaVersion: 2, profile: 'code-only', requiredNodeTests: [{ file: 'tests/change.test.ts', title: 'approved value behavior' }], requiredBrowserTests: [] }));
  symlinkSync(resolve('node_modules'), join(repository, 'node_modules'), 'dir');
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: repository, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q']); git(['add', '.']); git(['commit', '-qm', 'Disposable controller fixture']);
  const task = parseTask({ schemaVersion: 1, id: 'controller-fixture', title: 'Repair the approved value', goal: 'Return ready', acceptance: [{ id: 'ready', description: 'The value is ready' }], scope: ['src/', 'tests/change.test.ts', 'acceptance/probe.spec.ts'], verificationCommand: 'npm run verify', budget: { maxAttempts, workerTimeoutMs: 1000, totalTimeoutMs: 30000 }, notes: 'Isolated executable fixture, not an application browser acceptance test.' });
  return { repository, task };
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`controller persists a blocked report after ${signal}`, async () => {
    const { repository, task } = fixture();
    const directory = join(repository, '.runs');
    mkdirSync(directory);
    const script = join(directory, 'signal.mjs');
    const response = join(directory, 'signal-result.json');
    writeFileSync(script, `import {writeFileSync} from 'node:fs';\nimport {runController} from ${JSON.stringify(resolve('factory/controller.ts'))};\nconst state=await runController({repository:${JSON.stringify(repository)},task:${JSON.stringify(task)},agent:{run:async()=>{process.stdout.write('owned-controller:'+process.pid+'\\n');return await new Promise(()=>{});}}});\nwriteFileSync(${JSON.stringify(response)},JSON.stringify(state));\nprocess.exitCode=state.status==='blocked'?1:0;\n`);
    let signalled = false;
    const result = await runProcess({ command: process.execPath, args: [script], cwd: repository, logPath: join(directory, 'signal.log'), timeoutMs: 10000, onOutput: text => {
      const pid = text.match(/owned-controller:(\d+)/)?.[1];
      if (pid && !signalled) { signalled = true; process.kill(Number(pid), signal); }
    } });
    assert.equal(signalled, true);
    assert.equal(result.status, 'failed');
    const state = JSON.parse(readFileSync(response, 'utf8'));
    assert.equal(state.status, 'blocked');
    assert.match(state.reason, /cancelled/i);
    assert.equal(JSON.parse(readFileSync(join(state.runDirectory, 'state.json'), 'utf8')).status, 'blocked');
    const cleanup = spawnSync('git', ['worktree', 'remove', '--force', state.workspace], { cwd: repository, encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr);
  });
}

type Input = { phase: string; cwd: string; attempt: number; signal: AbortSignal };
function agent(taskId: string, mode: 'success' | 'staged' | 'reset-index' | 'append' | 'append-tamper' | 'omit-node' | 'repair' | 'exhausted' | 'tamper' | 'review-reject' | 'review-change' | 'timeout') {
  return { run: async (input: Input): Promise<unknown> => {
    if (mode === 'timeout' && input.phase === 'plan') return await new Promise(() => {});
    if (input.phase === 'plan') return { schemaVersion: 1, taskId, assumptions: [{ decision: 'Keep the approved interface', reason: 'The task changes one value' }], slices: [{ id: 'value', goal: 'Return ready', acceptanceIds: ['ready'], checks: [{ file: 'tests/change.test.ts', title: 'approved value behavior' }, ...(mode.startsWith('append') ? [{ file: 'tests/change.test.ts', title: 'appended value behavior' }] : [])] }], browserChecks: [] };
    if (input.phase === 'acceptance-review' || input.phase === 'review') {
      if (mode === 'review-change' && input.phase === 'review') writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'changed after verification';\n");
      const approved = mode !== 'review-reject' || input.phase !== 'review';
      return { schemaVersion: 1, taskId, approved, summary: approved ? 'Reviewed the approved behavior' : 'The result needs further work', findings: approved ? [] : ['Blocking review finding'] };
    }
    if (input.phase === 'tests' && mode.startsWith('append')) appendFileSync(join(input.cwd, 'tests/change.test.ts'), "test('appended value behavior', () => assert.equal(value, 'ready'));\n");
    if (input.phase !== 'tests') {
      if (mode === 'tamper') writeFileSync(join(input.cwd, 'tests/change.test.ts'), "import {test} from 'node:test'; test.skip('approved value behavior',()=>{});\n");
      else writeFileSync(join(input.cwd, 'src/value.ts'), `export const value = '${mode === 'exhausted' || mode === 'repair' && input.attempt === 1 ? 'broken' : 'ready'}';\n`);
      if (mode === 'staged') assert.equal(spawnSync('git', ['add', 'src/value.ts'], { cwd: input.cwd }).status, 0);
      if (mode === 'reset-index') assert.equal(spawnSync('git', ['reset', '--mixed', 'HEAD'], { cwd: input.cwd }).status, 0);
      if (mode === 'append-tamper') appendFileSync(join(input.cwd, 'tests/change.test.ts'), "test('unapproved implementation check', () => {});\n");
    }
    return { schemaVersion: 1, taskId, summary: 'Worker claims completion', blockers: [] };
  } };
}

for (const mode of ['success', 'staged', 'reset-index', 'append', 'append-tamper', 'omit-node', 'repair', 'exhausted', 'tamper', 'review-reject', 'review-change', 'timeout'] as const) {
  test(`controller handles ${mode} using owned worktrees and independent verification`, { timeout: 30000 }, async () => {
    const module = await import('../factory/controller.ts').catch(() => null);
    assert.ok(module, 'The bounded controller is not implemented.');
    const { repository, task } = fixture(mode === 'review-reject' || mode === 'review-change' ? 1 : 2, mode === 'omit-node');
    if (mode === 'reset-index') { mkdirSync(join(repository, 'docs')); writeFileSync(join(repository, 'docs/uncommitted.md'), 'Preserve the uncommitted baseline.\n'); }
    const result = await module.runController({ repository, task, agent: agent(task.id, mode) });
    assert.equal(result.status, mode === 'success' || mode === 'staged' || mode === 'reset-index' || mode === 'append' || mode === 'repair' ? 'ready' : 'blocked', JSON.stringify(result));
    assert.equal(readFileSync(join(repository, 'src/value.ts'), 'utf8'), "export const value = 'broken';\n");
    assert.ok(result.runDirectory && !result.runDirectory.startsWith(result.workspace + '/'));
    const state = JSON.parse(readFileSync(join(result.runDirectory, 'state.json'), 'utf8'));
    assert.equal(state.status, result.status);
    if (result.status === 'ready') {
      assert.equal(state.verification.status, 'passed');
      assert.equal(state.review.approved, true);
      assert.match(readFileSync(join(result.runDirectory, 'patch.diff'), 'utf8'), /ready/);
      if (mode === 'reset-index') assert.doesNotMatch(readFileSync(join(result.runDirectory, 'patch.diff'), 'utf8'), /docs\/uncommitted/);
      assert.equal(state.attempts.length, mode === 'repair' ? 2 : 1);
      assert.equal(state.redChecks[0].status, 'expected_failure');
    }
    if (mode === 'tamper' || mode === 'append-tamper') assert.match(state.reason, /protected|contract/i);
    if (mode === 'omit-node') assert.match(state.reason, /Missing required Node case/);
    if (mode === 'timeout') assert.match(state.reason, /timeout|timed out/i);
    if (mode === 'review-change') assert.match(state.reason, /read-only|changed/i);
    const cleanup = spawnSync('git', ['worktree', 'remove', '--force', result.workspace], { cwd: repository, encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr);
  });
}
