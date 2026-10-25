import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { Dropdown } from '../src/ui/components/Dropdown.tsx';
import { Fixture, IssueFixture, open } from './dropdown-fixture.ts';
import { declarations, effective, length } from './dropdown-styles.ts';

function resolve(node: HTMLElement, value: string): string {
  const tokens = declarations(node.ownerDocument.documentElement);
  for (let pass = 0; pass < 10 && value.includes('var('); pass++) value = value.replace(/var\((--[\w-]+)\)/g, (_match, name: string) => tokens[name] ?? 'invalid');
  return value;
}

function style(node: HTMLElement, state: Parameters<typeof declarations>[1] = {}) {
  const result = node.ownerDocument.createElement('span').style;
  for (const [property, value] of Object.entries(declarations(node, state))) result.setProperty(property, resolve(node, value));
  return result;
}

function typography(node: HTMLElement, fixture: Fixture) {
  const size = length(effective(node, 'font-size'), 0, fixture);
  const leading = resolve(node, effective(node, 'line-height'));
  return {
    size,
    weight: resolve(node, effective(node, 'font-weight')).replace('normal', '400'),
    leading: /^[\d.]+$/.test(leading) ? Number(leading) * size : length(leading, 0, fixture),
  };
}

function label(container: HTMLElement, text: string) {
  const node = [container, ...container.querySelectorAll<HTMLElement>('*')].reverse().find(candidate => candidate.textContent === text);
  assert.ok(node, 'The actual complete label remains present in the DOM.');
  return node;
}

function ellipsis(node: HTMLElement) {
  const observed = style(node);
  assert.equal(observed.minWidth, '0', 'The label can shrink within its flex row.');
  assert.equal(observed.flexGrow, '1', 'The label consumes the available row width.');
  assert.equal(observed.whiteSpace, 'nowrap', 'The complete label is single-line.');
  assert.equal(observed.overflow, 'hidden', 'The label clips only its visual overflow.');
  assert.equal(observed.textOverflow, 'ellipsis', 'The complete label uses the pinned ellipsis treatment.');
}

function glyph(node: HTMLElement | null, path: string, color: string, fixture: Fixture) {
  assert.ok(node, 'The actual dropdown contains the required painted glyph.');
  const observed = style(node);
  assert.equal(observed.width, '16px', 'The dropdown glyph is 16px wide.');
  assert.equal(observed.height, '16px', 'The dropdown glyph is 16px high.');
  assert.equal(observed.color, color, 'The glyph uses the exact pinned light color.');
  assert.equal(observed.stroke || node.getAttribute('stroke'), 'currentColor', 'The glyph paints its current color stroke.');
  assert.equal(length(observed.strokeWidth || node.getAttribute('stroke-width') || '', 0, fixture), 1.5, 'The glyph has an actual 1.5px stroke.');
  assert.equal(node.getAttribute('viewBox'), '0 0 24 24', 'The pinned glyph retains its 24-unit coordinate system.');
  const paintedPath = node.querySelector<HTMLElement>('path');
  assert.equal(paintedPath?.getAttribute('d'), path, 'The glyph uses the exact pinned path.');
  assert.equal(observed.transform || 'none', 'none', 'The pinned path needs no compensating rotation.');
  assert.equal(node.getAttribute('aria-hidden'), 'true', 'The decorative glyph does not change the accessible label.');
  for (let part: HTMLElement | null = paintedPath; part; part = part.parentElement) {
    const paint = style(part);
    assert.ok(!part.hidden && paint.display !== 'none' && !/hidden|collapse/.test(paint.visibility) && paint.opacity !== '0', 'The actual glyph path and its ancestors remain visible.');
  }
}

