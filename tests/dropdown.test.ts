import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Dropdown } from '../src/ui/components/Dropdown.tsx';
import { Modal } from '../src/ui/components/Modal.tsx';
import { Fixture, IssueFixture, issue, open } from './dropdown-fixture.ts';

const name = 'Filter by label';

test('dropdown opens deliberately navigates with arrows Home and End and commits pointer Enter and Space selections exactly once', async () => {
  const fixture = new Fixture();
  const selections: string[] = [];
  try {
    await fixture.mount(createElement(IssueFixture, { onLabelChange: value => selections.push(value) }));
    const trigger = fixture.combobox(name);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'The controlled selector starts closed.');
    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
      await fixture.key(trigger, key);
      assert.ok(fixture.panel(), `${key} deliberately opens the custom panel.`);
      await fixture.key(trigger, 'Escape');
    }
    await open(fixture, name);
    await fixture.key(trigger, 'End');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'beta', 'End activates the last current option.');
    await fixture.key(trigger, 'ArrowUp');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'alpha', 'ArrowUp moves through the current option order.');
    await fixture.key(trigger, 'Home');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'All labels', 'Home reaches the first option.');
    await fixture.key(trigger, 'ArrowDown');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'alpha', 'ArrowDown moves without committing.');
    assert.match(trigger.textContent ?? '', /All labels/, 'Navigation does not change the controlled value.');
    await fixture.key(trigger, 'Enter');
    assert.match(trigger.textContent ?? '', /alpha/, 'Enter commits the active value through the feature callback.');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'Enter closes the menu.');
    await open(fixture, name);
    await fixture.key(trigger, 'End');
    await fixture.key(trigger, ' ');
    assert.match(trigger.textContent ?? '', /beta/, 'Space commits the active value.');
    await open(fixture, name);
    const first = fixture.options().find(option => option.textContent?.trim() === 'All labels');
    assert.ok(first);
    await fixture.click(first);
    assert.match(trigger.textContent ?? '', /All labels/, 'Pointer selection commits the chosen value.');
    assert.equal(fixture.document.activeElement, trigger, 'Selection keeps active-descendant focus on the trigger.');
    assert.equal(selections.length, 3, 'Enter, Space and pointer selection each invoke the controlled callback exactly once; navigation and dismissal invoke none.');
  } finally { await fixture.dispose(); }
});

test('dropdown dismissal preserves Tab and outside focus and consumes Escape before native dialog cancellation', async () => {
  const fixture = new Fixture();
  let dismissals = 0;
  const bubbled: string[] = [];
  try {
    await fixture.mount(createElement('section', { onKeyDown: event => bubbled.push(event.key) }, createElement(Modal, { title: 'Dropdown containment', onDismiss: () => { dismissals++; }, children: createElement(IssueFixture) })));
    const dialog = fixture.root.querySelector('dialog');
    assert.ok(dialog, 'The fixture mounts the actual native Modal.');
    const trigger = await open(fixture, name);
    assert.equal(fixture.panel()?.closest('dialog'), dialog, 'The option panel stays inside its native dialog subtree.');
    const escape = await fixture.key(trigger, 'Escape');
    assert.equal(escape.defaultPrevented, true, 'Open-menu Escape prevents native dialog cancellation.');
    assert.deepEqual(bubbled, [], 'Open-menu Escape is consumed before the React parent.');
    assert.equal(fixture.panel(), undefined, 'Escape closes the listbox.');
    assert.equal(dismissals, 0, 'First Escape does not dismiss inspection.');
    const nextEscape = await fixture.key(trigger, 'Escape');
    assert.equal(nextEscape.defaultPrevented, false, 'A subsequent Escape remains available to native dialog cancellation.');
    assert.deepEqual(bubbled, ['Escape'], 'The React parent observes Escape after the menu closes.');
    await fixture.cancel(dialog);
    assert.equal(dismissals, 1, 'The existing Modal cancellation path still dismisses.');
    await open(fixture, name);
    await fixture.key(trigger, 'Tab');
    assert.equal(fixture.panel(), undefined, 'Tab closes the listbox without committing.');
    assert.notEqual(fixture.document.activeElement, trigger, 'Modal Tab traversal advances to another existing control.');
    await open(fixture, name);
    await fixture.key(trigger, 'Tab', true);
    assert.equal(fixture.panel(), undefined, 'Shift+Tab also closes and traverses.');
    assert.notEqual(fixture.document.activeElement, trigger, 'Reverse Modal traversal remains available.');
    await open(fixture, name);
    const outside = fixture.document.createElement('button');
    fixture.document.body.append(outside);
    await fixture.pointerDown(outside);
    assert.equal(fixture.panel(), undefined, 'Outside pointer input dismisses the open panel before focus or blur can close it.');
    await fixture.focus(outside);
    assert.equal(fixture.document.activeElement, outside, 'Outside dismissal preserves the pointer target focus.');
    assert.match(trigger.textContent ?? '', /All labels/, 'Dismissal never commits a navigated option.');
  } finally { await fixture.dispose(); }
});

