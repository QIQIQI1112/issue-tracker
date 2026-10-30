import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { assertRailDesign } from './ui-design-contract.ts';

test('rail design contract accepts alternate expanded widths while rejecting collapsed and malformed grids', () => {
  const source = {
    workspace: readFileSync(new URL('../src/ui/layout/workspace.css', import.meta.url), 'utf8'),
    tokens: readFileSync(new URL('../src/ui/theme/tokens.css', import.meta.url), 'utf8'),
    base: readFileSync(new URL('../src/ui/theme/base.css', import.meta.url), 'utf8'),
  };
  assertRailDesign(source);
  const workspace = postcss.parse(source.workspace);
  const expanded = workspace.nodes.find(node => node.type === 'rule' && node.selector === '.workspace[data-sidebar="expanded"]');
  assert.ok(expanded?.type === 'rule', 'Fixture readiness requires the actual desktop expanded recipe, excluding the responsive override.');
  const columns = expanded.nodes.find(node => node.type === 'decl' && node.prop === 'grid-template-columns');
  assert.ok(columns?.type === 'decl', 'Fixture readiness requires the declared desktop grid tracks.');
  for (const value of ['60px minmax(0, 1fr)', '59px minmax(0, 1fr)', 'auto minmax(0, 1fr)', `${'9'.repeat(309)}px minmax(0, 1fr)`, '224px 1fr']) {
    columns.value = value;
    assert.throws(() => assertRailDesign({ ...source, workspace: workspace.toString() }), { code: 'ERR_ASSERTION' }, `The expanded geometry contract must reject ${value}.`);
  }
  columns.value = '224px minmax(0, 1fr)';
  assert.doesNotThrow(() => assertRailDesign({ ...source, workspace: workspace.toString() }), 'A different finite expanded pixel width preserves the grid contract.');
  assertRailDesign(source);
});
