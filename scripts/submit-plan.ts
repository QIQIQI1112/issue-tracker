import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSubmission } from '../src/submission.ts';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';
import type { SubmissionReceipt } from '../src/workflow.ts';
import { writeJson } from '../factory/evidence.ts';

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let file: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['--list', '--validate', '--help'].includes(arg)) flags.add(arg);
    else if (['--url', '--database', '--status', '--receipt'].includes(arg)) {
      if (!args[index + 1] || args[index + 1].startsWith('--') || values.has(arg)) throw new Error(`Provide exactly one value for ${arg}.`);
      values.set(arg, args[++index]);
    } else if (arg.startsWith('--') || file) throw new Error(`Unexpected argument: ${arg}.`);
    else file = arg;
  }
  if (flags.has('--help')) {
    console.log('Usage: npm run submit-plan -- <plan.json> [--validate] [--url <loopback-url>] [--database <path>] [--receipt <path>]\n       npm run submit-plan -- --list [--url <loopback-url>] [--database <path>]\n       npm run submit-plan -- --status <submission-id> [--url <loopback-url>] [--database <path>]');
    return;
  }
  const statusId = values.get('--status');
  if ([Boolean(file), flags.has('--list'), Boolean(statusId)].filter(Boolean).length !== 1 || flags.has('--validate') && !file) throw new Error('Choose a plan file, --list, or --status. Use --help for usage.');
  if (statusId && !/^[a-zA-Z0-9_-]{1,100}$/.test(statusId)) throw new Error('Invalid submission ID.');
  const plan = file ? parseSubmission(JSON.parse(readFileSync(resolve(file), 'utf8'))) : undefined;
  if (flags.has('--validate')) { console.log(JSON.stringify({ valid: true, plan }, null, 2)); return; }
  const url = new URL(values.get('--url') ?? `http://127.0.0.1:${process.env.API_PORT ?? 4310}`);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a loopback HTTP origin without credentials, path, query, or fragment.');
  const database = values.get('--database') ?? process.env.DB_PATH ?? '.data/issues.sqlite';
  const expectedDatabase = database === ':memory:' ? database : resolve(database);
  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(url.origin + path, { ...options, signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error ?? 'Request failed.'}`);
    return body;
  };
  const health = await request('/api/health');
  if (health.status !== 'ok' || health.databasePath !== expectedDatabase || typeof health.instanceId !== 'string') throw new Error('Running API database identity does not match --database. Refusing submission.');
  if (flags.has('--list')) {
    console.log(JSON.stringify({ apiUrl: url.origin, databasePath: health.databasePath, instanceId: health.instanceId, ...(await request('/api/repos')) }, null, 2));
    return;
  }
  const id = plan?.submissionId ?? statusId!;
  const directory = resolve('.runs/submissions', id);
  mkdirSync(directory, { recursive: true });
  let receipt: SubmissionReceipt & { replayed?: boolean };
  if (plan) {
    const body = JSON.stringify(plan);
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error('Submission exceeds the API 64 KiB limit. Split unrelated business goals into separate plans.');
    writeJson(join(directory, 'plan.json'), plan);
    writeJson(join(directory, 'target.json'), { apiUrl: url.origin, instanceId: health.instanceId, databasePath: health.databasePath });
    try {
      receipt = await request('/api/plan-submissions', { method: 'POST', headers: { 'content-type': 'application/json', [targetHeader]: targetIdentity(health.instanceId, health.databasePath) }, body });
    } catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)} Reuse the same plan file and submissionId to retry, or query --status ${id}.`, { cause: error }); }
  } else receipt = await request(`/api/plan-submissions/${encodeURIComponent(id)}`);
  const receiptPath = resolve(values.get('--receipt') ?? join(directory, 'receipt.json'));
  writeJson(receiptPath, receipt);
  console.log(JSON.stringify({ submissionId: receipt.submission.id, planHash: receipt.submission.planHash, replayed: receipt.replayed, requirement: receipt.requirement, issues: receipt.issues.map(({ key, issue }) => ({ key, id: issue.id, title: issue.title, status: issue.status, dependsOn: issue.work?.dependsOn })), jobs: receipt.jobs.map(({ id, kind, status, reason }) => ({ id, kind, status, reason })), runs: receipt.runs.map(run => ({ id: run.id, status: run.status, reason: run.reason, reportUrl: `${url.origin}/api/runs/${run.id}` })), receiptPath }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
