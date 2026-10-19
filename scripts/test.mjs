import { readdirSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runProcess } from '../factory/process.ts';

const args = ['--import', 'tsx', '--test', '--test-reporter=spec'];
if (process.env.NODE_TEST_CONCURRENCY !== undefined) {
  const concurrency = Number(process.env.NODE_TEST_CONCURRENCY);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('NODE_TEST_CONCURRENCY must be a positive integer.');
  args.push(`--test-concurrency=${concurrency}`);
}
const directory = resolve(process.env.RUN_DIR ?? '.runs/node');
const timeoutMs = Number(process.env.NODE_TEST_TIMEOUT_MS ?? 180000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('NODE_TEST_TIMEOUT_MS must be a positive integer.');
mkdirSync(directory, { recursive: true });
args.push(`--test-reporter=${resolve('factory/node-reporter.mjs')}`, '--test-reporter-destination=stdout', `--test-reporter-destination=${resolve(directory, 'node-results.jsonl')}`);
const discover = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? discover(join(directory, entry.name)) : entry.name.endsWith('.test.ts') ? [resolve(directory, entry.name)] : []).sort();
args.push(...process.argv.slice(2), ...discover('tests'));
const result = await runProcess({ command: process.execPath, args, cwd: process.cwd(), logPath: resolve(directory, 'node.log'), timeoutMs, graceMs: 6000, onOutput: text => process.stdout.write(text) });
process.exitCode = result.status === 'passed' ? 0 : 1;
