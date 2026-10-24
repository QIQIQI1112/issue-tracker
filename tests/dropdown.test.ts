import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Children, cloneElement, createElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { Modal } from '../src/ui/components/Modal.tsx';
import { Fixture, Host, IssueFixture, issue, open } from './dropdown-fixture.ts';

const name = 'Filter by label';

test('dropdown opens deliberately navigates with arrows Home and End and commits pointer Enter and Space selections exactly once', () => {
  const fixture = new Fixture();
  try {
    fixture.mount(createElement(IssueFixture));
    const trigger = fixture.combobox(name);
    assert.equal(String(trigger.props['aria-expanded']), 'false', 'The controlled selector starts closed.');
    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
      fixture.key(trigger, key);
      assert.ok(fixture.panel(), `${key} deliberately opens the custom panel.`);
      fixture.key(trigger, 'Escape');
    }
    open(fixture, name);
    fixture.key(trigger, 'End');
    assert.equal(fixture.active(trigger)?.textContent.trim(), 'beta', 'End activates the last current option.');
    fixture.key(trigger, 'ArrowUp');
    assert.equal(fixture.active(trigger)?.textContent.trim(), 'alpha', 'ArrowUp moves through the current option order.');
    fixture.key(trigger, 'Home');
    assert.equal(fixture.active(trigger)?.textContent.trim(), 'All labels', 'Home reaches the first option.');
    fixture.key(trigger, 'ArrowDown');
    assert.equal(fixture.active(trigger)?.textContent.trim(), 'alpha', 'ArrowDown moves without committing.');
    assert.match(trigger.textContent, /All labels/, 'Navigation does not change the controlled value.');
    fixture.key(trigger, 'Enter');
    assert.match(trigger.textContent, /alpha/, 'Enter commits the active value through the feature callback.');
    assert.equal(String(trigger.props['aria-expanded']), 'false', 'Enter closes the menu.');
    open(fixture, name);
    fixture.key(trigger, 'End');
    fixture.key(trigger, ' ');
    assert.match(trigger.textContent, /beta/, 'Space commits the active value.');
    open(fixture, name);
    const first = fixture.options().find(option => option.textContent.trim() === 'All labels');
    assert.ok(first);
    fixture.click(first);
    assert.match(trigger.textContent, /All labels/, 'Pointer selection commits the chosen value.');
    assert.equal(fixture.document.activeElement, trigger, 'Selection keeps active-descendant focus on the trigger.');
    assert.equal(fixture.callbacks.length, 3, 'Enter, Space and pointer selection each invoke the controlled callback exactly once; navigation and dismissal invoke none.');
  } finally { fixture.dispose(); }
});

test('dropdown dismissal preserves Tab and outside focus and consumes Escape before native dialog cancellation', () => {
  const fixture = new Fixture();
  let dismissals = 0;
  try {
    fixture.mount(createElement(Modal, { title: 'Dropdown containment', onDismiss: () => { dismissals++; }, children: createElement(IssueFixture) }));
    const dialog = fixture.all().find(node => node.tagName === 'dialog');
    assert.ok(dialog, 'The fixture mounts the actual native Modal.');
    const trigger = open(fixture, name);
    assert.equal(fixture.panel()?.closest('dialog'), dialog, 'The option panel stays inside its native dialog subtree.');
    const escape = fixture.key(trigger, 'Escape');
    assert.equal(escape.defaultPrevented, true, 'Open-menu Escape prevents native dialog cancellation.');
    assert.equal(escape.propagationStopped, true, 'Open-menu Escape is consumed before the parent dialog.');
    assert.equal(fixture.panel(), undefined, 'Escape closes the listbox.');
    assert.equal(dismissals, 0, 'First Escape does not dismiss inspection.');
    const nextEscape = fixture.key(trigger, 'Escape');
    assert.equal(nextEscape.defaultPrevented, false, 'A subsequent Escape remains available to native dialog cancellation.');
    fixture.event(dialog, 'Cancel');
    assert.equal(dismissals, 1, 'The existing Modal cancellation path still dismisses.');
    open(fixture, name);
    fixture.key(trigger, 'Tab');
    assert.equal(fixture.panel(), undefined, 'Tab closes the listbox without committing.');
    assert.notEqual(fixture.document.activeElement, trigger, 'Modal Tab traversal advances to another existing control.');
    open(fixture, name);
    fixture.key(trigger, 'Tab', true);
    assert.equal(fixture.panel(), undefined, 'Shift+Tab also closes and traverses.');
    assert.notEqual(fixture.document.activeElement, trigger, 'Reverse Modal traversal remains available.');
    open(fixture, name);
    const outside = new Host('button', fixture);
    outside.focus();
    fixture.event(outside, 'PointerDown');
    assert.equal(fixture.panel(), undefined, 'Outside pointer input dismisses the open panel.');
    assert.equal(fixture.document.activeElement, outside, 'Outside dismissal preserves the pointer target focus.');
    assert.match(trigger.textContent, /All labels/, 'Dismissal never commits a navigated option.');
  } finally { fixture.dispose(); }
});

