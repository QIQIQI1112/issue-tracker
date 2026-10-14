import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Issue, IssuePatch, NewIssue } from './domain.ts';
import { parseLabels } from './domain.ts';
import { WorkflowStore } from './workflow-store.ts';
import { ConflictError } from './workflow.ts';

const columns = 'id, title, description, status, priority, labels, created_at AS createdAt, updated_at AS updatedAt';
const migrations = [
  `CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
    status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'done')),
    priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  "ALTER TABLE issues ADD COLUMN labels TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(labels) AND json_type(labels) = 'array');",
  `CREATE TABLE repos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, target_branch TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE requirements (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES repos(id), title TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE issue_context (issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE, repo_id INTEGER NOT NULL REFERENCES repos(id), requirement_id INTEGER REFERENCES requirements(id), depends_on TEXT NOT NULL, acceptance TEXT NOT NULL);
   CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL REFERENCES repos(id), requirement_id INTEGER REFERENCES requirements(id), issue_id INTEGER REFERENCES issues(id), kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, run_id TEXT, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE work_runs (id TEXT PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), repo_id INTEGER NOT NULL REFERENCES repos(id), requirement_id INTEGER REFERENCES requirements(id), issue_id INTEGER REFERENCES issues(id), status TEXT NOT NULL, evidence_path TEXT NOT NULL, reason TEXT, started_at TEXT NOT NULL, completed_at TEXT);
   CREATE INDEX job_queue ON jobs(status, id);`,
  `CREATE TABLE plan_submissions (id TEXT PRIMARY KEY, requirement_id INTEGER NOT NULL UNIQUE REFERENCES requirements(id), plan_hash TEXT NOT NULL, plan TEXT NOT NULL, issue_ids TEXT NOT NULL, created_at TEXT NOT NULL);`,
];

function issueRow(input: unknown): Issue {
  const row = input as Omit<Issue, 'labels'> & { labels: string };
  try { return { ...row, labels: parseLabels(JSON.parse(row.labels)) }; }
  catch (error) { throw new Error('Stored issue labels are invalid.', { cause: error }); }
}

export class IssueStore {
  readonly path: string;
  private readonly database: DatabaseSync;
  readonly work: WorkflowStore;

  constructor(path: string) {
    this.path = path === ':memory:' ? path : resolve(path);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path);
    try {
      this.database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
      try {
        const version = (this.database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > migrations.length) throw new Error('Database schema version is newer than this application.');
        for (let index = version; index < migrations.length; index += 1) {
          this.database.exec(migrations[index]);
          this.database.exec(`PRAGMA user_version = ${index + 1}`);
        }
        this.database.exec('COMMIT');
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
      this.database.exec('PRAGMA journal_mode = WAL;');
    } catch (error) { this.database.close(); throw error; }
    this.work = new WorkflowStore(this.database, this);
  }

  private enriched(row: unknown): Issue {
    const issue = issueRow(row);
    const work = this.work.context(issue.id);
    return work ? { ...issue, work } : issue;
  }

  private transaction<T>(action: () => T): T {
    if (this.database.isTransaction) return action();
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  list(): Issue[] {
    return this.database.prepare(`SELECT ${columns} FROM issues ORDER BY id DESC`).all().map(row => this.enriched(row));
  }

  get(id: number): Issue | undefined {
    const row = this.database.prepare(`SELECT ${columns} FROM issues WHERE id = ?`).get(id);
    return row ? this.enriched(row) : undefined;
  }

  create(input: NewIssue): Issue {
    return this.transaction(() => {
      if (input.work) this.work.validateContext(null, input.work);
      const now = new Date().toISOString();
      const result = this.database.prepare('INSERT INTO issues (title, description, status, priority, labels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.title, input.description, input.status, input.priority, JSON.stringify(input.labels), now, now);
      const id = Number(result.lastInsertRowid);
      if (input.work) this.work.assign(id, input.work);
      return this.get(id)!;
    });
  }

  update(id: number, patch: IssuePatch): Issue | undefined {
    return this.transaction(() => {
      const current = this.get(id);
      if (!current) return undefined;
      this.work.assertEditable(id);
      if (current.work && patch.status === 'done' && this.work.runs().some(run => run.issueId === id) && !this.work.runs().some(run => run.issueId === id && run.status === 'merged')) throw new ConflictError('Executed issues complete only after verified automatic merge.');
      if (patch.work) this.work.validateContext(id, patch.work);
      const next = { ...current, ...patch };
      this.database.prepare('UPDATE issues SET title = ?, description = ?, status = ?, priority = ?, labels = ?, updated_at = ? WHERE id = ?')
        .run(next.title, next.description, next.status, next.priority, JSON.stringify(next.labels), new Date().toISOString(), id);
      if (patch.work) this.work.assign(id, patch.work);
      return this.get(id);
    });
  }

  delete(id: number): boolean {
    return this.transaction(() => {
      this.work.assertDeletable(id);
      return this.database.prepare('DELETE FROM issues WHERE id = ?').run(id).changes > 0;
    });
  }

  close(): void {
    this.database.close();
  }
}
