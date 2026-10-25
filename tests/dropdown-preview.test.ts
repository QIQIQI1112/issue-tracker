import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { ComponentPreview } from '../src/ui/features/preview/ComponentPreview.tsx';
import { Fixture } from './dropdown-fixture.ts';

test('development gallery demonstrates shared dropdown and themed scrolling samples using only local state', async () => {
  const fixture = new Fixture();
  try {
    await fixture.mount(createElement(ComponentPreview));
    assert.match(fixture.root.textContent ?? '', /Component preview/, 'The existing development gallery mounts before checking its new demonstrations.');
    const selectors = fixture.all().filter(node => node.getAttribute('role') === 'combobox');
    assert.ok(selectors.length > 0, 'The development gallery demonstrates the production custom dropdown.');
    const observed = [];
    for (const trigger of selectors) {
      await fixture.click(trigger);
      const panel = fixture.panel();
      if (panel) {
        observed.push({ trigger, labels: fixture.options().map(option => (option.textContent ?? '').trim()) });
        const alternative = fixture.options().find(option => String(option.getAttribute('aria-selected')) !== 'true');
        if (alternative) {
          const label = (alternative.textContent ?? '').trim();
          await fixture.click(alternative);
          assert.ok((trigger.textContent ?? '').includes(label), 'An isolated controlled gallery sample commits its selected option locally.');
        } else await fixture.key(trigger, 'Escape');
      }
    }
    assert.ok(observed.some(sample => sample.labels.length >= 20), 'The gallery demonstrates a bounded long option list.');
    assert.ok(observed.some(sample => sample.labels.some(label => label.length > 100)), 'The gallery includes an actual long-label dropdown option.');
    assert.ok(selectors.some(trigger => trigger.hasAttribute('disabled') || String(trigger.getAttribute('aria-disabled')) === 'true') || observed.some(sample => sample.labels.length === 0), 'The gallery includes a coherent empty-options sample.');
    const opener = fixture.all().find(node => node.matches('button') && /open.*dialog/i.test(node.textContent ?? ''));
    assert.ok(opener, 'The existing gallery dialog opener remains available.');
    await fixture.click(opener);
    const dialogTrigger = fixture.all().find(node => node.getAttribute('role') === 'combobox' && node.closest('dialog'));
    assert.ok(dialogTrigger, 'An isolated dropdown sample is rendered inside the actual shared native Modal.');
    await fixture.click(dialogTrigger);
    assert.ok(fixture.panel()?.closest('dialog'), 'The gallery dialog sample uses contained custom options.');
    await fixture.settle();
    assert.deepEqual(fixture.requests, [], 'Gallery samples and interactions make no backend or evidence requests.');
    assert.equal(fixture.intervals.size, 0, 'The isolated gallery starts no polling.');
  } finally { await fixture.dispose(); }
});
