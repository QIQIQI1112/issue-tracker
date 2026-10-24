import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import type { Fixture, Host } from './dropdown-fixture.ts';

function stylesheet(url: URL): string {
  return readFileSync(url, 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g, (_match, path: string) => stylesheet(new URL(path, url)));
}
const css = postcss.parse(stylesheet(new URL('../src/ui/styles.css', import.meta.url)));
type State = { hover?: boolean; focus?: boolean; pseudo?: string };
function matches(selector: string, node: Host, state: State = {}): boolean {
  if (selector.includes('[data-theme="dark"]')) return false;
  if (selector.trim() === ':root') return node === node.fixture.root;
  if (/::[\w-]+/.test(selector)) {
    if (!state.pseudo || !selector.includes(state.pseudo)) return false;
    selector = selector.replace(/::[\w-]+/g, '');
  } else if (state.pseudo) return false;
  if (selector.includes(':hover') && !state.hover || /:focus(?:-visible)?/.test(selector) && !state.focus) return false;
  if (selector.includes(':not(.modal)') && node.matches('.modal')) return false;
  selector = selector.replace(':not(.modal)', '');
  selector = selector.replace(/:hover|:focus-visible|:focus(?!-)|:root|:not\(:disabled\)/g, '').trim();
  if (selector.includes(':')) return false;
  const parts = selector.split(/\s+/).filter(Boolean);
  const last = parts.pop() ?? '*';
  if (!node.matches(last)) return false;
  let ancestor = node.parentElement;
  while (parts.length) {
    const part = parts.pop()!;
    if (part === '>') { if (!ancestor?.matches(parts.pop()!)) return false; ancestor = ancestor.parentElement; }
    else { while (ancestor && !ancestor.matches(part)) ancestor = ancestor.parentElement; if (!ancestor) return false; ancestor = ancestor.parentElement; }
  }
  return true;
}
export function declarations(node: Host, state: State = {}): Record<string, string> {
  const winners = new Map<string, { priority: number; value: string }>();
  css.walkRules(rule => {
    let parent: postcss.Container | postcss.Document | undefined = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' && (parent as postcss.AtRule).name === 'media') {
        const boundary = (parent as postcss.AtRule).params.match(/\((max|min)-width:\s*(\d+)px\)/);
        if (boundary && (boundary[1] === 'max' ? node.fixture.viewport.width > Number(boundary[2]) : node.fixture.viewport.width < Number(boundary[2]))) return;
        if ((parent as postcss.AtRule).params.includes('prefers-reduced-motion')) return;
      }
      parent = parent.parent;
    }
    for (const selector of rule.selectors) {
      if (!matches(selector, node, state)) continue;
      const specificity = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0) * 100 + (selector.match(/(?:^|[ >])[a-z]+/g)?.length ?? 0);
      rule.walkDecls(declaration => {
        const priority = specificity + (declaration.important ? 100000 : 0);
        if (priority >= (winners.get(declaration.prop)?.priority ?? -1)) winners.set(declaration.prop, { priority, value: declaration.value });
      });
    }
  });
  const result = Object.fromEntries([...winners].map(([name, value]) => [name, value.value]));
  if (!state.pseudo) for (const [key, value] of Object.entries(node.style)) result[key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())] = typeof value === 'number' ? value + 'px' : String(value);
  return result;
}
export function length(value: string | undefined, total: number, fixture: Fixture): number {
  if (!value) return NaN;
  const tokens: Record<string, string> = {};
  css.walkRules(rule => { if (rule.selector === ':root') rule.walkDecls(declaration => { tokens[declaration.prop] = declaration.value; }); });
  for (let pass = 0; pass < 10 && value.includes('var('); pass++) value = value.replace(/var\((--[\w-]+)\)/g, (_match, name: string) => tokens[name] ?? 'invalid');
  value = value.replace(/([\d.]+)(px|dvh|vh|dvw|vw|rem|%)/g, (_match, number: string, unit: string) => String(Number(number) * (unit === '%' ? total / 100 : /vh/.test(unit) ? fixture.viewport.height / 100 : /vw/.test(unit) ? fixture.viewport.width / 100 : unit === 'rem' ? 16 : 1)));
  value = value.replace(/calc\(/g, '(');
  if (!/^[\d.\s,+*/()-]*(?:(?:min|max|clamp)[\d.\s,+*/()-]*)*$/.test(value)) return NaN;
  return Function('min', 'max', 'clamp', `return (${value})`)(Math.min, Math.max, (low: number, middle: number, high: number) => Math.max(low, Math.min(high, middle))) as number;
}
export function effective(node: Host, property: string, state: State = {}): string {
  const value = declarations(node, state)[property];
  if (value && value !== 'inherit') return value;
  return node.parentElement ? effective(node.parentElement, property, state) : '';
}

