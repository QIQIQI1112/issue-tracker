import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { createApp } from '../src/api.ts';

export const sourceLimit = 256 * 1024;
export const aggregateLimit = 2 * 1024 * 1024;
export const fixedSources = ['package.json', 'AGENTS.md', 'README.md', 'scripts/verify.mjs', 'scripts/verify-ci.mjs', 'scripts/test.mjs', 'factory/verification-contract.json', 'factory/ci-verification-contract.json', 'docs/architecture.md', 'docs/verification.md', 'docs/ci-critical.md', 'docs/workbench.md', 'docs/harness-reliability.md', 'docs/github-delivery.md', '.github/workflows/verify.yml'];

export function gitAt(path: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd: path, encoding: 'utf8', input, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function put(path: string, file: string, content: string | Buffer) {
  mkdirSync(dirname(join(path, file)), { recursive: true });
  writeFileSync(join(path, file), content);
}

export function commitFiles(path: string, files: Record<string, string | Buffer>): string {
  for (const [file, content] of Object.entries(files)) put(path, file, content);
  gitAt(path, ['add', '--all']);
  gitAt(path, ['commit', '--allow-empty', '-m', 'Disposable harness snapshot']);
  return gitAt(path, ['rev-parse', 'HEAD']);
}

export function harnessRepository(path: string, marker: string) {
  mkdirSync(path, { recursive: true });
  gitAt(path, ['init', '-b', 'main']);
  gitAt(path, ['config', 'user.name', 'Harness fixture']);
  gitAt(path, ['config', 'user.email', 'harness@example.invalid']);
  const full = { schemaVersion: 1, requiredNodeTests: [{ file: 'tests/value.test.ts', title: `${marker} required Node case` }], requiredBrowserTests: [{ file: 'value.spec.ts', title: `${marker} required browser case` }] };
  const critical = { schemaVersion: 1, profile: 'ci-critical', nodeFiles: ['tests/value.test.ts'], requiredNodeTests: [{ file: 'tests/value.test.ts', title: `${marker} critical Node case` }], requiredBrowserTests: [{ file: 'value.spec.ts', title: `${marker} critical browser case` }] };
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: marker, scripts: { verify: 'node scripts/verify.mjs', 'verify:ci': 'node scripts/verify-ci.mjs', test: 'node scripts/test.mjs', lint: `${marker}-lint --check`, typecheck: `${marker}-types`, build: `${marker}-build` } }),
    'scripts/verify.mjs': `const gates = ['lint', 'typecheck', 'test', 'build'];\nconsole.log('${marker} custom verifier source', gates);\n`,
    'scripts/verify-ci.mjs': `console.log('${marker} ci-critical verifier source');\n`,
    'scripts/test.mjs': `console.log('${marker} discovers Node test files');\n`,
    'factory/verification-contract.json': JSON.stringify(full),
    'factory/ci-verification-contract.json': JSON.stringify(critical),
    'AGENTS.md': `${marker} repository instructions\n`,
    'README.md': `${marker} readme\n`,
    'docs/verification.md': `${marker} verification documentation\n`,
    '.github/workflows/verify.yml': `name: ${marker} CI\non: push\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run verify:ci\n`,
  };
  const commit = commitFiles(path, files);
  return { path, marker, files, full, critical, commit };
}

export async function getInProcess(app: ReturnType<typeof createApp>, url: string): Promise<{ status: number; body: unknown; text: string }> {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } }) as Socket;
  const request = new IncomingMessage(socket);
  request.method = 'GET'; request.url = url; request.headers = { host: '127.0.0.1' }; request.httpVersion = '1.1';
  const response = new ServerResponse(request);
  response.assignSocket(socket);
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve); response.once('error', reject);
    app(request, response); request.push(null);
  });
  const raw = Buffer.concat(chunks).toString('utf8');
  const text = raw.slice(raw.indexOf('\r\n\r\n') + 4);
  socket.destroy();
  assert.match(response.getHeader('content-type')?.toString() ?? '', /application\/json/, 'Harness responses must use JSON, including errors.');
  return { status: response.statusCode, body: JSON.parse(text), text };
}

export function objects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(objects);
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(objects)];
}

export function sourceRecord(body: unknown, path: string): Record<string, unknown> {
  const source = objects(body).find(item => item.path === path || item.file === path);
  assert.ok(source, `Harness must identify the committed source ${path}.`);
  return source;
}

export function sourceState(body: unknown, path: string, state: RegExp) {
  const source = sourceRecord(body, path);
  const diagnostics = Object.fromEntries(['status', 'state', 'error', 'reason', 'message', 'warnings', 'diagnostics', 'availability'].filter(key => key in source).map(key => [key, source[key]]));
  assert.match(JSON.stringify(diagnostics), state, `${path} must explicitly report ${state} independently of untrusted source text.`);
  return source;
}
