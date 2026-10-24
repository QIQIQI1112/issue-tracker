import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git } from '../../factory/workspace.ts';
import type { Agent } from '../../factory/controller.ts';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function fixtureRepository(directory: string): string {
  mkdirSync(directory, { recursive: true });
  for (const name of ['src', 'tests', 'acceptance', 'factory']) mkdirSync(join(directory, name));
  writeFileSync(join(directory, '.gitignore'), '.data/\n.runs/\nnode_modules\ntest-results/\n');
  writeFileSync(join(directory, 'AGENTS.md'), 'Use focused behavior tests. Keep existing tests and harness files intact. Workers must not commit or merge.\n');
  writeFileSync(join(directory, 'src/value.ts'), "export const value = 'broken';\n");
  writeFileSync(join(directory, 'tests/value.test.ts'), "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.ts';\ntest('value is ready',()=>assert.equal(value,'ready'));\n");
  const noop = 'node -e "process.exit(0)"';
  const reporter = quote(resolve('factory/node-reporter.mjs'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module', scripts: { lint: noop, typecheck: noop, build: noop, test: `node --test --test-reporter=spec --test-reporter=${reporter} --test-reporter-destination=stdout --test-reporter-destination="$RUN_DIR/node-results.jsonl" tests/*.test.ts` } }));
  writeFileSync(join(directory, 'factory/verification-contract.json'), JSON.stringify({ schemaVersion: 2, profile: 'code-only', requiredNodeTests: [{ file: 'tests/value.test.ts', title: 'value is ready' }], requiredBrowserTests: [] }));
  symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
  git(directory, ['init', '-q', '-b', 'main']);
  git(directory, ['add', '.']);
  git(directory, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Disposable fixture']);
  return directory;
}

export function fixtureAgent(approved = true): Agent {
  return { run: async input => {
    if (input.phase === 'plan') return { schemaVersion: 1, taskId: input.task.id, assumptions: [{ decision: 'Return ready', reason: 'This is the fixture business goal.' }], slices: [{ id: 'value', goal: input.task.goal, acceptanceIds: input.task.acceptance.map(item => item.id), checks: [{ file: 'tests/value.test.ts', title: 'value is ready' }] }], browserChecks: [] };
    if (input.phase === 'review' || input.phase === 'acceptance-review') return { schemaVersion: 1, taskId: input.task.id, approved, summary: approved ? 'Approved the fixture behavior and evidence.' : 'Blocking fixture review.', findings: approved ? [] : ['Fixture review rejected.'] };
    if (input.phase === 'implement' || input.phase === 'repair') writeFileSync(join(input.cwd, 'src/value.ts'), "export const value = 'ready';\n");
    return { schemaVersion: 1, taskId: input.task.id, summary: 'Prepared the fixture candidate.', blockers: [] };
  } };
}
