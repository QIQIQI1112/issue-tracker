import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Issue, IssuePatch, NewIssue } from './domain.ts';

const columns = 'id, title, description, status, priority, created_at AS createdAt, updated_at AS updatedAt';

export class IssueStore {
  readonly path: string;
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.path = path === ':memory:' ? path : resolve(path);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true });
    this.database = new DatabaseSync(this.path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
        description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
        status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'done')),
        priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }

  list(): Issue[] {
    return this.database.prepare(`SELECT ${columns} FROM issues ORDER BY id DESC`).all() as unknown as Issue[];
  }

  get(id: number): Issue | undefined {
    return this.database.prepare(`SELECT ${columns} FROM issues WHERE id = ?`).get(id) as unknown as Issue | undefined;
  }

  create(input: NewIssue): Issue {
    const now = new Date().toISOString();
    const result = this.database.prepare('INSERT INTO issues (title, description, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.title, input.description, input.status, input.priority, now, now);
    return this.get(Number(result.lastInsertRowid))!;
  }

  update(id: number, patch: IssuePatch): Issue | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.database.prepare('UPDATE issues SET title = ?, description = ?, status = ?, priority = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.description, next.status, next.priority, new Date().toISOString(), id);
    return this.get(id);
  }

  delete(id: number): boolean {
    return this.database.prepare('DELETE FROM issues WHERE id = ?').run(id).changes > 0;
  }

  close(): void {
    this.database.close();
  }
}
