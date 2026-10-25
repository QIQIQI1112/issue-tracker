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
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(property => [property, actual[property]])), expected, `The declared ${name} recipe retains the independently pinned values.`);
}

export function assertDropdownDesign(source: DropdownDesignSources): void {
  const tokens = rule(postcss.parse(source.tokens), ':root');
  includes(tokens, {
    'color-scheme': 'light', '--surface': '#ffffff', '--surface-input': 'var(--surface)', '--surface-sunken': '#f9f9f7', '--surface-hover': '#f3f3f0',
    '--text-primary': '#0b0b0b', '--text-tertiary': '#97958d', '--accent': '#7c8fe6', '--line-ink': '11 11 11', '--border': 'rgb(var(--line-ink) / 10%)', '--border-strong': 'rgb(var(--line-ink) / 21%)',
    '--border-input': 'var(--border)', '--border-input-focus': 'var(--focus-ring)', '--focus-ring': 'var(--text-primary)', '--radius-input': '8px', '--radius-panel': '14px', '--radius-999': '999px',
    '--space-lg': '8px', '--space-2xl': '12px', '--font-size-control': 'var(--font-size-14)', '--font-size-14': '14px',
    '--shadow-menu': '0 0 0 1px var(--border), 0 2px 6px rgb(0 0 0 / 8%), 0 8px 24px rgb(0 0 0 / 12%)',
  }, 'light tokens');
  assert.match(tokens['--font-family-body'], /"Loop Han".*system-ui.*"PingFang SC"/);
  const primitives = postcss.parse(source.primitives);
  includes(rule(primitives, '.dropdown-trigger, .dropdown-panel'), {
    'font-family': 'var(--font-family-body)', 'font-size': 'var(--font-size-control)', 'font-weight': '400', 'text-rendering': 'optimizeLegibility', '-webkit-font-smoothing': 'antialiased', 'font-synthesis': 'none',
  }, 'shared typography');
  const trigger = rule(primitives, '.dropdown-trigger');
  includes(trigger, {
    display: 'flex', 'align-items': 'center', gap: 'var(--space-lg)', width: '100%', 'min-width': '0', 'min-height': '32px', padding: '0 var(--space-lg) 0 var(--space-2xl)',
    border: '1px solid var(--border-input)', 'border-radius': 'var(--radius-input)', background: 'var(--surface-input)', color: 'var(--text-primary)', 'line-height': '19px',
  }, 'trigger');
  assert.doesNotMatch(trigger.transition ?? '', /\ball\b|border|outline/, 'The declared trigger does not animate border or outline focus feedback.');
  includes(rule(primitives, ':root[data-focus-intent="keyboard"] .dropdown .dropdown-trigger:focus'), { outline: 'none', 'border-color': 'var(--border-input-focus)' }, 'intentional keyboard focus');
  includes(rule(primitives, '.dropdown-value'), { flex: '1', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }, 'complete label ellipsis');
  includes(rule(primitives, '.dropdown-chevron, .dropdown-check'), { flex: 'none', width: '16px', height: '16px', 'stroke-width': '1.5px' }, 'glyph size and stroke');
  includes(rule(primitives, '.dropdown-chevron'), { color: 'var(--text-tertiary)' }, 'ChevronDown');
  includes(rule(primitives, '.dropdown-check'), { color: 'var(--accent)' }, 'selected Check');
  includes(rule(primitives, '.dropdown-panel'), {
    position: 'fixed', width: 'max-content', 'min-width': 'min(192px, calc(100vw - 16px))', 'max-width': 'min(320px, calc(100vw - 16px))', 'max-height': 'min(384px, calc(100dvh - 16px))',
    'overflow-y': 'auto', padding: 'var(--space-lg)', border: '0', 'border-radius': 'var(--radius-panel)', background: 'var(--surface)', color: 'var(--text-primary)', 'box-shadow': 'var(--shadow-menu)', 'line-height': '20px',
  }, 'intrinsic panel declarations');
  const option = rule(primitives, '.dropdown-option');
  includes(option, {
    display: 'flex', 'align-items': 'center', gap: 'var(--space-2xl)', 'min-height': '32px', padding: '0 var(--space-2xl)', 'border-radius': 'var(--radius-input)', color: 'var(--text-primary)',
    transition: 'color 140ms cubic-bezier(0.4, 0, 0.2, 1), background-color 140ms cubic-bezier(0.4, 0, 0.2, 1)',
  }, 'option');
  assert.equal(option.background ?? option['background-color'] ?? 'transparent', 'transparent');
  assert.equal(option['box-shadow'] ?? 'none', 'none');
  includes(rule(primitives, '.dropdown-option:hover, .dropdown-option[data-active="true"]'), { background: 'var(--surface-hover)' }, 'pointer and keyboard active state');
  includes(rule(primitives, '.dropdown-group-label, .dropdown-empty'), { display: 'flex', 'align-items': 'center', 'min-height': '32px', padding: '0 var(--space-2xl)', color: 'var(--text-tertiary)' }, 'group caption');
  const base = postcss.parse(source.base);
  includes(rule(base, '*'), { 'scrollbar-width': 'thin', 'scrollbar-color': 'var(--border-strong) var(--surface-sunken)' }, 'shared standard scrollbar');
  includes(rule(base, '*::-webkit-scrollbar'), { width: '10px', height: '10px' }, 'shared WebKit scrollbar');
  includes(rule(base, '*::-webkit-scrollbar-track'), { background: 'var(--surface-sunken)' }, 'scrollbar track');
  includes(rule(base, '*::-webkit-scrollbar-thumb'), { background: 'var(--border-strong)', border: '2px solid var(--surface-sunken)', 'border-radius': 'var(--radius-999)' }, 'scrollbar thumb');
  includes(rule(base, '*::-webkit-scrollbar-thumb:hover'), { background: 'var(--text-tertiary)' }, 'scrollbar hover');
  includes(rule(base, '*::-webkit-scrollbar-corner'), { background: 'var(--surface-sunken)' }, 'scrollbar corner');
}

