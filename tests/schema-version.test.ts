import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import * as storage from '../src/storage.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('storage declares the exact schema version applied to newly opened databases', () => {
  const supported = (storage as unknown as Record<string, unknown>).DATABASE_SCHEMA_VERSION;
  assert.equal(typeof supported, 'number', 'Storage must expose its supported migration contract.');
  assert.ok(Number.isSafeInteger(supported) && Number(supported) >= 4);
  const path = join(evidenceDirectory('declared-schema'), 'state.sqlite');
  new storage.IssueStore(path).close();
  const database = new DatabaseSync(path);
  try { assert.equal((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, supported); }
  finally { database.close(); }
});
