import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import postcss from 'postcss';
import { Dropdown } from '../src/ui/components/Dropdown.tsx';
import { Fixture, open } from './dropdown-fixture.ts';
import { assertDropdownDesign } from './ui-design-contract.ts';
import type { DropdownDesignSources } from './ui-design-contract.ts';

function designSources(): DropdownDesignSources {
  return {
    tokens: readFileSync(new URL('../src/ui/theme/tokens.css', import.meta.url), 'utf8'),
    primitives: readFileSync(new URL('../src/ui/components/primitives.css', import.meta.url), 'utf8'),
    base: readFileSync(new URL('../src/ui/theme/base.css', import.meta.url), 'utf8'),
  };
}

test('dropdown declared recipes retain shared light tokens typography and semantic styling', () => {
  assertDropdownDesign(designSources());
  const entry = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
  const imports = [...entry.matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)].map(match => match[1]);
  for (const required of ['./theme/tokens.css', './theme/base.css', './components/primitives.css', './layout/workspace.css']) assert.ok(imports.includes(required), `The UI stylesheet entry retains ${required}.`);
  assert.match(readFileSync(new URL('../src/ui/main.tsx', import.meta.url), 'utf8'), /import\s+['"]\.\/styles\.css['"]/);
});

test('dropdown design contract accepts mutable local values and rejects inconsistent shared styling', () => {
  const source = designSources();
  const mutable = { ...source };
  for (const [part, changes] of [
    ['tokens', { '--radius-input': '11px', '--radius-panel': '18px', '--space-lg': '10px', '--shadow-menu': '0 4px 12px var(--border)' }],
    ['primitives', { 'min-height': '40px', padding: '2px 10px', gap: '10px', 'border-radius': '11px', 'min-width': 'min(220px, calc(100vw - 24px))', 'max-width': 'min(360px, calc(100vw - 24px))', 'max-height': 'min(420px, calc(100dvh - 24px))', transition: 'color 180ms ease, background-color 180ms ease' }],
    ['base', { width: '12px', height: '12px', 'border-radius': '12px' }],
  ] as const) {
    const sheet = postcss.parse(source[part]);
    sheet.walkDecls(declaration => {
      if (part === 'primitives' && declaration.parent?.type === 'rule' && !declaration.parent.selector.includes('.dropdown')) return;
      if (part === 'primitives' && declaration.prop === 'min-width' && declaration.parent?.type === 'rule' && declaration.parent.selector !== '.dropdown-panel') return;
      if (part === 'base' && declaration.parent?.type === 'rule' && !declaration.parent.selector.includes('scrollbar')) return;
      const value = (changes as Record<string, string>)[declaration.prop];
      if (value) declaration.value = value;
    });
    mutable[part] = sheet.toString();
  }
  assert.doesNotThrow(() => assertDropdownDesign(mutable));
  for (const [part, selector, property, incorrect] of [
    ['primitives', '.dropdown-trigger, .dropdown-panel', 'font-family', 'monospace'],
    ['primitives', '.dropdown-check', 'color', 'var(--text-tertiary)'],
    ['primitives', ':root[data-focus-intent="keyboard"] .dropdown .dropdown-trigger:focus', 'border-color', 'transparent'],
    ['tokens', ':root', '--accent', '#ff0000'],
    ['primitives', '.dropdown-chevron, .dropdown-check', 'stroke-width', '0px'],
  ] as const) {
    const sheet = postcss.parse(source[part]);
    const recipe = sheet.nodes.find(node => node.type === 'rule' && node.selector === selector);
    assert.ok(recipe?.type === 'rule', `Readiness requires ${selector}.`);
    const declaration = recipe.nodes.find(node => node.type === 'decl' && node.prop === property);
    assert.ok(declaration?.type === 'decl', `Readiness requires ${property}.`);
    declaration.value = incorrect;
    const changed = { ...source, [part]: sheet.toString() };
    assert.throws(() => assertDropdownDesign(changed), { code: 'ERR_ASSERTION' }, `The bounded design contract must reject ${incorrect}`);
  }
  assertDropdownDesign(source);
});
test('dropdown resize updates above and below placement from fixed geometry inputs without changing option identities', async () => {
  const fixture = new Fixture();
  const options = [`Current identifier ${'long_unbroken_label_'.repeat(12)}`, ...Array.from({ length: 30 }, (_, index) => `Other ${index}`)];
  try {
    await fixture.mount(createElement(Dropdown, { value: options[0], onChange: () => {}, 'aria-label': 'Placement inputs' }, options.map(value => createElement('option', { key: value, value }, value))));
    const trigger = await open(fixture, 'Placement inputs');
    const panel = fixture.panel()!;
    panel.getBoundingClientRect = () => new fixture.dom.window.DOMRect(0, 0, 320, 384);
    await act(async () => { fixture.dom.window.dispatchEvent(new fixture.dom.window.Event('resize')); });
    const position = () => {
      const bounds = Object.fromEntries((['minWidth', 'maxWidth', 'maxHeight', 'left'] as const).map(property => [property, Number.parseFloat(panel.style[property])]));
      assert.ok(Object.values(bounds).every(Number.isFinite), 'Placement emits finite numeric bounds.');
      assert.ok(bounds.minWidth > 0 && bounds.maxWidth >= bounds.minWidth && bounds.maxHeight > 0);
      const width = Math.max(bounds.minWidth, Math.min(panel.getBoundingClientRect().width, bounds.maxWidth));
      assert.ok(bounds.left >= 0 && bounds.left + width <= fixture.viewport.width, 'The supplied panel width stays within the viewport.');
      return bounds;
    };
    const above = position();
    assert.equal(panel.style.top, '', 'Upward placement clears the top anchor.');
    const bottom = Number.parseFloat(panel.style.bottom);
    assert.ok(Number.isFinite(bottom) && bottom >= 0);
    const aboveBottom = fixture.viewport.height - bottom;
    assert.ok(aboveBottom <= fixture.rect.top && aboveBottom - above.maxHeight >= 0, 'The panel is bounded above its trigger and inside the viewport.');
    assert.ok(above.left <= fixture.rect.left && above.left + above.maxWidth >= fixture.rect.right, 'The edge-clamped panel remains aligned with its trigger.');
    const identities = fixture.options().map(option => option.id);
    fixture.rect = { left: 24, right: 524, top: 40, bottom: 72, width: 500, height: 32, x: 24, y: 40 };
    fixture.viewport = { width: 1024, height: 900 };
    Object.defineProperty(fixture.dom.window, 'innerWidth', { value: 1024 });
    Object.defineProperty(fixture.dom.window, 'innerHeight', { value: 900 });
    await act(async () => { fixture.dom.window.dispatchEvent(new fixture.dom.window.Event('resize')); });
    const below = position();
    assert.equal(panel.style.bottom, '', 'Resize clears the obsolete bottom anchor.');
    const top = Number.parseFloat(panel.style.top);
    assert.ok(Number.isFinite(top) && top >= fixture.rect.bottom && top + below.maxHeight <= fixture.viewport.height, 'Resize places the bounded panel below the new trigger.');
    assert.equal(below.left, fixture.rect.left, 'An unclamped panel anchors to the trigger left edge.');
    assert.notEqual(below.left, above.left, 'Resize recalculates placement from the new geometry.');
    assert.deepEqual(fixture.options().map(option => option.id), identities);
    assert.deepEqual(fixture.options().map(option => option.textContent), options);
    assert.equal(panel.getAttribute('aria-label'), 'Placement inputs');
    assert.equal(trigger.getAttribute('aria-label'), 'Placement inputs');
    assert.equal(trigger.querySelector('.dropdown-value')?.textContent, options[0]);
    assert.equal(fixture.options().find(option => option.getAttribute('aria-selected') === 'true')?.textContent, options[0]);
  } finally { await fixture.dispose(); }
});
