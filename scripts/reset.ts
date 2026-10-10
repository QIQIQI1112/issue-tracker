import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCreateIssue } from '../src/domain.ts';
import { acquireDatabaseLock } from '../src/instance.ts';
import { IssueStore } from '../src/storage.ts';

if (!process.argv.includes('--confirm')) {
  console.error('Reset replaces the local database with disposable demo issues. Stop the app, then run npm run reset -- --confirm.');
  process.exit(1);
}
const path = resolve(process.env.DB_PATH ?? '.data/issues.sqlite');
const release = acquireDatabaseLock(path, 'reset');
try {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const store = new IssueStore(path);
  try {
    for (const input of [
      { title: 'Explore the local workspace', description: 'Disposable demo issue. Open this issue, rename it, and try changing its status.', status: 'open', priority: 'medium' },
      { title: 'Trace a change from UI to SQLite', description: 'Follow src/ui → src/api.ts → src/storage.ts. The real development backlog will live in GitHub, not this demo database.', status: 'in_progress', priority: 'high' },
      { title: 'Run the verification harness', description: 'npm run verify uses a separate test database and produces logs, browser traces, and a machine-readable result.', status: 'open', priority: 'high' },
      { title: 'Review the architecture map', description: 'Read AGENTS.md and docs/architecture.md before your next exercise.', status: 'done', priority: 'low' },
    ]) store.create(parseCreateIssue(input));
    console.log(JSON.stringify({ reset: true, databasePath: path, issueCount: store.list().length }));
  } finally { store.close(); }
} finally { release(); }
