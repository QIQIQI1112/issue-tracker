import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceLayout } from '../src/ui/layout/WorkspaceLayout.tsx';

type Element = { tag: string; attributes: Record<string, string>; parent?: Element; children: Element[] };
type Declaration = { property: string; value: string; important: boolean };
type Rule = { selector: string; media: string[]; declarations: Declaration[] };
type Environment = { width: number; state: 'collapsed' | 'expanded'; reducedMotion: boolean };

function splitList(value: string) {
  return value.split(/,(?![^()]*\))/).map(part => part.trim());
}

function stylesheet(url: URL): string {
  return readFileSync(url, 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g, (_match, path: string) => stylesheet(new URL(path, url)));
}

function parseRules(source: string, media: string[] = []): Rule[] {
  const rules: Rule[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf('{', cursor);
    if (opening < 0) break;
    const header = source.slice(cursor, opening).trim();
    let depth = 1;
    let closing = opening + 1;
    while (depth > 0 && closing < source.length) {
      if (source[closing] === '{') depth++;
      if (source[closing] === '}') depth--;
      closing++;
    }
    assert.equal(depth, 0, 'The production stylesheet must parse before rail declarations are evaluated.');
    const body = source.slice(opening + 1, closing - 1);
    if (header.startsWith('@media ')) rules.push(...parseRules(body, [...media, header.slice(7).trim()]));
    else if (!header.startsWith('@')) {
      const declarations = body.split(';').flatMap(text => {
        const colon = text.indexOf(':');
        if (colon < 0) return [];
        const value = text.slice(colon + 1).trim();
        return [{ property: text.slice(0, colon).trim(), value: value.replace(/\s*!important$/, ''), important: /!important$/.test(value) }];
      });
      for (const selector of splitList(header)) rules.push({ selector, media, declarations });
    }
    cursor = closing;
  }
  return rules;
}

const rules = parseRules(stylesheet(new URL('../src/ui/styles.css', import.meta.url)).replace(/\/\*[\s\S]*?\*\//g, ''));

function workspace() {
  const html = renderToStaticMarkup(createElement(WorkspaceLayout, {
    repos: [], repoFilter: '', selectedRepo: undefined, subview: 'issues', registryLoading: false,
    workbenchError: '', chooseRepository: () => {}, setSubview: () => {}, refreshRepositories: () => {}, children: null,
  }));
  const root: Element = { tag: 'root', attributes: {}, children: [] };
  let parent = root;
  for (const match of html.matchAll(/<(\/?)([a-z][\w:-]*)\b([^>]*?)(\/?)>/gi)) {
    if (match[1]) {
      parent = parent.parent ?? root;
      continue;
    }
    const attributes = Object.fromEntries([...match[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(attribute => [attribute[1], attribute[2] ?? '']));
    const element: Element = { tag: match[2], attributes, parent, children: [] };
    parent.children.push(element);
    if (!match[4] && !['area', 'br', 'hr', 'img', 'input', 'link', 'meta', 'wbr'].includes(element.tag)) parent = element;
  }
  function find(className: string, node = root): Element | undefined {
    if ((node.attributes.class ?? '').split(/\s+/).includes(className)) return node;
    for (const child of node.children) {
      const found = find(className, child);
      if (found) return found;
    }
  }
  const shell = find('workspace');
  const sidebar = find('sidebar');
  const toggle = find('rail-toggle');
  const navigation = find('nav-button');
  assert.ok(shell && sidebar && toggle && navigation, 'SSR fixture must contain the actual workspace, sidebar, toggle and navigation row.');
  const slot = find('toolbar-icon-slot', toggle);
  const icon = find('icon', toggle);
  assert.ok(slot && icon, 'The actual toggle must contain an icon slot and arrow before evaluating geometry.');
  return { shell, sidebar, toggle, navigation, slot, icon };
}

function compoundMatches(selector: string, element: Element, environment: Environment) {
  if (selector.includes(':')) return false;
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && tag !== element.tag) return false;
  const classes = (element.attributes.class ?? '').split(/\s+/);
  for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!classes.includes(match[1])) return false;
  for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const actual = match[1] === 'data-sidebar' ? environment.state : element.attributes[match[1]];
    if (actual === undefined || (match[2] !== undefined && actual !== match[2])) return false;
  }
  return selector.replace(/^[a-z][\w-]*|\*|\.[\w-]+|\[[^\]]+\]/gi, '') === '';
}

