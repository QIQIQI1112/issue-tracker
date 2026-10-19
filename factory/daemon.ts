import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { acquireExecutionLease } from './lease.ts';
import { SerialQueue } from './queue.ts';

const path = resolve(process.env.DB_PATH ?? '.data/issues.sqlite');
const release = acquireExecutionLease(`${path}.queue`, randomUUID());
let store: IssueStore | undefined;
const cancelled = new AbortController();
let stopping = false;
process.once('SIGINT', () => { stopping = true; cancelled.abort(); });
process.once('SIGTERM', () => { stopping = true; cancelled.abort(); });
try {
  store = new IssueStore(path);
  const queue = new SerialQueue(store, { signal: cancelled.signal });
  queue.recover();
  console.log(JSON.stringify({ event: 'queue-ready', databasePath: path, evidenceRoot: queue.evidenceRoot }));
  do {
    const executed = await queue.processNext();
    if (!executed && !stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!stopping && !process.argv.includes('--once'));
} finally { store?.close(); release(); }
