import assert from 'node:assert/strict';
import postcss from 'postcss';
import type { Root, Rule } from 'postcss';

export type DropdownDesignSources = { tokens: string; primitives: string; base: string };

function rule(sheet: Root, selector: string, condition?: string): Record<string, string> {
  const media = condition ? sheet.nodes.filter(node => node.type === 'atrule' && node.name === 'media' && node.params === condition) : [];
  if (condition) assert.equal(media.length, 1, `The bounded design contract needs one declared ${condition} block.`);
  const nodes = condition && media[0].type === 'atrule' ? media[0].nodes ?? [] : sheet.nodes;
  const key = (value: string) => value.split(',').map(part => part.trim()).sort().join(',');
  const matches = nodes.filter((node): node is Rule => node.type === 'rule' && key(node.selector) === key(selector));
  assert.equal(matches.length, 1, `The bounded design contract needs one declared ${selector} recipe.`);
  return Object.fromEntries(matches[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, `${node.value}${node.important ? ' !important' : ''}`]));
}

function includes(actual: Record<string, string>, expected: Record<string, string>, name: string) {
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(property => [property, actual[property]])), expected, `The declared ${name} recipe retains the shared semantic standards.`);
}

export function assertDropdownDesign(source: DropdownDesignSources): void {
  const tokens = rule(postcss.parse(source.tokens), ':root');
  includes(tokens, {
    'color-scheme': 'light', '--surface': '#ffffff', '--surface-input': 'var(--surface)', '--surface-sunken': '#f9f9f7', '--surface-hover': '#f3f3f0',
    '--text-primary': '#0b0b0b', '--text-tertiary': '#97958d', '--accent': '#7c8fe6', '--line-ink': '11 11 11', '--border': 'rgb(var(--line-ink) / 10%)', '--border-strong': 'rgb(var(--line-ink) / 21%)',
    '--border-input': 'var(--border)', '--border-input-focus': 'var(--focus-ring)', '--focus-ring': 'var(--text-primary)',
    '--font-size-control': 'var(--font-size-14)', '--font-size-14': '14px',
  }, 'light tokens');
  assert.match(tokens['--font-family-body'], /"Loop Han".*system-ui.*"PingFang SC"/);
  const primitives = postcss.parse(source.primitives);
  includes(rule(primitives, '.dropdown-trigger, .dropdown-panel'), {
    'font-family': 'var(--font-family-body)', 'font-size': 'var(--font-size-control)', 'font-weight': '400', 'text-rendering': 'optimizeLegibility', '-webkit-font-smoothing': 'antialiased', 'font-synthesis': 'none',
  }, 'shared typography');
  const trigger = rule(primitives, '.dropdown-trigger');
  includes(trigger, {
    display: 'flex', 'align-items': 'center', width: '100%', 'min-width': '0',
    background: 'var(--surface-input)', color: 'var(--text-primary)',
  }, 'trigger');
  assert.match(trigger.border, /^(?:\d+(?:\.\d+)?|\.\d+)px solid var\(--border-input\)$/);
  assert.ok(Number.isFinite(Number.parseFloat(trigger.border)) && Number.parseFloat(trigger.border) > 0, 'The trigger retains a visible border using its shared input token.');
  assert.doesNotMatch(trigger.transition ?? '', /\ball\b|border|outline/, 'The declared trigger does not animate border or outline focus feedback.');
  includes(rule(primitives, ':root[data-focus-intent="keyboard"] .dropdown .dropdown-trigger:focus'), { outline: 'none', 'border-color': 'var(--border-input-focus)' }, 'intentional keyboard focus');
  includes(rule(primitives, '.dropdown-value'), { flex: '1', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }, 'complete label ellipsis');
  const glyph = rule(primitives, '.dropdown-chevron, .dropdown-check');
  includes(glyph, { flex: 'none' }, 'non-shrinking glyphs');
  assert.match(glyph['stroke-width'], /^(?:\d+(?:\.\d+)?|\.\d+)px$/);
  assert.ok(Number.isFinite(Number.parseFloat(glyph['stroke-width'])) && Number.parseFloat(glyph['stroke-width']) > 0, 'Glyph strokes remain visible.');
  includes(rule(primitives, '.dropdown-chevron'), { color: 'var(--text-tertiary)' }, 'ChevronDown');
  includes(rule(primitives, '.dropdown-check'), { color: 'var(--accent)' }, 'selected Check');
  includes(rule(primitives, '.dropdown-panel'), {
    position: 'fixed', width: 'max-content', 'overflow-y': 'auto', border: '0',
    background: 'var(--surface)', color: 'var(--text-primary)', 'box-shadow': 'var(--shadow-menu)',
  }, 'intrinsic panel declarations');
  const option = rule(primitives, '.dropdown-option');
  includes(option, {
    display: 'flex', 'align-items': 'center', color: 'var(--text-primary)',
  }, 'option');
  assert.equal(option.background ?? option['background-color'] ?? 'transparent', 'transparent');
  assert.equal(option['box-shadow'] ?? 'none', 'none');
  includes(rule(primitives, '.dropdown-option:hover, .dropdown-option[data-active="true"]'), { background: 'var(--surface-hover)' }, 'pointer and keyboard active state');
  includes(rule(primitives, '.dropdown-group-label, .dropdown-empty'), { display: 'flex', 'align-items': 'center', color: 'var(--text-tertiary)' }, 'group caption');
  const base = postcss.parse(source.base);
  includes(rule(base, '*'), { 'scrollbar-width': 'thin', 'scrollbar-color': 'var(--border-strong) var(--surface-sunken)' }, 'shared standard scrollbar');
  includes(rule(base, '*::-webkit-scrollbar-track'), { background: 'var(--surface-sunken)' }, 'scrollbar track');
  includes(rule(base, '*::-webkit-scrollbar-thumb'), { background: 'var(--border-strong)' }, 'scrollbar thumb');
  includes(rule(base, '*::-webkit-scrollbar-thumb:hover'), { background: 'var(--text-tertiary)' }, 'scrollbar hover');
  includes(rule(base, '*::-webkit-scrollbar-corner'), { background: 'var(--surface-sunken)' }, 'scrollbar corner');
}

