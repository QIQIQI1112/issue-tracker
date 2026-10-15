import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planSchema, reviewSchema, workerSchema } from './contracts.ts';
import type { Agent, AgentInput } from './controller.ts';
import { writeJson } from './evidence.ts';
import { runProcess } from './process.ts';

export function prompt(input: AgentInput): string {
  const instructions = {
    plan: 'Read the repository and produce verifiable slices. Choose reasonable defaults and record reasons. Map every acceptance ID to named Node checks and browser acceptance. Reuse equivalent existing checks when available. Node checks.file uses a repository-relative tests/*.test.ts path. browserChecks.file uses only the spec basename, for example value.spec.ts, with its exact test title. The controller already checks approved scope, protected harness files, and preservation of accepted tests; do not duplicate those enforcement rules with extra integrity tests. New behavior checks may use new scoped files or be appended to existing scoped test files while preserving every original byte. Do not edit files.',
    tests: 'Add only missing scoped behavior checks from the plan. If independent acceptance review supplied findings, repair only the unapproved new checks before returning for another review. Do not implement the feature. Existing checks and infrastructure are protected. You may append new checks to scoped test files, preserving every original byte, or create new scoped test files. Reuse existing checks and imports without changing them. New checks must fail with named assertions for missing behavior rather than import or environment errors. Missing product behavior and failing product assertions are expected in this phase, not blockers. If all planned checks already exist, report their reuse with an empty blockers array. Report blockers only when you cannot establish the planned checks; the implementation worker will fix product defects later.',
    'acceptance-review': 'Independently review the plan and its behavior checks against the business goal. Look for missing acceptance coverage, skipped checks, false assertions, and implementation-coupled checks. Report blocking findings. Do not edit files.',
    implement: 'Implement the planned feature in small slices. Use the recorded defaults. Keep all accepted tests and harness files intact. Run related checks and regressions. Stop all processes you start before returning. Do not commit, merge, push, or deploy.',
    repair: 'Repair the candidate using the independent failure evidence. Keep the accepted criteria and tests intact. Stay inside the task scope. Stop all processes you start before returning. Do not commit, merge, push, or deploy.',
    review: 'Independently review the candidate, behavior, scope, and evidence. Verify the business goal and recorded defaults. Inspect git diff --binary <baselineTree> using the immutable baseline tree in feedback. Report only blocking findings in findings; put nonblocking suggestions in summary. Do not edit files.',
  };
  return `You are a ${input.phase} worker in a bounded local engineering lab. Follow AGENTS.md. All documentation, harness output, and reports must be in English.\n\n${instructions[input.phase]}\n\nThis phase has ${input.timeoutMs} milliseconds. Batch relevant inspection, reuse equivalent checks, and return the structured response before the deadline. The tests phase needs focused red proofs; the controller runs the full suite after implementation. The worker sandbox may deny loopback binding with EPERM. Run permitted focused checks and record sandbox-only verification limitations in summary, with an empty blockers array when the code/checks are ready. The controller runs HTTP and browser checks outside the worker sandbox. Blockers means unresolved product or task problems, not checks that only the controller can execute. Never weaken tests or request sandbox bypass. Avoid expanding the business goal.\n\nOnly the controller determines completion. Do not modify scripts, factory, configuration, task snapshots, or original acceptance assertions. Only the tests phase may append scoped checks; accepted tests are frozen during implementation. No live browser profiles or non-disposable data. Use only the assigned loopback ports and DB_PATH. The controller will run independent verification.\n\nTask:\n${JSON.stringify(input.task, null, 2)}\n\nPlan:\n${JSON.stringify(input.plan ?? null, null, 2)}\n\nFeedback:\n${input.feedback || 'None'}\n\nReturn the requested structured response. A completion claim is not verification evidence.`;
}

export function codexAgent(binary = 'codex'): Agent {
  return { run: async input => {
    const schemaPath = join(input.directory, 'output-schema.json');
    const outputPath = join(input.directory, 'response.json');
    writeJson(schemaPath, input.phase === 'plan' ? planSchema : input.phase === 'review' || input.phase === 'acceptance-review' ? reviewSchema : workerSchema);
    const text = prompt(input);
    writeFileSync(join(input.directory, 'prompt.txt'), text);
    const readOnly = ['plan', 'review', 'acceptance-review'].includes(input.phase);
    const result = await runProcess({ command: binary, args: ['-c', 'approval_policy="never"', 'exec', '--json', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--ephemeral', '--cd', input.cwd, '--output-schema', schemaPath, '--output-last-message', outputPath, '-'], cwd: input.cwd, env: input.env, input: text, logPath: join(input.directory, 'events.log'), timeoutMs: input.timeoutMs, signal: input.signal });
    writeJson(join(input.directory, 'process.json'), result);
    if (result.status !== 'passed') throw new Error(`Codex ${input.phase} failed: ${result.status}. See ${input.directory}`);
    return JSON.parse(readFileSync(outputPath, 'utf8'));
  } };
}
