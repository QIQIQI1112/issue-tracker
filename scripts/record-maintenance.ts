import { resolve } from 'node:path';
import { IssueStore } from '../src/storage.ts';
import { recordMaintenance } from '../factory/maintenance.ts';

const args = process.argv.slice(2);
function argument(name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Required argument: ${name}`);
  return args[index + 1];
}
let store: IssueStore | undefined;
try {
  const path = resolve(argument('--database'));
  const issueId = Number(argument('--issue'));
  if (!Number.isSafeInteger(issueId) || issueId < 1) throw new Error('Invalid issue ID.');
  store = new IssueStore(path);
  const delivery = recordMaintenance(store, { issueId, commit: argument('--commit'), verificationPath: resolve(argument('--verification')), reviewPath: resolve(argument('--review')) });
  console.log(JSON.stringify({ issueId, runId: delivery.runId, status: delivery.status, integration: delivery.integration }));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally { store?.close(); }