test('shared dropdown applies the pinned light trigger panel row typography glyph and interaction-state recipe', async () => {
  for (const width of [1024, 390]) {
    const fixture = new Fixture();
    try {
      fixture.viewport.width = width;
      Object.defineProperty(fixture.dom.window, 'innerWidth', { value: width });
      await fixture.mount(createElement(IssueFixture));
      const trigger = fixture.combobox('Filter by label');
      const resting = style(trigger);
      assert.equal(resting.minHeight, '32px', 'The actual shared trigger uses the pinned 32px minimum height at desktop and narrow widths.');
      assert.deepEqual(typography(trigger, fixture), { size: 14, weight: '400', leading: 19 }, 'The actual trigger uses regular 14px type with 19px leading.');
      assert.deepEqual([resting.paddingTop, resting.paddingRight, resting.paddingBottom, resting.paddingLeft, resting.gap, resting.borderRadius], ['0px', '8px', '0px', '12px', '8px', '8px'], 'The actual trigger uses the pinned insets gap and radius.');
      assert.deepEqual([resting.backgroundColor, resting.color, resting.borderWidth, resting.borderStyle, resting.borderColor], ['rgb(255, 255, 255)', 'rgb(11, 11, 11)', '1px', 'solid', 'rgba(11, 11, 11, 0.1)'], 'The actual trigger uses the exact light surface ink and hairline.');
      const hovered = style(trigger, { hover: true });
      assert.deepEqual([hovered.backgroundColor, hovered.borderColor], [resting.backgroundColor, resting.borderColor], 'Trigger hover changes neither surface nor border.');
      fixture.document.documentElement.dataset.focusIntent = 'keyboard';
      const focused = style(trigger, { focus: true });
      assert.equal(focused.borderColor, 'rgb(11, 11, 11)', 'Intentional focus changes the trigger border to primary ink.');
      assert.ok(focused.outline === 'none' || focused.outlineWidth === '0px', 'Intentional focus uses no outer outline.');
      assert.equal(focused.backgroundColor, resting.backgroundColor, 'Focus retains the neutral trigger surface.');
      assert.doesNotMatch(focused.transition, /\ball\b|border|outline/, 'Border focus feedback is instant.');
      assert.match(resolve(trigger, effective(trigger, 'font-family')), /Loop Han.*system-ui.*PingFang SC/, 'The shared dropdown retains the existing local platform font stack.');
      for (const [property, expected] of [['text-rendering', 'optimizeLegibility'], ['-webkit-font-smoothing', 'antialiased'], ['font-synthesis', 'none']]) assert.equal(resolve(trigger, effective(trigger, property)), expected, `The trigger retains pinned ${property}.`);
      glyph(trigger.querySelector<HTMLElement>('svg'), 'm6 9 6 6 6-6', 'rgb(151, 149, 141)', fixture);
      await open(fixture, 'Filter by label');
      await fixture.key(trigger, 'End');
      const panel = fixture.panel()!;
      const panelStyle = style(panel);
      assert.deepEqual([panelStyle.position, panelStyle.padding, panelStyle.borderRadius, panelStyle.borderWidth, panelStyle.backgroundColor], ['fixed', '8px', '14px', '0px', 'rgb(255, 255, 255)'], 'The actual panel uses the pinned fixed surface inset radius and zero border.');
      assert.equal(resolve(panel, declarations(panel)['box-shadow']).replace(/\s+/g, ' '), '0 0 0 1px rgb(11 11 11 / 10%), 0 2px 6px rgb(0 0 0 / 8%), 0 8px 24px rgb(0 0 0 / 12%)', 'The actual panel uses the ink ring and both raised light shadows.');
      for (const [property, expected] of [['text-rendering', 'optimizeLegibility'], ['-webkit-font-smoothing', 'antialiased'], ['font-synthesis', 'none']]) assert.equal(resolve(panel, effective(panel, property)), expected, `The panel retains pinned ${property}.`);
      const selected = fixture.options().find(row => row.getAttribute('aria-selected') === 'true');
      const unselected = fixture.options().find(row => row.textContent === 'alpha');
      assert.ok(selected && unselected, 'The appearance comparison observes a selected row and a distinct inactive unselected row.');
      assert.equal(selected.textContent, 'All labels', 'The selected paint observation belongs to the current controlled option.');
      assert.equal(selected.dataset.active, 'false', 'The selected row is independently inactive during the paint observation.');
      for (const row of [selected, unselected]) {
        const rowStyle = style(row);
        assert.deepEqual([rowStyle.display, rowStyle.alignItems, rowStyle.gap, rowStyle.minHeight, rowStyle.paddingLeft, rowStyle.paddingRight, rowStyle.borderRadius], ['flex', 'center', '12px', '32px', '12px', '12px', '8px'], 'Actual option rows use the pinned flex alignment dimensions and insets.');
        const rowType = typography(row, fixture);
        assert.deepEqual(rowType, { size: 14, weight: '400', leading: 20 }, 'Actual option rows use regular 14px type and 20px leading.');
        const verticalInsets = [rowStyle.paddingTop, rowStyle.paddingBottom, rowStyle.borderTopWidth, rowStyle.borderBottomWidth].reduce((total, value) => total + length(value || '0', 0, fixture), 0);
        assert.ok(rowType.leading + verticalInsets <= 32, 'The actual single-line row leading padding and borders fit the pinned 32px row height.');
        assert.equal(rowStyle.color, 'rgb(11, 11, 11)', 'Selected and unselected rows retain neutral primary ink.');
        assert.ok(!rowStyle.backgroundColor || rowStyle.backgroundColor === 'transparent' || rowStyle.backgroundColor === 'rgba(0, 0, 0, 0)', 'An inactive row has no selected accent fill.');
        assert.ok(!rowStyle.boxShadow || rowStyle.boxShadow === 'none', 'Selection adds no inset ring.');
        assert.equal(style(row, { hover: true }).backgroundColor, 'rgb(243, 243, 240)', 'Pointer hover uses the exact neutral light fill.');
        for (const property of ['color', 'background-color']) assert.match(rowStyle.transition, new RegExp(`${property} 140ms cubic-bezier\\(0\\.4,\\s*0,\\s*0\\.2,\\s*1\\)`), `The actual row transitions ${property} over the pinned 140ms easing.`);
      }
      assert.equal(style(fixture.active(trigger)!).backgroundColor, 'rgb(243, 243, 240)', 'The actual keyboard-active row uses the same neutral hover fill.');
      glyph(selected.querySelector<HTMLElement>('svg'), 'M20 6 9 17l-5-5', 'rgb(124, 143, 230)', fixture);
      assert.equal(selected.lastElementChild?.localName, 'svg', 'The selected Check trails its complete label.');
      assert.equal(unselected.querySelector('svg'), null, 'An unselected row does not paint a selected Check.');
      await fixture.key(trigger, 'Home');
      assert.ok(!style(selected).boxShadow || style(selected).boxShadow === 'none', 'A selected keyboard-active row also has no inset selection ring.');
      await fixture.key(trigger, 'Escape');
      await fixture.mount(createElement(Dropdown, { value: 'one', onChange: () => {}, 'aria-label': 'Grouped recipe' }, createElement('optgroup', { label: 'Current group' }, createElement('option', { value: 'one' }, 'One'))));
      await open(fixture, 'Grouped recipe');
      const group = fixture.root.querySelector<HTMLElement>('[role="group"]');
      assert.equal(group?.getAttribute('aria-label'), 'Current group', 'The current accessible group name is retained.');
      const caption = label(group!, 'Current group');
      const captionStyle = style(caption);
      assert.deepEqual([captionStyle.minHeight, captionStyle.paddingLeft, captionStyle.paddingRight, captionStyle.color], ['32px', '12px', '12px', 'rgb(151, 149, 141)'], 'The actual group caption uses the pinned height insets and tertiary ink.');
      assert.deepEqual(typography(caption, fixture), { size: 14, weight: '400', leading: 20 }, 'The group caption retains the pinned type and leading.');
    } finally { await fixture.dispose(); }
  }
});

