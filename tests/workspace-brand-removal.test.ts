import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import type { AtRule, Root, Rule } from 'postcss';
import { WorkspaceLayout } from '../src/ui/layout/WorkspaceLayout.tsx';
import { repo } from './dropdown-fixture.ts';

test('workspace header omits the logo and Loop wordmark while retaining the static local avatar', () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(WorkspaceLayout, {
    repos: [repo], repoFilter: String(repo.id), selectedRepo: repo, subview: 'requirements', registryLoading: false, workbenchError: '',
    chooseRepository: () => {}, setSubview: () => {}, refreshRepositories: () => {},
    children: createElement('p', null, 'Loop remains valid repository content'),
  })));
  try {
    const document = dom.window.document;
    const header = document.querySelector('.global-topbar');
    assert.ok(header, 'The existing global topbar remains present.');
    const avatar = header.querySelector('[role="img"][aria-label="Local workspace avatar"]');
    assert.ok(avatar, 'The header retains the named Local workspace avatar.');
    assert.equal(avatar.textContent, 'L', 'The static avatar retains its L identity.');
    assert.equal(avatar.closest('[hidden], [aria-hidden="true"]'), null, 'The named avatar remains exposed.');
    assert.equal(header.querySelector('button, a, input, select, textarea, [tabindex], [aria-haspopup], [aria-expanded], [role="button"], [role="menu"]'), null, 'The header avatar has no interactive wrapper, tab stop or menu.');
    assert.equal(document.querySelector('main .workspace-content p')?.textContent, 'Loop remains valid repository content', 'Brand removal preserves child content, including unrelated Loop text.');
    assert.equal(header.querySelector('.brand, .brand-mark, .brand-description'), null, 'The header removes the brand markup entirely, including hidden brand placeholders.');
    assert.equal(header.textContent?.trim(), 'L', 'The header contains the avatar initial without a Loop wordmark.');
    assert.deepEqual([...header.children], [avatar.closest('.user-menu')], 'Only the existing static avatar owner remains in the topbar, with no empty brand placeholder.');
  } finally {
    dom.window.close();
  }
});

function expectDeclarations(container: Root | AtRule, selector: string, expected: Record<string, string>) {
  const matches = container.nodes?.filter((node): node is Rule => node.type === 'rule' && node.selectors.includes(selector)) ?? [];
  assert.equal(matches.length, 1, `The shell retains one declared ${selector} recipe in ${container.type === 'atrule' ? container.params : 'the base stylesheet'}.`);
  const actual = Object.fromEntries(matches[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(property => [property, actual[property]])), expected, `The declared ${selector} recipe preserves its required shell values.`);
}

test('workspace shell declarations retain right avatar alignment and inset geometry without brand styles', () => {
  const sheet = postcss.parse(readFileSync(new URL('../src/ui/layout/workspace.css', import.meta.url), 'utf8'));
  expectDeclarations(sheet, '.workspace', {
    height: '100dvh', 'min-height': '0', display: 'grid', 'grid-template-rows': '60px minmax(0, 1fr)', overflow: 'hidden',
  });
  expectDeclarations(sheet, '.main', {
    'min-width': '0', 'min-height': '0', margin: '0 8px 8px 0', border: '.5px solid var(--border)',
    'border-radius': 'var(--radius-main)', overflow: 'clip', display: 'flex', 'flex-direction': 'column',
  });
  expectDeclarations(sheet, '.workspace-content', { 'min-height': '0', 'min-width': '0', flex: '1', padding: '24px', overflow: 'auto' });
  expectDeclarations(postcss.parse(readFileSync(new URL('../src/ui/theme/tokens.css', import.meta.url), 'utf8')), ':root', { '--radius-main': '20px' });
  for (const [condition, selector, expected] of [
    ['(max-width: 860px)', '.workspace-content', { padding: '16px' }],
    ['(max-width: 600px)', '.breadcrumb-workspace', { display: 'none' }],
  ] as const) {
    const media = sheet.nodes.find((node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === condition);
    assert.ok(media, `The shell retains its ${condition} declarations.`);
    expectDeclarations(media, selector, expected);
  }
  expectDeclarations(sheet, '.global-topbar', {
    'grid-column': '1 / -1', display: 'flex', 'align-items': 'center', 'justify-content': 'flex-end', height: '60px', 'padding-inline': '12px', 'min-width': '0',
  });
  const brandSelectors: string[] = [];
  sheet.walkRules(rule => {
    if (/\.brand(?:-(?:mark|description))?(?![\w-])/.test(rule.selector)) brandSelectors.push(rule.selector);
  });
  assert.deepEqual(brandSelectors, [], 'Dedicated brand layout selectors are removed, including the brand selector in the narrow-screen rule.');
});
