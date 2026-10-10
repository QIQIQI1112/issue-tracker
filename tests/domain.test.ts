import { test } from 'node:test';
import assert from 'node:assert/strict';

test('creation trims title and sets defaults', async () => {
  const module = await import('../src/domain.ts').catch(() => null);
  assert.ok(module, 'Issue validation is not implemented yet');
  assert.deepEqual(module.parseCreateIssue({ title: '  Fix refresh  ' }), { title: 'Fix refresh', description: '', status: 'open', priority: 'medium' });
});

test('creation rejects blank and overlong titles', async () => {
  const { parseCreateIssue } = await import('../src/domain.ts');
  for (const title of ['', '   ', 'x'.repeat(121)]) {
    assert.throws(() => parseCreateIssue({ title }), /Title/);
  }
});

test('creation rejects malformed bodies, unknown fields, and invalid enum values', async () => {
  const { parseCreateIssue } = await import('../src/domain.ts');
  for (const input of [null, [], 'text', {}, { title: 123 }, { title: 'Issue', status: 'unknown' }, { title: 'Issue', priority: 'urgent' }, { title: 'Issue', id: 99 }, { title: 'Issue', description: 'x'.repeat(2001) }]) {
    assert.throws(() => parseCreateIssue(input));
  }
});

test('a patch changes only explicitly supplied fields', async () => {
  const module = await import('../src/domain.ts');
  assert.equal(typeof module.parsePatchIssue, 'function', 'Patch validation is not implemented yet');
  assert.deepEqual(module.parsePatchIssue({ title: '  Rename  ', status: 'done' }), { title: 'Rename', status: 'done' });
});

test('patch validation rejects empty, immutable, and invalid values', async () => {
  const module = await import('../src/domain.ts');
  assert.equal(typeof module.parsePatchIssue, 'function', 'Patch validation is not implemented yet');
  for (const input of [{}, { id: 1 }, { title: '' }, { status: null }, { priority: 1 }, { description: 42 }]) {
    assert.throws(() => module.parsePatchIssue(input));
  }
});
