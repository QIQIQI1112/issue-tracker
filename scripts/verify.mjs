import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

if (process.env.UI_TEST_URL !== undefined) {
  throw new Error('UI_TEST_URL is not supported during verification; Playwright must test its owned frontend.');
}

const startedAt = new Date().toISOString();
const runDirectory = resolve('.runs', `verify-${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
mkdirSync(runDirectory, { recursive: true });
const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const diff = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
const summary = { startedAt, runDirectory, commit: head.status === 0 ? head.stdout.trim() : null, dirty: diff.status !== 0 || Boolean(diff.stdout.trim()), status: 'running', checks: [] };
writeFileSync(resolve(runDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
for (const script of ['lint', 'typecheck', 'test', 'build', 'test:e2e']) {
  console.log(`\n[verify] ${script}`);
  const start = Date.now();
  const result = spawnSync('npm', ['run', script], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, RUN_DIR: runDirectory } });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
  process.stdout.write(output);
  writeFileSync(resolve(runDirectory, `${script.replace(':', '-')}.log`), output);
  summary.checks.push({ name: script, exitCode: result.status ?? 1, durationMs: Date.now() - start });
  if (result.status !== 0) { summary.status = 'failed'; break; }
}
if (summary.status === 'running') summary.status = 'passed';
summary.completedAt = new Date().toISOString();
writeFileSync(resolve(runDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(resolve('.runs', 'latest.json'), JSON.stringify({ summaryPath: resolve(runDirectory, 'summary.json') }, null, 2));
console.log(`\nVerification ${summary.status}: ${runDirectory}/summary.json`);
if (summary.status !== 'passed') process.exitCode = 1;
