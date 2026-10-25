import { randomUUID } from 'node:crypto';
import { IssueStore } from '../src/storage.ts';
import { resolveDatabasePath } from '../src/instance.ts';
import { acquireExecutionLease } from './lease.ts';
import { SerialQueue } from './queue.ts';

const args = process.argv.slice(2);
const ownerIndex = args.indexOf('--owner-authorization');
const ownerAuthorizationPath = ownerIndex < 0 ? undefined : args[ownerIndex + 1];
if (args.some((arg, index) => arg !== '--once' && arg !== '--owner-authorization' && !(ownerIndex >= 0 && index === ownerIndex + 1)) || ownerIndex >= 0 && (!ownerAuthorizationPath || !args.includes('--once'))) throw new Error('Use --once with one absolute --owner-authorization request path.');
const path = resolveDatabasePath(process.env.DB_PATH ?? '.data/issues.sqlite');
const release = acquireExecutionLease(`${path}.queue`, randomUUID());
let store: IssueStore | undefined;
const cancelled = new AbortController();
let stopping = false;
process.once('SIGINT', () => { stopping = true; cancelled.abort(); });
process.once('SIGTERM', () => { stopping = true; cancelled.abort(); });
try {
  store = new IssueStore(path);
  const queue = new SerialQueue(store, { signal: cancelled.signal, ownerAuthorizationPath });
  queue.recover();
  console.log(JSON.stringify({ event: 'queue-ready', databasePath: path, evidenceRoot: queue.evidenceRoot }));
  do {
    const executed = await queue.processNext();
    if (!executed && !stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!stopping && !process.argv.includes('--once'));
} finally { store?.close(); release(); }