function selectorMatches(selector: string, element: Element, environment: Environment) {
  const parts = selector.trim().split(/\s+/);
  let current: Element | undefined = element;
  if (!compoundMatches(parts.pop() ?? '', current, environment)) return false;
  while (parts.length) {
    const part = parts.pop()!;
    if (part === '>') {
      current = current.parent;
      if (!current || !compoundMatches(parts.pop() ?? '', current, environment)) return false;
    } else {
      current = current.parent;
      while (current && !compoundMatches(part, current, environment)) current = current.parent;
      if (!current) return false;
    }
  }
  return true;
}

function mediaMatches(media: string, environment: Environment) {
  return media.split(/\s+and\s+/).every(condition => {
    const width = condition.match(/^\((min|max)-width:\s*(\d+)px\)$/);
    if (width) return width[1] === 'min' ? environment.width >= Number(width[2]) : environment.width <= Number(width[2]);
    if (condition === '(prefers-reduced-motion: reduce)') return environment.reducedMotion;
    return false;
  });
}

function expand(declaration: Declaration): Declaration[] {
  const { property, value } = declaration;
  if (property === 'padding' || property === 'margin' || property === 'border-width') {
    const [top, right = top, bottom = top, left = right] = value.split(/\s+/);
    return ['top', 'right', 'bottom', 'left'].map((side, index) => ({ ...declaration, property: property === 'border-width' ? `border-${side}-width` : `${property}-${side}`, value: [top, right, bottom, left][index] }));
  }
  if (property === 'border') return expand({ ...declaration, property: 'border-width', value: value.split(/\s+/)[0] });
  if (property === 'padding-inline' || property === 'margin-inline') {
    const [left, right = left] = value.split(/\s+/);
    const prefix = property.split('-')[0];
    return [{ ...declaration, property: `${prefix}-left`, value: left }, { ...declaration, property: `${prefix}-right`, value: right }];
  }
  if (property === 'transition') {
    const transitions = splitList(value).map(item => ({
      property: item.match(/^[\w-]+/)?.[0] ?? 'all',
      duration: item.match(/(?:^|\s)([\d.]+m?s)(?:\s|$)/)?.[1] ?? '0s',
      timing: item.match(/cubic-bezier\([^)]*\)|\b(?:linear|ease-in-out|ease-in|ease-out|ease)\b/)?.[0] ?? 'ease',
    }));
    return [
      { ...declaration, property: 'transition-property', value: transitions.map(item => item.property).join(', ') },
      { ...declaration, property: 'transition-duration', value: transitions.map(item => item.duration).join(', ') },
      { ...declaration, property: 'transition-timing-function', value: transitions.map(item => item.timing).join(', ') },
    ];
  }
  return [declaration];
}

function style(element: Element, environment: Environment) {
  const cascade = new Map<string, { value: string; priority: number }>();
  for (const rule of rules) {
    if (!rule.media.every(media => mediaMatches(media, environment)) || !selectorMatches(rule.selector, element, environment)) continue;
    const specificity = [...rule.selector.matchAll(/\.[\w-]+|\[[^\]]+\]/g)].length * 100 + [...rule.selector.matchAll(/(?:^|[\s>])[a-z][\w-]*/g)].length;
    for (const declaration of rule.declarations.flatMap(expand)) {
      const priority = specificity + (declaration.important ? 1000000 : 0);
      if (priority >= (cascade.get(declaration.property)?.priority ?? -1)) cascade.set(declaration.property, { value: declaration.value, priority });
    }
  }
  return Object.fromEntries([...cascade].map(([property, declaration]) => [property, declaration.value]));
}

function pixels(value: string | undefined, label: string) {
  assert.match(value ?? '', /^(?:0|[\d.]+px)$/, `${label} must resolve to a pixel length before geometry can be compared.`);
  return Number.parseFloat(value!);
}

const widths = [1280, 861, 860, 390];
const states = ['collapsed', 'expanded'] as const;