export type RailDesignSources = { workspace: string; tokens: string; base: string };

export function assertRailDesign(source: RailDesignSources): void {
  const workspace = postcss.parse(source.workspace);
  const railWidth = (columns: string) => {
    const match = /^(\d+(?:\.\d+)?)px minmax\(0, 1fr\)$/.exec(columns);
    assert.ok(match && Number.isFinite(Number(match[1])) && Number(match[1]) > 0, 'Rail tracks stay finite and positive beside shrinkable minmax(0, 1fr) content.');
    return Number(match[1]);
  };
  const collapsed = railWidth(rule(workspace, '.workspace')['grid-template-columns']);
  const expanded = railWidth(rule(workspace, '.workspace[data-sidebar="expanded"]')['grid-template-columns']);
  assert.ok(expanded > collapsed, 'Expansion widens the rail.');
  includes(rule(workspace, '.nav-button, .rail-toggle'), {
    position: 'relative', background: 'transparent', color: 'var(--text-primary)',
  }, 'navigation and toggle');
  includes(rule(workspace, '.toolbar-icon-slot'), { display: 'grid', 'place-items': 'center', flex: 'none' }, 'toolbar slot');
  includes(rule(workspace, '.nav-button .icon, .rail-toggle .icon'), { flex: 'none' }, 'toolbar glyph');
  includes(rule(workspace, '.rail-toggle'), { flex: 'none', width: 'max-content', 'align-self': 'flex-start', margin: 'auto 0 0' }, 'rail anchor');
  includes(rule(workspace, '.rail-toggle::before'), {
    content: "''", position: 'absolute', background: 'transparent', 'pointer-events': 'none',
  }, 'bounded rail hover surface');
  includes(rule(workspace, '.rail-toggle:hover::before'), { background: 'var(--surface-hover)' }, 'rail hover');
  includes(rule(workspace, '.rail-toggle .toolbar-icon-slot'), { position: 'relative' }, 'rail glyph layering');
  includes(rule(workspace, '.rail-toggle .icon'), { rotate: '180deg' }, 'collapsed direction');
  includes(rule(workspace, '.workspace[data-sidebar="expanded"] .rail-toggle .icon'), { rotate: '0deg' }, 'expanded direction');
  includes(rule(workspace, '.nav-button:hover'), { background: 'var(--surface-hover)' }, 'navigation hover');
  includes(rule(workspace, '.nav-button.active'), { background: 'var(--surface-active)' }, 'navigation selection');
  const narrow = railWidth(rule(workspace, '.workspace[data-sidebar="expanded"]', '(max-width: 860px)')['grid-template-columns']);
  assert.ok(narrow <= collapsed && narrow < expanded, 'The responsive rail remains compact.');
  includes(rule(postcss.parse(source.tokens), ':root'), { '--surface-hover': '#f3f3f0', '--surface-active': '#edece8' }, 'distinct hover and selection colors');
  const reduced = rule(postcss.parse(source.base), '*, *::before, *::after', '(prefers-reduced-motion: reduce)');
  includes(reduced, { 'animation-iteration-count': '1 !important' }, 'global reduced motion');
  for (const property of ['animation-duration', 'transition-duration']) {
    const duration = /^(\d+(?:\.\d+)?|\.\d+)(ms|s) !important$/.exec(reduced[property]);
    assert.ok(duration && Number(duration[1]) * (duration[2] === 's' ? 1000 : 1) <= 1, 'Reduced motion overrides element and pseudo-element durations to at most 1ms.');
  }
}