test('dropdown intrinsic sizing placement seams scrolling and complete ellipsized labels follow the pinned light recipe', async () => {
  const long = `Current identifier ${'long_unbroken_label_'.repeat(12)}`;
  for (const [width, height, top, left, triggerWidth, panelWidth, upwards, expectedHeight] of [
    [1024, 900, 40, 24, 500, 320, false, 384],
    [390, 900, 800, 282, 100, 320, true, 384],
    [390, 220, 40, 62, 320, 320, false, 132],
    [180, 220, 160, 8, 164, 164, true, 144],
  ] as const) {
    const fixture = new Fixture();
    try {
      fixture.viewport = { width, height };
      Object.defineProperty(fixture.dom.window, 'innerWidth', { value: width });
      Object.defineProperty(fixture.dom.window, 'innerHeight', { value: height });
      fixture.rect = { left, right: left + triggerWidth, top, bottom: top + 32, width: triggerWidth, height: 32, x: left, y: top };
      const options = [long, ...Array.from({ length: 30 }, (_, index) => `Other ${index}`)];
      await fixture.mount(createElement(Dropdown, { value: long, onChange: () => {}, 'aria-label': 'Recipe sizing' }, options.map(value => createElement('option', { key: value, value }, value))));
      const trigger = await open(fixture, 'Recipe sizing');
      const panel = fixture.panel()!;
      panel.getBoundingClientRect = () => new fixture.dom.window.DOMRect(0, 0, panelWidth, expectedHeight);
      await act(async () => { fixture.dom.window.dispatchEvent(new fixture.dom.window.Event('resize')); });
      const observed = style(panel);
      assert.equal(observed.width, 'max-content', 'The actual panel requests intrinsic max-content width instead of following the trigger width.');
      const minWidth = length(observed.minWidth, width, fixture);
      assert.equal(minWidth, Math.min(192, width - 16), 'The intrinsic minimum is 192px limited by the viewport seams.');
      const maxWidth = length(observed.maxWidth, width, fixture);
      assert.equal(maxWidth, Math.min(320, width - 16), 'The intrinsic maximum is 320px limited by the viewport seams.');
      assert.equal(length(observed.maxHeight, height, fixture), expectedHeight, 'The actual height cap is 384px limited by available above or below space after the 8px seams.');
      assert.equal(observed.overflowY, 'auto', 'The actual full option list retains native vertical scrolling.');
      const panelLeft = length(observed.left, width, fixture);
      assert.ok(panelLeft >= 8 && panelLeft + panelWidth <= width - 8, 'The placement calculation retains both 8px horizontal viewport seams for the explicit panel width independent of trigger width.');
      if (upwards) {
        const panelBottom = height - length(observed.bottom, height, fixture);
        assert.equal(panelBottom, top - 8, 'An upward panel retains the exact 8px anchor gap.');
        assert.ok(panelBottom - expectedHeight >= 8, 'An upward panel retains the top viewport seam.');
      } else {
        const panelTop = length(observed.top, height, fixture);
        assert.equal(panelTop, top + 32 + 8, 'A downward panel retains the exact 8px anchor gap.');
        assert.ok(panelTop + expectedHeight <= height - 8, 'A downward panel retains the bottom viewport seam.');
      }
      assert.deepEqual(fixture.options().map(row => row.textContent), options, 'The actual list retains every complete option identity for native scrolling.');
      assert.equal(panel.getAttribute('aria-label'), 'Recipe sizing', 'Sizing preserves the current listbox accessible name.');
      assert.equal(trigger.getAttribute('aria-label'), 'Recipe sizing', 'Ellipsis preserves the current trigger accessible name.');
      const row = fixture.options().find(option => option.getAttribute('aria-selected') === 'true');
      assert.ok(row && row.textContent === long, 'The selected option independently retains its full current identifier.');
      ellipsis(label(trigger, long));
      ellipsis(label(row, long));
    } finally { await fixture.dispose(); }
  }
});