test('rail toggle keeps a fixed horizontal anchor across sidebar states and responsive widths', () => {
  const { sidebar, toggle, slot } = workspace();
  const observations = widths.flatMap(width => states.map(state => {
    const environment = { width, state, reducedMotion: false };
    const control = style(toggle, environment);
    const container = style(sidebar, environment);
    const iconSlot = style(slot, environment);
    const left = pixels(control['padding-left'], 'Toggle left padding');
    const right = pixels(control['padding-right'], 'Toggle right padding');
    const slotWidth = pixels(iconSlot.width, 'Arrow slot width');
    const borderLeft = pixels(control['border-left-width'], 'Toggle left border');
    const borderRight = pixels(control['border-right-width'], 'Toggle right border');
    const marginLeft = pixels(control['margin-left'], 'Toggle left margin');
    assert.equal(control.width, 'max-content', `${width}px ${state}: toggle keeps its intrinsic width as the rail changes width.`);
    assert.equal(control['align-self'], 'flex-start', `${width}px ${state}: toggle stays anchored to the rail start.`);
    return {
      width, state, padding: [pixels(control['padding-top'], 'Toggle top padding'), right, pixels(control['padding-bottom'], 'Toggle bottom padding'), left],
      anchor: pixels(container['padding-left'], 'Sidebar left padding') + marginLeft + borderLeft + left + slotWidth / 2,
      intrinsicWidth: borderLeft + left + slotWidth + right + borderRight,
    };
  }));
  assert.deepEqual(observations, widths.flatMap(width => states.map(state => ({ width, state, padding: [0, 12, 0, 6], anchor: 30, intrinsicWidth: 42 }))), 'The toggle must keep its 30px arrow-center anchor and 42px intrinsic width in both states, including either side of the 860px breakpoint; removing only the transition must not hide a geometry jump.');
});

test('rail toggle preserves direction, control semantics, navigation padding and reduced motion', () => {
  const { shell, toggle, slot, icon, navigation } = workspace();
  assert.equal(shell.attributes['data-sidebar'], 'collapsed', 'Navigation retains its initial collapsed state.');
  assert.equal(toggle.tag, 'button', 'The actual rail toggle remains a native button.');
  assert.equal(toggle.attributes.type, 'button', 'The rail toggle does not submit a surrounding form.');
  assert.equal(toggle.attributes['aria-label'], 'Expand navigation rail', 'The initial control keeps its accessible action name.');
  assert.equal(toggle.attributes['aria-expanded'], 'false', 'The initial expanded state remains exposed.');
  assert.equal(toggle.attributes.disabled, undefined, 'The rail toggle remains enabled.');
  assert.equal(slot.attributes['aria-hidden'], 'true', 'The decorative arrow does not duplicate the action name.');
  assert.equal(icon.attributes.focusable, 'false', 'The decorative SVG does not add a focus target.');
  for (const width of widths) for (const state of states) {
    const environment = { width, state, reducedMotion: false };
    const arrow = style(icon, environment);
    const row = style(navigation, environment);
    assert.equal(arrow.rotate, state === 'collapsed' ? '180deg' : '0deg', `${width}px ${state}: chevron direction retains the existing rotation endpoint.`);
    assert.equal(arrow['transition-property'], 'rotate', `${width}px ${state}: the direction change remains animated through rotation.`);
    assert.equal(arrow['transition-duration'], '220ms', `${width}px ${state}: directional rotation retains its duration.`);
    assert.equal(arrow['transition-timing-function'], 'cubic-bezier(0.22, 1, 0.36, 1)', `${width}px ${state}: directional rotation retains its easing.`);
    assert.deepEqual(['top', 'right', 'bottom', 'left'].map(side => pixels(row[`padding-${side}`], `Navigation ${side} padding`)), [0, 12, 0, state === 'expanded' && width > 860 ? 12 : 6], `${width}px ${state}: normal navigation rows retain their distinct responsive padding.`);
    for (const element of [shell, navigation, toggle, icon]) {
      const reduced = style(element, { ...environment, reducedMotion: true });
      assert.equal(reduced['transition-duration'], '.001ms', `${width}px ${state} ${element.attributes.class}: the global reduced-motion transition override remains effective.`);
      assert.equal(reduced['animation-duration'], '.001ms', `${width}px ${state} ${element.attributes.class}: the global reduced-motion animation override remains effective.`);
    }
  }
});
