import assert from 'node:assert/strict';
import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Issues } from '../src/ui/features/issues/Issues.tsx';
import { useIssueCollection } from '../src/ui/shared/useIssueCollection.ts';
import type { Issue } from '../src/domain.ts';
import type { Job, Workbench, WorkRun } from '../src/workflow.ts';
import { declarations } from './dropdown-styles.ts';

export const now = '2026-10-20T00:00:00.000Z';
export const repo = { id: 1, name: 'Dropdown fixture', path: '/disposable/dropdown', targetBranch: 'main', createdAt: now };
export const requirement = { id: 1, repoId: 1, title: 'Scoped goal', goal: 'Preserve inspection', status: 'running' as const, createdAt: now, updatedAt: now };
export function issue(id = 37, changes: Partial<Issue> = {}): Issue {
  return { id, title: `Neutral ${id}`, description: '', status: 'open', priority: 'medium', labels: ['alpha', 'beta'], createdAt: now, updatedAt: now, work: { repoId: 1, requirementId: 1, dependsOn: [], acceptance: ['Inspect evidence'] }, ...changes };
}
export function run(id: number, issueId: number | null = 37, changes: Partial<WorkRun> = {}): WorkRun {
  return { id: `run-${id}`, jobId: id, repoId: 1, requirementId: 1, issueId, status: 'passed', evidencePath: `/disposable/dropdown/${id}`, reason: null, startedAt: now, completedAt: now, ...changes };
}
export function job(id: number, kind: Job['kind'] = 'issue', issueId: number | null = 37): Job {
  return { id, kind, issueId, repoId: 1, requirementId: 1, status: 'completed', payload: '{}', runId: `run-${id}`, reason: null, createdAt: now, updatedAt: now };
}
export function workbench(): Workbench {
  return { repos: [repo], requirements: [requirement], jobs: [job(1), job(2), job(3, 'plan_review', null), job(4, 'requirement_verify', null), { ...job(9, 'decompose', null), repoId: 2 }], runs: [run(1), run(2, 37, { status: 'merged' }), run(3, null), run(4, null), run(9, null, { repoId: 2 })] };
}
export function IssueFixture({ records = [issue()], labelFilter }: { records?: Issue[]; labelFilter?: string }) {
  const collection = useIssueCollection(records, '1');
  React.useEffect(() => { if (labelFilter !== undefined) collection.changeLabel(labelFilter); }, [labelFilter]);
  return React.createElement(Issues, { collection, issues: records, loading: false, loadError: null, retryIssues: () => {}, resetFilters: collection.resetFilters, onIssue: () => {} });
}

type Props = Record<string, unknown>;
type Component = (props: Props) => ReactNode;
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
export type InputEvent = { key: string; shiftKey: boolean; defaultPrevented: boolean; propagationStopped: boolean; target: Host; currentTarget: Host; preventDefault: () => void; stopPropagation: () => void };
export class Host {
  props: Props = {};
  parentElement: Host | null = null;
  children: Host[] = [];
  content = '';
  owner?: Component;
  ownerInput?: ReactElement<Props>;
  style: Record<string, unknown> = {};
  scrollTop = 0;
  isConnected = true;
  constructor(public tagName: string, public fixture: Fixture) {}
  get textContent(): string { return this.content + this.children.map(child => child.textContent).join(''); }
  get id() { return String(this.props.id ?? ''); }
  get value() { return String(this.props.value ?? ''); }
  get disabled() { return Boolean(this.props.disabled); }
  getAttribute(name: string) { const value = this.props[name]; return value === undefined ? null : String(value); }
  contains(node: Host | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  focus() { this.fixture.document.activeElement = this; }
  scrollIntoView() {}
  showModal() { this.props.open = true; }
  close() { this.props.open = false; }
  getClientRects() {
    if (this.props.hidden || declarations(this).display === 'none') return [];
    for (let node = this.parentElement; node; node = node.parentElement) {
      if (node.props.hidden || declarations(node).display === 'none') return [];
    }
    return [this.getBoundingClientRect()];
  }
  getBoundingClientRect() { return { ...this.fixture.rect }; }
  matches(selector: string): boolean {
    return selector.split(/,(?![^()]*\))/).some(part => {
      const text = part.trim();
      if (text.includes(':disabled') && this.disabled) return false;
      if (text.includes(':not([hidden])') && this.props.hidden) return false;
      const tag = text.match(/^[a-z]+/i)?.[0];
      if (tag && tag !== this.tagName.toLowerCase()) return false;
      for (const match of text.matchAll(/\.([\w-]+)/g)) if (!String(this.props.className ?? '').split(/\s+/).includes(match[1])) return false;
      for (const match of text.replace(/:not\([^)]*\)/g, '').matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g)) {
        const value = this.getAttribute(match[1]);
        if (value === null || match[2] !== undefined && value !== match[2]) return false;
      }
      return true;
    });
  }
  closest(selector: string): Host | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll<T = Host>(selector: string): T[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]) as T[]; }
}