test('controlled dropdown stays closed on mount focus and refresh and reconciles empty reordered and removed options without callbacks', () => {
  const fixture = new Fixture();
  try {
    const mount = (labels: string[], selected?: string) => fixture.mount(createElement(IssueFixture, { records: [issue(37, { labels })], labelFilter: selected }));
    mount(['alpha', 'beta']);
    const trigger = fixture.combobox(name);
    assert.equal(fixture.panel(), undefined, 'Mount must not open the menu.');
    trigger.focus();
    fixture.event(trigger, 'Focus');
    mount(['alpha', 'beta', 'gamma']);
    assert.equal(fixture.panel(), undefined, 'Incidental focus and refreshed option identities do not open it.');
    assert.match(trigger.textContent, /All labels/, 'Refresh does not commit an option.');
    open(fixture, name);
    fixture.key(trigger, 'End');
    mount(['alpha']);
    const activeId = trigger.getAttribute('aria-activedescendant');
    assert.ok(activeId === null || activeId.length > 0 && fixture.options().some(option => option.id === activeId), 'The active-descendant attribute is absent or resolves to a current option after removal.');
    fixture.key(trigger, 'Escape');
    assert.match(trigger.textContent, /All labels/, 'Removing options does not invoke selection.');
    mount([], '');
    open(fixture, name);
    assert.deepEqual(fixture.options().map(option => option.textContent.trim()), ['All labels'], 'An empty dynamic list keeps its current placeholder coherent.');
    fixture.key(trigger, 'Escape');
    mount(['alpha'], 'unavailable');
    assert.match(trigger.textContent, /unavailable/, 'Feature-owned retained label values remain selected when their last issue disappears.');
    assert.equal(fixture.panel(), undefined, 'Changing the controlled value never opens the menu.');
    assert.deepEqual(fixture.callbacks, [], 'Mount, focus, refreshed options, removal and external controlled updates never emit selection callbacks.');

    mount(['alpha', 'beta'], '');
    open(fixture, name);
    const owner = fixture.panel()!.owner;
    assert.ok(owner, 'The real feature exposes its production dropdown component.');
    const input = fixture.panel()!.ownerInput;
    assert.ok(input, 'The fixture retains the actual production dropdown input, without importing a proposed API.');
    const valueOf = (option: unknown): unknown => isValidElement<{ value?: unknown }>(option) ? option.props.value : typeof option === 'object' && option !== null ? (option as { value?: unknown }).value : option;
    const entry = Object.entries(input.props).find(([key, value]) => key !== 'children' && Array.isArray(value) && value.some(option => valueOf(option) === 'alpha') && value.some(option => valueOf(option) === 'beta'));
    const key = entry?.[0] ?? 'children';
    const options = entry ? entry[1] as unknown[] : Children.toArray(input.props.children as ReactNode);
    assert.deepEqual(options.map(valueOf), ['', 'alpha', 'beta'], 'Isolated changing-list setup uses the actual production option inputs, including the feature placeholder.');
    const isolated = (next: unknown[]) => fixture.mount(cloneElement(input, { [key]: next }));
    fixture.key(trigger, 'Escape');
    isolated(options);
    let isolatedTrigger = fixture.combobox(name);
    assert.equal(fixture.panel(), undefined, 'The isolated production dropdown also mounts closed.');
    open(fixture, name);
    fixture.key(isolatedTrigger, 'End');
    isolated([options[2], options[0], options[1]]);
    if (!fixture.panel()) open(fixture, name);
    assert.deepEqual(fixture.options().map(option => option.textContent.trim()), ['beta', 'All labels', 'alpha'], 'An actual shared option reorder reaches the panel unchanged by feature sorting.');
    fixture.key(isolatedTrigger, 'Home');
    assert.equal(fixture.active(isolatedTrigger)?.textContent.trim(), 'beta', 'Home follows the new first option after a real reorder.');
    fixture.key(isolatedTrigger, 'End');
    assert.equal(fixture.active(isolatedTrigger)?.textContent.trim(), 'alpha', 'End follows the new last option after a real reorder.');
    isolated([]);
    isolatedTrigger = fixture.combobox(name);
    assert.deepEqual(fixture.options(), [], 'The shared component receives zero options, including zero placeholder options.');
    const emptyActiveId = isolatedTrigger.getAttribute('aria-activedescendant');
    assert.equal(emptyActiveId, null, 'Zero shared options cannot retain an active descendant.');
    fixture.key(isolatedTrigger, 'ArrowDown');
    fixture.key(isolatedTrigger, 'Enter');
    fixture.key(isolatedTrigger, ' ');
    assert.deepEqual(fixture.callbacks, [], 'Reordering, removing every option and activating an empty list never emit a selection callback.');
    fixture.key(isolatedTrigger, 'Escape');
    isolated(options);
    assert.equal(fixture.panel(), undefined, 'Repopulating a closed empty dropdown never opens it.');
    open(fixture, name);
    assert.deepEqual(fixture.options().map(option => option.textContent.trim()), ['All labels', 'alpha', 'beta'], 'Repopulated shared options remain coherent.');
  } finally { fixture.dispose(); }
});
