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

type PaintEnvironment = Environment & { hovered?: Element };
type PaintTarget = { element: Element; pseudo?: 'before' | 'after' };
type PaintBox = { left: number; top: number; width: number; height: number };

function paintCompoundMatches(selector: string, element: Element, environment: PaintEnvironment): boolean {
  for (const match of selector.matchAll(/:not\(([^()]*)\)/g)) {
    if (paintCompoundMatches(match[1], element, environment)) return false;
  }
  selector = selector.replace(/:not\([^()]*\)/g, '');
  for (const match of selector.matchAll(/:(hover|disabled|root|focus-visible|focus|active)\b/g)) {
    if (match[1] === 'hover') {
      let hovered = environment.hovered;
      while (hovered && hovered !== element) hovered = hovered.parent;
      if (!hovered) return false;
    } else if (match[1] === 'disabled') {
      if (element.attributes.disabled === undefined) return false;
    } else if (match[1] === 'root') {
      if (element.parent) return false;
    } else return false;
  }
  return compoundMatches(selector.replace(/:(hover|disabled|root|focus-visible|focus|active)\b/g, ''), element, environment);
}

function paintSelectorMatches(selector: string, target: PaintTarget, environment: PaintEnvironment) {
  const pseudo = selector.match(/::(before|after)$/)?.[1];
  if (pseudo !== target.pseudo) return false;
  const parts = selector.replace(/::(before|after)$/, '').trim().split(/\s+/);
  let current: Element | undefined = target.element;
  if (!paintCompoundMatches(parts.pop() ?? '', current, environment)) return false;
  while (parts.length) {
    const part = parts.pop()!;
    current = current.parent;
    if (part === '>') {
      if (!current || !paintCompoundMatches(parts.pop() ?? '', current, environment)) return false;
    } else {
      while (current && !paintCompoundMatches(part, current, environment)) current = current.parent;
      if (!current) return false;
    }
  }
  return true;
}

function paintDeclarations(declaration: Declaration): Declaration[] {
  if (declaration.property === 'background') return [{ ...declaration, property: 'background-color' }];
  if (declaration.property === 'inset') {
    const [top, right = top, bottom = top, left = right] = declaration.value.split(/\s+/);
    return ['top', 'right', 'bottom', 'left'].map((property, index) => ({ ...declaration, property, value: [top, right, bottom, left][index] }));
  }
  return expand(declaration);
}

function paintStyle(target: PaintTarget, environment: PaintEnvironment): Record<string, string> {
  const cascade = new Map<string, { value: string; priority: number }>();
  for (const rule of rules) {
    if (!rule.media.every(media => mediaMatches(media, environment)) || !paintSelectorMatches(rule.selector, target, environment)) continue;
    const selector = rule.selector.replace(/:not\(([^()]*)\)/g, '$1');
    const specificity = [...selector.matchAll(/\.[\w-]+|\[[^\]]+\]|(?<!:):(?!:)[\w-]+/g)].length * 100
      + [...selector.matchAll(/(?:^|[\s>])[a-z][\w-]*|::[\w-]+/g)].length;
    for (const declaration of rule.declarations.flatMap(paintDeclarations)) {
      const priority = specificity + (declaration.important ? 1000000 : 0);
      if (priority >= (cascade.get(declaration.property)?.priority ?? -1)) cascade.set(declaration.property, { value: declaration.value, priority });
    }
  }
  const parent = target.pseudo ? target.element : target.element.parent;
  const inherited = parent ? paintStyle({ element: parent }, environment) : {};
  const variables = { ...Object.fromEntries(Object.entries(inherited).filter(([property]) => property.startsWith('--'))), ...Object.fromEntries([...cascade].map(([property, declaration]) => [property, declaration.value])) };
  function resolve(value: string, depth = 0): string {
    assert.ok(depth < 20, 'Production paint variables must resolve without a cycle.');
    return value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_match, name: string, fallback: string | undefined) => {
      assert.ok(variables[name] !== undefined || fallback !== undefined, `Production paint token ${name} must exist.`);
      return resolve(variables[name] ?? fallback!, depth + 1);
    });
  }
  return Object.fromEntries(Object.entries(variables).map(([property, value]) => [property, resolve(value === 'inherit' ? inherited[property] ?? 'initial' : value)]));
}

function paintLength(value: string | undefined, reference: number, label: string) {
  if (value?.endsWith('%')) return pixels(`${Number.parseFloat(value) * reference / 100}px`, label);
  return pixels(value, label);
}

