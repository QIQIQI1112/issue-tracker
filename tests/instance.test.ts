import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a database has one owner and becomes available after release', async () => {
  const module = await import('../src/instance.ts').catch(() => null);
  assert.ok(module, 'Database ownership protection is not implemented yet');
  const directory = mkdtempSync(join(tmpdir(), 'issue-lock-'));
  const path = join(directory, 'issues.sqlite');
  try {
    const release = module.acquireDatabaseLock(path, 'first');
    assert.throws(() => module.acquireDatabaseLock(path, 'second'), /locked/);
    release();
    const second = module.acquireDatabaseLock(path, 'second');
    release();
    assert.throws(() => module.acquireDatabaseLock(path, 'third'), /locked/);
    second();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
