export type Acceptance = { id: string; description: string };
export type Task = { schemaVersion: 1 | 2; id: string; title: string; goal: string; wholeGoal?: { requirementId: number; goal: string }; acceptance: Acceptance[]; scope: string[]; verificationCommand: 'npm run verify'; budget: { maxAttempts: number; workerTimeoutMs: number; totalTimeoutMs: number }; notes: string };
export type Check = { file: string; title: string; acceptanceIds?: string[] };
export type Plan = { schemaVersion: 1 | 2; coverage?: { mode: 'reuse' | 'extend'; reason: string }; taskId: string; assumptions: { decision: string; reason: string }[]; slices: { id: string; goal: string; acceptanceIds: string[]; checks: Check[] }[]; browserChecks: Check[] };
export type WorkerReport = { schemaVersion: 1; taskId: string; summary: string; blockers: string[] };
export type Review = { schemaVersion: 1; taskId: string; approved: boolean; needsRegression?: boolean; summary: string; findings: string[] };

export class ReviewResponseFormatError extends Error {
  readonly response: string;
  constructor(response: string, cause: SyntaxError) {
    super(`Review response is not valid JSON: ${cause.message}`);
    this.response = response;
  }
}

function object(input: unknown, name: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${name} must be an object.`);
  return input as Record<string, unknown>;
}

function text(input: unknown, name: string): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 10000) throw new Error(`${name} must be a nonempty string of at most 10000 characters.`);
  return input.trim();
}

function list(input: unknown, name: string): unknown[] {
  if (!Array.isArray(input) || input.length > 100) throw new Error(`${name} must be an array of at most 100 items.`);
  return input;
}

function id(input: unknown, name: string): string {
  const value = text(input, name);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error(`${name} must be a short lowercase identifier.`);
  return value;
}

function integer(input: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(input) || Number(input) < minimum || Number(input) > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return Number(input);
}

export function scoped(path: string, task: Task): boolean {
  return task.scope.some(allowed => allowed.endsWith('/') ? path.startsWith(allowed) : path === allowed);
}

function path(input: unknown, name: string): string {
  const value = text(input, name);
  if (value.startsWith('/') || value.includes('\\') || value.replace(/\/$/, '').split('/').some(part => part === '..' || part === '.' || !part) || !/^(src|tests|acceptance|docs)\//.test(value)) throw new Error(`${name} must stay inside application, test, acceptance, or documentation paths.`);
  return value;
}

export function parseTask(input: unknown, authorizedScope: readonly string[] = []): Task {
  const value = object(input, 'Task');
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new Error('Unsupported task schema version.');
  if (value.verificationCommand !== 'npm run verify') throw new Error('Task verification must use the controller-owned verification command.');
  const acceptance = list(value.acceptance, 'acceptance').map(input => {
    const item = object(input, 'Acceptance item');
    return { id: id(item.id, 'Acceptance ID'), description: text(item.description, 'Acceptance description') };
  });
  if (!acceptance.length || new Set(acceptance.map(item => item.id)).size !== acceptance.length) throw new Error('Tasks require distinct acceptance items.');
  const scope = list(value.scope, 'scope').map(item => authorizedScope.includes(String(item)) ? text(item, 'Scope') : path(item, 'Scope'));
  if (!scope.length) throw new Error('Tasks need an explicit scope.');
  const budget = object(value.budget, 'Budget');
  const parsedBudget = { maxAttempts: integer(budget.maxAttempts, 'maxAttempts', 1, 5), workerTimeoutMs: integer(budget.workerTimeoutMs, 'workerTimeoutMs', 1000, 600000), totalTimeoutMs: integer(budget.totalTimeoutMs, 'totalTimeoutMs', 1000, 3600000) };
  if (parsedBudget.totalTimeoutMs < parsedBudget.workerTimeoutMs) throw new Error('Total budget cannot be smaller than the worker budget.');
  const wholeGoal = value.schemaVersion === 2 && value.wholeGoal !== undefined ? object(value.wholeGoal, 'Whole goal') : undefined;
  return { schemaVersion: value.schemaVersion, ...(wholeGoal ? { wholeGoal: { requirementId: integer(wholeGoal.requirementId, 'Requirement ID', 1, Number.MAX_SAFE_INTEGER), goal: text(wholeGoal.goal, 'Whole goal') } } : {}), id: id(value.id, 'Task ID'), title: text(value.title, 'Title'), goal: text(value.goal, 'Goal'), acceptance, scope, verificationCommand: 'npm run verify', budget: parsedBudget, notes: typeof value.notes === 'string' ? value.notes : '' };
}

export function parsePlan(input: unknown, task: Task): Plan {
  const value = object(input, 'Plan');
  if (value.schemaVersion !== task.schemaVersion || value.taskId !== task.id) throw new Error('Plan version or task identity mismatch.');
  const adaptive = task.schemaVersion === 2;
  const coverage = adaptive ? object(value.coverage, 'Coverage') : undefined;
  if (coverage && !['reuse', 'extend'].includes(String(coverage.mode))) throw new Error('Coverage mode must be reuse or extend.');
  const identities = new Set<string>();
  const distinct = (file: string, title: string) => { const key = `${file}#${title}`; if (adaptive && identities.has(key)) throw new Error('Duplicate named check.'); identities.add(key); return { file, title }; };
  const executable = new Set<string>();
  const assumptions = list(value.assumptions, 'assumptions').map(input => {
    const item = object(input, 'Assumption');
    return { decision: text(item.decision, 'Decision'), reason: text(item.reason, 'Reason') };
  });
  const covered = new Set<string>();
  const sliceIds = new Set<string>();
  const slices = list(value.slices, 'slices').map(input => {
    const item = object(input, 'Slice');
    const sliceId = id(item.id, 'Slice ID');
    if (sliceIds.has(sliceId)) throw new Error('Duplicate slice ID.');
    sliceIds.add(sliceId);
    const acceptanceIds = list(item.acceptanceIds, 'acceptanceIds').map(input => {
      const value = id(input, 'Acceptance ID');
      if (!task.acceptance.some(item => item.id === value)) throw new Error('Plan references unknown acceptance.');
      covered.add(value);
      return value;
    });
    const checks = list(item.checks, 'checks').map(input => {
      const check = object(input, 'Check');
      const file = path(check.file, 'Check file');
      if (!file.startsWith('tests/') || !file.endsWith('.test.ts') || !scoped(file, task)) throw new Error('Slice checks must be scoped Node behavior tests.');
      return distinct(file, text(check.title, 'Check title'));
    });
    if (!acceptanceIds.length || !adaptive && !checks.length) throw new Error('Each slice needs acceptance IDs and executable checks.');
    if (checks.length) acceptanceIds.forEach(id => executable.add(id));
    return { id: sliceId, goal: text(item.goal, 'Slice goal'), acceptanceIds, checks };
  });
  if (!slices.length || task.acceptance.some(item => !covered.has(item.id))) throw new Error('Plan must cover every acceptance item.');
  if (list(value.browserChecks, 'browserChecks').length) throw new Error('Browser checks are retired; use named Node checks and browserChecks: [].');
  const browserChecks: Check[] = [];
  if (task.acceptance.some(item => !executable.has(item.id))) throw new Error('Every acceptance item needs named executable Node coverage.');
  return { schemaVersion: task.schemaVersion, ...(coverage ? { coverage: { mode: coverage.mode as 'reuse' | 'extend', reason: text(coverage.reason, 'Coverage reason') } } : {}), taskId: task.id, assumptions, slices, browserChecks };
}

