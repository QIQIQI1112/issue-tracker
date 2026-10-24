import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prompt } from '../factory/agent.ts';
import { parseTask } from '../factory/contracts.ts';
import type { AgentInput } from '../factory/controller.ts';

function instructions(phase: AgentInput['phase']): string {
  const task = parseTask(JSON.parse(readFileSync('tickets/001-labels.json', 'utf8')));
  const text = prompt({ phase, task, cwd: process.cwd(), attempt: 1, feedback: '', directory: process.cwd(), timeoutMs: 1000, signal: new AbortController().signal, env: {} });
  return text.split('\n\nTask:\n')[0];
}

test('test authoring and coverage review require fixture readiness and meaningful migration proofs before freezing', () => {
  for (const phase of ['tests', 'regression-tests', 'acceptance-review'] as const) {
    const text = instructions(phase);
    const fixtureGuidance = text.replace(/\s+/g, ' ');
    assert.match(fixtureGuidance, /fixture.{0,120}(?:readiness|ready|setup|prepar|initializ)|(?:readiness|setup|prepar|initializ).{0,120}fixture/i, `${phase} must require working fixture setup.`);
    assert.match(fixtureGuidance, /migrat|removed (?:paths|commands|files)|retired (?:paths|commands|files)/i, `${phase} must inspect fixture migration.`);
    for (const concept of [/path|file/i, /command|launch/i, /report|output/i, /case|identit/i]) {
      assert.match(fixtureGuidance, concept, `${phase} must inspect each affected fixture interface.`);
    }
    assert.match(fixtureGuidance, /run|execut|result|evidence|proof/i, `${phase} must use actual focused fixture results.`);
    assert.match(fixtureGuidance, /approv|freez/i, `${phase} must establish readiness before approval or freezing.`);
    assert.match(text, /named assertion|named.*assertion|assertion.*named/i, `${phase} must distinguish a behavior red from setup failure.`);
    assert.match(text, /setup|import|environment/i, `${phase} must distinguish setup failures.`);
    assert.match(text, /not|cannot|never|invalid|insufficient/i, `${phase} cannot accept setup failure as a red proof.`);
  }
});

test('all agent phases await settled checks and cancellation before editing verification inputs', () => {
  for (const phase of ['plan', 'tests', 'regression-tests', 'acceptance-review', 'implement', 'repair', 'review'] as const) {
    const text = instructions(phase);
    const waiting = text.replace(/\s+/g, ' ');
    assert.match(waiting, /wait|await/i, `${phase} must await checks.`);
    assert.match(waiting, /settle|exit|finish|complet/i, `${phase} must await check settlement.`);
    assert.match(waiting, /edit|modif/i, `${phase} must bind waiting to edits.`);
    assert.match(waiting, /source/i, `${phase} must protect source inputs.`);
    assert.match(waiting, /test/i, `${phase} must protect test inputs.`);
    assert.match(waiting, /engine|control/i, `${phase} must protect execution-engine inputs.`);
    const cancellation = waiting;
    assert.match(cancellation, /cancel|terminat/i, `${phase} must cover explicit check cancellation.`);
    assert.match(cancellation, /settle|exit|finish|complet/i, `${phase} must wait for cancellation to finish.`);
    assert.match(cancellation, /edit|modif/i, `${phase} cannot edit during cancellation.`);
    const drift = waiting;
    assert.match(drift, /drift|input.{0,40}chang|source.{0,40}chang/i, `${phase} must identify changed verification inputs.`);
    assert.match(drift, /product/i, `${phase} must distinguish changed verification inputs from product defects.`);
    assert.match(drift, /not|never|separat|distinct/i, `${phase} cannot treat source drift as a product failure.`);
  }
});
