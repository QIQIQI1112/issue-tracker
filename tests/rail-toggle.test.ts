import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import postcss from 'postcss';
import { WorkspaceLayout } from '../src/ui/layout/WorkspaceLayout.tsx';
import { Fixture, repo } from './dropdown-fixture.ts';
import { assertRailDesign } from './ui-design-contract.ts';

function designSources() {
  return {
    workspace: readFileSync(new URL('../src/ui/layout/workspace.css', import.meta.url), 'utf8'),
    tokens: readFileSync(new URL('../src/ui/theme/tokens.css', import.meta.url), 'utf8'),
    base: readFileSync(new URL('../src/ui/theme/base.css', import.meta.url), 'utf8'),
  };
}

test('rail toggle retains real button semantics and changes the actual workspace state without selecting navigation', async () => {
  const fixture = new Fixture();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const actions: string[] = [];
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    observe() {}
    disconnect() {}
  } });
  try {
    await fixture.mount(createElement(WorkspaceLayout, {
      repos: [repo], repoFilter: String(repo.id), selectedRepo: repo, subview: 'requirements', registryLoading: false, workbenchError: '',
      chooseRepository: id => actions.push(`repository:${id}`), setSubview: view => actions.push(`view:${view}`), refreshRepositories: () => actions.push('refresh'),
      children: createElement('p', null, 'Current content'),
    }));
    const workspace = fixture.root.querySelector<HTMLElement>('.workspace');
    const toggle = fixture.named('Expand navigation rail');
    assert.ok(workspace && toggle instanceof fixture.dom.window.HTMLButtonElement);
    assert.equal(workspace.dataset.sidebar, 'collapsed');
    assert.equal(toggle.type, 'button');
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.querySelector('.toolbar-icon-slot')?.getAttribute('aria-hidden'), 'true');
    assert.equal(toggle.querySelector('svg')?.getAttribute('focusable'), 'false');
    assert.equal(toggle.querySelector('path')?.getAttribute('d'), 'm11 17-5-5 5-5m7 10-5-5 5-5');
    const navigationState = () => [...fixture.root.querySelectorAll('nav button, nav a')].map(node => [
      node.getAttribute('aria-label') ?? node.textContent?.trim(), node.getAttribute('aria-pressed'), node.getAttribute('aria-current'), node.classList.contains('active'),
    ]);
    const selection = navigationState();
    assert.ok(selection.some(([, pressed]) => pressed === 'true'), 'The fixture starts with an actual active navigation selection.');
    await fixture.click(toggle);
    assert.equal(workspace.dataset.sidebar, 'expanded');
    assert.equal(toggle.getAttribute('aria-label'), 'Collapse navigation rail');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(fixture.document.activeElement, toggle);
    assert.deepEqual(navigationState(), selection, 'Expansion preserves every existing navigation selection state.');
    await fixture.click(toggle);
    assert.equal(workspace.dataset.sidebar, 'collapsed');
    assert.equal(toggle.getAttribute('aria-label'), 'Expand navigation rail');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(fixture.document.activeElement, toggle);
    assert.deepEqual(navigationState(), selection, 'Collapse preserves every existing navigation selection state.');
    assert.equal(fixture.root.querySelector('main p')?.textContent, 'Current content');
    assert.deepEqual(actions, []);
  } finally {
    try { await fixture.dispose(); }
    finally { if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous); else Reflect.deleteProperty(globalThis, 'ResizeObserver'); }
  }
});

test('rail declared recipes retain state styling anchoring and effective reduced motion', () => {
  assertRailDesign(designSources());
});

test('rail design contract accepts mutable local styling and rejects ineffective reduced motion', () => {
  const source = designSources();
  const workspace = postcss.parse(source.workspace);
  workspace.walkDecls(declaration => {
    if (declaration.prop === 'padding') declaration.value = '10px 14px';
    if (declaration.prop === 'border-radius') declaration.value = '12px';
    if (declaration.prop === 'transition') declaration.value = 'color 180ms ease, background-color 180ms ease';
    if (declaration.parent?.type === 'rule' && declaration.parent.selector === '.rail-toggle::before') {
      if (declaration.prop === 'width') declaration.value = '42px';
      if (declaration.prop === 'height') declaration.value = '36px';
      if (declaration.prop === 'left') declaration.value = '2px';
    }
  });
  const base = postcss.parse(source.base);
  base.walkDecls(/^(animation|transition)-duration$/, declaration => { declaration.value = '0s'; });
  const mutable = { ...source, workspace: workspace.toString(), base: base.toString() };
  assert.doesNotThrow(() => assertRailDesign(mutable));
  for (const [part, selector, property, incorrect, important] of [
    ['workspace', '.nav-button.active', 'background', 'var(--surface-hover)', false],
    ['workspace', '.rail-toggle::before', 'pointer-events', 'auto', false],
    ['base', '*, *::before, *::after', 'transition-duration', '220ms', true],
    ['base', '*, *::before, *::after', 'animation-duration', '1s', true],
    ['base', '*, *::before, *::after', 'transition-duration', '0s', false],
    ['base', '*, *::before, *::after', 'animation-iteration-count', 'infinite', true],
  ] as const) {
    const sheet = postcss.parse(source[part]);
    let changed = false;
    sheet.walkRules(selector, recipe => {
      recipe.walkDecls(property, declaration => { declaration.value = incorrect; declaration.important = important; changed = true; });
    });
    assert.ok(changed, `Readiness requires ${selector} ${property}.`);
    assert.throws(() => assertRailDesign({ ...source, [part]: sheet.toString() }), { code: 'ERR_ASSERTION' }, `The contract rejects ${property}: ${incorrect}.`);
  }
  const elementsOnly = postcss.parse(source.base);
  elementsOnly.walkRules('*, *::before, *::after', recipe => { recipe.selector = '*'; });
  assert.throws(() => assertRailDesign({ ...source, base: elementsOnly.toString() }), { code: 'ERR_ASSERTION' }, 'Reduced motion must also cover pseudo-elements.');
  assertRailDesign(source);
});