export function parseWorkerReport(input: unknown, task: Task): WorkerReport {
  const value = object(input, 'Worker report');
  if (value.schemaVersion !== 1 || value.taskId !== task.id) throw new Error('Worker report identity mismatch.');
  return { schemaVersion: 1, taskId: task.id, summary: text(value.summary, 'Summary'), blockers: list(value.blockers, 'blockers').map(item => text(item, 'Blocker')) };
}

export function parseReview(input: unknown, task: Pick<Task, 'id'>): Review {
  const value = object(input, 'Review');
  if (value.schemaVersion !== 1 || value.taskId !== task.id || typeof value.approved !== 'boolean') throw new Error('Review identity or approval is invalid.');
  const findings = list(value.findings, 'findings').map(item => text(item, 'Finding'));
  if (value.approved && findings.length) throw new Error('Approved reviews cannot contain blocking findings.');
  if ('needsRegression' in value && typeof value.needsRegression !== 'boolean') throw new Error('Regression request must be boolean.');
  if (value.needsRegression && (value.approved || !findings.length)) throw new Error('Regression requests require blocking review findings.');
  return { schemaVersion: 1, taskId: task.id, approved: value.approved, ...('needsRegression' in value ? { needsRegression: value.needsRegression as boolean } : {}), summary: text(value.summary, 'Summary'), findings };
}

