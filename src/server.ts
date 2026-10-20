import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApp } from './api.ts';
import { acquireDatabaseLock, resolveDatabasePath } from './instance.ts';
import { IssueStore } from './storage.ts';
import { parseRepository } from './repository.ts';
import { spawnSync } from 'node:child_process';

const port = Number(process.env.API_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be between 1 and 65535.');
const databasePath = resolveDatabasePath(process.env.DB_PATH ?? '.data/issues.sqlite');
const instanceId = process.env.INSTANCE_ID ?? randomUUID();
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const release = acquireDatabaseLock(databasePath, instanceId);
let store: IssueStore;
try { store = new IssueStore(databasePath); } catch (error) { release(); throw error; }
try {
  if (process.env.FACTORY_REGISTER_SELF !== '0' && !store.work.repos().length) {
    const branch = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
    if (branch.status === 0) store.work.addRepo(parseRepository({ name: 'issue-tracker', path: process.cwd(), targetBranch: branch.stdout.trim() }));
  }
  const repo = store.work.repos()[0];
  if (repo) for (const issue of store.list().filter(issue => !issue.work)) store.work.assign(issue.id, { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: [issue.title] });
} catch (error) { store.close(); release(); throw error; }
const app = createApp(store, { instanceId, version });
if (existsSync('dist/index.html')) app.use(express.static(resolve('dist')));
const server = app.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'ready', url: `http://127.0.0.1:${port}`, instanceId, databasePath, version }));
});
let closing = false;
function cleanup() { store.close(); release(); }
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => { cleanup(); });
  server.closeAllConnections();
}
server.once('error', error => { console.error(error.message); cleanup(); process.exitCode = 1; });
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
