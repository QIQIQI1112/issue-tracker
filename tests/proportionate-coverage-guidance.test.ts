import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prompt } from '../factory/agent.ts';
import { parseTask } from '../factory/contracts.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';

test('existing author and coverage reviewer roles require concrete risk rather than redundant assertion matrices', () => {
  const task = parseTask({ schemaVersion: 1, id: 'proportionate-guidance', title: 'Inspect state', goal: 'Observe the correct current business state.', acceptance: [{ id: 'state', description: 'The current state is correct.' }], scope: ['tests/', 'acceptance/'], verificationCommand: 'npm run verify', budget: { maxAttempts: 1, workerTimeoutMs: 3000, totalTimeoutMs: 10000 } });
  for (const phase of ['tests', 'regression-tests', 'acceptance-review'] as const) {
    const text = prompt({ phase, task, cwd: process.cwd(), attempt: 1, feedback: '', directory: evidenceDirectory('proportionate-guidance'), timeoutMs: 3000, signal: new AbortController().signal, env: {} });
    assert.match(text, /(?:concrete|actual|specific)[^.\n]*(?:risk|counterexample)|risk[- ]proportionate/i, `${phase} must justify additional assertions with a business risk.`);
    assert.match(text, /(?:one|single)[^.\n]*exact[^.\n]*positive[^.\n]*(?:suffic|enough)|exact[^.\n]*positive[^.\n]*(?:suffic|enough)/i);
    assert.match(text, /(?:negative|opposite)[^.\n]*(?:concrete|actual|specific)[^.\n]*risk|(?:concrete|actual|specific)[^.\n]*risk[^.\n]*(?:negative|opposite)/i);
    assert.match(text, /(?:not|never|avoid)[^.\n]*mechanical[^.\n]*(?:source|snapshot)/i);
    assert.match(text, /(?:confirmed|actionable)[^.\n]*(?:gaps|findings)[^.\n]*(?:together|consolidat)|consolidat[^.\n]*(?:confirmed|actionable)[^.\n]*(?:gaps|findings)/i);
    assert.match(text, /(?:preserve|protect)[^.\n]*(?:accepted|baseline|frozen)[^.\n]*(?:checks|bytes)/i);
    assert.match(text, /This phase has 3000 milliseconds/);
    assert.match(text, /Only the controller determines completion/);
    if (phase === 'acceptance-review') assert.match(text, /approved review[^.\n]*empty findings/i);
  }
});
