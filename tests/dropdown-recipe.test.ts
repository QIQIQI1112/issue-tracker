import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
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

test('dropdown declared tokens and component recipes retain the independently pinned light design values', () => {
  assertDropdownDesign(designSources());
  const entry = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
  const imports = [...entry.matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)].map(match => match[1]);
  for (const required of ['./theme/tokens.css', './theme/base.css', './components/primitives.css', './layout/workspace.css']) assert.ok(imports.includes(required), `The UI stylesheet entry retains ${required}.`);
  assert.match(readFileSync(new URL('../src/ui/main.tsx', import.meta.url), 'utf8'), /import\s+['"]\.\/styles\.css['"]/);
});

test('dropdown design contract rejects incorrect trigger size accent color and glyph stroke declarations', () => {
  const source = designSources();
  for (const [part, original, incorrect] of [
    ['primitives', 'min-height: 32px; padding: 0 var(--space-lg)', 'min-height: 48px; padding: 0 var(--space-lg)'],
    ['tokens', '--accent: #7c8fe6;', '--accent: #ff0000;'],
    ['primitives', 'stroke-width: 1.5px;', 'stroke-width: 0;'],
  ] as const) {
    assert.equal(source[part].split(original).length, 2, 'Each negative control changes exactly one intended declaration.');
    const changed = { ...source, [part]: source[part].replace(original, incorrect) };
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
    const position = () => ({ minWidth: panel.style.minWidth, maxWidth: panel.style.maxWidth, maxHeight: panel.style.maxHeight, left: panel.style.left, top: panel.style.top, bottom: panel.style.bottom });
    assert.deepEqual(position(), { minWidth: '192px', maxWidth: '320px', maxHeight: '384px', left: '62px', top: '', bottom: '78px' }, 'The component clamps a fixed 320px panel above the narrow bottom-edge trigger.');
    fixture.rect = { left: 24, right: 524, top: 40, bottom: 72, width: 500, height: 32, x: 24, y: 40 };
    fixture.viewport = { width: 1024, height: 900 };
    Object.defineProperty(fixture.dom.window, 'innerWidth', { value: 1024 });
    Object.defineProperty(fixture.dom.window, 'innerHeight', { value: 900 });
    await act(async () => { fixture.dom.window.dispatchEvent(new fixture.dom.window.Event('resize')); });
    assert.deepEqual(position(), { minWidth: '192px', maxWidth: '320px', maxHeight: '384px', left: '24px', top: '80px', bottom: '' }, 'Resize clears the old bottom anchor and preserves a fixed panel width beside a wider trigger.');
    assert.deepEqual(fixture.options().map(option => option.textContent), options);
    assert.equal(panel.getAttribute('aria-label'), 'Placement inputs');
    assert.equal(trigger.getAttribute('aria-label'), 'Placement inputs');
    assert.equal(trigger.querySelector('.dropdown-value')?.textContent, options[0]);
    assert.equal(fixture.options().find(option => option.getAttribute('aria-selected') === 'true')?.textContent, options[0]);
  } finally { await fixture.dispose(); }
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