function controlBox(element: Element, environment: PaintEnvironment, available: number, containerLeft: number): PaintBox {
  const control = paintStyle({ element }, environment);
  const slot = element.children.find(child => (child.attributes.class ?? '').split(/\s+/).includes('toolbar-icon-slot'));
  assert.ok(slot, 'Production toolbar controls must contain their shared icon slot before computing their intrinsic box.');
  const iconSlot = paintStyle({ element: slot }, environment);
  const padding = (side: string) => pixels(control[`padding-${side}`] ?? '0', `Control ${side} padding`);
  const border = (side: string) => pixels(control[`border-${side}-width`] ?? '0', `Control ${side} border`);
  const intrinsicWidth = pixels(iconSlot.width, 'Control icon slot width') + padding('left') + padding('right') + border('left') + border('right');
  const intrinsicHeight = pixels(iconSlot.height, 'Control icon slot height') + padding('top') + padding('bottom') + border('top') + border('bottom');
  return {
    left: containerLeft + pixels(control['margin-left'] ?? '0', 'Control left margin'), top: 0,
    width: control.width === 'max-content' ? intrinsicWidth : paintLength(control.width, available, 'Control width'),
    height: Math.max(pixels(control['min-height'] ?? '0', 'Control minimum height'), control.height ? paintLength(control.height, 32, 'Control height') : intrinsicHeight),
  };
}

function paintTargets(element: Element): PaintTarget[] {
  return [{ element }, { element, pseudo: 'before' }, { element, pseudo: 'after' }, ...element.children.flatMap(paintTargets)];
}

function visiblePaint(target: PaintTarget, environment: PaintEnvironment) {
  const surface = paintStyle(target, environment);
  if (target.pseudo && (!surface.content || ['none', 'normal'].includes(surface.content))) return false;
  return surface.display !== 'none' && surface.visibility !== 'hidden' && surface.opacity !== '0'
    && !['transparent', 'rgba(0, 0, 0, 0)'].includes(surface['background-color'] ?? 'transparent');
}

function paintBox(target: PaintTarget, environment: PaintEnvironment, toggle: Element, control: PaintBox): PaintBox {
  if (target.element === toggle && !target.pseudo) return control;
  const surface = paintStyle(target, environment);
  const left = paintLength(surface.left ?? '0', control.width, 'Paint left offset');
  const top = paintLength(surface.top ?? '0', control.height, 'Paint top offset');
  return {
    left: control.left + left, top: control.top + top,
    width: surface.width && surface.width !== 'auto' ? paintLength(surface.width, control.width, 'Paint width') : control.width - left - paintLength(surface.right ?? '0', control.width, 'Paint right offset'),
    height: surface.height && surface.height !== 'auto' ? paintLength(surface.height, control.height, 'Paint height') : control.height - top - paintLength(surface.bottom ?? '0', control.height, 'Paint bottom offset'),
  };
}

test('rail toggle paints a 36px by 32px peer-aligned hover surface across sidebar states and responsive widths', () => {
  const { shell, sidebar, toggle, navigation } = workspace();
  for (const width of widths) for (const state of states) {
    const environment: PaintEnvironment = { width, state, reducedMotion: false, hovered: toggle };
    const container = paintStyle({ element: sidebar }, environment);
    const railWidth = pixels(paintStyle({ element: shell }, environment)['grid-template-columns'].split(/\s+/)[0], 'Rail width');
    const containerLeft = pixels(container['padding-left'], 'Rail left padding');
    const available = railWidth - containerLeft - pixels(container['padding-right'], 'Rail right padding');
    const control = controlBox(toggle, environment, available, containerLeft);
    assert.deepEqual(control, { left: 12, top: 0, width: 42, height: 32 }, `${width}px ${state}: narrowing paint must preserve the complete 42px by 32px hit target.`);
    const peerEnvironment = { ...environment, state: 'collapsed' as const, hovered: navigation };
    const peerContainer = paintStyle({ element: sidebar }, peerEnvironment);
    const peerLeft = pixels(peerContainer['padding-left'], 'Collapsed rail left padding');
    const peerRailWidth = pixels(paintStyle({ element: shell }, peerEnvironment)['grid-template-columns'].split(/\s+/)[0], 'Collapsed rail width');
    const peer = controlBox(navigation, peerEnvironment, peerRailWidth - peerLeft - pixels(peerContainer['padding-right'], 'Collapsed rail right padding'), peerLeft);
    assert.deepEqual(peer, { left: 12, top: 0, width: 36, height: 32 }, `${width}px: the actual collapsed peer establishes the target surface geometry.`);
    const surfaces = paintTargets(toggle).filter(target => visiblePaint(target, environment));
    assert.ok(surfaces.length > 0, `${width}px ${state}: hovering the actual toggle must paint a surface.`);
    for (const target of surfaces) {
      assert.deepEqual(paintBox(target, environment, toggle, control), peer, `${width}px ${state}: every visible hover layer must match the 36px by 32px peer at the 12px left edge, without painting the full 42px hit target.`);
      const radius = paintStyle(target, environment)['border-radius'];
      assert.equal(radius, paintStyle({ element: navigation }, peerEnvironment)['border-radius'], `${width}px ${state}: hover corners match the navigation peer.`);
      assert.equal(radius, '8px', `${width}px ${state}: the hover frame retains the established 8px radius.`);
    }
  }
});

