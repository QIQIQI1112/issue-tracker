import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Issue, IssuePatch, NewIssue } from './domain.ts';
import { parseCloseIssue, parseLabels, ValidationError } from './domain.ts';
import { WorkflowStore } from './workflow-store.ts';
import { ConflictError } from './workflow.ts';
import { resolveDatabasePath } from './instance.ts';

const columns = 'id, title, description, status, priority, labels, created_at AS createdAt, updated_at AS updatedAt, closure_reason AS closureReason, closed_at AS closedAt, superseded_by AS supersededBy';
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
  `CREATE TABLE IF NOT EXISTS issue_change_kinds (issue_id INTEGER PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE, change_kind TEXT NOT NULL CHECK(change_kind IN ('feature','acceptance_contract','harness')));`,
  (database: DatabaseSync) => {
    for (const [table, column, definition] of [['repos', 'github', 'TEXT CHECK(github IS NULL OR json_valid(github))'], ['requirements', 'publication', 'TEXT CHECK(publication IS NULL OR json_valid(publication))'], ['jobs', 'available_at', 'INTEGER NOT NULL DEFAULT 0']]) {
      if (!database.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
  (database: DatabaseSync) => {
    if (!database.prepare('PRAGMA table_info(issues)').all().some(row => row.name === 'closed_at')) {
      const sequence = Number(database.prepare("SELECT seq FROM sqlite_sequence WHERE name='issues'").get()?.seq ?? 0);
      const definitions = database.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='issues' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
      database.exec(`CREATE TABLE issues_lifecycle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
        description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
        status TEXT NOT NULL CHECK(status IN ('open','in_progress','blocked','closed','done')),
        priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(labels) AND json_type(labels) = 'array'),
        closure_reason TEXT CHECK(closure_reason IS NULL OR length(trim(closure_reason)) BETWEEN 1 AND 2000),
        closed_at TEXT,
        superseded_by INTEGER REFERENCES issues(id) ON DELETE RESTRICT CHECK(superseded_by IS NULL OR superseded_by > 0 AND superseded_by <> id),
        CHECK((status='closed' AND closure_reason IS NOT NULL AND closed_at IS NOT NULL) OR (status<>'closed' AND closure_reason IS NULL AND closed_at IS NULL AND superseded_by IS NULL))
      );
      INSERT INTO issues_lifecycle (id,title,description,status,priority,created_at,updated_at,labels)
        SELECT id,title,description,status,priority,created_at,updated_at,labels FROM issues;
      DROP TABLE issues;
      ALTER TABLE issues_lifecycle RENAME TO issues;`);
      database.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='issues'").run(sequence);
      if (!database.prepare("SELECT seq FROM sqlite_sequence WHERE name='issues'").get()) database.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)').run('issues', sequence);
      for (const definition of definitions) database.exec(String(definition.sql));
    }
    database.exec(`UPDATE issues SET status='blocked'
      WHERE status IN ('open','in_progress')
        AND (SELECT status FROM jobs WHERE issue_id=issues.id ORDER BY id DESC LIMIT 1)='blocked'
        AND NOT EXISTS(SELECT 1 FROM jobs WHERE issue_id=issues.id AND status IN ('queued','running'))
        AND NOT EXISTS(SELECT 1 FROM work_runs WHERE issue_id=issues.id AND status IN ('merged','running'));`);
  },
];

export const DATABASE_SCHEMA_VERSION = migrations.length;

function issueRow(input: unknown): Issue {
  const { closureReason, closedAt, supersededBy, ...row } = input as Omit<Issue, 'labels' | 'closure'> & { labels: string; closureReason: string | null; closedAt: string | null; supersededBy: number | null };
  try { return { ...row, labels: parseLabels(JSON.parse(row.labels)), ...(closedAt ? { closure: { reason: closureReason!, closedAt, ...(supersededBy === null ? {} : { supersededBy }) } } : {}) }; }
  catch (error) { throw new Error('Stored issue labels are invalid.', { cause: error }); }
}

export class IssueStore {
  readonly path: string;
  private readonly database: DatabaseSync;
  readonly work: WorkflowStore;

  constructor(path: string) {
    this.path = path === ':memory:' ? path : resolveDatabasePath(path);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path);
    try {
      this.database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
      try {
        const version = (this.database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version > migrations.length) throw new Error('Database schema version is newer than this application.');
        for (let index = version; index < migrations.length; index += 1) {
          const migration = migrations[index];
          if (typeof migration === 'string') this.database.exec(migration);
          else migration(this.database);
          this.database.exec(`PRAGMA user_version = ${index + 1}`);
        }
        if (version < migrations.length && this.database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database migration failed foreign-key integrity checks.');
        this.database.exec('COMMIT');
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
      this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
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
      if (input.status === 'closed') throw new ValidationError('Use the explicit close lifecycle operation to close an issue.');
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
      if (patch.status === 'closed') throw new ValidationError('Use the explicit close lifecycle operation to close an issue.');
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

  closeIssue(id: number, input: unknown): Issue | undefined {
    const value = parseCloseIssue(input);
    return this.transaction(() => {
      const current = this.get(id);
      if (!current) return undefined;
      if (current.status === 'closed') {
        if (current.closure?.reason === value.reason && current.closure.supersededBy === value.supersededBy) return current;
        throw new ConflictError('The issue already has a different recorded closure.');
      }
      const requirementId = current.work?.requirementId;
      const active = this.work.jobs().some(job => (job.issueId === id || job.issueId === null && requirementId !== null && requirementId !== undefined && job.requirementId === requirementId) && ['queued', 'running'].includes(job.status));
      if (current.status === 'done' || active || this.work.runs().some(run => run.issueId === id && ['running', 'merged'].includes(run.status))) throw new ConflictError('Queued, running or merged issues cannot close.');
      if (value.supersededBy !== undefined) {
        const replacement = this.get(value.supersededBy);
        if (!replacement || replacement.id === id || !current.work || replacement.work?.repoId !== current.work.repoId) throw new ValidationError('Replacement must be another existing issue in the same repository.');
        const seen = new Set([id]);
        let next: Issue | undefined = replacement;
        while (next) {
          if (seen.has(next.id)) throw new ValidationError('Replacement issues must not create a supersession cycle.');
          seen.add(next.id);
          next = next.closure?.supersededBy === undefined ? undefined : this.get(next.closure.supersededBy);
        }
      }
      const now = new Date().toISOString();
      this.database.prepare("UPDATE issues SET status='closed', closure_reason=?, closed_at=?, superseded_by=?, updated_at=? WHERE id=?").run(value.reason, now, value.supersededBy ?? null, now, id);
      return this.get(id);
    });
  }

  close(): void {
    this.database.close();
  }
}