export class Fixture {
  root = new Host('root', this);
  rect = { left: 282, right: 382, top: 530, bottom: 562, width: 100, height: 32, x: 282, y: 530 };
  viewport = { width: 390, height: 600 };
  document = { activeElement: null as Host | null, body: new Host('body', this), documentElement: { dataset: {} as Record<string, string> }, addEventListener: (name: string, callback: EventListener) => this.listen(name, callback), removeEventListener: (name: string, callback: EventListener) => this.listeners.get(name)?.delete(callback), getElementById: (id: string) => this.all().find(node => node.id === id) ?? null };
  listeners = new Map<string, Set<EventListener>>();
  intervals = new Map<number, () => void>();
  requests: string[] = [];
  callbacks: { args: unknown[] }[] = [];
  response: (url: string) => unknown = url => url.startsWith('/api/issues/') ? { issue: issue(), runs: [run(1), run(2), run(7, 99), run(8, 37, { repoId: 2 })] } : { run: workbench().runs.find(value => url.endsWith(value.id)) ?? run(1), delivery: null };
  private cells = new Map<string, Slot[]>();
  private hosts = new Map<string, Host>();
  private effects: (() => void)[] = [];
  private restore: (() => void)[] = [];
  private dirty = false;
  private input: ReactNode = null;
  constructor() {
    const replace = (key: string, value: unknown) => {
      const old = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      this.restore.push(() => old ? Object.defineProperty(globalThis, key, old) : Reflect.deleteProperty(globalThis, key));
    };
    replace('document', this.document);
    replace('window', { innerWidth: this.viewport.width, innerHeight: this.viewport.height, addEventListener: this.document.addEventListener, removeEventListener: this.document.removeEventListener, visualViewport: null });
    replace('HTMLElement', Host);
    replace('Node', Host);
    replace('setInterval', (callback: () => void) => { const id = this.intervals.size + 1; this.intervals.set(id, callback); return id; });
    replace('clearInterval', (id: number) => this.intervals.delete(id));
    replace('fetch', async (url: string) => { this.requests.push(String(url)); const data = this.response(String(url)); return typeof data === 'string' ? new Response(data) : Response.json(data); });
  }
  listen(name: string, callback: EventListener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name)!.add(callback); }
  all() { return this.root.querySelectorAll<Host>('*'); }
  named(name: string, role?: string) { return this.all().find(node => node.props['aria-label'] === name && (!role || node.props.role === role)); }
  combobox(name: string) {
    const found = this.named(name, 'combobox');
    assert.ok(found, `${name} must expose a custom named combobox trigger rather than an active native select.`);
    assert.notEqual(found.tagName, 'select', `${name} must open a custom visual option panel.`);
    return found;
  }
  options() { return this.all().filter(node => node.props.role === 'option'); }
  panel() { return this.all().find(node => node.props.role === 'listbox' && !node.props.hidden); }
  active(trigger: Host) { return this.all().find(node => node.id === trigger.props['aria-activedescendant']); }
  event(node: Host, type: string, key = '', shiftKey = false) {
    const event: InputEvent = { key, shiftKey, defaultPrevented: false, propagationStopped: false, target: node, currentTarget: node, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
    for (const listener of [...this.listeners.get(type.toLowerCase()) ?? []]) listener(event as unknown as Event);
    for (let current: Host | null = node; current && !event.propagationStopped; current = current.parentElement) {
      event.currentTarget = current;
      const handler = current.props[`on${type}`] as ((event: InputEvent) => void) | undefined;
      handler?.(event);
    }
    this.render();
    return event;
  }
  click(node: Host) { const pointer = this.event(node, 'PointerDown'); const mouse = this.event(node, 'MouseDown'); if (!node.disabled && !pointer.defaultPrevented && !mouse.defaultPrevented) node.focus(); return this.event(node, 'Click'); }
  key(node: Host, key: string, shiftKey = false) { return this.event(node, 'KeyDown', key, shiftKey); }
  mount(input: ReactNode) { this.input = input; this.render(); }
  render() {
    let iterations = 0;
    do {
      assert.ok(iterations++ < 30, 'The Node component fixture must settle synchronous hook updates.');
      this.dirty = false;
      this.root.children = this.expand(this.input, 'root', this.root);
      const effects = this.effects.splice(0);
      effects.forEach(effect => effect());
    } while (this.dirty);
  }
  private expand(input: ReactNode, path: string, parent: Host, owner?: Component, ownerInput?: ReactElement<Props>): Host[] {
    if (input === null || input === undefined || typeof input === 'boolean') return [];
    if (Array.isArray(input)) return input.flatMap((child, index) => this.expand(child, `${path}.${index}`, parent, owner, ownerInput));
    if (typeof input === 'string' || typeof input === 'number' || typeof input === 'bigint') { const host = new Host('#text', this); host.content = String(input); host.parentElement = parent; return [host]; }
    const element = input as ReactElement<Props>;
    const type = element.type;
    if (typeof type === 'symbol') return this.expand(element.props.children as ReactNode, path, parent, owner, ownerInput);
    if (typeof type === 'function') {
      const component = type as Component;
      const identity = `${path}/${component.name}:${element.key ?? ''}`;
      const slots = this.cells.get(identity) ?? [];
      this.cells.set(identity, slots);
      let cursor = 0;
      const slot = () => slots[cursor] ?? (slots[cursor] = {});
      const state = (initial: unknown) => { const cell = slot(); if (!('value' in cell)) cell.value = typeof initial === 'function' ? initial() : initial; cursor++; return [cell.value, (next: unknown) => { const value = typeof next === 'function' ? next(cell.value) : next; if (!Object.is(value, cell.value)) { cell.value = value; this.dirty = true; } }]; };
      const memo = (callback: () => unknown, deps: unknown[] = []) => { const cell = slot(); cursor++; if (!cell.deps || deps.some((value, index) => !Object.is(value, cell.deps![index]))) { cell.value = callback(); cell.deps = deps; } return cell.value; };
      const effect = (callback: () => (() => void) | void, deps?: unknown[]) => { const cell = slot(); cursor++; if (!deps || !cell.deps || deps.some((value, index) => !Object.is(value, cell.deps![index]))) { cell.deps = deps; this.effects.push(() => { cell.cleanup?.(); cell.cleanup = callback() ?? undefined; }); } };
      const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown } }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = { useState: state, useRef: (value: unknown) => memo(() => ({ current: value }), []), useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect, useId: () => memo(() => `fixture-${identity.replace(/[^\w-]/g, '-')}-${cursor}`, []) };
      let output: ReactNode;
      try {
        const props = { ...element.props };
        const callback = props.onChange;
        if (typeof callback === 'function') props.onChange = (...args: unknown[]) => { this.callbacks.push({ args }); return callback(...args); };
        output = component(props);
      } finally { internals.H = previous; }
      return this.expand(output, identity, parent, component, element);
    }
    assert.equal(typeof type, 'string', 'The fixture supports production function components and host elements.');
    let host = this.hosts.get(path);
    if (!host) { host = new Host(String(type), this); this.hosts.set(path, host); }
    host.props = { ...element.props };
    host.owner = owner;
    host.ownerInput = ownerInput;
    host.style = element.props.style as Record<string, unknown> ?? {};
    host.parentElement = parent;
    host.children = this.expand(element.props.children as ReactNode, `${path}.children`, host, owner, ownerInput);
    const ref = element.props.ref;
    if (typeof ref === 'function') ref(host);
    else if (ref && typeof ref === 'object') (ref as { current: Host }).current = host;
    return [host];
  }
  async settle() { for (let i = 0; i < 8; i++) { await new Promise<void>(resolve => setImmediate(resolve)); this.render(); } }
  async refresh() { [...this.intervals.values()].forEach(callback => callback()); await this.settle(); }
  dispose() { for (const slots of this.cells.values()) for (const slot of slots) slot.cleanup?.(); this.restore.reverse().forEach(restore => restore()); }
}

export function open(fixture: Fixture, name: string) {
  const trigger = fixture.combobox(name);
  fixture.click(trigger);
  assert.ok(fixture.panel(), `${name} must open an actual custom listbox on deliberate activation.`);
  return trigger;
}
export function choose(fixture: Fixture, name: string, label: string) {
  const trigger = open(fixture, name);
  const option = fixture.options().find(node => node.textContent.trim() === label);
  assert.ok(option, `${name} must expose the current option ${label}.`);
  fixture.click(option);
  assert.equal(trigger.props['aria-expanded'], false, 'Committing a custom option closes its panel.');
  return trigger;
}
