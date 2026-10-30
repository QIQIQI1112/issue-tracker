import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

test('desktop expanded rail declares 208px and current UI documentation records that width', () => {
  const workspace = postcss.parse(readFileSync(new URL('../src/ui/layout/workspace.css', import.meta.url), 'utf8'));
  const expanded = workspace.nodes.find(node => node.type === 'rule' && node.selector === '.workspace[data-sidebar="expanded"]');
  assert.ok(expanded?.type === 'rule', 'Readiness requires the actual desktop expanded recipe, excluding its responsive override.');
  const columns = expanded.nodes.find(node => node.type === 'decl' && node.prop === 'grid-template-columns');
  assert.ok(columns?.type === 'decl', 'Readiness requires the declared desktop expanded grid tracks.');
  assert.equal(columns.value, '208px minmax(0, 1fr)', 'The desktop expanded rail must declare exactly 208px with the unchanged content track.');

  const documentation = readFileSync(new URL('../docs/ui-iteration.md', import.meta.url), 'utf8');
  const navigation = documentation.split(/^## /m).find(section => section.startsWith('Repository navigation and concise inspection\n'));
  assert.ok(navigation, 'Readiness requires the current navigation documentation, excluding historical revisions.');
  assert.match(navigation, /\bdesktop\b[^.\n]*\b208px\b|\b208px\b[^.\n]*\bdesktop\b/i, 'The current navigation documentation must record the 208px desktop rail width.');
});