test('controlled dropdown stays closed on mount focus and refresh and reconciles empty reordered and removed options without callbacks', async () => {
  const fixture = new Fixture();
  const selections: string[] = [];
  const onLabelChange = (value: string) => { selections.push(value); };
  try {
    const mount = (labels: string[], selected?: string) => fixture.mount(createElement(IssueFixture, { records: [issue(37, { labels })], labelFilter: selected, onLabelChange }));
    await mount(['alpha', 'beta']);
    const trigger = fixture.combobox(name);
    assert.equal(fixture.panel(), undefined, 'Mount must not open the menu.');
    await fixture.focus(trigger);
    await mount(['alpha', 'beta', 'gamma']);
    assert.equal(fixture.panel(), undefined, 'Incidental focus and refreshed option identities do not open it.');
    assert.match(trigger.textContent ?? '', /All labels/, 'Refresh does not commit an option.');
    await open(fixture, name);
    await fixture.key(trigger, 'End');
    await mount(['alpha']);
    const activeId = trigger.getAttribute('aria-activedescendant');
    assert.ok(activeId === null || activeId.length > 0 && fixture.options().some(option => option.id === activeId), 'The active-descendant attribute is absent or resolves to a current option after removal.');
    await fixture.key(trigger, 'Escape');
    assert.match(trigger.textContent ?? '', /All labels/, 'Removing options does not invoke selection.');
    await mount([], '');
    await open(fixture, name);
    assert.deepEqual(fixture.options().map(option => option.textContent?.trim()), ['All labels'], 'An empty dynamic list keeps its current placeholder coherent.');
    await fixture.key(trigger, 'Escape');
    await mount(['alpha'], 'unavailable');
    assert.match(trigger.textContent ?? '', /unavailable/, 'Feature-owned retained label values remain selected when their last issue disappears.');
    assert.equal(fixture.panel(), undefined, 'Changing the controlled value never opens the menu.');
    assert.deepEqual(selections, [], 'Mount, focus, refreshed options, removal and external controlled updates never emit selection callbacks.');

    const options = ['', 'alpha', 'beta'].map(value => createElement('option', { key: value, value }, value || 'All labels'));
    const isolated = (next: typeof options) => fixture.mount(createElement(Dropdown, { value: '', onChange: onLabelChange, 'aria-label': name }, next));
    await isolated(options);
    let isolatedTrigger = fixture.combobox(name);
    assert.equal(fixture.panel(), undefined, 'The isolated production dropdown also mounts closed.');
    await open(fixture, name);
    await fixture.key(isolatedTrigger, 'End');
    await isolated([options[2], options[0], options[1]]);
    assert.deepEqual(fixture.options().map(option => option.textContent?.trim()), ['beta', 'All labels', 'alpha'], 'An actual shared option reorder reaches the panel unchanged by feature sorting.');
    await fixture.key(isolatedTrigger, 'Home');
    assert.equal(fixture.active(isolatedTrigger)?.textContent?.trim(), 'beta', 'Home follows the new first option after a real reorder.');
    await fixture.key(isolatedTrigger, 'End');
    assert.equal(fixture.active(isolatedTrigger)?.textContent?.trim(), 'alpha', 'End follows the new last option after a real reorder.');
    await isolated([]);
    isolatedTrigger = fixture.combobox(name);
    assert.deepEqual(fixture.options(), [], 'The shared component receives zero options, including zero placeholder options.');
    assert.equal(isolatedTrigger.getAttribute('aria-activedescendant'), null, 'Zero shared options cannot retain an active descendant.');
    await fixture.key(isolatedTrigger, 'ArrowDown');
    await fixture.key(isolatedTrigger, 'Enter');
    await fixture.key(isolatedTrigger, ' ');
    assert.deepEqual(selections, [], 'Reordering, removing every option and activating an empty list never emit a selection callback.');
    await fixture.key(isolatedTrigger, 'Escape');
    await isolated(options);
    assert.equal(fixture.panel(), undefined, 'Repopulating a closed empty dropdown never opens it.');
    await open(fixture, name);
    assert.deepEqual(fixture.options().map(option => option.textContent?.trim()), ['All labels', 'alpha', 'beta'], 'Repopulated shared options remain coherent.');
  } finally { await fixture.dispose(); }
});