const string = { type: 'string' };
const strings = { type: 'array', items: string };
const recordSchema = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const checkSchema = recordSchema({ file: string, title: string });
export const planSchema = recordSchema({ schemaVersion: { type: 'integer', const: 1 }, taskId: string, assumptions: { type: 'array', items: recordSchema({ decision: string, reason: string }) }, slices: { type: 'array', items: recordSchema({ id: string, goal: string, acceptanceIds: strings, checks: { type: 'array', items: checkSchema } }) }, browserChecks: { type: 'array', maxItems: 0, items: checkSchema } });
export const adaptivePlanSchema = recordSchema({ ...planSchema.properties, schemaVersion: { type: 'integer', const: 2 }, coverage: recordSchema({ mode: { type: 'string', enum: ['reuse', 'extend'] }, reason: string }), browserChecks: { type: 'array', maxItems: 0, items: recordSchema({ file: string, title: string, acceptanceIds: strings }) } });
export const workerSchema = recordSchema({ schemaVersion: { type: 'integer', const: 1 }, taskId: string, summary: string, blockers: strings });
export const reviewSchema = recordSchema({ schemaVersion: { type: 'integer', const: 1 }, taskId: string, approved: { type: 'boolean' }, needsRegression: { type: 'boolean' }, summary: string, findings: strings });

export type RegressionReport = WorkerReport & { checks: Check[]; browserChecks: Check[] };
export function parseRegressionReport(input: unknown, task: Task): RegressionReport {
  const value = object(input, 'Regression report');
  const report = parseWorkerReport(input, task);
  const parseChecks = (input: unknown, browser: boolean) => list(input, 'Regression checks').map(input => {
    const check = object(input, 'Regression check');
    const file = text(check.file, 'Regression file');
    if (!(browser ? /^[a-zA-Z0-9_-]+\.spec\.ts$/ : /^tests\/[a-zA-Z0-9_-]+\.test\.ts$/).test(file) || !scoped(browser ? `acceptance/${file}` : file, task)) throw new Error('Regression checks must use new scoped test files.');
    return { file, title: text(check.title, 'Regression title') };
  });
  const checks = parseChecks(value.checks, false);
  if (list(value.browserChecks, 'browserChecks').length) throw new Error('Browser regression checks are retired; use named Node checks.');
  const browserChecks: Check[] = [];
  const keys = [...checks.map(check => `${check.file}#${check.title}`), ...browserChecks.map(check => `${check.file}#${check.title}`)];
  if (!keys.length || new Set(keys).size !== keys.length) throw new Error('Regression report requires distinct named checks.');
  return { ...report, checks, browserChecks };
}
export const regressionSchema = recordSchema({ ...workerSchema.properties, checks: { type: 'array', items: checkSchema }, browserChecks: { type: 'array', maxItems: 0, items: checkSchema } });
