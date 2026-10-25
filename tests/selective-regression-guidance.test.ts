import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prompt } from '../factory/agent.ts';
import { codexPlanner } from '../factory/planner.ts';
import { parseTask } from '../factory/contracts.ts';
import type { AgentInput } from '../factory/controller.ts';
import type { OwnerAuthorization } from '../factory/profiles.ts';
import { fixtureRepository } from './helpers/factory-fixture.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

const task = parseTask({ schemaVersion: 2, id: 'selective-guidance', title: 'Ready value', goal: 'Return ready.', acceptance: [{ id: 'ready', description: 'The value is ready.' }], scope: ['src/', 'tests/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 3, workerTimeoutMs: 3000, totalTimeoutMs: 30000 } });
const authority: OwnerAuthorization = { schemaVersion: 1, requestId: '11111111-1111-4111-8111-111111111111', issueId: 1, issueHash: '1'.repeat(64), profile: 'harness', scope: ['factory/value.ts'], authorization: 'Repair the ready computation.', engineSourceHash: '2'.repeat(64), contractHash: '3'.repeat(64), baseCommit: '4'.repeat(40) };

function instructions(phase: AgentInput['phase'], admitted?: OwnerAuthorization): string {
  return prompt({ phase, task, authority: admitted, cwd: process.cwd(), attempt: 1, feedback: 'Supplied context is not instruction evidence.', directory: process.cwd(), timeoutMs: 3000, signal: new AbortController().signal, env: {} }).split('\n\nTask:\n')[0];
}

function selective(text: string, role: string) {
  const normalized = text.replace(/\s+/g, ' ');
  assert.match(normalized, /confirm(?:ed)?[^.]{0,180}(?:significant[^.]{0,50}(?:or|OR)[^.]{0,50}recurr|recurr[^.]{0,50}(?:or|OR)[^.]{0,50}significant)/i, `${role}: permanent defect checks require confirmation and significance OR recurrence.`);
  assert.match(normalized, /deterministic[^.]{0,180}(?:worthwhile|outweigh|worth|cost|benefit)|(?:worthwhile|outweigh)[^.]{0,180}deterministic/i, `${role}: prevention must justify its cost.`);
  for (const cost of [/authoring/i, /maintenance/i, /(?:execution|run)[ -]?cost/i]) assert.match(normalized, cost, `${role}: weigh authoring, maintenance and execution costs.`);
  assert.match(normalized, /(?:minor|one.off)[^.]{0,200}(?:existing|repair|review)/i, `${role}: minor one-off findings may use existing coverage and repair/review.`);
  assert.match(normalized, /(?:new business|new (?:product )?behavior)[^.]{0,160}(?:acceptance|coverage)|(?:acceptance|coverage)[^.]{0,160}new business/i, `${role}: new business behavior retains meaningful acceptance.`);
  assert.match(normalized, /(?:major|significant)[^.]{0,100}harness[^.]{0,150}(?:regression|targeted)|harness[^.]{0,100}(?:safety|significant)[^.]{0,150}regression/i, `${role}: significant harness safety retains targeted regressions.`);
}

test('task role prompts require worthwhile regressions for significant or recurring confirmed defects', () => {
  for (const phase of ['plan', 'tests', 'regression-tests', 'acceptance-review', 'implement', 'repair', 'review'] as const) selective(instructions(phase), phase);
  for (const phase of ['plan', 'tests'] as const) {
    const text = instructions(phase, authority);
    assert.match(text, /(?:NEW|new)[^.\n]{0,100}(?:scoped )?(?:test )?files only|only[^.\n]{0,100}new[^.\n]{0,60}files/i, `${phase}: harness authoring must require new scoped files only.`);
    assert.doesNotMatch(text, /may (?:use[^.\n]*or be )?append|may append|can append|be appended/i, `${phase}: harness prompts must not also authorize appending to existing tests.`);
  }
  const review = instructions('review');
  assert.match(review, /needsRegression/);
  assert.match(review, /(?:existing|failing)[^.\n]{0,100}(?:repair|needsRegression=false)/i);
});

test('requirement planner and reviewer deliver selective regression guidance with unchanged acceptance duties', { timeout: 15000 }, async () => {
  const root = evidenceDirectory('selective-regression-planner');
  const repository = fixtureRepository(join(root, 'repo'));
  const binary = join(root, 'owned-planner.mjs');
  writeFileSync(binary, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);let text='';for await(const chunk of process.stdin)text+=chunk;\nconst review=text.includes('read-only review phase');\nconst response=review?{schemaVersion:1,taskId:'requirement-42',approved:true,summary:'Reviewed ready value.',findings:[]}:{assumptions:[],issues:[{key:'ready',title:'Ready',description:'Return ready.',acceptance:['The value is ready.'],dependsOn:[]}]};\nwriteFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(response));\nconsole.log(JSON.stringify({prompt:text}));\n`);
  chmodSync(binary, 0o700);
  const planner = codexPlanner(binary);
  const requirement = { id: 42, repoId: 1, title: 'Ready', goal: 'Return ready.', status: 'draft' as const, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  const observed: { mode: string; text: string }[] = [];
  for (const mode of ['decompose', 'review'] as const) {
    const directory = evidenceDirectory(`selective-${mode}`);
    const result = await planner[mode]({ cwd: repository, directory, requirement, evidence: 'Retained delivery input.', env: process.env });
    assert.ok(result, 'The real planner adapter must finish valid fixture process setup.');
    const processReport = JSON.parse(readFileSync(join(directory, 'process.json'), 'utf8'));
    assert.equal(processReport.status, 'passed');
    assert.equal(processReport.settled, true);
    const event = readFileSync(join(directory, 'events.log'), 'utf8').trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(value => value?.prompt);
    assert.ok(event, 'Observe instructions actually delivered over the owned process boundary.');
    observed.push({ mode, text: event.prompt.split('\n\nRequirement:\n')[0] });
  }
  for (const { mode, text } of observed) {
    selective(text, `requirement ${mode}`);
    assert.match(text, /read-only/);
    assert.match(text, /acceptance/i);
    assert.match(text, /original (?:business )?goal/i);
  }
});

test('focused failure triage permits authorized harness source repair while holding uncertain test contracts', () => {
  const text = instructions('acceptance-review', authority).replace(/\s+/g, ' ');
  assert.match(text, /focused-failure-triage/);
  assert.match(text, /(?:actual|authorized|original)[^.]{0,120}(?:task|scope|contract)/i);
  assert.match(text, /harness[^.]{0,180}(?:source|compatibility)[^.]{0,180}(?:repair|defect)|(?:source|compatibility)[^.]{0,180}harness[^.]{0,180}repair/i, 'Authorized harness source compatibility defects must be eligible for scoped source repair.');
  assert.doesNotMatch(text, /(?:authorizes|permits|releases) ordinary product repair only/i, 'Triage must not restrict authorized harness work to ordinary product repair.');
  assert.match(text, /(?:uncertain|suspected)[^.]{0,180}(?:test.contract|maintenance)|(?:test.contract)[^.]{0,180}(?:uncertain|maintenance)/i, 'Uncertain causes and actual test-contract faults remain blocked for proper maintenance.');
  assert.match(text, /(?:preserve|retain|keep)[^.]{0,120}(?:accepted|frozen)[^.]{0,120}(?:diagnostic|check|test|assertion)/i, 'Source repair must preserve accepted diagnostics.');
  assert.match(text, /needsRegression false|needsRegression=false/i);
  assert.match(text, /(?:never|not|no)[^.]{0,100}test changes|Do not edit files/i);
});