function backgroundTransition(surface: Record<string, string>, label: string) {
  const properties = splitList(surface['transition-property'] ?? 'all');
  const index = properties.findLastIndex(property => ['all', 'background', 'background-color'].includes(property));
  assert.ok(index >= 0, `${label}: the paint surface must transition its background.`);
  const durations = splitList(surface['transition-duration'] ?? '0s');
  const timing = splitList(surface['transition-timing-function'] ?? 'ease');
  return { duration: durations[index % durations.length], timing: timing[index % timing.length] };
}

test('rail toggle hover paint preserves navigation hover and selection fills and reduced-motion treatment', () => {
  const { toggle, navigation } = workspace();
  const group = navigation.parent!;
  const refresh = group.children.find(element => element.attributes['aria-label'] === 'Refresh repositories');
  assert.ok(refresh, 'The actual SSR fixture must expose the unselected Refresh repositories peer.');
  assert.equal(navigation.attributes['aria-pressed'], 'true', 'All repositories supplies an independently selected peer.');
  assert.equal((refresh.attributes.class ?? '').split(/\s+/).includes('active'), false, 'Refresh repositories supplies an independently unselected peer.');
  for (const width of widths) for (const state of states) {
    const environment: PaintEnvironment = { width, state, reducedMotion: false };
    const selected = paintStyle({ element: navigation }, environment);
    const peerHover = paintStyle({ element: refresh }, { ...environment, hovered: refresh });
    assert.equal(selected['background-color'], selected['--surface-active'], `${width}px ${state}: the selected peer retains the active fill.`);
    assert.equal(paintStyle({ element: navigation }, { ...environment, hovered: navigation })['background-color'], selected['--surface-active'], `${width}px ${state}: selected navigation keeps its active fill while hovered.`);
    assert.equal(peerHover['background-color'], peerHover['--surface-hover'], `${width}px ${state}: an unselected navigation peer uses the hover fill.`);
    assert.notEqual(peerHover['background-color'], selected['background-color'], `${width}px ${state}: hover and selected states remain distinct.`);
    assert.equal(paintStyle({ element: refresh }, environment)['background-color'], 'transparent', `${width}px ${state}: an unselected resting peer remains clear.`);
    assert.deepEqual(backgroundTransition(peerHover, 'Navigation peer'), { duration: '140ms', timing: 'cubic-bezier(0.4, 0, 0.2, 1)' }, `${width}px ${state}: navigation hover retains its established transition.`);
    assert.equal(paintTargets(toggle).some(target => visiblePaint(target, environment)), false, `${width}px ${state}: the resting toggle has no hover fill.`);
    const hovered = { ...environment, hovered: toggle };
    const surfaces = paintTargets(toggle).filter(target => visiblePaint(target, hovered));
    assert.ok(surfaces.length > 0, `${width}px ${state}: hover produces observable toggle paint.`);
    for (const target of surfaces) {
      const surface = paintStyle(target, hovered);
      assert.equal(surface['background-color'], peerHover['background-color'], `${width}px ${state}: the toggle paints the same hover fill as an unselected navigation peer.`);
      assert.deepEqual(backgroundTransition(surface, 'Toggle paint'), backgroundTransition(peerHover, 'Navigation peer'), `${width}px ${state}: the actual paint surface retains the peer background timing and easing.`);
      const reduced = paintStyle(target, { ...hovered, reducedMotion: true });
      assert.equal(reduced['transition-duration'], '.001ms', `${width}px ${state}: reduced motion suppresses the actual hover paint transition, including generated surfaces.`);
      assert.equal(reduced['animation-duration'], '.001ms', `${width}px ${state}: reduced motion suppresses animation on the actual hover paint surface.`);
    }
  }
});
