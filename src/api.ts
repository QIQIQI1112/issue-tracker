import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { parseCreateIssue, parsePatchIssue, ValidationError } from './domain.ts';
import type { IssueStore } from './storage.ts';
import { targetHeader, targetIdentity } from './target-safety.ts';
import { parseRepository } from './repository.ts';
import { boundedText, ConflictError, positiveId, record } from './workflow.ts';
import { evidenceFile, readDelivery } from './evidence-files.ts';
import { basename } from 'node:path';

function issueId(input: string): number {
  if (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(Number(input))) {
    throw new ValidationError('Issue ID must be a positive safe integer.');
  }
  return Number(input);
}

export function createApp(store: IssueStore, metadata: { instanceId: string; version: string }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    if (!['127.0.0.1', 'localhost'].includes(request.hostname)) {
      response.status(403).json({ error: 'Only loopback hosts are allowed.' }); return;
    }
    const origin = request.get('origin');
    const uiPort = process.env.UI_PORT ?? '5173';
    const allowed = [`http://${request.get('host')}`, `http://127.0.0.1:${uiPort}`, `http://localhost:${uiPort}`];
    if (origin && !allowed.includes(origin)) {
      response.status(403).json({ error: 'Cross-origin requests are not allowed.' }); return;
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', ...metadata, databasePath: store.path, issueCount: store.list().length });
  });
  app.get('/api/issues', (_request, response) => response.json({ issues: store.list() }));
  const ownedIdentity = targetIdentity(metadata.instanceId, store.path);
  app.use('/api', (request, response, next) => {
    const expected = request.get(targetHeader);
    if (['POST', 'PATCH', 'DELETE'].includes(request.method)
      && expected !== undefined && expected !== ownedIdentity) {
      response.status(409).json({ error: 'Owned API target identity mismatch. Refusing mutation.' }); return;
    }
    next();
  });
  app.get('/api/workbench', (_request, response) => response.json({ repos: store.work.repos(), requirements: store.work.requirements(), jobs: store.work.jobs(), runs: store.work.runs() }));
  app.get('/api/repos', (_request, response) => response.json({ repos: store.work.repos() }));
  app.post('/api/repos', (request, response) => response.status(201).json({ repo: store.work.addRepo(parseRepository(request.body)) }));
  app.get('/api/requirements', (_request, response) => response.json({ requirements: store.work.requirements() }));
  app.post('/api/plan-submissions', (request, response) => {
    const receipt = store.work.submitPlan(request.body);
    response.status(receipt.replayed ? 200 : 201).json(receipt);
  });
  app.get('/api/plan-submissions/:id', (request, response) => {
    const receipt = store.work.submissionReceipt(request.params.id);
    if (!receipt) { response.status(404).json({ error: 'Submission not found.' }); return; }
    response.json(receipt);
  });
  app.post('/api/requirements', (request, response) => {
    const value = record(request.body);
    response.status(201).json({ requirement: store.work.addRequirement({ repoId: positiveId(value.repoId), title: boundedText(value.title, 'Title', 120), goal: boundedText(value.goal, 'Business goal') }) });
  });
  app.post('/api/requirements/:id/start', (request, response) => response.status(202).json({ jobs: store.work.startRequirement(issueId(request.params.id)) }));
  app.get('/api/issues/:id', (request, response) => {
    const issue = store.get(issueId(request.params.id));
    if (!issue) { response.status(404).json({ error: 'Issue not found.' }); return; }
    response.json({ issue, runs: store.work.runs().filter(run => run.issueId === issue.id) });
  });
  app.post('/api/issues/:id/start', (request, response) => response.status(202).json({ job: store.work.startIssue(issueId(request.params.id)) }));
  app.get('/api/runs/:id', (request, response) => {
    const run = store.work.run(request.params.id);
    if (!run) { response.status(404).json({ error: 'Run not found.' }); return; }
    response.json({ run, delivery: readDelivery(run.evidencePath) });
  });
  app.get('/api/runs/:id/evidence', (request, response) => {
    const run = store.work.run(request.params.id);
    if (!run) { response.status(404).json({ error: 'Run not found.' }); return; }
    if (typeof request.query.file !== 'string') throw new ValidationError('Select a manifest evidence file.');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    const path = evidenceFile(run.evidencePath, request.query.file);
    response.download(path, basename(path), { dotfiles: 'allow' });
  });
  app.post('/api/issues', (request, response) => {
    const input = parseCreateIssue(request.body);
    const repo = store.work.repos()[0];
    if (!input.work && repo) input.work = { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: [input.title] };
    response.status(201).json({ issue: store.create(input) });
  });
  app.patch('/api/issues/:id', (request, response) => {
    const issue = store.update(issueId(request.params.id), parsePatchIssue(request.body));
    if (!issue) { response.status(404).json({ error: 'Issue not found.' }); return; }
    response.json({ issue });
  });
  app.delete('/api/issues/:id', (request, response) => {
    if (!store.delete(issueId(request.params.id))) { response.status(404).json({ error: 'Issue not found.' }); return; }
    response.status(204).end();
  });
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint not found.' }));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ConflictError) { response.status(409).json({ error: error.message }); return; }
    if (error instanceof ValidationError) { response.status(400).json({ error: error.message }); return; }
    if (error instanceof SyntaxError) { response.status(400).json({ error: 'Malformed JSON body.' }); return; }
    if (error instanceof Error && 'status' in error && typeof error.status === 'number'
      && Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      && 'expose' in error && error.expose === true) {
      response.status(error.status).json({ error: error.message }); return;
    }
    console.error(error);
    response.status(500).json({ error: 'The server could not complete this request.' });
  };
  app.use(errors);
  return app;
}
