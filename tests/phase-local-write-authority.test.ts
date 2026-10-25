import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prompt } from '../factory/agent.ts';
import { parseTask } from '../factory/contracts.ts';
import type { AgentInput } from '../factory/controller.ts';

test('role prompts keep test writes phase-local and defer scoped documentation until after freeze', () => {
  const task = parseTask(JSON.parse(readFileSync('tickets/001-labels.json', 'utf8')));
  const failures: string[] = [];
  for (const profile of [undefined, 'harness', 'acceptance_contract'] as const) {
    for (const phase of ['plan', 'tests', 'regression-tests', 'implement', 'repair'] as const) {
      const authority: AgentInput['authority'] = profile ? { schemaVersion: 1, requestId: '11111111-2222-4333-8444-555555555555', issueId: 1, issueHash: 'a'.repeat(64), profile, scope: ['tests/', 'acceptance/', 'docs/', 'AGENTS.md'], authorization: 'Prepare the scoped tests and documentation.', engineSourceHash: 'b'.repeat(64), contractHash: 'c'.repeat(64), baseCommit: 'd'.repeat(40) } : undefined;
      const text = prompt({ phase, task, authority, cwd: process.cwd(), attempt: 1, feedback: '', directory: process.cwd(), timeoutMs: 1000, signal: new AbortController().signal, env: {} }).split('\n\nTask:\n')[0].replace(/Writable protected scope: \[[^\]]*\]\./g, '').replace(/\s+/g, ' ');
      const required: [RegExp, string][] = [
        [/whole[- ]task scope.{0,140}(?:does not|never|cannot).{0,100}(?:phase|permission|authoriz)|phase[- ]local.{0,140}(?:permission|authorit).{0,140}(?:whole|scope)/i, 'whole-task scope cannot expand phase-local permission'],
      ];
      if (phase === 'plan') required.push([/read[- ]only|do not edit files/i, 'planning stays read-only'], [/tests.{0,160}(?:phase|author).{0,180}(?:documentation|docs)|documentation.{0,180}implementation/i, 'planning allocates tests and documentation to their phases'], [/(?:documentation|docs).{0,180}implementation.{0,140}(?:freeze|frozen)|implementation.{0,140}(?:freeze|frozen).{0,180}(?:documentation|docs)/i, 'planning defers documentation until implementation after freeze']);
      if (phase === 'tests' || phase === 'regression-tests') required.push(
        [/(?:only|limited|restrict).{0,100}tests\/.{0,100}acceptance\/|tests\/.{0,100}acceptance\/.{0,100}only/i, 'writes are limited to authorized tests/ and acceptance/ files'],
        [/(?:do not|never|must not|prohibit).{0,100}(?:write|edit|change|modif).{0,120}(?:docs|documentation)/i, 'documentation writes are expressly prohibited'],
        [/structured.{0,30}(?:report|summary)|(?:report|summary).{0,30}structured/i, 'rationale belongs in the structured report'],
        [/(?:documentation|docs).{0,180}implementation.{0,140}(?:freeze|frozen)|implementation.{0,140}(?:freeze|frozen).{0,180}(?:documentation|docs)/i, 'implementation writes requested documentation after freeze'],
      );
      if (phase === 'implement' || phase === 'repair') required.push([/(?:accepted|frozen).{0,40}test.{0,60}(?:intact|immutable|unchanged)|(?:preserv|keep).{0,40}(?:accepted|frozen).{0,40}test/i, 'frozen tests remain protected']);
      for (const [pattern, meaning] of required) if (!pattern.test(text)) failures.push(`${profile ?? 'feature'} ${phase}: ${meaning}`);
    }
  }
  assert.deepEqual(failures, [], 'Every applicable role must receive explicit phase-local write authority even when documentation is in the whole-task scope.');
});