export type RailDesignSources = { workspace: string; tokens: string; base: string };

export function assertRailDesign(source: RailDesignSources): void {
  const workspace = postcss.parse(source.workspace);
  includes(rule(workspace, '.workspace'), { 'grid-template-columns': '60px minmax(0, 1fr)', transition: 'grid-template-columns 220ms cubic-bezier(0.22, 1, 0.36, 1)' }, 'collapsed workspace');
  includes(rule(workspace, '.workspace[data-sidebar="expanded"]'), { 'grid-template-columns': '256px minmax(0, 1fr)' }, 'expanded workspace');
  includes(rule(workspace, '.sidebar'), { padding: '8px 12px 12px' }, 'rail insets');
  includes(rule(workspace, '.nav-button, .rail-toggle'), {
    position: 'relative', padding: '0 12px 0 6px', 'border-radius': '8px', background: 'transparent', 'min-height': '32px', color: 'var(--text-primary)',
    transition: 'padding 220ms cubic-bezier(0.22, 1, 0.36, 1), color 140ms cubic-bezier(0.4, 0, 0.2, 1), background-color 140ms cubic-bezier(0.4, 0, 0.2, 1)',
  }, 'navigation and toggle');
  includes(rule(workspace, '.toolbar-icon-slot'), { display: 'grid', 'place-items': 'center', width: '24px', height: '24px', flex: 'none' }, 'toolbar slot');
  includes(rule(workspace, '.nav-button .icon, .rail-toggle .icon'), { width: '20px', height: '20px', flex: 'none' }, 'toolbar glyph');
  includes(rule(workspace, '.rail-toggle'), { flex: 'none', width: 'max-content', 'align-self': 'flex-start', margin: 'auto 0 0' }, 'rail anchor');
  includes(rule(workspace, '.rail-toggle::before'), {
    content: "''", position: 'absolute', top: '0', left: '0', width: '36px', height: '32px', 'border-radius': 'inherit', background: 'transparent', 'pointer-events': 'none',
    transition: 'background-color 140ms cubic-bezier(0.4, 0, 0.2, 1)',
  }, 'bounded rail hover surface');
  includes(rule(workspace, '.rail-toggle:hover::before'), { background: 'var(--surface-hover)' }, 'rail hover');
  includes(rule(workspace, '.rail-toggle .toolbar-icon-slot'), { position: 'relative' }, 'rail glyph layering');
  includes(rule(workspace, '.rail-toggle .icon'), { rotate: '180deg', transition: 'rotate 220ms cubic-bezier(0.22, 1, 0.36, 1)' }, 'collapsed direction');
  includes(rule(workspace, '.workspace[data-sidebar="expanded"] .rail-toggle .icon'), { rotate: '0deg' }, 'expanded direction');
  includes(rule(workspace, '.nav-button:hover'), { background: 'var(--surface-hover)' }, 'navigation hover');
  includes(rule(workspace, '.nav-button.active'), { background: 'var(--surface-active)' }, 'navigation selection');
  includes(rule(workspace, '.workspace[data-sidebar="expanded"] .nav-button'), { padding: '0 12px' }, 'expanded navigation insets');
  includes(rule(workspace, '.workspace[data-sidebar="expanded"] .nav-button', '(max-width: 860px)'), { padding: '0 12px 0 6px' }, 'narrow expanded navigation insets');
  includes(rule(workspace, '.workspace[data-sidebar="expanded"]', '(max-width: 860px)'), { 'grid-template-columns': '60px minmax(0, 1fr)' }, 'narrow expanded rail');
  includes(rule(postcss.parse(source.tokens), ':root'), { '--surface-hover': '#f3f3f0', '--surface-active': '#edece8' }, 'distinct hover and selection colors');
  includes(rule(postcss.parse(source.base), '*, *::before, *::after', '(prefers-reduced-motion: reduce)'), {
    'animation-duration': '.001ms !important', 'animation-iteration-count': '1 !important', 'transition-duration': '.001ms !important',
  }, 'global reduced motion');
}
