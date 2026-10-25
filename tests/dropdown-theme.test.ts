import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Fixture, IssueFixture, issue, open } from './dropdown-fixture.ts';
import { declarations, effective, length } from './dropdown-styles.ts';

test('dropdown panels constrain viewport placement wrap long labels and retain bounded native option scrolling', async () => {
  const fixture = new Fixture();
  try {
    const labels = Array.from({ length: 60 }, (_, index) => `Option ${String(index).padStart(2, '0')} ${'long_unbroken_identifier_'.repeat(8)}`);
    await fixture.mount(createElement(IssueFixture, { records: [issue(37, { labels })] }));
    await open(fixture, 'Filter by label');
    const panel = fixture.panel()!;
    const style = declarations(panel);
    const maxWidth = length(style['max-width'] ?? style['max-inline-size'] ?? style.width, fixture.viewport.width, fixture);
    assert.ok(Number.isFinite(maxWidth) && maxWidth <= fixture.viewport.width, 'The actual panel width constraint fits the 390px viewport.');
    const maxHeight = length(style['max-height'] ?? style['max-block-size'], fixture.viewport.height, fixture);
    assert.ok(maxHeight > 0 && maxHeight <= fixture.viewport.height, 'The actual long-list panel has a positive viewport-bounded height.');
    assert.match(style['overflow-y'] ?? style.overflow ?? '', /^(auto|scroll)$/, 'Long custom option lists retain native vertical overflow.');
    const row = fixture.options().find(node => (node.textContent ?? '').includes('long_unbroken_identifier_'));
    assert.ok(row, 'The panel contains actual long-label options.');
    assert.match(effective(row, 'overflow-wrap') || effective(row, 'word-break'), /anywhere|break-word|break-all/, 'Long unbroken option labels have an applied wrapping rule.');
    assert.notEqual(effective(row, 'white-space'), 'nowrap', 'Option labels are not forced onto an overflowing single line.');
    assert.ok(style.position === 'fixed' || style.position === 'absolute', 'The panel exposes a supported fixed or absolute placement calculation.');
    let anchor: HTMLElement | null = style.position === 'absolute' ? panel.parentElement : null;
    while (anchor && (!declarations(anchor).position || declarations(anchor).position === 'static')) anchor = anchor.parentElement;
    const containing = anchor?.getBoundingClientRect() ?? { left: 0, top: 0, width: fixture.viewport.width, height: fixture.viewport.height };
    const width = Math.min(length(style.width ?? style['inline-size'] ?? String(maxWidth), containing.width, fixture), maxWidth);
    assert.ok(Number.isFinite(width) && width > 0, 'The supported placement calculation resolves a positive panel width.');
    const start = length(style.left ?? style['inset-inline-start'], containing.width, fixture);
    const end = length(style.right ?? style['inset-inline-end'], containing.width, fixture);
    const left = containing.left + (Number.isFinite(start) ? start : containing.width - end - width);
    assert.ok(Number.isFinite(left) && left >= 0 && left + width <= fixture.viewport.width, 'Calculated placement clamps the right-edge trigger panel inside the viewport.');
    const before = length(style.top ?? style['inset-block-start'], containing.height, fixture);
    const after = length(style.bottom ?? style['inset-block-end'], containing.height, fixture);
    const top = containing.top + (Number.isFinite(before) ? before : containing.height - after - maxHeight);
    assert.ok(Number.isFinite(top) && top >= 0 && top + maxHeight <= fixture.viewport.height, 'Calculated placement uses available space above a near-bottom trigger.');
    assert.equal(fixture.options().length, 61, 'The full option collection remains present for native panel scrolling.');
  } finally { await fixture.dispose(); }
});

test('dropdown interaction states and shared native scrollbars use existing light-theme tokens across application scroll containers', async () => {
  const fixture = new Fixture();
  try {
    await fixture.mount(createElement(IssueFixture));
    const trigger = await open(fixture, 'Filter by label');
    const panel = fixture.panel()!;
    const row = fixture.options()[1];
    for (const [node, properties] of [[trigger, ['background', 'border', 'border-radius']], [panel, ['background', 'border-radius', 'box-shadow']]] as const) {
      for (const property of properties) assert.match(declarations(node)[property] ?? '', /var\(--[\w-]+\)/, `The actual ${node.getAttribute('role')} ${property} uses shared semantic tokens.`);
    }
    assert.match(effective(trigger, 'font-family') || effective(trigger, 'font'), /inherit|var\(--font-family-body\)/, 'Dropdown controls inherit the shared body font.');
    const normal = declarations(row);
    const hover = declarations(row, { hover: true });
    assert.ok(Object.entries(hover).some(([key, value]) => value !== normal[key] && /var\(--/.test(value)), 'An actual option hover treatment uses shared tokens.');
    const optionLabel = (row.textContent ?? '').trim();
    await fixture.key(trigger, 'Home');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'All labels', 'Navigation rests on another option before the styling comparison.');
    assert.equal(String(row.getAttribute('aria-selected')), 'false', 'The observed option is initially unselected.');
    const unselectedStyle = declarations(row);
    await fixture.click(row);
    await open(fixture, 'Filter by label');
    await fixture.key(trigger, 'Home');
    const selected = fixture.options().find(option => (option.textContent ?? '').trim() === optionLabel);
    assert.ok(selected, 'The same option remains present after the controlled selection.');
    assert.equal(String(selected.getAttribute('aria-selected')), 'true', 'The real callback updates the observed option to selected.');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'All labels', 'The styling comparison keeps navigation on the same other option in both states.');
    const selectedStyle = declarations(selected);
    assert.ok(Object.entries(selectedStyle).some(([key, value]) => value !== unselectedStyle[key] && /var\(--/.test(value)), 'The actual selected option has a distinct token-based treatment.');
    fixture.document.documentElement.dataset.focusIntent = 'keyboard';
    const focused = declarations(trigger, { focus: true });
    assert.match(focused.outline ?? focused['outline-color'] ?? '', /var\(--focus-ring\)/, 'The trigger receives the shared intentional keyboard focus treatment.');
    const containers = [panel, ...['workspace-content', 'issue-list', 'requirement-list', 'modal', 'evidence-preview', 'harness-source'].map(className => {
      const node = fixture.document.createElement(className === 'modal' ? 'dialog' : 'div'); node.className = className; fixture.root.append(node);
      if (className === 'evidence-preview' || className === 'harness-source') { const pre = fixture.document.createElement('pre'); node.append(pre); return pre; }
      return node;
    })];
    for (const container of containers) {
      const scrollbar = effective(container, 'scrollbar-color');
      assert.match(scrollbar, /var\(--[\w-]+\)/, `${container.className || container.tagName}: standard native scrollbars use shared theme tokens.`);
      assert.notEqual(effective(container, 'scrollbar-width'), 'none', 'Visible native scrollbars are not hidden.');
      const thumb = declarations(container, { pseudo: '::-webkit-scrollbar-thumb' });
      assert.match(thumb.background ?? thumb['background-color'] ?? '', /var\(--[\w-]+\)/, `${container.className || container.tagName}: WebKit scrollbar thumbs use the shared theme.`);
    }
  } finally { await fixture.dispose(); }
});