test('dropdown documentation records pinned Select and Menu provenance adapted listbox semantics and code-only limits', () => {
  const documentation = readFileSync(new URL('../docs/ui-iteration.md', import.meta.url), 'utf8');
  const section = documentation.split(/^## /m).find(candidate => candidate.includes('b94ea8d4-ebb8-48f5-b4d5-8bad04bae81e/reference'));
  assert.ok(section, 'English dropdown documentation identifies the actual pinned light recipe capsule.');
  assert.match(section, /light-recipe\.json/, 'Dropdown provenance names the authoritative light recipe.');
  assert.match(section, /83c6d755654e860f2d7bde7e132b451ebf92812d/, 'Dropdown provenance records the pinned UTG source revision.');
  assert.match(section, /Select[\s\S]*Menu|Menu[\s\S]*Select/, 'Dropdown provenance identifies both source appearance primitives.');
  assert.match(section, /combobox[\s\S]*listbox|listbox[\s\S]*combobox/, 'The dropdown adaptation documents retained combobox and listbox semantics.');
  assert.match(section, /appearance[\s\S]*adapt|adapt[\s\S]*appearance/i, 'Documentation explains the source appearance adaptation.');
  assert.match(section, /no runtime dependency|provenance only|no runtime access/i, 'The external capsule remains provenance rather than a runtime dependency.');
  assert.match(section, /Node[\s\S]*(?:do not|cannot|does not)[\s\S]*browser[\s\S]*(?:paint|layout)/i, 'Documentation limits Node style and geometry observations without claiming browser fidelity.');
  assert.doesNotMatch(section, /wrap long labels/i, 'The current dropdown documentation no longer prescribes wrapping instead of the pinned ellipsis.');
});
