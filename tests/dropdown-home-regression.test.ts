import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Fixture, IssueFixture, issue } from './dropdown-fixture.ts';

test('Home opens a closed label dropdown at All labels without a callback and Enter commits the empty label value', async () => {
  const fixture = new Fixture();
  const selections: string[][] = [];
  try {
    const records = [
      issue(37, { labels: ['beta'] }),
      issue(38, { labels: ['alpha'] }),
      issue(39, { labels: ['beta'], work: { repoId: 2, requirementId: null, dependsOn: [], acceptance: [] } }),
    ];
    await fixture.mount(createElement(IssueFixture, { records, labelFilter: 'beta', onLabelChange: value => selections.push([value]) }));
    const trigger = fixture.combobox('Filter by label');
    const backing = fixture.root.querySelector<HTMLSelectElement>('select[aria-label="Filter by label"]');
    assert.ok(backing, 'Setup reaches the production label selector and its controlled value.');
    const visibleIds = () => fixture.all()
      .filter(node => node.matches('li') && String(node.getAttribute('data-testid')).startsWith('issue-'))
      .map(node => node.getAttribute('data-testid')).sort();
    const callbackArgs = () => selections;
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'The beta selector is closed before Home.');
    assert.equal(backing.value, 'beta', 'The initial current label value is beta rather than the first option.');
    assert.deepEqual(visibleIds(), ['issue-37'], 'Setup applies beta and excludes alpha and another repository.');
    assert.deepEqual(callbackArgs(), [], 'Setting up the controlled beta filter emits no selection callback.');

    await fixture.focus(trigger);
    const home = await fixture.key(trigger, 'Home');
    assert.equal(home.defaultPrevented, true, 'The dropdown handles Home through its production keyboard handler.');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'Home deliberately opens the closed dropdown.');
    assert.ok(fixture.panel(), 'Home exposes the custom option list.');
    assert.deepEqual(fixture.options().map(option => (option.textContent ?? '').trim()), ['All labels', 'alpha', 'beta'], 'The actual current option order starts with All labels.');
    assert.deepEqual(callbackArgs(), [], 'Opening with Home must not invoke the selection callback.');
    assert.equal(backing.value, 'beta', 'Home navigation preserves the controlled beta value until selection.');
    assert.deepEqual(visibleIds(), ['issue-37'], 'Home navigation preserves the current filtered records.');
    assert.deepEqual(fixture.options().filter(option => option.getAttribute('aria-selected') === 'true').map(option => (option.textContent ?? '').trim()), ['beta'], 'The committed option remains beta while navigating.');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'All labels', 'Home on a closed dropdown must activate the first enabled option rather than the selected beta option.');

    await fixture.key(trigger, 'Enter');
    assert.deepEqual(callbackArgs(), [['']], 'Enter commits the empty label value exactly once.');
    assert.equal(backing.value, '', 'The real feature callback clears the controlled label filter.');
    assert.equal((trigger.textContent ?? '').trim(), 'All labels', 'The trigger displays the newly committed All labels value.');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'Enter closes the dropdown after selection.');
    assert.equal(fixture.panel(), undefined, 'The committed menu is dismissed.');
    assert.deepEqual(visibleIds(), ['issue-37', 'issue-38'], 'Clearing beta restores the owned alpha issue while excluding the other repository.');
  } finally { await fixture.dispose(); }
});
