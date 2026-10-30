import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { assertRailDesign } from './ui-design-contract.ts';

test('rail design contract accepts alternate local dimensions while rejecting invalid grid relationships', () => {
  const source = {
    workspace: readFileSync(new URL('../src/ui/layout/workspace.css', import.meta.url), 'utf8'),
    tokens: readFileSync(new URL('../src/ui/theme/tokens.css', import.meta.url), 'utf8'),
    base: readFileSync(new URL('../src/ui/theme/base.css', import.meta.url), 'utf8'),
  };
  assertRailDesign(source);
  const workspace = postcss.parse(source.workspace);
  const collapsed = workspace.nodes.find(node => node.type === 'rule' && node.selector === '.workspace');
  assert.ok(collapsed?.type === 'rule');
  const collapsedColumns = collapsed.nodes.find(node => node.type === 'decl' && node.prop === 'grid-template-columns');
  assert.ok(collapsedColumns?.type === 'decl');
  const expanded = workspace.nodes.find(node => node.type === 'rule' && node.selector === '.workspace[data-sidebar="expanded"]');
  assert.ok(expanded?.type === 'rule', 'Fixture readiness requires the actual desktop expanded recipe, excluding the responsive override.');
  const columns = expanded.nodes.find(node => node.type === 'decl' && node.prop === 'grid-template-columns');
  assert.ok(columns?.type === 'decl', 'Fixture readiness requires the declared desktop grid tracks.');
  collapsedColumns.value = '72px minmax(0, 1fr)';
  columns.value = '248px minmax(0, 1fr)';
  assert.doesNotThrow(() => assertRailDesign({ ...source, workspace: workspace.toString() }), 'Alternate collapsed and expanded widths preserve the layout relationships.');
  for (const value of ['72px minmax(0, 1fr)', '71px minmax(0, 1fr)', '0px minmax(0, 1fr)', 'auto minmax(0, 1fr)', `${'9'.repeat(309)}px minmax(0, 1fr)`, '248px 1fr']) {
    columns.value = value;
    assert.throws(() => assertRailDesign({ ...source, workspace: workspace.toString() }), { code: 'ERR_ASSERTION' }, `The expanded geometry contract must reject ${value}.`);
  }
  columns.value = '248px minmax(0, 1fr)';
  collapsedColumns.value = '0px minmax(0, 1fr)';
  assert.throws(() => assertRailDesign({ ...source, workspace: workspace.toString() }), { code: 'ERR_ASSERTION' }, 'The collapsed rail cannot disappear.');
  collapsedColumns.value = '72px minmax(0, 1fr)';
  const responsive = workspace.nodes.find(node => node.type === 'atrule' && node.params === '(max-width: 860px)');
  assert.ok(responsive?.type === 'atrule');
  const narrow = responsive.nodes?.find(node => node.type === 'rule' && node.selector === '.workspace[data-sidebar="expanded"]');
  assert.ok(narrow?.type === 'rule');
  const narrowColumns = narrow.nodes.find(node => node.type === 'decl' && node.prop === 'grid-template-columns');
  assert.ok(narrowColumns?.type === 'decl');
  narrowColumns.value = '56px minmax(0, 1fr)';
  assert.doesNotThrow(() => assertRailDesign({ ...source, workspace: workspace.toString() }), 'The responsive rail may use a different compact width.');
  narrowColumns.value = '248px minmax(0, 1fr)';
  assert.throws(() => assertRailDesign({ ...source, workspace: workspace.toString() }), { code: 'ERR_ASSERTION' }, 'Responsive expansion cannot retain the wide desktop rail.');
  assertRailDesign(source);
});
