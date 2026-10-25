import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { WorkspaceLayout } from '../src/ui/layout/WorkspaceLayout.tsx';
import { Fixture } from './dropdown-fixture.ts';
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
  const observed = new Set<Element>();
  const actions: string[] = [];
  let disconnected = 0;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    observe(element: Element) { observed.add(element); }
    disconnect() { observed.clear(); disconnected++; }
  } });
  try {
    await fixture.mount(createElement(WorkspaceLayout, {
      repos: [], repoFilter: '', selectedRepo: undefined, subview: 'issues', registryLoading: false, workbenchError: '',
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
    const selected = fixture.named('All repositories');
    const unselected = fixture.named('Refresh repositories');
    assert.ok(selected && unselected);
    assert.equal(selected.getAttribute('aria-pressed'), 'true');
    assert.equal(unselected.classList.contains('active'), false);
    await fixture.click(toggle);
    assert.equal(workspace.dataset.sidebar, 'expanded');
    assert.equal(toggle.getAttribute('aria-label'), 'Collapse navigation rail');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(fixture.document.activeElement, toggle);
    assert.deepEqual([...observed], [fixture.root.querySelector('.repository-list')]);
    await fixture.click(toggle);
    assert.equal(workspace.dataset.sidebar, 'collapsed');
    assert.equal(toggle.getAttribute('aria-label'), 'Expand navigation rail');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(observed.size, 0);
    assert.equal(disconnected, 1);
    assert.equal(selected.getAttribute('aria-pressed'), 'true');
    assert.equal(unselected.classList.contains('active'), false);
    assert.equal(fixture.root.querySelector('main p')?.textContent, 'Current content');
    assert.deepEqual(actions, []);
  } finally {
    try { await fixture.dispose(); }
    finally { if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous); else Reflect.deleteProperty(globalThis, 'ResizeObserver'); }
  }
});

test('rail declared anchor hover direction and reduced-motion recipes retain independent fixed values', () => {
  assertRailDesign(designSources());
});

test('rail design contract rejects an oversized hover surface and ineffective reduced-motion duration', () => {
  const source = designSources();
  for (const [part, original, incorrect] of [
    ['workspace', 'left: 0; width: 36px; height: 32px;', 'left: 0; width: 42px; height: 32px;'],
    ['base', 'transition-duration: .001ms !important;', 'transition-duration: 220ms;'],
  ] as const) {
    assert.equal(source[part].split(original).length, 2);
    assert.throws(() => assertRailDesign({ ...source, [part]: source[part].replace(original, incorrect) }), { code: 'ERR_ASSERTION' });
  }
  assertRailDesign(source);
});
