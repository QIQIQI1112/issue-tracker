import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { runProcess } from './process.ts';
import { writeJson } from './evidence.ts';
import { parseReview, reviewSchema } from './contracts.ts';
import { parseDecomposition } from '../src/submission.ts';
import type { Decomposition, Requirement } from '../src/workflow.ts';

export { parseDecomposition } from '../src/submission.ts';
export type { Decomposition } from '../src/workflow.ts';
export type PlannerInput = { cwd: string; directory: string; requirement: Requirement; evidence: string; env: NodeJS.ProcessEnv; signal?: AbortSignal };
export type Planner = { decompose(input: PlannerInput): Promise<Decomposition>; review(input: PlannerInput): Promise<{ approved: boolean; summary: string; findings: string[] }> };

const string = { type: 'string' };
const strings = { type: 'array', items: string };
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const decompositionSchema = objectSchema({ assumptions: { type: 'array', items: objectSchema({ decision: string, reason: string }) }, issues: { type: 'array', items: objectSchema({ key: string, title: string, description: string, acceptance: strings, dependsOn: strings }) } });

export function codexPlanner(binary = 'codex'): Planner {
  const execute = async (input: PlannerInput, mode: 'decompose' | 'review'): Promise<unknown> => {
    const schemaPath = join(input.directory, 'output-schema.json');
    const responsePath = join(input.directory, 'response.json');
    writeJson(schemaPath, mode === 'decompose' ? decompositionSchema : reviewSchema);
    const instruction = mode === 'decompose' ? 'Decompose this business requirement into at most 20 independently verifiable issues. Choose ordinary defaults and explain them. Every issue needs concrete acceptance conditions and dependencies expressed with issue keys. Keys must contain 1–64 lowercase letters, digits, or hyphens, for example ready-value. Dependencies must reference exact keys; no cycles or duplicates. Descriptions contain at most 2000 characters. Cover the whole original goal, including integration behavior. Do not invent unrelated work.' : `Independently review the requirement against the supplied decomposition or integrated delivery evidence and actual source. Check completeness, meaningful acceptance, dependency order, and the original business goal across all issues. Approve only when there are no blocking findings. Use taskId requirement-${input.requirement.id}, schemaVersion 1, and put only blocking findings in findings.`;
    const evidence = Buffer.from(input.evidence, 'utf8');
    const evidencePath = resolve(input.directory, 'evidence.txt');
    writeFileSync(evidencePath, evidence);
    const reference = { path: evidencePath, bytes: evidence.byteLength, sha256: createHash('sha256').update(evidence).digest('hex') };
    const inline = evidence.byteLength <= 64 * 1024 ? `\n\nEvidence (inline):\n${input.evidence}` : '';
    const prompt = `Follow AGENTS.md. This is a read-only ${mode} phase. Do not edit, commit, merge, push, or start servers. Return the structured response within five minutes. Write reports in English.\n\n${instruction}\n\nRequirement:\n${JSON.stringify(input.requirement)}\n\nEvidence file:\n${JSON.stringify(reference)}\nRead the full retained evidence file and inspect actual source and underlying machine reports. Never approve from summaries alone. The reference preserves complete evidence; large manifests are omitted from inline input without truncating the file.${inline}`;
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
