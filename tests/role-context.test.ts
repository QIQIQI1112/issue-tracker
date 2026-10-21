import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceDirectory } from './helpers/subprocess.ts';

type Evidence = { path: string; bytes: number; sha256: string; purpose?: string };
type ContextInput = { directory: string; role: string; goal: string; relevantPaths?: string[]; decisions?: { decision: string; reason: string }[]; feedback: string; sourceHash: string; evidence?: { path: string; purpose?: string }[] };
type ContextIndex = { schemaVersion: number; role: string; goal: string; sourceHash: string; relevantPaths: string[]; decisions: { decision: string; reason: string }[]; feedback: Evidence; evidence: Evidence[] };
type ContextModule = { writeRoleContext: (input: ContextInput) => Evidence & { indexPath: string; index: ContextIndex } };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function contextModule() {
  const path = '../factory/optimization.ts';
  const module = await import(path).catch(() => null) as ContextModule | null;
  assert.ok(module && typeof module.writeRoleContext === 'function', 'Role handoff must retain complete source-bound feedback and an owner evidence index.');
  return module;
}

test('role context retains complete UTF-8 feedback and indexes actual failed evidence independently of worker claims', async () => {
  const module = await contextModule();
  const root = evidenceDirectory('role-context');
  const directory = join(root, 'phase');
  const prior = join(root, 'prior');
  mkdirSync(directory);
  mkdirSync(prior);
  const proofPath = join(prior, 'summary.json');
  const proof = JSON.stringify({ status: 'failed', snapshot: { hash: 'a'.repeat(64) }, checks: [{ name: 'test', status: 'failed' }], error: 'A reproducible assertion failed.' });
  writeFileSync(proofPath, proof);
  const feedback = `Worker claims everything passed.\n${'Retain this full diagnostic context: 诊断证据。\n'.repeat(2000)}Original terminal failure must remain available.\n`;
  const input: ContextInput = { directory, role: 'repair', goal: 'Deliver the original goal using actual owner verification.', sourceHash: 'a'.repeat(64), relevantPaths: ['src/value.ts', 'tests/value.test.ts'], decisions: [{ decision: 'Preserve existing checks.', reason: 'The accepted behavior contract remains unchanged.' }], feedback, evidence: [{ path: proofPath, purpose: 'Owner verification failure' }] };
  const result = module.writeRoleContext(input);
  assert.equal(readFileSync(result.path, 'utf8'), feedback);
  assert.equal(result.bytes, Buffer.byteLength(feedback));
  assert.equal(result.sha256, digest(feedback));
  const indexBytes = readFileSync(result.indexPath);
  const index = JSON.parse(indexBytes.toString('utf8')) as ContextIndex;
  assert.deepEqual(index, result.index);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.role, input.role);
  assert.equal(index.goal, input.goal);
  assert.equal(index.sourceHash, input.sourceHash);
  assert.deepEqual(index.relevantPaths, input.relevantPaths);
  assert.deepEqual(index.decisions, input.decisions);
  assert.equal(index.feedback.path, result.path);
  assert.equal(index.feedback.bytes, result.bytes);
  assert.equal(index.feedback.sha256, result.sha256);
  assert.ok(indexBytes.length < Buffer.byteLength(feedback) / 4, 'The handoff index must reference full retained feedback instead of copying large diagnostics.');
  assert.deepEqual(index.evidence, [{ path: proofPath, purpose: 'Owner verification failure', bytes: Buffer.byteLength(proof), sha256: digest(proof) }]);
  assert.equal(JSON.parse(readFileSync(proofPath, 'utf8')).status, 'failed', 'Worker narrative cannot rewrite or replace the owner verification artifact.');
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'context-identity.json'), 'utf8')), { indexPath: result.indexPath, sha256: digest(indexBytes) });
});

test('role context reads regular owner evidence paths and rejects missing traversal symlink or directory inputs', async () => {
  const module = await contextModule();
  const root = evidenceDirectory('role-context-paths');
  const directory = join(root, 'phase');
  mkdirSync(directory);
  mkdirSync(join(directory, 'evidence'));
  writeFileSync(join(directory, 'evidence/summary.json'), '{"status":"failed"}\n');
  const outside = join(root, 'prior-summary.json');
  writeFileSync(outside, '{"status":"failed","owner":"prior run"}\n');
  symlinkSync(outside, join(directory, 'evidence-link.json'));
  const input: ContextInput = { directory, role: 'review', goal: 'Inspect actual owner evidence.', sourceHash: 'b'.repeat(64), feedback: 'Full reviewer feedback.' };
  for (const path of ['evidence/summary.json', outside]) {
    const result = module.writeRoleContext({ ...input, evidence: [{ path }] });
    assert.equal(result.index.evidence.length, 1);
    assert.equal(result.index.evidence[0].sha256, digest(readFileSync(result.index.evidence[0].path)));
  }
  for (const path of ['missing.json', '../prior-summary.json', 'evidence-link.json', 'evidence']) assert.throws(() => module.writeRoleContext({ ...input, evidence: [{ path }] }), `Unsafe or missing evidence must not be silently indexed: ${path}`);
  assert.equal(readFileSync(outside, 'utf8'), '{"status":"failed","owner":"prior run"}\n');
});
