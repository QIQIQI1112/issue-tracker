import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { IssueStore, DATABASE_SCHEMA_VERSION } from '../src/storage.ts';
import { parseCreateIssue } from '../src/domain.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const legacySchema = `
  PRAGMA foreign_keys=ON;
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
    status TEXT NOT NULL CHECK(status IN ('open','in_progress','done')),
    priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    labels TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(labels) AND json_type(labels)='array')
  );
  CREATE TABLE repos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, target_branch TEXT NOT NULL, created_at TEXT NOT NULL, github TEXT CHECK(github IS NULL OR json_valid(github)));
  CREATE TABLE requirements (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES repos(id), title TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, publication TEXT CHECK(publication IS NULL OR json_valid(publication)));
  CREATE TABLE issue_context (issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE, repo_id INTEGER NOT NULL REFERENCES repos(id), requirement_id INTEGER REFERENCES requirements(id), depends_on TEXT NOT NULL, acceptance TEXT NOT NULL);
  CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES repos(id), requirement_id INTEGER REFERENCES requirements(id), issue_id INTEGER REFERENCES issues(id), kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, run_id TEXT, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, available_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE work_runs (id TEXT PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), repo_id INTEGER NOT NULL REFERENCES repos(id), requirement_id INTEGER REFERENCES requirements(id), issue_id INTEGER REFERENCES issues(id), status TEXT NOT NULL, evidence_path TEXT NOT NULL, reason TEXT, started_at TEXT NOT NULL, completed_at TEXT);
  CREATE INDEX job_queue ON jobs(status,id);
  CREATE TABLE plan_submissions (id TEXT PRIMARY KEY, requirement_id INTEGER NOT NULL UNIQUE REFERENCES requirements(id), plan_hash TEXT NOT NULL, plan TEXT NOT NULL, issue_ids TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE issue_change_kinds (issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE, change_kind TEXT NOT NULL CHECK(change_kind IN ('feature','acceptance_contract','harness')));
  PRAGMA user_version=6;
`;

const retainedTables = ['repos', 'requirements', 'issue_context', 'jobs', 'work_runs', 'plan_submissions', 'issue_change_kinds'];
const timestamp = '2026-01-02T03:04:05.000Z';

function fixture(label: string) {
  const root = evidenceDirectory(label);
  const path = join(root, 'v6.sqlite');
  const database = new DatabaseSync(path);
  database.exec(legacySchema);
  const github = { repository: 'fixture/project', remote: 'origin', workflow: 'verify.yml' };
  database.prepare('INSERT INTO repos VALUES (?,?,?,?,?,?)').run(4, 'Original repository', '/original-repository', 'main', timestamp, JSON.stringify(github));
  const publication = { ...github, branch: 'codex/requirement-7-original', baseBranch: 'main', state: 'blocked', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40), verifiedRunId: 'old-verification', deadline: 1999999999999, number: 12, url: 'https://github.com/fixture/project/pull/12', ciRunId: 1234, ciUrl: 'https://github.com/fixture/project/actions/runs/1234', ciHead: 'b'.repeat(40), mergeCommit: 'c'.repeat(40), reason: 'Original publication blocker.' };
  database.prepare('INSERT INTO requirements VALUES (?,?,?,?,?,?,?,?)').run(7, 4, 'Original goal', 'Preserve this exact original business goal.', 'blocked', timestamp, timestamp, JSON.stringify(publication));
  const ids = { failed: 11, retried: 13, queued: 17, running: 19, merged: 23, open: 29, manualDone: 31, manualProgress: 37, maintenance: 41, olderActive: 47 };
  const insertIssue = database.prepare('INSERT INTO issues (id,title,description,status,priority,created_at,updated_at,labels) VALUES (?,?,?,?,?,?,?,?)');
  for (const [key, id] of Object.entries(ids)) {
    const status = key === 'running' || key === 'manualProgress' || key === 'olderActive' ? 'in_progress' : key === 'merged' || key === 'manualDone' ? 'done' : 'open';
    insertIssue.run(id, `Original ${key}`, `Original ${key} description.`, status, 'high', timestamp, timestamp, JSON.stringify(['original', key.toLowerCase()]));
    database.prepare('INSERT INTO issue_context VALUES (?,?,?,?,?)').run(id, 4, 7, JSON.stringify(key === 'retried' ? [ids.failed] : []), JSON.stringify([`Original ${key} condition.`]));
    database.prepare('INSERT INTO issue_change_kinds VALUES (?,?)').run(id, key === 'maintenance' ? 'harness' : 'feature');
  }
  insertIssue.run(1001, 'Deleted high-water issue', '', 'open', 'medium', timestamp, timestamp, '[]');
  database.prepare('DELETE FROM issues WHERE id=1001').run();
  const plan = { schemaVersion: 2, submissionId: 'v6-original-plan', repoId: 4, requirement: { title: 'Original goal', goal: 'Preserve this exact original business goal.' }, source: { kind: 'codex', reference: 'original-v6-conversation', summary: 'Original source summary.' }, assumptions: [], issues: Object.entries(ids).map(([key]) => ({ key, title: `Original ${key}`, description: `Original ${key} description.`, acceptance: [`Original ${key} condition.`], dependsOn: key === 'retried' ? ['failed'] : [], ...(key === 'maintenance' ? { changeKind: 'harness' } : {}) })) };
  database.prepare('INSERT INTO plan_submissions VALUES (?,?,?,?,?,?)').run(plan.submissionId, 7, 'original-plan-hash', JSON.stringify(plan), JSON.stringify(ids), timestamp);
  let jobId = 50;
  function addJob(issueId: number, status: 'blocked' | 'queued' | 'running' | 'completed', outcome?: string) {
    const id = ++jobId;
    const runId = outcome ? `original-run-${id}` : null;
    database.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 4, 7, issueId, issueId === ids.maintenance ? 'maintenance' : 'issue', status, JSON.stringify({ original: true, budget: { usedMs: id * 100, implementationAttempts: 3, acceptanceAttempts: 2 } }), runId, status === 'blocked' ? 'Original failure.' : null, timestamp, timestamp, id * 1000);
    if (runId) {
      const evidencePath = join(root, runId);
      mkdirSync(evidencePath);
      writeFileSync(join(evidencePath, 'delivery.json'), JSON.stringify({ runId, status: outcome, summary: 'Original retained evidence.' }));
      database.prepare('INSERT INTO work_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(runId, id, 4, 7, issueId, outcome!, evidencePath, outcome === 'blocked' ? 'Original failure.' : null, `${timestamp.slice(0, 20)}${String(id).padStart(3, '0')}Z`, outcome === 'running' ? null : timestamp);
    }
  }
  addJob(ids.failed, 'blocked', 'blocked');
  addJob(ids.retried, 'blocked', 'blocked'); addJob(ids.retried, 'completed', 'passed');
  addJob(ids.queued, 'blocked', 'blocked'); addJob(ids.queued, 'queued');
  addJob(ids.running, 'blocked', 'blocked'); addJob(ids.running, 'running', 'running');
  addJob(ids.merged, 'completed', 'merged'); addJob(ids.merged, 'blocked', 'blocked');
  addJob(ids.maintenance, 'blocked', 'blocked');
  addJob(ids.olderActive, 'running', 'running'); addJob(ids.olderActive, 'blocked', 'blocked');
  const retained = Object.fromEntries(retainedTables.map(table => [table, database.prepare(`SELECT * FROM ${table}`).all()]));
  const issues = database.prepare('SELECT id,title,description,priority,labels,created_at FROM issues ORDER BY id').all();
  const evidence = database.prepare('SELECT evidence_path FROM work_runs').all().map(row => ({ path: join(String(row.evidence_path), 'delivery.json'), bytes: readFileSync(join(String(row.evidence_path), 'delivery.json'), 'utf8') }));
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  database.close();
  return { path, ids, retained, issues, evidence };
}

test('version-six lifecycle migration preserves every issue identity, immutable plan, relationship, job, run, publication and evidence file', () => {
  const original = fixture('lifecycle-migration-preserve');
  const store = new IssueStore(original.path);
  try {
    assert.ok(DATABASE_SCHEMA_VERSION > 6, 'Blocked and closure persistence require an explicit migration beyond the version-six schema.');
    const database = new DatabaseSync(original.path, { readOnly: true });
    try {
      assert.equal((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, DATABASE_SCHEMA_VERSION);
      for (const table of retainedTables) assert.deepEqual(database.prepare(`SELECT * FROM ${table}`).all(), original.retained[table], `${table} must survive the issues table migration byte-for-byte.`);
      assert.deepEqual(database.prepare('SELECT id,title,description,priority,labels,created_at FROM issues ORDER BY id').all(), original.issues);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(database.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      assert.ok(database.prepare('PRAGMA foreign_key_list(issue_context)').all().some(row => row.table === 'issues' && row.on_delete === 'CASCADE'));
      for (const item of original.evidence) assert.equal(readFileSync(item.path, 'utf8'), item.bytes);
      assert.equal(store.work.submission('v6-original-plan')?.plan.source.reference, 'original-v6-conversation');
      assert.equal(store.work.requirement(7)?.publication?.ciHead, 'b'.repeat(40));
      assert.ok(store.list().every(item => !('closure' in item)), 'Existing issues must retain the old public shape until explicitly closed.');
    } finally { database.close(); }
  } finally { store.close(); }
});

test('version-six lifecycle migration backfills only latest blocked inactive unmerged work and preserves AUTOINCREMENT and foreign-key enforcement', () => {
  const original = fixture('lifecycle-migration-backfill');
  const store = new IssueStore(original.path);
  const expected = { failed: 'blocked', retried: 'open', queued: 'open', running: 'in_progress', merged: 'done', open: 'open', manualDone: 'done', manualProgress: 'in_progress', maintenance: 'blocked', olderActive: 'in_progress' };
  try {
    assert.deepEqual(Object.fromEntries(Object.entries(original.ids).map(([key, id]) => [key, store.get(id)?.status])), expected, 'Only latest blocked, inactive issues without any recorded merge may backfill to Blocked.');
    const fresh = store.create(parseCreateIssue({ title: 'After migration' }));
    assert.equal(fresh.id, 1002, 'Migrating the issues table must preserve deleted issue IDs in the sequence high-water mark.');
    assert.throws(() => store.delete(original.ids.failed), /immutable|history|depend/i);
    const dependent = store.create({ ...parseCreateIssue({ title: 'Delete cascade probe' }), work: { repoId: 4, requirementId: null, dependsOn: [], acceptance: ['The fixture is removable.'] } });
    assert.equal(store.delete(dependent.id), true);
    const database = new DatabaseSync(original.path, { readOnly: true });
    try {
      assert.equal(database.prepare('SELECT issue_id FROM issue_context WHERE issue_id=?').get(dependent.id), undefined, 'Foreign keys must be reenabled after migration so issue-context cascades remain enforced.');
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(database.prepare('SELECT * FROM issues WHERE id=?').get(original.ids.failed)?.status, 'blocked');
    } finally { database.close(); }
  } finally { store.close(); }
  const reopened = new IssueStore(original.path);
  try {
    assert.deepEqual(Object.fromEntries(Object.entries(original.ids).map(([key, id]) => [key, reopened.get(id)?.status])), expected);
    assert.equal(reopened.create(parseCreateIssue({ title: 'After second open' })).id, 1004);
    for (const table of retainedTables) {
      const database = new DatabaseSync(original.path, { readOnly: true });
      try { assert.deepEqual(database.prepare(`SELECT * FROM ${table}`).all(), original.retained[table]); }
      finally { database.close(); }
    }
  } finally { reopened.close(); }
});
