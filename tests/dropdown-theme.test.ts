import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { Fixture, IssueFixture, issue, open } from './dropdown-fixture.ts';
import { declarations, effective, length } from './dropdown-styles.ts';

function visible(node: HTMLElement, fixture: Fixture): boolean {
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    const style = declarations(current);
    if (current.hidden || style.display === 'none' || /hidden|collapse/.test(style.visibility ?? '') || style.opacity !== undefined && Number(style.opacity) === 0) return false;
  }
  if (node.localName === 'path') return true;
  const style = declarations(node);
  const rect = node.getBoundingClientRect();
  return (['width', 'height'] as const).every(dimension => length(style[dimension] ?? node.getAttribute(dimension) ?? String(rect[dimension]), fixture.viewport[dimension], fixture) > 0);
}

function containedLabel(node: HTMLElement, fixture: Fixture): boolean {
  if (!visible(node, fixture)) return false;
  const style = declarations(node);
  if (effective(node, 'white-space') !== 'nowrap' && /anywhere|break-word|break-all/.test(effective(node, 'overflow-wrap') || effective(node, 'word-break'))) return true;
  const parent = node.parentElement && declarations(node.parentElement);
  const width = length(style.width ?? style['max-width'], fixture.viewport.width, fixture);
  const constrained = parent?.display === 'flex' && length(style['min-width'], fixture.viewport.width, fixture) === 0 || /block|flex|grid/.test(style.display ?? '') && Number.isFinite(width) && width > 0;
  return constrained && effective(node, 'white-space') === 'nowrap' && /hidden|clip/.test(style['overflow-x'] ?? style.overflow ?? '') && style['text-overflow'] === 'ellipsis';
}

function selectionPaint(row: HTMLElement, fixture: Fixture): string[] {
  return [row, ...row.querySelectorAll<HTMLElement>('svg')].filter(node => visible(node, fixture)).flatMap(node => {
    const style = declarations(node);
    if (node === row) return ['background', 'background-color', 'color'].flatMap(property => /var\(--/.test(style[property] ?? '') ? [`row:${property}:${style[property]}`] : []);
    const path = node.querySelector<HTMLElement>('path[d]');
    if (!path?.getAttribute('d')?.trim() || !visible(path, fixture)) return [];
    const pathStyle = declarations(path);
    const stroke = pathStyle.stroke ?? path.getAttribute('stroke') ?? style.stroke ?? node.getAttribute('stroke');
    const strokeWidth = length(pathStyle['stroke-width'] ?? path.getAttribute('stroke-width') ?? style['stroke-width'] ?? node.getAttribute('stroke-width') ?? '1', 1, fixture);
    const color = stroke === 'currentColor' ? effective(path, 'color') : stroke;
    return strokeWidth > 0 && /var\(--/.test(color ?? '') ? [`indicator:${color}`] : [];
  });
}

function focusEdge(style: Record<string, string>, kind: 'outline' | 'border', fixture: Fixture): string {
  const shorthand = style[kind] ?? '';
  const width = length(style[`${kind}-width`] ?? shorthand.match(/[\d.]+(?:px|rem)/)?.[0], 1, fixture);
  const color = style[`${kind}-color`] ?? shorthand;
  return width > 0 && /solid|dashed|dotted|double/.test(style[`${kind}-style`] ?? shorthand) && /var\(--/.test(color) ? `${width}:${color}` : '';
}

test('dropdown panels constrain viewport placement contain long labels and retain bounded native option scrolling', async () => {
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
    assert.equal(row.textContent?.trim(), labels[0], 'The actual complete long label remains in the DOM.');
    const label = [row, ...row.querySelectorAll<HTMLElement>('*')].reverse().find(node => node.textContent?.trim() === labels[0]);
    assert.ok(label && containedLabel(label, fixture), 'The actual long label wraps or has constrained hidden-overflow single-line ellipsis.');
    assert.ok(style.position === 'fixed' || style.position === 'absolute', 'The panel exposes a supported fixed or absolute placement calculation.');
    let anchor: HTMLElement | null = style.position === 'absolute' ? panel.parentElement : null;
    while (anchor && (!declarations(anchor).position || declarations(anchor).position === 'static')) anchor = anchor.parentElement;
    const containing = anchor?.getBoundingClientRect() ?? { left: 0, top: 0, width: fixture.viewport.width, height: fixture.viewport.height };
    const inlineWidth = style.width ?? style['inline-size'];
    const width = Math.min(inlineWidth === 'max-content' ? panel.getBoundingClientRect().width : length(inlineWidth ?? String(maxWidth), containing.width, fixture), maxWidth);
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
    const unselectedStyle = selectionPaint(row, fixture);
    await fixture.click(row);
    await open(fixture, 'Filter by label');
    await fixture.key(trigger, 'Home');
    const selected = fixture.options().find(option => (option.textContent ?? '').trim() === optionLabel);
    assert.ok(selected, 'The same option remains present after the controlled selection.');
    assert.equal(String(selected.getAttribute('aria-selected')), 'true', 'The real callback updates the observed option to selected.');
    assert.equal(fixture.active(trigger)?.textContent?.trim(), 'All labels', 'The styling comparison keeps navigation on the same other option in both states.');
    const selectedStyle = selectionPaint(selected, fixture);
    assert.ok(selectedStyle.some(paint => !unselectedStyle.includes(paint)), 'The actual selected option has a distinct visible token-based row or indicator treatment.');
    fixture.document.documentElement.dataset.focusIntent = 'keyboard';
    const unfocused = declarations(trigger);
    const focused = declarations(trigger, { focus: true });
    assert.ok(visible(trigger, fixture) && (['outline', 'border'] as const).some(kind => focusEdge(focused, kind, fixture) && focusEdge(focused, kind, fixture) !== focusEdge(unfocused, kind, fixture)), 'Intentional keyboard focus changes a visible nonzero shared-token outline or border edge.');
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
