import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexAgent } from '../factory/agent.ts';
import { runController } from '../factory/controller.ts';
import { parseTask } from '../factory/contracts.ts';
import { fixtureAgent, fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { git } from '../factory/workspace.ts';

for (const mode of ['malformed-json', 'process-failed'] as const) test(`review adapter ${mode} keeps protocol repair separate from process failure`, { timeout: 30000 }, async () => {
  const root = evidenceDirectory(`review-response-${mode}`);
  const repository = fixtureRepository(join(root, 'repo'));
  const task = parseTask({ schemaVersion: 1, id: 'review-response-json', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 1500, totalTimeoutMs: 30000 }, notes: '' });
  const counterPath = join(root, 'review-invocations.txt');
  const binary = join(root, 'fake-review-codex.mjs');
  const raw = '{"rawFixture":"malformed-review"';
  const approval = { schemaVersion: 1, taskId: task.id, approved: true, summary: 'Approved the actual red proofs.', findings: [] };
  writeFileSync(binary, `#!/usr/bin/env node\nimport {existsSync,readFileSync,writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nfor await(const chunk of process.stdin) void chunk;\nconst counterPath=${JSON.stringify(counterPath)};\nconst count=existsSync(counterPath)?Number(readFileSync(counterPath,'utf8'))+1:1;\nwriteFileSync(counterPath,String(count));\nwriteFileSync(args[args.indexOf('--output-last-message')+1],count===1?${JSON.stringify(raw)}:JSON.stringify(${JSON.stringify(approval)}));\nprocess.stdout.write(JSON.stringify({type:'fixture.review',count})+'\\n');\nprocess.exit(${mode === 'process-failed' ? 7 : 0});\n`);
  chmodSync(binary, 0o700);
  const delegate = fixtureAgent();
  const reviewer = codexAgent(binary);
  const counts = new Map<string, number>();
  const state = await runController({ repository, task, evidenceRoot: root, agent: { run: async input => {
    counts.set(input.phase, (counts.get(input.phase) ?? 0) + 1);
    return input.phase === 'acceptance-review' ? reviewer.run(input) : delegate.run(input);
  } } });
  try {
    assert.equal(state.status, mode === 'malformed-json' ? 'ready' : 'blocked', state.reason ?? 'No failure reason');
    assert.equal(Number(readFileSync(counterPath, 'utf8')), mode === 'malformed-json' ? 2 : 1);
    assert.equal(counts.get('plan'), 1);
    assert.equal(counts.get('tests'), 1);
    assert.equal(counts.get('implement') ?? 0, Number(mode === 'malformed-json'));
    assert.equal(state.budget?.acceptanceAttempts, 1);
    const directories = readdirSync(state.runDirectory).filter(name => name.endsWith('-acceptance-review')).map(name => join(state.runDirectory, name));
    assert.equal(readFileSync(join(directories[0], 'response.json'), 'utf8'), raw);
    if (mode === 'malformed-json') {
      assert.match(readFileSync(join(directories[0], 'contract-error.json'), 'utf8'), /malformed-review/);
      assert.equal(JSON.parse(readFileSync(join(directories[0], 'process.json'), 'utf8')).status, 'passed');
      assert.equal(state.budget?.implementationAttempts, 1);
    } else {
      assert.match(state.reason ?? '', /Codex.*failed/i);
      assert.equal(JSON.parse(readFileSync(join(directories[0], 'process.json'), 'utf8')).status, 'failed');
      assert.equal(state.budget?.implementationAttempts, 0);
    }
  } finally { git(repository, ['worktree', 'remove', '--force', state.workspace]); }
});
