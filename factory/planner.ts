import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from './process.ts';
import { writeJson } from './evidence.ts';
import { parseReview, reviewSchema } from './contracts.ts';
import { boundedText, criteria, record } from '../src/workflow.ts';
import type { Requirement } from '../src/workflow.ts';

export type Decomposition = { assumptions: { decision: string; reason: string }[]; issues: { key: string; title: string; description: string; acceptance: string[]; dependsOn: string[] }[] };
export type PlannerInput = { cwd: string; directory: string; requirement: Requirement; evidence: string; env: NodeJS.ProcessEnv; signal?: AbortSignal };
export type Planner = { decompose(input: PlannerInput): Promise<Decomposition>; review(input: PlannerInput): Promise<{ approved: boolean; summary: string; findings: string[] }> };

const string = { type: 'string' };
const strings = { type: 'array', items: string };
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const decompositionSchema = objectSchema({ assumptions: { type: 'array', items: objectSchema({ decision: string, reason: string }) }, issues: { type: 'array', items: objectSchema({ key: string, title: string, description: string, acceptance: strings, dependsOn: strings }) } });

export function parseDecomposition(input: unknown): Decomposition {
  const value = record(input);
  if (!Array.isArray(value.issues) || !value.issues.length || value.issues.length > 20 || !Array.isArray(value.assumptions) || value.assumptions.length > 30) throw new Error('Decomposition needs 1–20 issues and bounded assumptions.');
  const issues = value.issues.map(input => {
    const item = record(input);
    const key = boundedText(item.key, 'Issue key', 64);
    if (!/^[a-z0-9-]+$/.test(key) || !Array.isArray(item.dependsOn) || item.dependsOn.length > 20) throw new Error('Invalid issue key or dependencies.');
    return { key, title: boundedText(item.title, 'Title', 120), description: boundedText(item.description, 'Description', 2000), acceptance: criteria(item.acceptance), dependsOn: item.dependsOn.map(value => boundedText(value, 'Dependency', 64)) };
  });
  const indexed = new Map(issues.map(issue => [issue.key, issue]));
  if (indexed.size !== issues.length) throw new Error('Duplicate issue keys.');
  const visit = (key: string, stack: Set<string>) => {
    if (stack.has(key)) throw new Error('Cyclic issue dependencies.');
    const issue = indexed.get(key);
    if (!issue) throw new Error('Unknown dependency key.');
    if (new Set(issue.dependsOn).size !== issue.dependsOn.length) throw new Error('Duplicate dependencies.');
    for (const dependency of issue.dependsOn) visit(dependency, new Set([...stack, key]));
  };
  for (const issue of issues) visit(issue.key, new Set());
  return { issues, assumptions: value.assumptions.map(input => { const item = record(input); return { decision: boundedText(item.decision, 'Decision'), reason: boundedText(item.reason, 'Reason') }; }) };
}

export function codexPlanner(binary = 'codex'): Planner {
  const execute = async (input: PlannerInput, mode: 'decompose' | 'review'): Promise<unknown> => {
    const schemaPath = join(input.directory, 'output-schema.json');
    const responsePath = join(input.directory, 'response.json');
    writeJson(schemaPath, mode === 'decompose' ? decompositionSchema : reviewSchema);
    const instruction = mode === 'decompose' ? 'Decompose this business requirement into at most 20 independently verifiable issues. Choose ordinary defaults and explain them. Every issue needs concrete acceptance conditions and dependencies expressed with issue keys. Keys must contain 1–64 lowercase letters, digits, or hyphens, for example ready-value. Dependencies must reference exact keys; no cycles or duplicates. Descriptions contain at most 2000 characters. Cover the whole original goal, including integration behavior. Do not invent unrelated work.' : `Independently review the requirement against the supplied decomposition or integrated delivery evidence and actual source. Check completeness, meaningful acceptance, dependency order, and the original business goal across all issues. Approve only when there are no blocking findings. Use taskId requirement-${input.requirement.id}, schemaVersion 1, and put only blocking findings in findings.`;
    const prompt = `Follow AGENTS.md. This is a read-only ${mode} phase. Do not edit, commit, merge, push, or start servers. Return the structured response within five minutes. Write reports in English.\n\n${instruction}\n\nRequirement:\n${JSON.stringify(input.requirement)}\n\nEvidence:\n${input.evidence}`;
    writeFileSync(join(input.directory, 'prompt.txt'), prompt);
    const result = await runProcess({ command: binary, args: ['-c', 'approval_policy="never"', 'exec', '--json', '--sandbox', 'read-only', '--ephemeral', '--cd', input.cwd, '--output-schema', schemaPath, '--output-last-message', responsePath, '-'], cwd: input.cwd, env: input.env, input: prompt, logPath: join(input.directory, 'events.log'), timeoutMs: 300000, signal: input.signal });
    writeJson(join(input.directory, 'process.json'), result);
    if (result.status !== 'passed') throw new Error(`Requirement ${mode} failed: ${result.status}.`);
    return JSON.parse(readFileSync(responsePath, 'utf8'));
  };
  const validated = async <T>(input: PlannerInput, mode: 'decompose' | 'review', parse: (value: unknown) => T): Promise<T> => {
    let feedback = input.evidence;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const directory = attempt === 1 ? input.directory : join(input.directory, `protocol-repair-${attempt}`);
      mkdirSync(directory, { recursive: true });
      const value = await execute({ ...input, directory, evidence: feedback }, mode);
      try { return parse(value); }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        writeJson(join(directory, 'contract-error.json'), { reason });
        if (attempt === 2) throw error;
        feedback = `${input.evidence}\nPrevious response failed the runtime contract: ${reason}. Correct only the response format or invalid plan structure. Preserve the original business goal.\nPrevious response:\n${JSON.stringify(value)}`;
      }
    }
    throw new Error('Structured response attempt budget exhausted.');
  };
  return { decompose: async input => validated(input, 'decompose', parseDecomposition), review: async input => validated(input, 'review', value => parseReview(value, { id: `requirement-${input.requirement.id}` })) };
}
